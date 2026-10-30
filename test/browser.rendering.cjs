'use strict';

// Dependency-free Chrome DevTools Protocol smoke for a genuine two-client match.
// Connects to an already-running local Netlify Dev server; it never touches an
// existing browser profile, match, production service, or production data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const baseUrl = process.argv[2] || 'http://localhost:8888';
const chromePath = process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profiles = [
  { name: 'small-mobile', width: 360, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'ultrawide', width: 2560, height: 1440 }
];

class DevTools {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message);
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new DevTools(socket);
  }

  on(method, callback) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(callback);
  }

  command(method, params = {}, sessionId) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async evaluate(sessionId, expression) {
    const response = await this.command('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true
    }, sessionId);
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result?.value;
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(devtools, sessionId, expression, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await devtools.evaluate(sessionId, expression)) return;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for browser condition: ${expression}`);
}

async function main() {
  assert.ok(fs.existsSync(chromePath), `Chrome executable not found: ${chromePath}`);
  const artifactDir = path.resolve('test-artifacts', `phase17b-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(artifactDir, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-shift-cdp-'));
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--remote-allow-origins=*',
    '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  let devtools;
  const pages = {};
  const browserErrors = [];
  const report = {
    baseUrl, startedAt: new Date().toISOString(), browser: 'isolated headless Chrome via CDP',
    server: 'existing local Netlify Dev; no server process started by this script',
    room: null, clients: {}, input: {}, gunner: {}, viewports: [], errors: browserErrors
  };
  report.artifactDir = artifactDir;

  try {
    const activePortFile = path.join(profileDir, 'DevToolsActivePort');
    let port;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (chrome.exitCode !== null) throw new Error(`Chrome exited early with code ${chrome.exitCode}`);
      if (fs.existsSync(activePortFile)) {
        port = Number(fs.readFileSync(activePortFile, 'utf8').split(/\r?\n/)[0]);
        if (port) break;
      }
      await sleep(100);
    }
    assert.ok(port, 'Chrome DevTools did not start');
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json());
    devtools = await DevTools.connect(version.webSocketDebuggerUrl);
    devtools.on('Runtime.exceptionThrown', event => browserErrors.push({ type: 'exception', details: event.params.exceptionDetails?.text }));
    devtools.on('Log.entryAdded', event => {
      const entry = event.params.entry;
      if (entry.level === 'error') browserErrors.push({ type: 'console', text: entry.text, url: entry.url });
    });

    for (const client of ['host', 'guest']) {
      const context = await devtools.command('Target.createBrowserContext', { disposeOnDetach: true });
      const target = await devtools.command('Target.createTarget', { url: 'about:blank', browserContextId: context.browserContextId });
      const attached = await devtools.command('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      const sessionId = attached.sessionId;
      pages[client] = { contextId: context.browserContextId, targetId: target.targetId, sessionId };
      await devtools.command('Page.enable', {}, sessionId);
      await devtools.command('Runtime.enable', {}, sessionId);
      await devtools.command('Log.enable', {}, sessionId);
      await devtools.command('Network.enable', {}, sessionId);
      await devtools.command('Page.navigate', { url: baseUrl }, sessionId);
      await waitFor(devtools, sessionId, `document.readyState === 'complete' && !!document.querySelector('#btn-create-room')`);
    }

    // Use the real landing controls and forms in two isolated browser contexts.
    await devtools.evaluate(pages.host.sessionId, `document.querySelector('#btn-create-room').click()`);
    await waitFor(devtools, pages.host.sessionId, `document.querySelector('#screen-name.active')`);
    await devtools.evaluate(pages.host.sessionId, `(() => {
      const input = document.querySelector('#name-input'); input.value = 'CDP Pilot';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#btn-name-submit').click(); return true;
    })()`);
    await waitFor(devtools, pages.host.sessionId, `window.App?.state?.roomCode && document.querySelector('#screen-lobby.active')`);
    const roomCode = await devtools.evaluate(pages.host.sessionId, `window.App.state.roomCode`);
    report.room = { createdThroughLandingUi: true, roomCode };

    await devtools.evaluate(pages.guest.sessionId, `document.querySelector('#btn-join-room').click()`);
    await waitFor(devtools, pages.guest.sessionId, `document.querySelector('#screen-name.active')`);
    await devtools.evaluate(pages.guest.sessionId, `(() => {
      const code = document.querySelector('#join-code-input'); code.value = ${JSON.stringify(roomCode)};
      code.dispatchEvent(new Event('input', { bubbles: true }));
      const name = document.querySelector('#name-input'); name.value = 'CDP Gunner';
      name.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#btn-name-submit').click(); return true;
    })()`);
    await waitFor(devtools, pages.guest.sessionId, `window.App?.state?.room?.players?.length === 2 && document.querySelector('#screen-lobby.active')`);
    await waitFor(devtools, pages.host.sessionId, `window.App?.state?.room?.players?.length === 2`);
    report.clients.host = await devtools.evaluate(pages.host.sessionId, `(() => { const p=window.App.state.room.players.find(p=>p.isMe); return { nickname:p?.nickname, role:p?.roles?.length?p.roles:(p?.role?[p.role]:[]) }; })()`);
    report.clients.guest = await devtools.evaluate(pages.guest.sessionId, `(() => { const p=window.App.state.room.players.find(p=>p.isMe); return { nickname:p?.nickname, role:p?.roles?.length?p.roles:(p?.role?[p.role]:[]) }; })()`);
    await devtools.evaluate(pages.host.sessionId, `document.querySelector('#btn-start-game').click()`);
    await waitFor(devtools, pages.host.sessionId, `window.App?.state?.room?.phase === 'playing'`, 25000);
    await waitFor(devtools, pages.guest.sessionId, `window.App?.state?.room?.phase === 'playing'`, 25000);
    await waitFor(devtools, pages.host.sessionId, `(() => { const canvas=document.querySelector('#game-canvas'); return canvas && canvas.width>1 && canvas.height>1 && window.SpaceRenderer; })()`, 15000);
    await waitFor(devtools, pages.guest.sessionId, `(() => { const canvas=document.querySelector('#game-canvas'); return canvas && canvas.width>1 && canvas.height>1 && window.SpaceRenderer; })()`, 15000);
    report.background = await devtools.evaluate(pages.host.sessionId, `(() => {
      const canvas=document.querySelector('#game-canvas'),scene=document.querySelector('.flight-scene');
      const c=canvas.getBoundingClientRect(),ctx=canvas.getContext('2d');
      const media=[...scene.querySelectorAll('video,img')].map(item=>item.currentSrc||item.src||'');
      const corner=ctx.getImageData(Math.min(4,canvas.width-1),Math.min(4,canvas.height-1),1,1).data;
      return {procedural:true,noMediaBackground:media.length===0,media,
        width:canvas.width,height:canvas.height,cssWidth:c.width,cssHeight:c.height,
        canvasAlpha:corner[3],canvasPixel:[corner[0],corner[1],corner[2]],
        canvasStyle:{zIndex:getComputedStyle(canvas).zIndex,background:getComputedStyle(canvas).backgroundColor},
        coversScene:Math.abs(c.width-scene.clientWidth)<1&&Math.abs(c.height-scene.clientHeight)<1};
    })()`);

    const targetBefore = await devtools.evaluate(pages.guest.sessionId, `(() => {
      const button = document.querySelector('#gunner-target-list .gunner-target');
      if (!button) return null; button.click();
      const target=window.App.state.room.round.flight.asteroids.find(item=>item.id===window.GunnerConsole.getSelectedTarget());
      return { id: window.GunnerConsole.getSelectedTarget(), text: button.textContent, x:target?.x, y:target?.y,
        radius:target?.radius, asteroidIds:window.App.state.room.round.flight.asteroids.map(item=>item.id) };
    })()`);
    assert.ok(targetBefore?.id, 'Gunner UI must offer a real target from the authoritative snapshot');
    const healthBefore = await devtools.evaluate(pages.guest.sessionId,
      `window.App.state.room.round.flight.asteroids.find(item => item.id === ${JSON.stringify(targetBefore.id)})?.health`);
    const scoreBeforeShot = await devtools.evaluate(pages.host.sessionId, `window.App?.state?.room?.round?.score ?? 0`);
    await devtools.evaluate(pages.guest.sessionId, `document.querySelector('#btn-fire-cannon').click()`);
    await waitFor(devtools, pages.guest.sessionId,
      `window.App.state.room.round.flight.weaponEvents?.some(event=>event.asteroidId===${JSON.stringify(targetBefore.id)}&&event.destroyed)`, 12000);
    await waitFor(devtools, pages.host.sessionId, `(() => {
      const rock = window.App.state.room.round.flight.asteroids.find(item => item.id === ${JSON.stringify(targetBefore.id)});
      return !rock && window.App.state.room.round.score === ${Number(scoreBeforeShot)} + 50;
    })()`, 12000);
    await waitFor(devtools, pages.guest.sessionId, `(() => {
      const room=window.App.state.room;
      return !room.round.flight.asteroids.some(item=>item.id===${JSON.stringify(targetBefore.id)}) &&
        room.round.score === ${Number(scoreBeforeShot)} + 50;
    })()`, 12000);
    const hostShotState = await devtools.evaluate(pages.host.sessionId, `(() => ({
      score:window.App.state.room.round.score,
      targetPresent:window.App.state.room.round.flight.asteroids.some(item=>item.id===${JSON.stringify(targetBefore.id)}),
      asteroidIds:window.App.state.room.round.flight.asteroids.map(item=>item.id),
      event:window.App.state.room.round.flight.weaponEvents.findLast(event=>event.asteroidId===${JSON.stringify(targetBefore.id)})
    }))()`);
    const guestShotState = await devtools.evaluate(pages.guest.sessionId, `(() => ({
      score:window.App.state.room.round.score,
      targetPresent:window.App.state.room.round.flight.asteroids.some(item=>item.id===${JSON.stringify(targetBefore.id)}),
      event:window.App.state.room.round.flight.weaponEvents.findLast(event=>event.asteroidId===${JSON.stringify(targetBefore.id)})
    }))()`);
    const destructionShot = await devtools.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, pages.guest.sessionId);
    fs.writeFileSync(path.join(artifactDir, 'gunner-one-shot-destruction.png'), Buffer.from(destructionShot.data, 'base64'));
    report.gunner = { selectedThroughUi: true, targetId: targetBefore.id, targetLabel: targetBefore.text,
      healthBefore, healthAfterObservedByHost: hostShotState.targetPresent ? 'present' : null,
      authoritativeDamageObserved: !hostShotState.targetPresent,
      destroyedOnBothClients: !hostShotState.targetPresent && !guestShotState.targetPresent,
      scoreBeforeShot, scoreAfterShot: hostShotState.score, guestScoreAfterShot: guestShotState.score,
      scoreSynchronized: hostShotState.score === scoreBeforeShot + 50 && guestShotState.score === hostShotState.score,
      otherOriginalAsteroidsRemain: targetBefore.asteroidIds.filter(id=>id!==targetBefore.id).every(id=>hostShotState.asteroidIds.includes(id)),
      destructionEvent: !!hostShotState.event?.destroyed && !!guestShotState.event?.destroyed &&
        Number.isFinite(hostShotState.event.impactX) && Number.isFinite(hostShotState.event.impactY),
      impact:hostShotState.event&&{x:hostShotState.event.impactX,y:hostShotState.event.impactY},
      effectScreenshot:'gunner-one-shot-destruction.png' };
    const ordered = [...profiles, ...profiles.slice().reverse()];
    for (const viewport of ordered) {
      for (const client of ['host', 'guest']) {
        const page = pages[client];
        await devtools.command('Emulation.setDeviceMetricsOverride', {
          width: viewport.width, height: viewport.height, deviceScaleFactor: 1,
          mobile: viewport.width <= 719, screenWidth: viewport.width, screenHeight: viewport.height
        }, page.sessionId);
      }
      await sleep(450);
      const row = { profile: viewport.name, width: viewport.width, height: viewport.height, resizedWithoutReload: true, clients: {} };
      for (const client of ['host', 'guest']) {
        const page = pages[client];
        const metrics = await devtools.evaluate(page.sessionId, `(() => {
          const scene = document.querySelector('.flight-scene');
          const canvas = document.querySelector('#game-canvas');
          const box = selector => {
            const element = document.querySelector(selector); if (!element) return null;
            const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
            return { x:rect.x,y:rect.y,width:rect.width,height:rect.height,display:style.display,
              position:style.position,flex:style.flex,minHeight:style.minHeight,heightCss:style.height,
              gridRows:style.gridTemplateRows,overflow:style.overflow };
          };
          const sceneRect = scene?.getBoundingClientRect(); const rect = canvas?.getBoundingClientRect();
          const style = canvas ? getComputedStyle(canvas) : null;
          const room = window.App?.state?.room; const flight = room?.round?.flight;
          const ship = flight?.ship;
          const shipWorld = ship && [ship.x, ship.y].every(Number.isFinite) ? { x: ship.x, y: ship.y } : null;
          const rocks = Array.isArray(flight?.asteroids) ? flight.asteroids : [];
          const validRocks = rocks.filter(a => a && [a.x,a.y,a.radius].every(Number.isFinite) && a.radius > 0);
          const dpr = window.devicePixelRatio || 1;
          let patch = (nx, ny, radiusCss) => 0;
          try {
            const ctx = canvas.getContext('2d');
            patch = (nx, ny, radiusCss) => {
              const cx = Math.round(nx * canvas.width), cy = Math.round(ny * canvas.height);
              const radius = Math.max(2, Math.round(radiusCss * Math.min(canvas.width / Math.max(1,rect.width), canvas.height / Math.max(1,rect.height))));
              const x0 = Math.max(0,cx-radius), y0 = Math.max(0,cy-radius);
              const x1 = Math.min(canvas.width,cx+radius), y1 = Math.min(canvas.height,cy+radius);
              if (x1 <= x0 || y1 <= y0) return 0;
              const data = ctx.getImageData(x0,y0,x1-x0,y1-y0).data; let visible = 0;
              for (let i=0;i<data.length;i+=16) if (data[i]+data[i+1]+data[i+2] > 250) visible++;
              return visible;
            };
          } catch (_) {}
          const shipPixels = shipWorld ? patch(shipWorld.x,shipWorld.y,Math.min(rect?.width||0,rect?.height||0)*.1) : 0;
          const visibleDraw = window.SpaceRenderer?.create?.(canvas)?.draw?.(room?.round?.flight, room?.round?.hullIntegrity,
            room?.round?.activeBuffs, Date.now(), null);
          const rockSamples = validRocks.slice(0,8).map(a => {
            const pos = window.SceneCoordinates?.asteroidPosition?.(a,flight,Date.now()) || a;
            return { id:a.id,x:pos.x,y:pos.y,pixels:patch(pos.x,pos.y,Math.max(5,a.radius*Math.min(rect?.width||0,rect?.height||0)))};
          });
          const center = rect && document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
          const sceneStyle = scene && getComputedStyle(scene);
          const media=[...(scene?.querySelectorAll('video,img')||[])];
          return {
            viewport:{innerWidth,innerHeight}, scene:sceneRect&&{x:sceneRect.x,y:sceneRect.y,width:sceneRect.width,height:sceneRect.height},
            parents:{screen:box('#screen-game'),app:box('#app'),body:box('.game-body'),stage:box('.game-stage'),emergencies:box('.emergencies-panel')},
            canvas:rect&&{x:rect.x,y:rect.y,width:rect.width,height:rect.height,cssWidth:style.width,cssHeight:style.height,bufferWidth:canvas.width,bufferHeight:canvas.height,dpr},
            css:style&&{display:style.display,position:style.position,visibility:style.visibility,opacity:style.opacity,overflow:style.overflow,zIndex:style.zIndex},
            sceneCss:sceneStyle&&{display:sceneStyle.display,visibility:sceneStyle.visibility,opacity:sceneStyle.opacity,overflow:sceneStyle.overflow},
            background:sceneRect&&{width:sceneRect.width,height:sceneRect.height,loaded:media.length===0,
              coversScene:!!rect&&Math.abs(rect.width-sceneRect.width)<1&&Math.abs(rect.height-sceneRect.height)<1},
            centerElement:center?.id||center?.className||center?.tagName,
            matchId:room?.matchId,phase:room?.phase,role:room?.players?.find(p=>p.isMe)?.roles,
            shipWorld,shipScreen:shipWorld&&rect?{x:shipWorld.x*rect.width,y:shipWorld.y*rect.height}:null,
            shipBrightSamplePixels:shipPixels,authoritativeAsteroidCount:rocks.length,validAsteroidCount:validRocks.length,
            renderedShip:visibleDraw?.ship===true,
            asteroidSamples:rockSamples,visibleAsteroidSamples:visibleDraw?.asteroidsDrawn ?? rockSamples.filter(a=>a.pixels>0).length,
            asteroidHealth:validRocks.map(a=>[a.id,a.health])
          };
        })()`);
        const screenshot = await devtools.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, page.sessionId);
        const shotName = `${client}-${viewport.name}-${viewport.width}x${viewport.height}.png`;
        fs.writeFileSync(path.join(artifactDir, shotName), Buffer.from(screenshot.data, 'base64'));
        row.clients[client] = metrics;
        row.clients[client].screenshot = shotName;
      }
      report.viewports.push(row);
    }

    // Exercise real Pilot keys after capturing centered viewport evidence.
    await devtools.command('Page.bringToFront', {}, pages.host.sessionId);
    const flightPoint = await devtools.evaluate(pages.host.sessionId, `(() => { const r=document.querySelector('.flight-scene').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    await devtools.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: flightPoint.x, y: flightPoint.y }, pages.host.sessionId);
    await devtools.command('Input.dispatchMouseEvent', { type: 'mousePressed', x: flightPoint.x, y: flightPoint.y, button: 'left', clickCount: 1 }, pages.host.sessionId);
    await devtools.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: flightPoint.x, y: flightPoint.y, button: 'left', clickCount: 1 }, pages.host.sessionId);
    const beforeInput = await devtools.evaluate(pages.host.sessionId, `window.App?.state?.room?.round?.flight?.ship && ({ ...window.App.state.room.round.flight.ship })`);
    if (beforeInput) {
      await devtools.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 }, pages.host.sessionId);
      await sleep(300);
      await devtools.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 }, pages.host.sessionId);
      await devtools.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 }, pages.host.sessionId);
      await sleep(300);
      await devtools.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 }, pages.host.sessionId);
      await sleep(1200);
      const afterInput = await devtools.evaluate(pages.guest.sessionId, `window.App?.state?.room?.round?.flight?.ship && ({ ...window.App.state.room.round.flight.ship })`);
      report.input = afterInput ? { pilotThrustObservedByGuest: afterInput.speed > beforeInput.speed || afterInput.x !== beforeInput.x || afterInput.y !== beforeInput.y,
        pilotRotationObservedByGuest: Number.isFinite(afterInput.heading) && afterInput.heading !== beforeInput.heading,
        before: beforeInput, after: afterInput,
        hostIsFocused:await devtools.evaluate(pages.host.sessionId, `document.hasFocus()`),
        hostIsPilot:await devtools.evaluate(pages.host.sessionId, `window.App?.state?.room?.players?.find(player=>player.isMe)?.role === 'pilot'`) } : { pilotControlsNotVerified: 'round ended while the viewport matrix was running' };
    } else {
      report.input = { pilotControlsNotVerified: 'round ended while the viewport matrix was running' };
    }

    const landingContext = await devtools.command('Target.createBrowserContext', { disposeOnDetach: true });
    const landingTarget = await devtools.command('Target.createTarget', { url: 'about:blank', browserContextId: landingContext.browserContextId });
    const landingAttachment = await devtools.command('Target.attachToTarget', { targetId: landingTarget.targetId, flatten: true });
    const landing = { contextId: landingContext.browserContextId, targetId: landingTarget.targetId, sessionId: landingAttachment.sessionId };
    pages.landing = landing;
    await devtools.command('Page.enable', {}, landing.sessionId);
    await devtools.command('Runtime.enable', {}, landing.sessionId);
    await devtools.command('Log.enable', {}, landing.sessionId);
    await devtools.command('Page.navigate', { url: baseUrl }, landing.sessionId);
    await waitFor(devtools, landing.sessionId, `document.readyState === 'complete' && !!document.querySelector('#splash-wayfarer-video')`);
    await waitFor(devtools, landing.sessionId, `(() => { const video=document.querySelector('#splash-wayfarer-video'); return video.readyState>=2 && video.videoWidth>0 && !video.paused; })()`, 30000);
    report.landing = { viewports: [] };
    const landingProfiles = [
      { name: 'mobile-375', width: 375, height: 812 },
      { name: 'tablet-768', width: 768, height: 1024 },
      { name: 'laptop-1024', width: 1024, height: 768 },
      { name: 'desktop-1440', width: 1440, height: 900 },
      { name: 'ultrawide-1920', width: 1920, height: 1080 }
    ];
    for (const viewport of landingProfiles) {
      await devtools.command('Emulation.setDeviceMetricsOverride', {
        width: viewport.width, height: viewport.height, deviceScaleFactor: 1,
        mobile: viewport.width <= 719, screenWidth: viewport.width, screenHeight: viewport.height
      }, landing.sessionId);
      await waitFor(devtools, landing.sessionId, `document.querySelector('#screen-splash.active') && document.querySelector('#splash-wayfarer-video').readyState>=2`);
      await sleep(250);
      const metrics = await devtools.evaluate(landing.sessionId, `(() => {
        const rect = selector => { const e=document.querySelector(selector); if(!e)return null; const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
        const video=document.querySelector('#splash-wayfarer-video'),root=document.querySelector('#screen-splash'),overlay=document.querySelector('.splash-video-overlay');
        const style=video&&getComputedStyle(video), overlayStyle=overlay&&getComputedStyle(overlay),
          rootRect=root?.getBoundingClientRect(),videoRect=video?.getBoundingClientRect(),overlayRect=overlay?.getBoundingClientRect();
        let framePixels=0;
        try {
          const sample=document.createElement('canvas'); sample.width=32; sample.height=18;
          const context=sample.getContext('2d',{willReadFrequently:true}); context.drawImage(video,0,0,32,18);
          const pixels=context.getImageData(0,0,32,18).data;
          for(let i=0;i<pixels.length;i+=4) if(pixels[i]+pixels[i+1]+pixels[i+2]>60) framePixels++;
        } catch (_) {}
        const content=[rect('.splash-topbar'),rect('.splash-logo'),rect('.splash-briefing'),rect('.splash-actions'),rect('.splash-footer')];
        const controls=['#btn-create-room','#btn-join-room','#btn-mute','#btn-skip-intro'].map(selector=>rect(selector));
        return {viewport:{innerWidth,innerHeight},videoReady:video?.readyState>=2&&video.videoWidth>0,
          videoPlaying:!video?.paused,videoMuted:video?.muted,videoLooping:video?.loop,videoInline:video?.playsInline,
          videoSize:{width:video?.videoWidth,height:video?.videoHeight,duration:video?.duration,currentTime:video?.currentTime},
          framePixels,root:rect('#screen-splash'),video:rect('#splash-wayfarer-video'),overlay:rect('.splash-video-overlay'),
          fullBleedCoversViewport:!!rootRect&&!!videoRect&&Math.abs(rootRect.x)<1&&Math.abs(rootRect.y)<1&&Math.abs(rootRect.width-innerWidth)<1&&Math.abs(rootRect.height-innerHeight)<1&&Math.abs(videoRect.x-rootRect.x)<1&&Math.abs(videoRect.y-rootRect.y)<1&&Math.abs(videoRect.width-rootRect.width)<1&&Math.abs(videoRect.height-rootRect.height)<1,
          overlayCoversViewport:!!overlayRect&&Math.abs(overlayRect.x-rootRect.x)<1&&Math.abs(overlayRect.y-rootRect.y)<1&&Math.abs(overlayRect.width-rootRect.width)<1&&Math.abs(overlayRect.height-rootRect.height)<1,
          videoStyle:{position:style?.position,objectFit:style?.objectFit,pointerEvents:style?.pointerEvents,zIndex:style?.zIndex},
          overlayStyle:{pointerEvents:overlayStyle?.pointerEvents,zIndex:overlayStyle?.zIndex},
          contentAboveVideo:!!style&&!!getComputedStyle(document.querySelector('.splash-layout'))&&Number(getComputedStyle(document.querySelector('.splash-layout')).zIndex)>Number(style.zIndex),
          typographyAndActionsInsideViewport:content.every(r=>r&&r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight)&&controls.every(r=>r&&r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight),
          copyAndActionsDoNotOverlap:rect('.splash-logo').bottom<=rect('.splash-briefing').y&&rect('.splash-briefing').bottom<=rect('.splash-actions').y&&rect('.splash-actions').bottom<=rect('.splash-footer').y,
          horizontalOverflow:document.documentElement.scrollWidth>innerWidth,
          briefingBorder:getComputedStyle(document.querySelector('.splash-briefing')).borderTopStyle,
          controls:{create:!!document.querySelector('#btn-create-room'),join:!!document.querySelector('#btn-join-room'),audio:!!document.querySelector('#btn-mute'),skip:!!document.querySelector('#btn-skip-intro')}};
      })()`);
      const screenshot = await devtools.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, landing.sessionId);
      const shotName = `landing-${viewport.name}-${viewport.width}x${viewport.height}.png`;
      fs.writeFileSync(path.join(artifactDir, shotName), Buffer.from(screenshot.data, 'base64'));
      report.landing.viewports.push({ profile: viewport.name, ...metrics, screenshot: shotName });
    }
    const videoTimeBefore = await devtools.evaluate(landing.sessionId, `document.querySelector('#splash-wayfarer-video').currentTime`);
    await sleep(1300);
    const videoTimeAfter = await devtools.evaluate(landing.sessionId, `document.querySelector('#splash-wayfarer-video').currentTime`);
    report.landing.playbackAdvances = videoTimeAfter > videoTimeBefore;
    await devtools.command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, landing.sessionId);
    await sleep(250);
    report.landing.reducedMotionAnimation = await devtools.evaluate(landing.sessionId,
      `getComputedStyle(document.querySelector('.splash-inner')).animationName`);
    report.landing.pausedForReducedMotion = await devtools.evaluate(landing.sessionId,
      `document.querySelector('#splash-wayfarer-video').paused`);
    await devtools.evaluate(landing.sessionId, `document.querySelector('#btn-mute').click(); document.querySelector('#btn-skip-intro').click()`);
    report.landing.audioToggled = await devtools.evaluate(landing.sessionId, `document.querySelector('#btn-mute').textContent.includes('🔇')`);
    report.landing.skipIntroApplied = await devtools.evaluate(landing.sessionId, `document.querySelector('#screen-splash').classList.contains('intro-skipped')`);

    report.finishedAt = new Date().toISOString();
    report.artifactDir = artifactDir;
    report.browserErrors = browserErrors;
    report.result = {
      activeTwoClientMatch: true,
      originalProceduralBackground: report.background?.procedural && report.background?.noMediaBackground &&
        report.background?.canvasAlpha === 255 && report.background?.canvasPixel?.some(channel => channel > 0),
      originalCanvasCoversGameplayViewport: report.background?.coversScene && report.background?.width > 1 && report.background?.height > 1,
      allViewportCanvasesNonzero: report.viewports.every(row => ['host','guest'].every(client => row.clients[client].canvas?.width > 0 && row.clients[client].canvas?.height > 0)),
      allViewportBackgroundsCoverScene: report.viewports.every(row => ['host','guest'].every(client => row.clients[client].background?.coversScene && row.clients[client].background?.loaded)),
      allViewportSnapshotsHaveShipAndAsteroids: report.viewports.every(row => ['host','guest'].every(client =>
        !!row.clients[client].shipWorld && row.clients[client].authoritativeAsteroidCount > 1)),
      allViewportShipPixelsPresent: report.viewports.every(row => ['host','guest'].every(client => row.clients[client].shipBrightSamplePixels > 0)),
      allViewportShipDrawsPresent: report.viewports.every(row => ['host','guest'].every(client => row.clients[client].renderedShip)),
      allViewportMultipleAsteroidsSampled: report.viewports.every(row => ['host','guest'].every(client => row.clients[client].visibleAsteroidSamples >= 2)),
      bothClientsShareMatch: report.viewports.every(row => row.clients.host.matchId === row.clients.guest.matchId),
      pilotInput: report.input.pilotThrustObservedByGuest ?? null,
      pilotRotation: report.input.pilotRotationObservedByGuest ?? null,
      gunnerDamageSynchronized: report.gunner.authoritativeDamageObserved,
      gunnerOneShotDestructionAndScore: report.gunner.destroyedOnBothClients && report.gunner.scoreSynchronized && report.gunner.destructionEvent,
      landingFullBleedVideo: report.landing.viewports.every(view => view.videoReady && view.videoPlaying && view.videoMuted && view.videoLooping && view.videoInline &&
        view.framePixels > 0 && view.fullBleedCoversViewport && view.overlayCoversViewport && view.videoStyle.objectFit === 'cover' &&
        view.videoStyle.pointerEvents === 'none' && view.overlayStyle.pointerEvents === 'none' && view.contentAboveVideo &&
        view.typographyAndActionsInsideViewport && view.copyAndActionsDoNotOverlap && !view.horizontalOverflow),
      landingMotionAndReducedMotion: report.landing.playbackAdvances &&
        report.landing.reducedMotionAnimation === 'none' && report.landing.pausedForReducedMotion,
      landingAudioAndSkipControls: report.landing.audioToggled && report.landing.skipIntroApplied
    };
    fs.writeFileSync(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ artifactDir, result: report.result, roles: report.clients, gunner: report.gunner, browserErrors }, null, 2));
    assert.ok(report.result.activeTwoClientMatch, 'real two-client match was reached');
    assert.ok(report.result.originalProceduralBackground, 'the original clean procedural background is drawn inside an opaque Canvas with no media ship layer');
    assert.ok(report.result.originalCanvasCoversGameplayViewport, 'the original renderer Canvas covers the gameplay viewport');
    assert.ok(report.result.allViewportBackgroundsCoverScene, 'both clean backgrounds resize with their live gameplay viewports');
    assert.ok(report.result.allViewportCanvasesNonzero, 'both clients have nonzero rendering surfaces at all tested sizes');
    assert.ok(report.result.allViewportShipPixelsPresent, 'ship-region pixel samples contain scene pixels at every viewport');
    assert.ok(report.result.allViewportShipDrawsPresent, 'both clients draw the original gameplay ship from shared state at every viewport');
    assert.ok(report.result.allViewportMultipleAsteroidsSampled, 'multiple asteroid-region samples contain rendered pixels at every viewport');
    assert.ok(report.result.bothClientsShareMatch, 'both clients render the same active match at every viewport');
    if (report.result.pilotInput !== null) assert.ok(report.result.pilotInput, 'guest observes Pilot movement');
    if (report.result.pilotRotation !== null) assert.ok(report.result.pilotRotation, 'guest observes Pilot rotation');
    assert.ok(report.result.gunnerDamageSynchronized, 'host observes Gunner damage');
    assert.ok(report.result.gunnerOneShotDestructionAndScore, 'one real Gunner shot removes its target and awards +50 on both clients');
    assert.ok(report.result.landingFullBleedVideo, 'landing video covers all representative viewports with readable, interactive content and no overflow');
    assert.ok(report.result.landingMotionAndReducedMotion, 'landing video advances and pauses for reduced motion');
    assert.ok(report.result.landingAudioAndSkipControls, 'audio and Skip Intro controls remain active');
    assert.equal(browserErrors.length, 0, 'browser reported no console/page errors');
  } finally {
    if (devtools) {
      try { await devtools.command('Browser.close'); } catch (_) {}
      try { devtools.socket.close(); } catch (_) {}
    }
    if (chrome.exitCode === null) chrome.kill();
    if (report.artifactDir && !fs.existsSync(path.join(report.artifactDir, 'report.json'))) {
      report.finishedAt = new Date().toISOString();
      report.artifactDir = report.artifactDir;
      fs.writeFileSync(path.join(report.artifactDir, 'report.json'), JSON.stringify(report, null, 2));
    }
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
