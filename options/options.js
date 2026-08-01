document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['backendUrl'], (result) => {
    if (result.backendUrl) {
      document.getElementById('backendUrl').value = result.backendUrl;
    }
  });
  
  document.getElementById('saveBtn').addEventListener('click', () => {
    const url = document.getElementById('backendUrl').value;
    chrome.storage.local.set({ backendUrl: url }, () => {
      document.getElementById('msg').textContent = 'Saved!';
      setTimeout(() => document.getElementById('msg').textContent = '', 2000);
    });
  });
});
