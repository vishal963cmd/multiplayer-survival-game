// Exposes the clean static space plate only while the gameplay screen is active.
// The Canvas remains transparent above it; the ship itself is rendered as a
// separate heading-aligned sprite by SpaceRenderer.
window.GameplayBackground = (function() {
  let active = false;

  function getImage() {
    return document.getElementById('flight-background');
  }

  return {
    setActive(value) { active = !!value; },
    isPlaying() {
      const image = getImage();
      return active && !!image && image.complete === true && image.naturalWidth > 0;
    },
    sync() {}
  };
})();
