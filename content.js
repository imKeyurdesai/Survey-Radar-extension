chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'POLL_ATTAPOLL') {
    const userId = encodeURIComponent(request.userEmailId);
    // API lives on attapoll.app, not earn.attapoll.app — but cookies are shared across subdomains
    const url = `https://attapoll.app/api/v3/user/projects?userId=${userId}`;

    fetch(url, {
      method: 'GET',
      credentials: 'include', // needed since earn.attapoll.app fetches cross-origin to attapoll.app
      headers: {
        'Accept': 'application/json'
      }
    })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      sendResponse({ success: true, data });
    })
    .catch((error) => {
      console.error('[AttaPoll Content Script] Error:', error);
      sendResponse({ success: false, error: error.message });
    });

    return true; // Keep message channel open for async fetch
  }
});
