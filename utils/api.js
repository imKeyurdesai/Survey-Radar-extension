// Utility for API requests to the Survey Radar Backend
// The backend URL should be configurable via options
export const API = {
  baseUrl: 'http://localhost:5000/api', // Default fallback

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
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'API Request Failed');
    }
    
    return data;
  }
};
