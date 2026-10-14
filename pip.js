(() => {
  function findVideo(root = document) {
    let best = null;
    function visit(current) {
      for (const element of current.querySelectorAll('*')) {
        if (element.shadowRoot) visit(element.shadowRoot);
        if (element.localName !== 'video' || element.readyState === 0 ||
            !element.videoWidth || element.ended || element.error) continue;
        const rect = element.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area <= 0) continue;
        const playing = !element.paused;
        if (!best || (playing && !best.playing) ||
            (playing === best.playing && area > best.area)) {
          best = { video: element, playing, area };
        }
      }
    }
    visit(root);
    return best;
  }

  async function open(video) {
    if (!document.pictureInPictureEnabled) throw new Error('Picture-in-Picture is blocked on this page.');
    // Restore the page's opt-out even when the browser rejects the request.
    const disabled = video.getAttribute('disablepictureinpicture');
    video.removeAttribute('disablepictureinpicture');
    try {
      await video.requestPictureInPicture();
    } finally {
      if (disabled !== null) video.setAttribute('disablepictureinpicture', disabled);
    }
  }

  globalThis.FloatingVideo = { findVideo, open };
  const selected = findVideo();
  return {
    active: !!document.pictureInPictureElement,
    available: !!selected && !!document.pictureInPictureEnabled,
    playing: selected?.playing ?? false,
    area: selected?.area ?? 0
  };
})();
