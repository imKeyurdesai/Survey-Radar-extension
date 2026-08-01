import { SurveyProvider } from './SurveyProvider.js';

export class AttaPollProvider extends SurveyProvider {
  constructor(userEmailId) {
    super();
    this.providerName = 'AttaPoll';
    this.userEmailId = userEmailId;
    this.isActive = false;
  }

  start() {
    this.isActive = true;
    console.log(`[AttaPoll] Started monitoring for ${this.userEmailId}`);
  }

  stop() {
    this.isActive = false;
    console.log(`[AttaPoll] Stopped monitoring`);
  }

  async poll() {
    if (!this.isActive || !this.userEmailId) return null;
    
    try {
      const url = `https://attapoll.app/api/v3/user/projects?userId=${encodeURIComponent(this.userEmailId)}`;
      
      const { attapollHeaders } = await chrome.storage.local.get(['attapollHeaders']);
      
      if (!attapollHeaders || !attapollHeaders['authorization']) {
        throw new Error("Missing API Authorization Token. Please refresh the AttaPoll tab to capture a new token.");
      }
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          ...attapollHeaders
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('[AttaPoll] Error polling surveys:', error);
      throw error;
    }
  }

  parseResponse(rawResponse) {
    const surveys = [];
    
    // The actual API returns the surveys in the "surveys" array
    const items = rawResponse.projects || rawResponse.surveys;
    if (items && Array.isArray(items)) {
      for (const item of items) {
        // If it's in the surveys array, it's considered available.
        surveys.push({
          provider: this.providerName,
          surveyId: item.id || item.projectId,
          title: item.title || 'AttaPoll Survey',
          reward: item.amt && item.ccy ? `${item.amt} ${item.ccy}` : (item.reward || 'Variable'),
          estimatedTime: item.loi ? `${item.loi} mins` : 'Unknown'
        });
      }
    }
    
    return surveys;
  }
}
