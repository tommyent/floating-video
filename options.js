const checkbox = document.getElementById('automatic');
const status = document.getElementById('status');
let saved = false;

chrome.storage.sync.get({ autoPictureInPicture: false }).then(settings => {
  saved = settings.autoPictureInPicture === true;
  checkbox.checked = saved;
  checkbox.disabled = false;
}).catch(() => { status.textContent = 'Could not load settings. Reload this page to try again.'; });

checkbox.addEventListener('change', async () => {
  checkbox.disabled = true;
  status.textContent = 'Saving…';
  try {
    await chrome.storage.sync.set({ autoPictureInPicture: checkbox.checked });
    saved = checkbox.checked;
    status.textContent = 'Saved.';
  } catch {
    checkbox.checked = saved;
    status.textContent = 'Could not save. Please try again.';
  } finally {
    checkbox.disabled = false;
  }
});
