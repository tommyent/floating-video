(() => {
  let registered = false;
  let revision = 0;

  function configure(enabled) {
    if (!navigator.mediaSession || (!enabled && !registered)) return;
    try {
      navigator.mediaSession.setActionHandler('enterpictureinpicture', enabled ? async () => {
        const selected = globalThis.FloatingVideo.findVideo();
        if (!selected?.playing || document.pictureInPictureElement) return;
        try {
          await globalThis.FloatingVideo.open(selected.video);
        } catch (error) {
          console.warn('Floating Video: automatic Picture-in-Picture unavailable.', error.name);
        }
      } : null);
      registered = enabled;
    } catch (error) {
      console.warn('Floating Video: automatic Picture-in-Picture unsupported.', error.name);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.autoPictureInPicture) return;
    revision++;
    configure(changes.autoPictureInPicture.newValue === true);
  });
  chrome.storage.sync.get({ autoPictureInPicture: false }).then(settings => {
    if (revision === 0) configure(settings.autoPictureInPicture === true);
  }).catch(error => console.warn('Floating Video: could not load settings.', error.name));
})();
