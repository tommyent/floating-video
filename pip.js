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
    // Chrome closes PiP as soon as the opt-out returns, so restore it only when the window closes or the request fails.
    const disabled = video.getAttribute('disablepictureinpicture');
    const restore = () => { if (disabled !== null) video.setAttribute('disablepictureinpicture', disabled); };
    video.removeAttribute('disablepictureinpicture');
    try {
      await video.requestPictureInPicture();
    } catch (error) {
      restore();
      throw error;
    }
    video.addEventListener('leavepictureinpicture', restore, { once: true });
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
