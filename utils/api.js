// Utility for API requests to the Survey Radar Backend
// The backend URL should be configurable via options
export const API = {
  baseUrl: 'https://survey-radar-api.onrender.com/api', // Default fallback

  async getBaseUrl() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['backendUrl'], (result) => {
        resolve(result.backendUrl || this.baseUrl);
      });
    });
  },

  async request(endpoint, method = 'GET', body = null, token = null, workerId = null) {
    const baseUrl = await this.getBaseUrl();
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (workerId) headers['x-worker-id'] = workerId;

    const options = {
      method,
      headers
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${baseUrl}${endpoint}`, options);
    
    // Check if session has expired or is unauthorized
    if (response.status === 401 || response.status === 403) {
      try {
        await chrome.storage.local.remove(['token', 'isActive', 'workerId']);
        await chrome.storage.local.set({ sessionExpired: true });
        chrome.runtime.sendMessage({ type: 'STOP_WORKER', reason: 'SESSION_EXPIRED' }, () => {
          if (chrome.runtime.lastError) { /* ignore if no receiver */ }
        });
      } catch (_e) {}
      throw new Error('Your session has expired. Please log in again.');
    }

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'API Request Failed');
    }
    
    return data;
  }
};
