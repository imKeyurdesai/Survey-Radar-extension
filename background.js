import { AttaPollProvider } from './providers/AttaPollProvider.js';
import { API } from './utils/api.js';

let activeProvider = null;
let currentProjectId = null;
let currentWorkerId = null;
let currentWorkerName = null;
let currentToken = null;
let currentUserEmailId = null;
let isActive = false;
let pollingInterval = 60000; // 1 minute default
let intervalId = null;
let reportedSurveyHashes = new Set();
let hasNotifiedAttaPollExpired = false;
let lastAutoReloadTime = 0;

// Initialize from storage
chrome.storage.local.get(
  ['projectId', 'workerId', 'workerName', 'token', 'userEmailId', 'isActive', 'pollingInterval'], 
  (data) => {
    if (data.projectId) currentProjectId = data.projectId;
    if (data.workerId) currentWorkerId = data.workerId;
    if (data.workerName) currentWorkerName = data.workerName;
    if (data.token) currentToken = data.token;
    if (data.userEmailId) currentUserEmailId = data.userEmailId;
    if (data.pollingInterval) pollingInterval = data.pollingInterval;
    
    updateBadge();

    if (data.isActive && data.userEmailId) {
      startWorker(data.userEmailId);
    }
  }
);

// Sniff outgoing requests to capture the Firebase JWT and AttaPoll headers
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const interceptedHeaders = {};
    for (const header of details.requestHeaders) {
      const name = header.name.toLowerCase();
      if (name === 'authorization' || name.startsWith('x-attapoll-')) {
        interceptedHeaders[name] = header.value;
      }
    }
    
    if (interceptedHeaders['authorization']) {
      chrome.storage.local.set({ 
        attapollHeaders: interceptedHeaders,
        attaPollStatus: 'VALID'
      });
      hasNotifiedAttaPollExpired = false;
      updateBadge();
      console.log('[Worker] Sniffed fresh API Auth Token from browser traffic!');
    }
    
    return { requestHeaders: details.requestHeaders };
  },
  { urls: ["*://attapoll.app/api/v3/*"] },
  ["requestHeaders"] // No "extraHeaders" needed unless cross-site cookies, but we just want Auth headers
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_WORKER') {
    startWorker(message.userEmailId);
    sendResponse({ success: true });
  } else if (message.type === 'STOP_WORKER') {
    stopWorker();
    sendResponse({ success: true });
  } else if (message.type === 'UPDATE_CONFIG') {
    currentProjectId = message.projectId;
    currentWorkerId = message.workerId;
    currentWorkerName = message.workerName;
    currentToken = message.token;
    if (message.pollingInterval) {
      pollingInterval = message.pollingInterval;
      if (isActive) {
        if (intervalId) clearInterval(intervalId);
        intervalId = setInterval(pollAndReport, pollingInterval);
      }
    }
    
    // Save to storage
    chrome.storage.local.set({
      projectId: currentProjectId,
      workerId: currentWorkerId,
      workerName: currentWorkerName,
      token: currentToken,
      pollingInterval
    });
    
    sendResponse({ success: true });
  }
  return true;
});

function startWorker(userEmailId) {
  currentUserEmailId = userEmailId;
  isActive = true;

  chrome.storage.local.set({ isActive: true, userEmailId });
  activeProvider = new AttaPollProvider(userEmailId);
  activeProvider.start();
  
  chrome.alarms.clearAll();
  chrome.alarms.create('pollSurveys', { periodInMinutes: Math.max(pollingInterval / 60000, 1) });
  chrome.alarms.create('heartbeat', { periodInMinutes: 1 });
  
  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(pollAndReport, pollingInterval);
  
  // Register worker with backend
  if (currentProjectId && currentWorkerId && currentToken) {
    API.request(
      '/workers/register',
      'POST',
      { workerId: currentWorkerId, projectId: currentProjectId, name: currentWorkerName, browser: 'Chrome', version: '1.0' },
      currentToken
    ).catch(e => {
      console.log('Worker registration error', e);
      if (e.message && (e.message.includes('session has expired') || e.message.includes('Not authorized'))) {
        handleBackendAuthFailure();
      }
    });
  }
  
  updateBadge();

  // Immediate poll — uses in-memory vars, no storage race condition
  pollAndReport();
  sendHeartbeat();
}

function stopWorker() {
  isActive = false;
  if (intervalId) clearInterval(intervalId);
  if (activeProvider) {
    activeProvider.stop();
  }
  chrome.alarms.clearAll();
  chrome.storage.local.set({ isActive: false });
  updateBadge();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pollSurveys') {
    pollAndReport();
  } else if (alarm.name === 'heartbeat') {
    sendHeartbeat();
  }
});

