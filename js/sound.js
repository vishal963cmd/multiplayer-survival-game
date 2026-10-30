// ════════════════════════════════════════════════════════════════════════════
// Signal Shift — Sound Manager
// Pure Web Audio API. No external files. No network requests.
// All sounds are synthesized with oscillators and gain envelopes.
// ════════════════════════════════════════════════════════════════════════════

window.Sound = (function() {
  let ctx = null;
  let muted = false;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function playTone({ freq = 440, type = 'sine', duration = 0.2, vol = 0.3, delay = 0, attack = 0.01, release = 0.05, detune = 0 }) {
    if (muted) return;
    try {
      const c   = getCtx();
      const osc = c.createOscillator();
      const gain= c.createGain();
      osc.connect(gain);
      gain.connect(c.destination);

      osc.type    = type;
      osc.frequency.setValueAtTime(freq, c.currentTime + delay);
      osc.detune.setValueAtTime(detune, c.currentTime + delay);

      gain.gain.setValueAtTime(0, c.currentTime + delay);
      gain.gain.linearRampToValueAtTime(vol, c.currentTime + delay + attack);
      gain.gain.setValueAtTime(vol, c.currentTime + delay + duration - release);
      gain.gain.linearRampToValueAtTime(0, c.currentTime + delay + duration);

      osc.start(c.currentTime + delay);
      osc.stop(c.currentTime + delay + duration + 0.01);
    } catch (e) { /* silently ignore audio errors */ }
  }

  function sweep({ startFreq, endFreq, duration = 0.3, type = 'sawtooth', vol = 0.25, delay = 0 }) {
    if (muted) return;
    try {
      const c   = getCtx();
      const osc = c.createOscillator();
      const gain= c.createGain();
      osc.connect(gain);
      gain.connect(c.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(startFreq, c.currentTime + delay);
      osc.frequency.linearRampToValueAtTime(endFreq, c.currentTime + delay + duration);
      gain.gain.setValueAtTime(0, c.currentTime + delay);
      gain.gain.linearRampToValueAtTime(vol, c.currentTime + delay + 0.02);
      gain.gain.linearRampToValueAtTime(0, c.currentTime + delay + duration);
      osc.start(c.currentTime + delay);
      osc.stop(c.currentTime + delay + duration + 0.01);
    } catch (e) {}
  }

  return {
    setMuted(m) { muted = m; },
    isMuted()   { return muted; },

    // ── Lobby / UX sounds ──────────────────────────────────────────────
    join() {
      playTone({ freq: 523, type: 'sine',     duration: 0.12, vol: 0.2 });
      playTone({ freq: 659, type: 'sine',     duration: 0.12, vol: 0.2, delay: 0.1 });
    },

    start() {
      [261, 329, 392, 523].forEach((f, i) =>
        playTone({ freq: f, type: 'triangle', duration: 0.2, vol: 0.25, delay: i * 0.09 })
      );
    },

    // ── Emergency alarm — repeating pulse ──────────────────────────────
    alarm() {
      for (let i = 0; i < 3; i++) {
        sweep({ startFreq: 600, endFreq: 800, duration: 0.18, type: 'square', vol: 0.12, delay: i * 0.22 });
      }
    },

    // ── Player successfully uses an ability ────────────────────────────
    action() {
      playTone({ freq: 880, type: 'sine',     duration: 0.1,  vol: 0.2 });
      playTone({ freq: 1046, type: 'sine',    duration: 0.12, vol: 0.2, delay: 0.08 });
    },

    // ── Gunner pulse cannon ──────────────────────────────────────────
    pulseCannon() {
      sweep({ startFreq: 1150, endFreq: 180, duration: 0.16, type: 'sawtooth', vol: 0.14 });
      playTone({ freq: 1680, type: 'triangle', duration: 0.045, vol: 0.09, delay: 0.015 });
    },

    // ── Emergency resolved ─────────────────────────────────────────────
    resolved() {
      [523, 659, 784, 1046].forEach((f, i) =>
        playTone({ freq: f, type: 'sine', duration: 0.15, vol: 0.25, delay: i * 0.07 })
      );
    },

    // ── Hull damage thud ───────────────────────────────────────────────
    damage() {
      sweep({ startFreq: 200, endFreq: 60, duration: 0.25, type: 'sawtooth', vol: 0.3 });
    },

    // ── Warning — sub-30 s tick ────────────────────────────────────────
    tick() {
      playTone({ freq: 440, type: 'square', duration: 0.06, vol: 0.08 });
    },

    // ── Victory fanfare ────────────────────────────────────────────────
    victory() {
      const notes = [523, 659, 784, 1046, 1046, 1046, 880, 1046];
      const delays= [0, 0.1, 0.2, 0.35, 0.55, 0.65, 0.72, 0.80];
      notes.forEach((f, i) =>
        playTone({ freq: f, type: 'triangle', duration: 0.22, vol: 0.28, delay: delays[i] })
      );
    },

    // ── Defeat ────────────────────────────────────────────────────────
    defeat() {
      [400, 350, 280, 200].forEach((f, i) =>
        playTone({ freq: f, type: 'sawtooth', duration: 0.3, vol: 0.2, delay: i * 0.18 })
      );
    },

    // ── Button click ──────────────────────────────────────────────────
    click() {
      playTone({ freq: 660, type: 'sine', duration: 0.08, vol: 0.12 });
    },

    // ── Error / reject ────────────────────────────────────────────────
    error() {
      sweep({ startFreq: 300, endFreq: 200, duration: 0.2, type: 'square', vol: 0.15 });
    }
  };
})();
