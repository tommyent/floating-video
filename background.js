const title = 'Floating Video — toggle Picture-in-Picture (Alt+P)';
const busyTabs = new Set();

chrome.action.onClicked.addListener(async tab => {
  if (!Number.isInteger(tab.id) || busyTabs.has(tab.id)) return;
  busyTabs.add(tab.id);
  try {
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
    await chrome.action.setTitle({ tabId: tab.id, title });
    const frames = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true }, files: ['pip.js']
    });
    const active = frames.find(frame => frame.result?.active);
    const selected = active || frames.filter(frame => frame.result?.available).sort((a, b) =>
      Number(b.result.playing) - Number(a.result.playing) || b.result.area - a.result.area
    )[0];
    if (!selected) throw new Error('No playable video found. Start a video and try again.');
    // Pin the document so navigation cannot redirect the action to a replacement page.
    const results = await chrome.scripting.executeScript({
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
    });
    if (!results[0]?.result?.ok) throw new Error(results[0]?.result?.error || 'The page changed. Try again.');
  } catch (error) {
    await Promise.allSettled([
      chrome.action.setBadgeText({ tabId: tab.id, text: '!' }),
      chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#AD342A' }),
      chrome.action.setTitle({ tabId: tab.id, title: `Floating Video — ${error.message}` })
    ]);
  } finally {
    busyTabs.delete(tab.id);
  }
});