async function pollAndReport() {
  // Use in-memory variables — avoids storage race condition
  if (!isActive || !currentProjectId || !currentWorkerId || !currentToken || !currentUserEmailId) {
    console.log('[Worker] Skipping poll — missing config:', { isActive, currentProjectId: !!currentProjectId, currentWorkerId: !!currentWorkerId, currentToken: !!currentToken, currentUserEmailId: !!currentUserEmailId });
    return;
  }
  
  if (!activeProvider) {
    activeProvider = new AttaPollProvider(currentUserEmailId);
    activeProvider.start();
  }

  try {
    console.log('[Worker] Polling AttaPoll for surveys...');
    const surveys = await activeProvider.detectNewSurveys();
    
    // Save last checked time and status as healthy
    chrome.storage.local.set({ 
      lastChecked: new Date().toISOString(), 
      lastStatus: 'Success',
      attaPollStatus: 'VALID'
    });
    hasNotifiedAttaPollExpired = false;
    updateBadge();
    console.log(`[Worker] Poll complete. Found ${surveys.length} survey(s).`);
    
    if (surveys && surveys.length > 0) {
      // Filter out surveys already reported in this session
      const newSurveys = surveys.filter(s => {
        const hash = `${s.provider}-${s.surveyId || s.title}-${s.reward || ''}`;
        if (reportedSurveyHashes.has(hash)) return false;
        reportedSurveyHashes.add(hash);
        return true;
      });
      
      if (newSurveys.length > 0) {
        // Notify backend
        await API.request(
          `/surveys/${currentProjectId}/report`,
          'POST',
          { surveys: newSurveys },
          currentToken,
          currentWorkerId
        );
        
        // Local notification
        chrome.notifications.create(`survey-${Date.now()}`, {
          type: 'basic',
          iconUrl: 'assets/icon.png',
          title: 'New Surveys Available!',
          message: `Detected ${newSurveys.length} new survey(s) on AttaPoll`
        });
      } else {
        console.log('[Worker] Surveys detected, but all were already reported in this session.');
      }
    }
  } catch (error) {
    console.error('[Worker] Error in polling loop:', error);

    const isBackendAuthError = error.message && (
      error.message.includes('session has expired') || 
      error.message.includes('Not authorized')
    );

    const isAttaPollAuthError = error.message && (
      error.message.includes('ATTAPOLL_AUTH_EXPIRED') || 
      error.message.includes('ATTAPOLL_AUTH_MISSING') || 
      error.message.includes('401') || 
      error.message.includes('403')
    );

    if (isBackendAuthError) {
      handleBackendAuthFailure();
      return;
    }

    if (isAttaPollAuthError) {
      handleAttaPollAuthFailure(error.message);
    } else {
      chrome.storage.local.set({ 
        lastChecked: new Date().toISOString(), 
        lastStatus: error.message || 'Error occurred' 
      });
    }
  }
}

async function sendHeartbeat() {
  if (!isActive || !currentProjectId || !currentWorkerId || !currentToken) return;
  
  try {
    await API.request(
      `/workers/heartbeat`,
      'POST',
      { workerId: currentWorkerId, name: currentWorkerName },
      currentToken,
      currentWorkerId
    );
  } catch (error) {
    console.error('[Worker] Failed to send heartbeat', error);
    if (error.message && (error.message.includes('session has expired') || error.message.includes('Not authorized'))) {
      handleBackendAuthFailure();
    }
  }
}

function handleAttaPollAuthFailure(errorMessage) {
  chrome.storage.local.set({ 
    attaPollStatus: 'EXPIRED',
    lastChecked: new Date().toISOString(),
    lastStatus: 'AttaPoll Token Expired'
  });
  
  updateBadge('!');

  // Auto-recovery: If an AttaPoll tab is already open, reload it to get fresh token (cooldown 90s)
  const now = Date.now();
  if (now - lastAutoReloadTime > 90000) {
    lastAutoReloadTime = now;
    chrome.tabs.query({ url: "*://*.attapoll.app/*" }, (tabs) => {
      if (tabs && tabs.length > 0) {
        console.log('[Worker] Auto-reloading AttaPoll tab to capture fresh token...');
        chrome.tabs.reload(tabs[0].id);
      }
    });
  }

  // Notify user on desktop (only once per expiry)
  if (!hasNotifiedAttaPollExpired) {
    hasNotifiedAttaPollExpired = true;
    chrome.notifications.create('attapoll-token-expired', {
      type: 'basic',
      iconUrl: 'assets/icon.png',
      title: '⚠️ AttaPoll Session Expired',
      message: 'Survey alerts are paused. Click here or refresh your AttaPoll tab to reconnect.'
    });
  }
}

function handleBackendAuthFailure() {
  console.warn('[Worker] Survey Radar backend session expired. Stopping worker and logging out.');
  stopWorker();
  chrome.storage.local.remove(['token', 'isActive', 'workerId']);
  chrome.storage.local.set({ sessionExpired: true });
  updateBadge('LOG');
  chrome.notifications.create('backend-session-expired', {
    type: 'basic',
    iconUrl: 'assets/icon.png',
    title: '🔒 Survey Radar Logged Out',
    message: 'Your account session expired. Please open the extension and log in again.'
  });
}

function updateBadge(overrideText = null) {
  if (overrideText) {
    chrome.action.setBadgeText({ text: overrideText });
    chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
    return;
  }

  chrome.storage.local.get(['isActive', 'attaPollStatus', 'token'], (data) => {
    if (!data.token) {
      chrome.action.setBadgeText({ text: '' });
    } else if (data.attaPollStatus === 'EXPIRED') {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#EAB308' });
    } else if (data.isActive) {
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#10B981' });
    } else {
      chrome.action.setBadgeText({ text: 'OFF' });
      chrome.action.setBadgeBackgroundColor({ color: '#64748B' });
    }
  });
}

chrome.notifications.onClicked.addListener((notifId) => {
  if (notifId === 'attapoll-token-expired') {
    chrome.tabs.query({ url: "*://*.attapoll.app/*" }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
        chrome.tabs.reload(tabs[0].id);
      } else {
        chrome.tabs.create({ url: 'https://attapoll.app/' });
      }
    });
  }
});
