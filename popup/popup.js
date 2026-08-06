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

  // Check state
  chrome.storage.local.get(['token', 'projectId', 'userEmailId', 'pollingInterval', 'isActive', 'workerId', 'workerName', 'lastChecked', 'lastStatus'], (data) => {
    if (data.token) {
      showMain(data);
    } else {
      showLogin();
    }
  });

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
      
      await chrome.storage.local.set({ token, workerId });
      showMain({ token, workerId, pollingInterval: 30000 });
    } catch (err) {
      errorEl.textContent = err.message || 'Login failed';
      errorEl.classList.remove('hidden');
    }
  });

  logoutBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_WORKER' });
    chrome.storage.local.remove(['token', 'projectId', 'userEmailId', 'isActive', 'workerId']);
    showLogin();
  });

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
    chrome.storage.local.get(['isActive', 'userEmailId', 'projectId'], (data) => {
      if (!data.projectId || !data.userEmailId) {
        alert('Please save project ID and Email ID first!');
        return;
      }
      
      if (data.isActive) {
        chrome.runtime.sendMessage({ type: 'STOP_WORKER' }, () => {
          updateStatus(false);
        });
      } else {
        chrome.runtime.sendMessage({ type: 'START_WORKER', userEmailId: data.userEmailId }, () => {
          updateStatus(true);
        });
      }
    });
  });

  // Listen for storage changes to update lastChecked in real-time
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.lastChecked) {
      updateLastChecked(changes.lastChecked.newValue);
    }
    if (changes.lastStatus) {
      updateLastStatus(changes.lastStatus.newValue);
    }
  });

  function showLogin() {
    loginView.classList.remove('hidden');
    mainView.classList.add('hidden');
  }

  function showMain(data) {
    loginView.classList.add('hidden');
    mainView.classList.remove('hidden');
    
    if (data.projectId) document.getElementById('projectId').value = data.projectId;
    if (data.workerName) document.getElementById('workerName').value = data.workerName;
    if (data.userEmailId) document.getElementById('userEmailId').value = data.userEmailId;
    if (data.pollingInterval) document.getElementById('interval').value = data.pollingInterval;
    
    updateStatus(data.isActive);
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
      setTimeout(() => toast.classList.add('hidden'), 300); // Wait for transition
    }, 2000);
  }

  function updateStatus(isActive) {
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
});
