import { AttaPollProvider } from './providers/AttaPollProvider.js';
import { API } from './utils/api.js';

let activeProvider = null;
let currentProjectId = null;
let currentWorkerId = null;
let currentToken = null;
let currentUserEmailId = null;
let isActive = false;
let pollingInterval = 60000; // 1 minute default
let intervalId = null;

// Initialize from storage
chrome.storage.local.get(
  ['projectId', 'workerId', 'token', 'userEmailId', 'isActive', 'pollingInterval'], 
  (data) => {
    if (data.projectId) currentProjectId = data.projectId;
    if (data.workerId) currentWorkerId = data.workerId;
    if (data.token) currentToken = data.token;
    if (data.userEmailId) currentUserEmailId = data.userEmailId;
    if (data.pollingInterval) pollingInterval = data.pollingInterval;
    
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
      chrome.storage.local.set({ attapollHeaders: interceptedHeaders });
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
    currentToken = message.token;
    if (message.pollingInterval) pollingInterval = message.pollingInterval;
    
    // Save to storage
    chrome.storage.local.set({
      projectId: currentProjectId,
      workerId: currentWorkerId,
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
  
  // Register worker with backend
  if (currentProjectId && currentWorkerId && currentToken) {
    API.request(
      '/workers/register',
      'POST',
      { workerId: currentWorkerId, projectId: currentProjectId, browser: 'Chrome', version: '1.0' },
      currentToken
    ).catch(e => console.log('Worker registration error', e));
  }
  
  // Immediate poll — uses in-memory vars, no storage race condition
  pollAndReport();
  sendHeartbeat();
}

function stopWorker() {
  isActive = false;
  if (activeProvider) {
    activeProvider.stop();
  }
  chrome.alarms.clearAll();
  chrome.storage.local.set({ isActive: false });
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
    
    // Save last checked time and status
    chrome.storage.local.set({ lastChecked: new Date().toISOString(), lastStatus: 'Success' });
    console.log(`[Worker] Poll complete. Found ${surveys.length} survey(s).`);
    
    if (surveys && surveys.length > 0) {
      // Notify backend
      await API.request(
        `/surveys/${currentProjectId}/report`,
        'POST',
        { surveys },
        currentToken,
        currentWorkerId
      );
      
      // Local notification
      chrome.notifications.create(`survey-${Date.now()}`, {
        type: 'basic',
        iconUrl: 'assets/icon.png',
        title: 'New Surveys Available!',
        message: `Detected ${surveys.length} new survey(s) on AttaPoll`
      });
    }
  } catch (error) {
    console.error('[Worker] Error in polling loop:', error);
    chrome.storage.local.set({ 
      lastChecked: new Date().toISOString(), 
      lastStatus: error.message || 'Error occurred' 
    });
  }
}

async function sendHeartbeat() {
  if (!isActive || !currentProjectId || !currentWorkerId || !currentToken) return;
  
  try {
    await API.request(
      `/workers/heartbeat`,
      'POST',
      { workerId: currentWorkerId },
      currentToken,
      currentWorkerId
    );
  } catch (error) {
    console.error('[Worker] Failed to send heartbeat', error);
  }
}
