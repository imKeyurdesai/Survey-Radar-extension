import { API } from '../utils/api.js';

document.addEventListener('DOMContentLoaded', async () => {
  const loginView = document.getElementById('loginView');
  const mainView = document.getElementById('mainView');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const toggleWorkerBtn = document.getElementById('toggleWorkerBtn');
  const saveConfigBtn = document.getElementById('saveConfigBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const toast = document.getElementById('toast');
  const lastCheckedText = document.getElementById('lastCheckedText');
  const lastStatusText = document.getElementById('lastStatusText');
  const statusIndicator = document.getElementById('statusIndicator');
  const openAttaPollBtn = document.getElementById('openAttaPollBtn');
  const attaPollAlert = document.getElementById('attaPollAlert');

  // Check state on popup load
  chrome.storage.local.get(
    ['token', 'sessionExpired', 'projectId', 'userEmailId', 'pollingInterval', 'isActive', 'workerId', 'workerName', 'lastChecked', 'lastStatus', 'attaPollStatus'], 
    (data) => {
      if (data.token && !data.sessionExpired) {
        showMain(data);
      } else {
        showLogin(data.sessionExpired ? 'Your session expired. Please log in again.' : null);
      }
    }
  );

  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  loginBtn.addEventListener('click', async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('loginError');
    
    try {
      errorEl.classList.add('hidden');
      const res = await API.request('/auth/login', 'POST', { email, password });
      
      const token = res.data.token;
      // create a mock worker id for this session
      const workerId = `ext-${Math.random().toString(36).substring(2, 9)}`;
      
      await chrome.storage.local.remove(['sessionExpired']);
      await chrome.storage.local.set({ token, workerId });
      showMain({ token, workerId, pollingInterval: 30000 });
    } catch (err) {
      errorEl.textContent = err.message || 'Login failed';
      errorEl.classList.remove('hidden');
    }
  });

  logoutBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_WORKER' });
    chrome.storage.local.remove(['token', 'projectId', 'userEmailId', 'isActive', 'workerId', 'sessionExpired']);
    showLogin();
  });

  if (openAttaPollBtn) {
    openAttaPollBtn.addEventListener('click', () => {
      chrome.tabs.query({ url: "*://*.attapoll.app/*" }, (tabs) => {
        if (tabs && tabs.length > 0) {
          chrome.tabs.update(tabs[0].id, { active: true });
          chrome.windows.update(tabs[0].windowId, { focused: true });
          chrome.tabs.reload(tabs[0].id);
        } else {
          chrome.tabs.create({ url: 'https://attapoll.app/' });
        }
      });
      showToast('Opening AttaPoll tab...');
    });
  }

  saveConfigBtn.addEventListener('click', () => {
    const projectId = document.getElementById('projectId').value;
    const userEmailId = document.getElementById('userEmailId').value;
    const workerName = document.getElementById('workerName').value;
    const pollingInterval = parseInt(document.getElementById('interval').value) || 30000;
    
    chrome.storage.local.set({ projectId, userEmailId, workerName, pollingInterval });
    
    chrome.storage.local.get(['workerId', 'token'], (data) => {
      chrome.runtime.sendMessage({
        type: 'UPDATE_CONFIG',
        projectId,
        workerId: data.workerId,
        workerName,
        token: data.token,
        pollingInterval
      });
    });
    
    showToast('Configuration Saved Successfully!');
  });

  toggleWorkerBtn.addEventListener('click', () => {
    chrome.storage.local.get(['isActive', 'userEmailId', 'projectId', 'attaPollStatus'], (data) => {
      if (!data.projectId || !data.userEmailId) {
        alert('Please save project ID and Email ID first!');
        return;
      }
      
      if (data.isActive && data.attaPollStatus !== 'EXPIRED') {
        chrome.runtime.sendMessage({ type: 'STOP_WORKER' }, () => {
          updateStatus(false, data.attaPollStatus);
        });
      } else {
        chrome.runtime.sendMessage({ type: 'START_WORKER', userEmailId: data.userEmailId }, () => {
          updateStatus(true, data.attaPollStatus);
        });
      }
    });
  });

  // Listen for storage changes in real-time
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.token && !changes.token.newValue) {
      showLogin('You have been logged out.');
      return;
    }
    if (changes.sessionExpired && changes.sessionExpired.newValue) {
      showLogin('Your session expired. Please log in again.');
      return;
    }
    if (changes.lastChecked) {
      updateLastChecked(changes.lastChecked.newValue);
    }
    if (changes.lastStatus) {
      updateLastStatus(changes.lastStatus.newValue);
    }
    if (changes.isActive || changes.attaPollStatus) {
      chrome.storage.local.get(['isActive', 'attaPollStatus'], (data) => {
        updateStatus(data.isActive, data.attaPollStatus);
      });
    }
  });

  function showLogin(errorMessage = null) {
    loginView.classList.remove('hidden');
    mainView.classList.add('hidden');
    const errorEl = document.getElementById('loginError');
    if (errorMessage) {
      errorEl.textContent = errorMessage;
      errorEl.classList.remove('hidden');
    } else {
      errorEl.classList.add('hidden');
    }
  }

  function showMain(data) {
    loginView.classList.add('hidden');
    mainView.classList.remove('hidden');
    
    if (data.projectId) document.getElementById('projectId').value = data.projectId;
    if (data.workerName) document.getElementById('workerName').value = data.workerName;
    if (data.userEmailId) document.getElementById('userEmailId').value = data.userEmailId;
    if (data.pollingInterval) document.getElementById('interval').value = data.pollingInterval;
    
    updateStatus(data.isActive, data.attaPollStatus);
    updateLastChecked(data.lastChecked);
    updateLastStatus(data.lastStatus);
  }

  function updateLastChecked(isoString) {
    if (!isoString) {
      lastCheckedText.textContent = 'Last checked: Never';
      return;
    }
    const date = new Date(isoString);
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    lastCheckedText.textContent = `Last checked: ${time}`;
  }

  function updateLastStatus(statusStr) {
    if (!statusStr) {
      lastStatusText.textContent = 'Last API call: N/A';
      lastStatusText.style.color = '#94a3b8';
      return;
    }
    lastStatusText.textContent = `Last API call: ${statusStr}`;
    if (statusStr === 'Success') {
      lastStatusText.style.color = '#10B981'; // Green
    } else {
      lastStatusText.style.color = '#EF4444'; // Red
    }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.remove('hidden');
    toast.classList.add('show');
    
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.classList.add('hidden'), 300);
    }, 2000);
  }

  function updateStatus(isActive, attaPollStatus) {
    if (attaPollStatus === 'EXPIRED') {
      statusIndicator.textContent = 'ATTAPOLL EXPIRED';
      statusIndicator.className = 'status warning';
      if (attaPollAlert) attaPollAlert.classList.remove('hidden');
      toggleWorkerBtn.textContent = 'Restart Worker';
      toggleWorkerBtn.className = 'btn btn-primary mt-2';
    } else {
      if (attaPollAlert) attaPollAlert.classList.add('hidden');
      if (isActive) {
        statusIndicator.textContent = 'ONLINE';
        statusIndicator.className = 'status online';
        toggleWorkerBtn.textContent = 'Stop Worker';
        toggleWorkerBtn.className = 'btn btn-danger mt-2';
      } else {
        statusIndicator.textContent = 'OFFLINE';
        statusIndicator.className = 'status offline';
        toggleWorkerBtn.textContent = 'Start Worker';
        toggleWorkerBtn.className = 'btn btn-primary mt-2';
      }
    }
  }
});
