// Original procedural space artwork. All world motion is extrapolated from the
// last server snapshot; this renderer never writes game state or calls the API.
window.SpaceRenderer = (function() {
  // Restore the original procedural flight world geometry preserved in the
  // staged last-known-good renderer.
  const TUNNEL_PARTICLES = 680;
  const TUNNEL_RAYS = 112;
  let contextFailureReported = false;

  function seeded(seed) {
    let value = (Number(seed) || 1) >>> 0;
    return function() {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  function create(canvas) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      if (!contextFailureReported) {
        console.error('[SpaceRenderer] Canvas 2D context unavailable; gameplay renderer will retry.');
        contextFailureReported = true;
      }
      return { available: false, draw: () => ({ background: false, ship: false, asteroidsDrawn: 0 }), resize() {}, getCacheStats: () => ({ asteroidTextures: 0 }) };
    }
    const random = seeded(20261028);
    const tunnelParticles = Array.from({ length: TUNNEL_PARTICLES }, () => ({
      angle: random() * Math.PI * 2,
      phase: random(),
      depth: .18 + random() * .82,
      width: .45 + random() * 1.65,
      curve: (random() - .5) * .075,
      brightness: .18 + random() * .72
    }));
    const tunnelRays = Array.from({ length: TUNNEL_RAYS }, () => ({
      angle: random() * Math.PI * 2,
      phase: random() * Math.PI * 2,
      depth: .2 + random() * .8,
      curve: (random() - .5) * .11,
      width: .5 + random() * 1.35,
      brightness: .08 + random() * .25
    }));
    const asteroidTextures = new Map();
    const reducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let lastAuthoritativeShip = null;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const nextDpr = Math.min(2, window.devicePixelRatio || 1);
      const nextWidth = Math.max(1, Math.round(rect.width * nextDpr));
      const nextHeight = Math.max(1, Math.round(rect.height * nextDpr));
      if (nextWidth === canvas.width && nextHeight === canvas.height &&
          rect.width === width && rect.height === height && nextDpr === dpr) return;
      width = rect.width;
      height = rect.height;
      dpr = nextDpr;
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw(flight, hull, buffs, now, selectedAsteroidId) {
      resize();
      if (!width || !height) return { background: false, ship: false, asteroidsDrawn: 0 };
      const unit = Math.min(width, height);
      const matchId = typeof flight?.matchId === 'string' ? flight.matchId : null;
      const snapshotShip = flight?.ship;
      const snapshotShipValid = [snapshotShip?.x, snapshotShip?.y, snapshotShip?.heading].every(Number.isFinite) &&
        snapshotShip.x >= 0 && snapshotShip.x <= 1 && snapshotShip.y >= 0 && snapshotShip.y <= 1;
      if (lastAuthoritativeShip && lastAuthoritativeShip.matchId !== matchId) lastAuthoritativeShip = null;
      if (snapshotShipValid && matchId) {
        lastAuthoritativeShip = {
          matchId,
          observedAt: now,
          snapshotAt: Number.isFinite(flight.snapshotAt) ? flight.snapshotAt : now,
          ship: { ...snapshotShip }
        };
      }
      // A single delayed/partial poll should not make the Wayfarer disappear.
      // This is a short render-only grace cache scoped to one server match; it
      // never writes input, position or physics back into authoritative state.
      const useCachedShip = !snapshotShipValid && lastAuthoritativeShip &&
        lastAuthoritativeShip.matchId === matchId && now >= lastAuthoritativeShip.observedAt &&
        now - lastAuthoritativeShip.observedAt <= 3000;
      const ship = snapshotShipValid ? snapshotShip : useCachedShip ? lastAuthoritativeShip.ship : null;
      const shipSnapshot = useCachedShip ? { snapshotAt: lastAuthoritativeShip.snapshotAt } : flight;
      drawBackdrop(ctx, width, height, unit, Number.isFinite(ship?.vx) ? ship.vx : 0,
        Number.isFinite(ship?.vy) ? ship.vy : 0, now, tunnelParticles, tunnelRays,
        Number.isFinite(ship?.speed) ? ship.speed : 0, reducedMotion);
      const extrapolate = window.SceneCoordinates?.extrapolationSeconds?.(shipSnapshot, now) || 0;
      // Reuse server physics for the local prediction so turning, thrust and
      // position all follow one curve and the nose stays aligned with travel.
      const predictedShip = ship ? (window.Spaceflight?.predictShip ? window.Spaceflight.predictShip({
        ...ship,
        vx: Number.isFinite(ship.vx) ? ship.vx : 0,
        vy: Number.isFinite(ship.vy) ? ship.vy : 0,
        speed: Number.isFinite(ship.speed) ? ship.speed : 0,
        inputX: Number.isFinite(ship.inputX) ? ship.inputX : 0,
        inputY: Number.isFinite(ship.inputY) ? ship.inputY : 0
      }, extrapolate * 1000) : ship) : null;
      const shipX = predictedShip ? predictedShip.x * width : 0;
      const shipY = predictedShip ? predictedShip.y * height : 0;

      let asteroidsDrawn = 0;
      const asteroids = Array.isArray(flight?.asteroids) ? flight.asteroids : [];
      for (const asteroid of asteroids) {
        if (!asteroid || !Number.isFinite(asteroid.x) || !Number.isFinite(asteroid.y) ||
            !Number.isFinite(asteroid.radius) || asteroid.radius <= 0 ||
            asteroid.x < -1 || asteroid.x > 2 || asteroid.y < -1 || asteroid.y > 2) continue;
        const position = window.SceneCoordinates?.asteroidPosition?.(asteroid, flight, now) || {
          x: asteroid.x + (Number.isFinite(asteroid.vx) ? asteroid.vx : 0) * extrapolate,
          y: asteroid.y + (Number.isFinite(asteroid.vy) ? asteroid.vy : 0) * extrapolate
        };
        const x = position.x;
        const y = position.y;
        if (x < -.12 || x > 1.12 || y < -.12 || y > 1.12) continue;
        const marked = flight.markedThreat?.asteroidId === asteroid.id;
        const threatKind = asteroid.threatId ? 'rogue' : marked ? 'navigator' : false;
        drawAsteroid(ctx, asteroid, x * width, y * height,
          (Number.isFinite(asteroid.rotation) ? asteroid.rotation : 0) +
          (Number.isFinite(asteroid.spin) ? asteroid.spin : 0) * extrapolate,
          unit, threatKind, asteroidTextures, canvas);
        asteroidsDrawn++;
        if (asteroid.id === selectedAsteroidId) drawTargetReticle(ctx, x * width, y * height, Math.max(18, asteroid.radius * unit * 1.8), now);
      }

      for (const event of Array.isArray(flight.collisionEvents) ? flight.collisionEvents : []) {
        if (!event.matchId || event.matchId === flight?.matchId) drawImpact(ctx, event, width, height, unit, now);
      }
      for (const event of Array.isArray(flight.navigationEvents) ? flight.navigationEvents : []) {
        if (!event.matchId || event.matchId === flight?.matchId) drawImpact(ctx, { ...event, blocked: true }, width, height, unit, now);
      }
      for (const event of Array.isArray(flight.weaponEvents) ? flight.weaponEvents : []) {
        if (!event.matchId || event.matchId === flight?.matchId) drawPulseShot(ctx, event, width, height, unit, now);
      }

      const shielded = (buffs || []).some(buff => buff.id === 'boost_shields' && buff.remainingMs > 0);
      const hullHit = (Array.isArray(flight?.collisionEvents) ? flight.collisionEvents : []).some(event =>
        (!event.matchId || event.matchId === flight?.matchId) && !event.blocked && event.damage > 0 && now - event.at >= 0 && now - event.at < 360);
      if (predictedShip) drawShip(ctx, shipX, shipY, predictedShip.heading, unit, hull, ship.inputY, shielded, now, hullHit);
      drawWorldMarks(ctx, width, height);
      return { background: true, ship: !!predictedShip, asteroidsDrawn };
    }

    return { available: true, draw, resize, getCacheStats: () => ({ asteroidTextures: asteroidTextures.size,
      ambientParticles: tunnelParticles.length, ambientRays: tunnelRays.length }) };
  }

  function drawTargetReticle(ctx, x, y, radius, now) {
    const pulse = 1 + Math.sin(now / 180) * .025;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);
    ctx.strokeStyle = 'rgba(222,196,135,.84)';
    ctx.lineWidth = 1.2;
    ctx.shadowColor = 'rgba(224,194,125,.3)';
    ctx.shadowBlur = 3;
    ctx.beginPath();
    ctx.arc(0, 0, radius, .15, Math.PI * .38);
    ctx.arc(0, 0, radius, Math.PI * .65, Math.PI * .88);
    ctx.arc(0, 0, radius, Math.PI * 1.15, Math.PI * 1.38);
    ctx.arc(0, 0, radius, Math.PI * 1.65, Math.PI * 1.88);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-radius * .45, 0); ctx.lineTo(-radius * .18, 0);
    ctx.moveTo(radius * .18, 0); ctx.lineTo(radius * .45, 0);
    ctx.moveTo(0, -radius * .45); ctx.lineTo(0, -radius * .18);
    ctx.moveTo(0, radius * .18); ctx.lineTo(0, radius * .45);
    ctx.stroke();
    ctx.restore();
  }

  function drawBackdrop(ctx, width, height, unit, vx, vy, now, particles, rays, shipSpeed, reducedMotion) {
    ctx.fillStyle = '#020304';
    ctx.fillRect(0, 0, width, height);
    const cx = width * .5 - clamp(vx, -1, 1) * width * .008;
    const cy = height * .5 - clamp(vy, -1, 1) * height * .008;
    const reach = Math.hypot(width, height) * .76;
    const seconds = reducedMotion ? 0 : now / 1000;
    const speedFactor = reducedMotion ? 0 : clamp(shipSpeed / .36, 0, 1);

    // Charcoal volume at the tunnel rim; the central opening stays near black.
    const volume = ctx.createRadialGradient(cx, cy, unit * .035, cx, cy, reach);
    volume.addColorStop(0, '#010203');
    volume.addColorStop(.13, '#090a0c');
    volume.addColorStop(.34, '#17191b');
    volume.addColorStop(.68, '#090a0b');
    volume.addColorStop(1, '#010203');
    ctx.fillStyle = volume;
    ctx.fillRect(0, 0, width, height);

    // Narrow, irregularly bent filaments give the tunnel a coherent vanishing
    // point and rotational flow instead of a field of unrelated straight lines.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const ray of rays) {
      const flicker = reducedMotion ? 1 : .72 + .28 * Math.sin(seconds * (1.1 + ray.depth) + ray.phase);
      const end = reach * (.7 + ray.depth * .48);
      const twist = .23 + ray.curve * 2.1;
      const gradient = ctx.createLinearGradient(cx, cy, cx + Math.cos(ray.angle) * end, cy + Math.sin(ray.angle) * end);
      gradient.addColorStop(0, 'rgba(235,239,240,0)');
      gradient.addColorStop(.22, `rgba(202,208,211,${ray.brightness * .24})`);
      gradient.addColorStop(.68, `rgba(228,232,233,${clamp(ray.brightness * flicker * 1.65, .12, .62)})`);
      gradient.addColorStop(1, 'rgba(248,249,249,0)');
      ctx.strokeStyle = gradient;
      ctx.lineWidth = ray.width * (.6 + ray.depth * .9);
      ctx.beginPath();
      for (let step = 0; step <= 12; step++) {
        const t = step / 12;
        const radius = unit * (.025 + t * (end / unit));
        const angle = ray.angle + twist * t * t + Math.sin(t * 8 + ray.phase + seconds * .25) * ray.curve * t;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (step === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Seeded grains stream outward from the vortex. Each has its own depth,
    // angular drift, curvature and exposure, producing layered silver trails.
    for (const particle of particles) {
      const travel = wrap(particle.phase + seconds * (.055 + speedFactor * .15) * (.35 + particle.depth), 1);
      const radius = unit * (.025 + travel * 1.42);
      if (radius > reach * 1.12) continue;
      const angle = particle.angle + seconds * (.015 + particle.depth * .018) + travel * .44;
      const length = unit * (.003 + travel * particle.depth * (.022 + speedFactor * .052));
      const bend = particle.curve * radius * (.35 + travel);
      const driftX = clamp(vx / .36, -1, 1) * radius * particle.depth * .08;
      const driftY = clamp(vy / .36, -1, 1) * radius * particle.depth * .08;
      const x1 = cx + Math.cos(angle) * radius - driftX;
      const y1 = cy + Math.sin(angle) * radius - driftY;
      const x2 = cx + Math.cos(angle + particle.curve) * (radius + length) - driftX;
      const y2 = cy + Math.sin(angle + particle.curve) * (radius + length) - driftY;
      const alpha = particle.brightness * (.24 + travel * .68);
      ctx.strokeStyle = particle.depth > .77
        ? `rgba(248,249,249,${alpha})`
        : `rgba(185,193,197,${alpha * .74})`;
      ctx.lineWidth = particle.width * (.35 + travel * .8);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo((x1 + x2) * .5 - Math.sin(angle) * bend, (y1 + y2) * .5 + Math.cos(angle) * bend, x2, y2);
      ctx.stroke();
      if (particle.depth > .86 && travel > .72) {
        ctx.fillStyle = `rgba(255,255,255,${alpha * .6})`;
        ctx.fillRect(x2, y2, 1.2, 1.2);
      }
    }
    ctx.restore();

    // Atmospheric edge falloff frames the bright tunnel without obscuring the
    // center or the interactive foreground.
    const vignette = ctx.createRadialGradient(cx, cy, unit * .18, cx, cy, reach * .92);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(.55, 'rgba(0,0,0,.06)');
    vignette.addColorStop(1, 'rgba(0,0,0,.64)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  function drawAsteroid(ctx, asteroid, x, y, rotation, unit, threatened, textureCache, canvas) {
    const radius = asteroid.radius * unit;
    const sprite = getAsteroidTexture(asteroid.shapeSeed, textureCache, canvas);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.shadowColor = 'rgba(0,0,0,.76)';
    ctx.shadowBlur = radius * .15;
    ctx.shadowOffsetX = -radius * .18;
    ctx.shadowOffsetY = radius * .2;
    if (sprite) ctx.drawImage(sprite, -radius, -radius, radius * 2, radius * 2);
    else drawRockTexture(ctx, radius, asteroid.shapeSeed);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

    const health = Number.isFinite(asteroid.health) ? asteroid.health : 3;
    const maxHealth = Number.isFinite(asteroid.maxHealth) ? asteroid.maxHealth : 3;
    for (const mark of (asteroid.damageMarks || [])) {
      drawRockCrack(ctx, mark.u * radius, mark.v * radius, radius, maxHealth - health + 1);
    }
    if (threatened) {
      const warningColor = threatened === 'rogue' ? 'rgba(255,135,111,.76)' : 'rgba(103,218,222,.76)';
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
      ctx.strokeStyle = warningColor;
      ctx.lineWidth = Math.max(1, radius * .028);
      ctx.beginPath();
      for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const inner = radius * 1.08;
        const outer = radius * 1.2;
        ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
        ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function getAsteroidTexture(seed, cache, sourceCanvas) {
    if (cache.has(seed)) return cache.get(seed);
    const documentRef = sourceCanvas?.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!documentRef?.createElement) return null;
    const texture = documentRef.createElement('canvas');
    texture.width = texture.height = 256;
    const textureCtx = texture.getContext('2d');
    if (!textureCtx) return null;
    drawRockTexture(textureCtx, 102, seed);
    if (cache.size >= 16) cache.delete(cache.keys().next().value);
    cache.set(seed, texture);
    return texture;
  }

  function drawRockTexture(ctx, radius, seed) {
    const random = seeded(seed);
    const cx = 128; const cy = 128; const scale = radius / 102;
    const pointCount = 17 + Math.floor(random() * 7);
    const angleOffset = random() * Math.PI * 2;
    const points = Array.from({ length: pointCount }, (_, index) => {
      const angle = angleOffset + index * Math.PI * 2 / pointCount;
      const r = radius * (.72 + random() * .28);
      return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
    });
    ctx.save();
    // Texture canvas uses a fixed 256px coordinate system; gameplay fallback
    // runs at world scale and is transformed into the same local space.
    if (radius !== 102) { ctx.translate(-cx * scale, -cy * scale); ctx.scale(scale, scale); }
    ctx.beginPath(); points.forEach(([px, py], index) => index ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.closePath();
    ctx.shadowColor = 'rgba(0,0,0,.65)'; ctx.shadowBlur = 16; ctx.shadowOffsetX = -8; ctx.shadowOffsetY = 12;
    const rock = ctx.createRadialGradient(cx - 32, cy - 39, 8, cx + 8, cy + 8, 120);
    rock.addColorStop(0, '#e0d8c5'); rock.addColorStop(.2, '#999a8e'); rock.addColorStop(.58, '#50574f'); rock.addColorStop(.86, '#2b322c'); rock.addColorStop(1, '#101713');
    ctx.fillStyle = rock; ctx.fill(); ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.save(); ctx.clip();
    // Broad, deterministic planes suggest fractured mineral faces under one
    // upper-left key light and break up the smooth spherical gradient.
    for (let i = 0; i < 22; i++) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * radius * .74;
      const px = cx + Math.cos(angle) * distance;
      const py = cy + Math.sin(angle) * distance;
      const facet = radius * (.055 + random() * .16);
      const shade = random();
      ctx.fillStyle = shade > .7 ? 'rgba(221,216,198,.12)' : `rgba(8,13,14,${.035 + shade * .11})`;
      ctx.beginPath();
      ctx.moveTo(px - facet, py + facet * .3);
      ctx.lineTo(px - facet * .24, py - facet);
      ctx.lineTo(px + facet, py - facet * .12);
      ctx.lineTo(px + facet * .35, py + facet * .72);
      ctx.closePath();
      ctx.fill();
    }
    const mineralColors = ['rgba(189,184,169,.17)', 'rgba(23,29,31,.28)', 'rgba(137,145,144,.16)', 'rgba(190,160,122,.10)'];
    for (let i = 0; i < 86; i++) {
      const angle = random() * Math.PI * 2; const distance = Math.sqrt(random()) * radius * .82;
      const px = cx + Math.cos(angle) * distance; const py = cy + Math.sin(angle) * distance;
      ctx.fillStyle = mineralColors[Math.floor(random() * mineralColors.length)];
      ctx.beginPath(); ctx.ellipse(px, py, 1.5 + random() * 5.5, .8 + random() * 3.8, random() * Math.PI, 0, Math.PI * 2); ctx.fill();
    }
    const craterCount = 4 + Math.floor(random() * 4);
    for (let i = 0; i < craterCount; i++) {
      const angle = random() * Math.PI * 2; const distance = Math.sqrt(random()) * radius * .62;
      const px = cx + Math.cos(angle) * distance; const py = cy + Math.sin(angle) * distance;
      const craterRadius = radius * (.045 + random() * .105);
      ctx.fillStyle = 'rgba(188,190,182,.42)';
      ctx.beginPath(); ctx.ellipse(px - craterRadius * .08, py - craterRadius * .06, craterRadius * 1.12, craterRadius * .76, random() * Math.PI, 0, Math.PI * 2); ctx.fill();
      const pit = ctx.createRadialGradient(px - craterRadius * .2, py - craterRadius * .25, craterRadius * .08, px, py, craterRadius);
      pit.addColorStop(0, 'rgba(10,13,14,.9)'); pit.addColorStop(.64, 'rgba(27,30,30,.76)'); pit.addColorStop(1, 'rgba(60,64,62,.18)');
      ctx.fillStyle = pit; ctx.beginPath(); ctx.ellipse(px, py, craterRadius, craterRadius * .68, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(8,11,12,.55)'; ctx.lineWidth = Math.max(1, craterRadius * .12);
      ctx.beginPath(); ctx.arc(px, py, craterRadius * .86, .2, Math.PI * 1.7); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(206,205,194,.2)'; ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const angle = random() * Math.PI * 2; const distance = radius * (.3 + random() * .34);
      let px = cx + Math.cos(angle) * distance; let py = cy + Math.sin(angle) * distance;
      ctx.beginPath(); ctx.moveTo(px, py);
      for (let step = 0; step < 3; step++) {
        px += (random() - .5) * radius * .18; py += (random() - .5) * radius * .18; ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
    // Cool directional rim separates the shadow side from deep space.
    const rim = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    rim.addColorStop(0, 'rgba(244,233,204,.62)'); rim.addColorStop(.4, 'rgba(177,190,174,.22)'); rim.addColorStop(1, 'rgba(1,5,8,.12)');
    ctx.strokeStyle = rim; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
  }

  function drawRockCrack(ctx, x, y, radius, stage) {
    ctx.save(); ctx.lineCap = 'round';
    const spread = radius * (.18 + Math.min(2, stage) * .07);
    ctx.strokeStyle = 'rgba(7,10,12,.95)'; ctx.lineWidth = Math.max(1.2, radius * .045);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - spread * .2, y - spread * .35); ctx.lineTo(x + spread * .15, y - spread * .62); ctx.lineTo(x + spread * .05, y - spread); ctx.moveTo(x - spread * .1, y - spread * .4); ctx.lineTo(x - spread * .55, y - spread * .58); ctx.moveTo(x + spread * .1, y - spread * .63); ctx.lineTo(x + spread * .5, y - spread * .72); ctx.stroke();
    ctx.strokeStyle = 'rgba(205,195,173,.62)'; ctx.lineWidth = Math.max(1, radius * .014);
    ctx.beginPath(); ctx.moveTo(x + 1, y + 1); ctx.lineTo(x + spread * .1, y - spread * .6); ctx.stroke();
    ctx.restore();
  }

  function drawShip(ctx, x, y, heading, unit, hull, throttle, shielded, now, hullHit) {
    const size = unit * .105;
    ctx.save();
    ctx.translate(x, y);
    // Hull artwork's nose is native +X; shared flight heading uses that same axis.
    ctx.rotate(heading);
    if (shielded) {
      ctx.strokeStyle = 'rgba(66,190,255,.42)';
      ctx.lineWidth = Math.max(2, size * .055);
      ctx.beginPath(); ctx.ellipse(0, 0, size * 1.55, size * .92, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (throttle < 0) {
      const flare = size * (.48 + .2 * Math.sin(now / 55));
      const flame = ctx.createLinearGradient(-size, 0, -size - flare * 2.2, 0);
      flame.addColorStop(0, 'rgba(182,246,255,.9)'); flame.addColorStop(.35, 'rgba(36,187,255,.7)'); flame.addColorStop(1, 'rgba(26,105,255,0)');
      ctx.fillStyle = flame;
      ctx.beginPath(); ctx.moveTo(-size * .72, -size * .2); ctx.lineTo(-size - flare * 2.2, 0); ctx.lineTo(-size * .72, size * .2); ctx.fill();
    } else if (throttle > 0) {
      // A brief forward-facing reverse jet marks braking/reverse input.
      ctx.strokeStyle = 'rgba(255,173,111,.9)'; ctx.lineWidth = Math.max(2, size * .055);
      ctx.beginPath(); ctx.moveTo(size * .83, -size * .15); ctx.lineTo(size * 1.12, 0); ctx.lineTo(size * .83, size * .15); ctx.stroke();
    }
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(size * 1.18, 0); ctx.lineTo(size * .52, -size * .22); ctx.lineTo(size * .14, -size * .48);
    ctx.lineTo(-size * .42, -size * .39); ctx.lineTo(-size * .79, -size * .7); ctx.lineTo(-size * .62, -size * .14);
    ctx.lineTo(-size * .62, size * .14); ctx.lineTo(-size * .79, size * .7); ctx.lineTo(-size * .42, size * .39);
    ctx.lineTo(size * .14, size * .48); ctx.lineTo(size * .52, size * .22); ctx.closePath();
    const hullPaint = ctx.createLinearGradient(0, -size, size, size);
    hullPaint.addColorStop(0, '#d9e6eb'); hullPaint.addColorStop(.3, '#788c99'); hullPaint.addColorStop(.56, '#35495a'); hullPaint.addColorStop(1, '#a4b5bf');
    ctx.fillStyle = hullPaint; ctx.fill();
    ctx.strokeStyle = 'rgba(231,246,251,.8)'; ctx.lineWidth = Math.max(1, size * .025); ctx.stroke();
    if (hullHit) {
      ctx.strokeStyle = `rgba(255,87,64,${.48 + .32 * Math.sin(now / 22)})`;
      ctx.lineWidth = Math.max(2, size * .07); ctx.stroke();
    }
    ctx.fillStyle = '#234762';
    ctx.beginPath(); ctx.moveTo(size * .57, 0); ctx.lineTo(size * .2, -size * .16); ctx.lineTo(-size * .17, -size * .12); ctx.lineTo(-size * .28, 0); ctx.lineTo(-size * .17, size * .12); ctx.lineTo(size * .2, size * .16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(119,224,255,.8)'; ctx.fillRect(-size * .72, -size * .12, size * .13, size * .09); ctx.fillRect(-size * .72, size * .04, size * .13, size * .09);
    ctx.strokeStyle = 'rgba(245,158,92,.88)'; ctx.lineWidth = size * .045;
    ctx.beginPath(); ctx.moveTo(-size * .34, -size * .34); ctx.lineTo(-size * .05, -size * .23); ctx.moveTo(-size * .34, size * .34); ctx.lineTo(-size * .05, size * .23); ctx.stroke();
    if (hull < 45) {
      ctx.strokeStyle = 'rgba(255,91,65,.9)'; ctx.lineWidth = size * .035;
      ctx.beginPath(); ctx.moveTo(-size * .32, -size * .12); ctx.lineTo(-size * .05, 0); ctx.lineTo(-size * .25, size * .18); ctx.stroke();
    }
    ctx.restore();
  }

  function drawImpact(ctx, event, width, height, unit, now) {
    const age = Math.max(0, now - event.at);
    const progress = age / 2400;
    if (progress >= 1) return;
    const x = event.x * width; const y = event.y * height;
    const radius = unit * (.006 + progress * .052);
    ctx.save(); ctx.globalAlpha = (1 - progress) * (event.blocked ? .65 : 1);
    const flash = ctx.createRadialGradient(x, y, 0, x, y, radius);
    flash.addColorStop(0, age < 180 ? '#ffffff' : '#fff0c0'); flash.addColorStop(.18, '#ffc36f'); flash.addColorStop(.55, '#f26838'); flash.addColorStop(1, 'rgba(185,43,24,0)');
    ctx.fillStyle = flash; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = event.blocked ? '#72ddff' : '#ffb26b'; ctx.lineWidth = Math.max(1, unit * .002);
    ctx.beginPath(); ctx.arc(x, y, radius * (.22 + progress * 2.2), 0, Math.PI * 2); ctx.stroke();
    const random = seeded(hashEvent(event.id));
    for (let i = 0; i < 14; i++) {
      const angle = Math.atan2(event.normalY || 0, event.normalX || 0) + (random() - .5) * 2.3;
      const speed = .014 + random() * .065;
      const travel = unit * speed * Math.min(1, age / 480);
      const px = x + Math.cos(angle) * travel;
      const py = y + Math.sin(angle) * travel;
      ctx.strokeStyle = i % 3 ? 'rgba(255,192,121,.86)' : 'rgba(195,228,239,.9)';
      ctx.lineWidth = i % 4 ? 1 : 2;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(angle) * unit * .006, py + Math.sin(angle) * unit * .006); ctx.stroke();
    }
    if (event.damage > 0 && age < 950) {
      ctx.globalAlpha = 1 - age / 950; ctx.fillStyle = '#fff0dc'; ctx.font = `700 ${Math.max(11, unit * .018)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.fillText(`HULL −${event.damage}%`, x, y - unit * (.045 + progress * .025));
    }
    ctx.restore();
  }

  function drawPulseShot(ctx, event, width, height, unit, now) {
    const age = Math.max(0, now - event.at);
    if (age > 3200) return;
    const fromX = event.fromX * width; const fromY = event.fromY * height;
    const hitX = event.impactX * width; const hitY = event.impactY * height;
    const travel = clamp(age / 165, 0, 1);
    if (age < 180) {
      const x = fromX + (hitX - fromX) * travel;
      const y = fromY + (hitY - fromY) * travel;
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.strokeStyle = 'rgba(110,224,255,.48)'; ctx.lineWidth = Math.max(2, unit * .006);
      ctx.beginPath(); ctx.moveTo(fromX, fromY); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = '#effcff'; ctx.shadowColor = '#4ccaff'; ctx.shadowBlur = unit * .035;
      ctx.beginPath(); ctx.arc(x, y, Math.max(2, unit * .009), 0, Math.PI * 2); ctx.fill();
      const muzzle = ctx.createRadialGradient(fromX, fromY, 0, fromX, fromY, unit * (.015 + age / 180 * .018));
      muzzle.addColorStop(0, 'rgba(255,255,255,.94)'); muzzle.addColorStop(.3, 'rgba(107,226,255,.72)'); muzzle.addColorStop(1, 'rgba(55,157,230,0)');
      ctx.fillStyle = muzzle; ctx.beginPath(); ctx.arc(fromX, fromY, unit * (.015 + age / 180 * .018), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    if (age >= 120) drawWeaponBurst(ctx, event, hitX, hitY, unit, age - 120);
  }

  function drawWeaponBurst(ctx, event, x, y, unit, age) {
    const destroyed = !!event.destroyed;
    const duration = destroyed ? 3000 : 1800;
    if (age > duration) return;
    const progress = age / duration;
    const random = seeded(hashEvent(event.id));
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    if (age < 150) {
      const radius = unit * (.008 + age / 150 * (destroyed ? .036 : .018));
      const flash = ctx.createRadialGradient(x, y, 0, x, y, radius);
      flash.addColorStop(0, '#ffffff'); flash.addColorStop(.18, '#d9fbff'); flash.addColorStop(.55, '#57cfff'); flash.addColorStop(1, 'rgba(49,157,225,0)');
      ctx.fillStyle = flash; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = 'rgba(133,222,255,.82)'; ctx.lineWidth = Math.max(1, unit * .0016);
    ctx.beginPath(); ctx.arc(x, y, unit * (.008 + progress * (destroyed ? .07 : .032)), 0, Math.PI * 2); ctx.stroke();
    const count = destroyed ? 24 : 10;
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const isRock = destroyed && i < 8;
      const speed = isRock ? .03 + random() * .045 : .02 + random() * .09;
      const travel = unit * speed * Math.min(1.5, age / 420);
      const px = x + Math.cos(angle) * travel;
      const py = y + Math.sin(angle) * travel;
      if (isRock) {
        const size = unit * (.006 + random() * .009) * (1 - progress * .36);
        ctx.save(); ctx.translate(px, py); ctx.rotate(angle + age * .003 * (i % 2 ? 1 : -1));
        ctx.fillStyle = i % 2 ? `rgba(126,132,130,${1-progress})` : `rgba(204,211,205,${1-progress})`;
        ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(size * .15, size * .7); ctx.lineTo(-size * .75, size * .35); ctx.lineTo(-size * .4, -size * .65); ctx.closePath(); ctx.fill(); ctx.restore();
      } else {
        ctx.strokeStyle = i % 3 ? `rgba(255,211,144,${1-progress})` : `rgba(211,245,255,${1-progress})`;
        ctx.lineWidth = i % 4 ? 1 : 2; ctx.beginPath(); ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(angle) * unit * .008, py + Math.sin(angle) * unit * .008); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawWorldMarks(ctx, width, height) {
    ctx.save(); ctx.strokeStyle = 'rgba(116,178,203,.24)'; ctx.lineWidth = 1;
    const pad = 14; const length = 18;
    for (const [x, y, sx, sy] of [[pad,pad,1,1],[width-pad,pad,-1,1],[pad,height-pad,1,-1],[width-pad,height-pad,-1,-1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + sy * length); ctx.lineTo(x, y); ctx.lineTo(x + sx * length, y); ctx.stroke();
    }
    ctx.restore();
  }

  function hashEvent(value) { let h = 0; for (const char of String(value)) h = Math.imul(h ^ char.charCodeAt(0), 16777619); return h >>> 0; }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function wrap(value, size) { return ((value % size) + size) % size; }
  return { create };
})();
