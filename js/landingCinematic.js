// Small landing-only video controller. The poster keeps the Wayfarer visible
// when autoplay, decoding, or media support is unavailable.
window.LandingCinematic = (function() {
  let video = null;
  let splash = null;
  let active = false;
  let skipped = false;
  let motionPreference = null;

  function syncPlayback() {
    if (!video) return;
    const shouldPlay = active && !skipped && !document.hidden && !motionPreference?.matches;
    if (!shouldPlay) {
      video.pause();
      return;
    }
    const playback = video.play();
    if (playback?.catch) playback.catch(() => splash?.classList.add('cinematic-video-unavailable'));
  }

  function initialize() {
    if (video) return;
    video = document.getElementById('splash-wayfarer-video');
    splash = document.getElementById('screen-splash');
    if (!video || !splash) return;
    video.muted = true;
    video.defaultMuted = true;
    video.addEventListener('error', () => splash.classList.add('cinematic-video-unavailable'));
    motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
    document.addEventListener('visibilitychange', syncPlayback);
    motionPreference?.addEventListener?.('change', syncPlayback);
    syncPlayback();
  }

  function setActive(value) {
    active = !!value;
    syncPlayback();
  }

  function skip() {
    skipped = true;
    syncPlayback();
  }

  return { initialize, setActive, skip };
})();
