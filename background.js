const title = 'Floating Video — toggle Picture-in-Picture (Alt+P)';
const busyTabs = new Set();

chrome.action.onClicked.addListener(tab => {
  if (!Number.isInteger(tab.id) || busyTabs.has(tab.id)) return;
  busyTabs.add(tab.id);
  function finish(error) {
    busyTabs.delete(tab.id);
    void Promise.allSettled([
      chrome.action.setBadgeText({ tabId: tab.id, text: error ? '!' : '' }),
      chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#AD342A' }),
      chrome.action.setTitle({ tabId: tab.id, title: error ? `Floating Video — ${error}` : title })
    ]);
  }
  // Chrome carries the toolbar gesture into API callbacks, not awaited promises.
  chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true }, files: ['pip.js']
  }, frames => {
    if (chrome.runtime.lastError) return finish(chrome.runtime.lastError.message);
    const active = frames.find(frame => frame.result?.active);
    const selected = active || frames.filter(frame => frame.result?.available).sort((a, b) =>
      Number(b.result.playing) - Number(a.result.playing) || b.result.area - a.result.area
    )[0];
    if (!selected) return finish('No playable video found. Start a video and try again.');
    // Pin the document so navigation cannot redirect the action to a replacement page.
    chrome.scripting.executeScript({
      target: { tabId: tab.id, documentIds: [selected.documentId] },
      args: [!!active],
      func: async close => {
        try {
          if (close) {
            if (document.pictureInPictureElement) await document.exitPictureInPicture();
          } else {
            const selected = globalThis.FloatingVideo.findVideo();
            if (!selected) throw new Error('The video is no longer available.');
            await globalThis.FloatingVideo.open(selected.video);
          }
          return { ok: true };
        } catch (error) {
          return { error: error.message || 'Picture-in-Picture could not be opened.' };
        }
      }
    }, results => {
      if (chrome.runtime.lastError) return finish(chrome.runtime.lastError.message);
      finish(results[0]?.result?.ok ? null : results[0]?.result?.error || 'The page changed. Try again.');
    });
  });
});
