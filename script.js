/* ============================================================================
   AURA — Read Your Energy
   A generative, motion-driven "energy signature" reader.

   How it works, in short:
   1. We silently record every pointer movement for a short reading window.
   2. From that motion we derive four traits: Chaos, Flow, Reach, Calm.
   3. Those traits are matched against eight "Archetypes" (nearest-neighbour
      in trait-space) and hashed into a seed.
   4. The seed drives a deterministic generative renderer that paints a
      one-of-a-kind mandala — literally a picture of how you moved.
   5. The whole card renders to a single high-res canvas so it can be
      downloaded and shared as one image.
   ============================================================================ */

(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  Shared DOM references
   * ------------------------------------------------------------------ */
  const introScreen   = document.getElementById('introScreen');
  const hud           = document.getElementById('hud');
  const revealScreen  = document.getElementById('revealScreen');
  const hintText      = document.getElementById('hintText');

  const bgCanvas      = document.getElementById('bgCanvas');
  const bgCtx         = bgCanvas.getContext('2d');
  const cursorGlow    = document.getElementById('cursorGlow');

  const ringProgress  = document.getElementById('ringProgress');
  const ringLabel     = document.getElementById('ringLabel');
  const barChaos      = document.getElementById('barChaos');
  const barFlow       = document.getElementById('barFlow');
  const barReach      = document.getElementById('barReach');
  const barCalm       = document.getElementById('barCalm');
  const revealBtn     = document.getElementById('revealBtn');

  const auraCanvas    = document.getElementById('auraCanvas');
  const auraCtx       = auraCanvas.getContext('2d');

  const downloadBtn   = document.getElementById('downloadBtn');
  const shareBtn       = document.getElementById('shareBtn');
  const copyBtn       = document.getElementById('copyBtn');
  const restartBtn    = document.getElementById('restartBtn');
  const toast         = document.getElementById('toast');

  const RING_CIRC = 2 * Math.PI * 52; // matches r=52 in the SVG

  const isTouch = 'ontouchstart' in window;

  /* ------------------------------------------------------------------ *
   *  Reading-window tuning constants
   * ------------------------------------------------------------------ */
  const READING_TIME_MS   = 13000;   // time-based portion of progress
  const READING_DISTANCE  = 7000;    // px-based portion of progress (cumulative travel)
  const GRID_COLS = 14, GRID_ROWS = 22; // coverage grid resolution

  /* ------------------------------------------------------------------ *
   *  State
   * ------------------------------------------------------------------ */
  let state = null;
  function freshState() {
    return {
      tracking: false,
      started: false,
      finished: false,
      startTime: 0,
      lastX: null, lastY: null, lastT: null,
      lastAngle: null,
      totalDistance: 0,
      directionChangeScore: 0,   // accumulates angular deltas
      sampleCount: 0,
      speedSum: 0,
      maxSpeed: 0,
      stillTimeMs: 0,
      visitedCells: new Set(),
      minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity,
    };
  }

  /* ------------------------------------------------------------------ *
   *  Particle trail (background canvas) — runs continuously at 60fps
   * ------------------------------------------------------------------ */
  let particles = [];
  const MAX_PARTICLES = 420;

  function resizeBgCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    bgCanvas.width  = window.innerWidth  * dpr;
    bgCanvas.height = window.innerHeight * dpr;
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeBgCanvas();
  window.addEventListener('resize', resizeBgCanvas);

  function spawnParticles(x, y, speed) {
    const count = Math.min(4, 1 + Math.floor(speed / 12));
    for (let i = 0; i < count; i++) {
      if (particles.length >= MAX_PARTICLES) particles.shift();
      const angle = Math.random() * Math.PI * 2;
      const force = Math.random() * (0.6 + Math.min(speed / 30, 3));
      particles.push({
        x, y,
        vx: Math.cos(angle) * force,
        vy: Math.sin(angle) * force,
        life: 1,
        decay: 0.012 + Math.random() * 0.02,
        size: 1.5 + Math.random() * 2.5,
        hue: 260 + Math.min(speed * 1.4, 140), // violet -> magenta/cyan as speed rises
      });
    }
  }

  function drawParticles() {
    // translucent fill for a soft trailing / motion-blur effect
    bgCtx.fillStyle = 'rgba(8,5,15,0.18)';
    bgCtx.globalCompositeOperation = 'source-over';
    bgCtx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    bgCtx.globalCompositeOperation = 'lighter';
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= p.decay;
      if (p.life <= 0) { particles.splice(i, 1); continue; }

      const r = p.size * (0.6 + p.life);
      const grad = bgCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 6);
      grad.addColorStop(0, `hsla(${p.hue}, 95%, 70%, ${p.life * 0.9})`);
      grad.addColorStop(1, `hsla(${p.hue}, 95%, 60%, 0)`);
      bgCtx.fillStyle = grad;
      bgCtx.beginPath();
      bgCtx.arc(p.x, p.y, r * 6, 0, Math.PI * 2);
      bgCtx.fill();
    }
    bgCtx.globalCompositeOperation = 'source-over';
  }

  function bgLoop() {
    drawParticles();
    requestAnimationFrame(bgLoop);
  }
  requestAnimationFrame(bgLoop);

  /* ------------------------------------------------------------------ *
   *  Custom cursor glow (lerped for a smooth, premium feel)
   * ------------------------------------------------------------------ */
  let glowTX = window.innerWidth / 2, glowTY = window.innerHeight / 2;
  let glowX = glowTX, glowY = glowTY;
  function glowLoop() {
    glowX += (glowTX - glowX) * 0.22;
    glowY += (glowTY - glowY) * 0.22;
    cursorGlow.style.transform = `translate(${glowX}px, ${glowY}px)`;
    requestAnimationFrame(glowLoop);
  }
  if (!isTouch) requestAnimationFrame(glowLoop);

  /* ------------------------------------------------------------------ *
   *  Pointer tracking -> traits
   * ------------------------------------------------------------------ */
  state = freshState();

  function beginTracking() {
    if (state.started) return;
    state.started = true;
    state.tracking = true;
    state.startTime = performance.now();
    introScreen.classList.add('hidden');
    hud.classList.remove('hidden');
  }

  function handleMove(x, y) {
    glowTX = x; glowTY = y;
    if (!state.started) beginTracking();
    if (!state.tracking) return;

    const now = performance.now();

    if (state.lastX !== null) {
      const dx = x - state.lastX;
      const dy = y - state.lastY;
      const dist = Math.hypot(dx, dy);
      const dt = Math.max(now - state.lastT, 1);
      const speed = dist / dt * 16.6; // px per frame-equivalent, roughly frame-rate independent

      state.totalDistance += dist;
      state.sampleCount++;
      state.speedSum += speed;
      state.maxSpeed = Math.max(state.maxSpeed, speed);

      if (speed < 1.2) {
        state.stillTimeMs += dt;
      }

      if (dist > 0.5) {
        const angle = Math.atan2(dy, dx);
        if (state.lastAngle !== null) {
          let delta = Math.abs(angle - state.lastAngle);
          if (delta > Math.PI) delta = 2 * Math.PI - delta;
          state.directionChangeScore += delta;
        }
        state.lastAngle = angle;
      }

      spawnParticles(x, y, speed);
    }

    // Coverage grid
    const col = Math.min(GRID_COLS - 1, Math.floor((x / window.innerWidth) * GRID_COLS));
    const row = Math.min(GRID_ROWS - 1, Math.floor((y / window.innerHeight) * GRID_ROWS));
    state.visitedCells.add(col + ':' + row);

    state.minX = Math.min(state.minX, x); state.maxX = Math.max(state.maxX, x);
    state.minY = Math.min(state.minY, y); state.maxY = Math.max(state.maxY, y);

    state.lastX = x; state.lastY = y; state.lastT = now;

    updateProgress(now);
  }

  window.addEventListener('pointermove', (e) => handleMove(e.clientX, e.clientY), { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (e.touches[0]) handleMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  /* ------------------------------------------------------------------ *
   *  Progress + live HUD readout
   * ------------------------------------------------------------------ */
  let progressReady = false;

  function updateProgress(now) {
    const timeFrac = Math.min((now - state.startTime) / READING_TIME_MS, 1);
    const distFrac = Math.min(state.totalDistance / READING_DISTANCE, 1);
    const progress = timeFrac * 0.55 + distFrac * 0.45;

    const offset = RING_CIRC * (1 - progress);
    ringProgress.style.strokeDashoffset = offset.toFixed(1);
    ringLabel.textContent = Math.round(progress * 100) + '%';

    // live trait preview (rough, for HUD bars only — final calc happens on reveal)
    const traits = computeTraits();
    barChaos.style.width = traits.chaos + '%';
    barFlow.style.width  = traits.speed + '%';
    barReach.style.width = traits.coverage + '%';
    barCalm.style.width  = traits.calm + '%';

    if (progress >= 1 && !progressReady) {
      progressReady = true;
      revealBtn.disabled = false;
      revealBtn.classList.add('ready');
      ringProgress.style.stroke = 'var(--amber)';
    }
  }

  function computeTraits() {
    const elapsed = Math.max(performance.now() - state.startTime, 1);

    const avgSpeed = state.sampleCount ? state.speedSum / state.sampleCount : 0;
    const speedScore = clamp(mapRange(avgSpeed, 0, 26, 0, 100), 0, 100);

    const chaosScore = clamp(mapRange(state.directionChangeScore / Math.max(state.sampleCount, 1), 0, 1.6, 0, 100), 0, 100);

    const coverageScore = clamp(mapRange(state.visitedCells.size, 0, GRID_COLS * GRID_ROWS * 0.55, 0, 100), 0, 100);

    const calmScore = clamp(mapRange(state.stillTimeMs / elapsed, 0, 0.5, 0, 100), 0, 100);

    return { chaos: Math.round(chaosScore), speed: Math.round(speedScore), coverage: Math.round(coverageScore), calm: Math.round(calmScore) };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function mapRange(v, a, b, c, d) { return c + (clamp(v, a, b) - a) * (d - c) / (b - a); }

  /* ------------------------------------------------------------------ *
   *  Archetypes — prototype vectors in [chaos, speed, coverage, calm]
   * ------------------------------------------------------------------ */
  const ARCHETYPES = [
    { name: 'The Storm',     desc: 'Fast, unpredictable, electric. You move like weather.',            colors: ['#f7297b', '#7b2ff7', '#ffb648'], proto: [85, 80, 50, 10] },
    { name: 'The Wanderer',  desc: 'You cover ground without ever rushing. Curious by nature.',          colors: ['#22e5ff', '#7b2ff7', '#f4f2ff'], proto: [30, 50, 85, 20] },
    { name: 'The Architect', desc: 'Deliberate and structured. Every move has a reason.',                colors: ['#7b2ff7', '#22e5ff', '#ffb648'], proto: [15, 40, 80, 40] },
    { name: 'The Dreamer',   desc: 'Slow, soft, still. You drift more than you drive.',                  colors: ['#ffb648', '#f7297b', '#7b2ff7'], proto: [10, 15, 30, 90] },
    { name: 'The Spark',     desc: 'Short, intense bursts of energy. Small radius, huge intensity.',     colors: ['#f7297b', '#ffb648', '#22e5ff'], proto: [60, 90, 20, 5]  },
    { name: 'The Sage',      desc: 'Calm and unhurried, but never lost. Quiet confidence.',               colors: ['#22e5ff', '#ffb648', '#7b2ff7'], proto: [10, 20, 40, 80] },
    { name: 'The Rebel',     desc: 'Erratic on purpose. You break your own patterns before anyone else can.', colors: ['#f7297b', '#7b2ff7', '#22e5ff'], proto: [90, 60, 25, 10] },
    { name: 'The Flow',      desc: 'Smooth, continuous, balanced. You move like water finding its path.', colors: ['#22e5ff', '#7b2ff7', '#f7297b'], proto: [35, 55, 60, 30] },
  ];

  function pickArchetype(t) {
    const v = [t.chaos, t.speed, t.coverage, t.calm];
    let best = null, bestDist = Infinity;
    for (const a of ARCHETYPES) {
      const d = Math.hypot(v[0]-a.proto[0], v[1]-a.proto[1], v[2]-a.proto[2], v[3]-a.proto[3]);
      if (d < bestDist) { bestDist = d; best = a; }
    }
    // Rarity: further from the *average* of all prototypes = more unusual combination.
    const avg = [0,0,0,0];
    ARCHETYPES.forEach(a => a.proto.forEach((p, i) => avg[i] += p / ARCHETYPES.length));
    const distFromAvg = Math.hypot(v[0]-avg[0], v[1]-avg[1], v[2]-avg[2], v[3]-avg[3]);
    const rarity = clamp(Math.round(mapRange(distFromAvg, 10, 90, 2, 27)), 1, 32);
    return { archetype: best, rarity };
  }

  /* ------------------------------------------------------------------ *
   *  Deterministic PRNG, seeded from the user's own traits
   * ------------------------------------------------------------------ */
  function hashSeed(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ *
   *  Generative aura card rendering
   *  Draws directly onto the 1080x1350 export-quality canvas.
   * ------------------------------------------------------------------ */
  let rotation = 0;
  let rafReveal = null;
  let cardData = null; // { traits, archetype, rarity, rand }

  function renderAuraCard(rotateBy) {
    const W = auraCanvas.width, H = auraCanvas.height;
    const { traits, archetype, rarity, rand } = cardData;
    const cx = W / 2, cy = H * 0.42;

    // Background
    const bg = auraCtx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0c0818');
    bg.addColorStop(1, '#05030a');
    auraCtx.fillStyle = bg;
    auraCtx.fillRect(0, 0, W, H);

    // Soft glow behind the mandala
    const glow = auraCtx.createRadialGradient(cx, cy, 10, cx, cy, W * 0.55);
    glow.addColorStop(0, hexA(archetype.colors[0], 0.55));
    glow.addColorStop(1, hexA(archetype.colors[0], 0));
    auraCtx.fillStyle = glow;
    auraCtx.fillRect(0, 0, W, H);

    // ---- Mandala: layered rotating rings built from the user's traits ----
    const ringCount = 3 + Math.round(mapRange(traits.coverage, 0, 100, 0, 4));
    const petals = 5 + Math.round(mapRange(traits.chaos, 0, 100, 0, 11));
    const baseR = W * 0.30;

    auraCtx.save();
    auraCtx.translate(cx, cy);
    auraCtx.rotate(rotateBy);

    for (let ring = 0; ring < ringCount; ring++) {
      const ringR = baseR * (0.35 + (ring / ringCount) * 0.85);
      const wobble = mapRange(traits.chaos, 0, 100, 0.02, 0.22);
      const color = archetype.colors[ring % archetype.colors.length];
      const alpha = 0.85 - ring * (0.5 / ringCount);
      auraCtx.strokeStyle = hexA(color, alpha);
      auraCtx.lineWidth = 2 + mapRange(traits.speed, 0, 100, 0, 4);
      auraCtx.beginPath();

      const steps = petals * 6;
      for (let s = 0; s <= steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        const petalWave = Math.sin(a * petals + ring) * wobble;
        const jitter = (rand() - 0.5) * wobble * 0.4;
        const r = ringR * (1 + petalWave + jitter);
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (s === 0) auraCtx.moveTo(x, y); else auraCtx.lineTo(x, y);
      }
      auraCtx.closePath();
      auraCtx.stroke();
    }

    // Scattered "energy" dots — count from speed/intensity
    const dotCount = 12 + Math.round(mapRange(traits.speed, 0, 100, 0, 40));
    for (let i = 0; i < dotCount; i++) {
      const a = rand() * Math.PI * 2;
      const r = baseR * (0.15 + rand() * 1.15);
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      const size = 1.5 + rand() * 3.5;
      auraCtx.fillStyle = hexA(archetype.colors[i % archetype.colors.length], 0.5 + rand() * 0.4);
      auraCtx.beginPath();
      auraCtx.arc(x, y, size, 0, Math.PI * 2);
      auraCtx.fill();
    }

    // Core
    const core = auraCtx.createRadialGradient(0, 0, 0, 0, 0, baseR * 0.22);
    core.addColorStop(0, '#ffffff');
    core.addColorStop(0.4, hexA(archetype.colors[1], 0.9));
    core.addColorStop(1, hexA(archetype.colors[1], 0));
    auraCtx.fillStyle = core;
    auraCtx.beginPath();
    auraCtx.arc(0, 0, baseR * 0.22, 0, Math.PI * 2);
    auraCtx.fill();

    auraCtx.restore();

    // ---- Text block ----
    auraCtx.textAlign = 'center';

    auraCtx.fillStyle = 'rgba(244,242,255,0.55)';
    auraCtx.font = '600 22px "Space Grotesk", sans-serif';
    auraCtx.fillText('A U R A', cx, H * 0.72);

    auraCtx.fillStyle = '#f4f2ff';
    auraCtx.font = '700 64px "Space Grotesk", sans-serif';
    auraCtx.fillText(archetype.name, cx, H * 0.785);

    auraCtx.fillStyle = 'rgba(244,242,255,0.7)';
    auraCtx.font = '400 26px "Inter", sans-serif';
    wrapText(archetype.desc, cx, H * 0.825, W * 0.78, 34);

    // Rarity badge
    const badgeY = H * 0.90;
    auraCtx.font = '600 24px "JetBrains Mono", monospace';
    const badgeText = `${rarity}% RARE ENERGY SIGNATURE`;
    const badgeWidth = auraCtx.measureText(badgeText).width + 56;
    auraCtx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(auraCtx, cx - badgeWidth / 2, badgeY - 30, badgeWidth, 50, 25);
    auraCtx.fill();
    auraCtx.fillStyle = archetype.colors[2] || '#22e5ff';
    auraCtx.fillText(badgeText, cx, badgeY + 2);

    auraCtx.fillStyle = 'rgba(244,242,255,0.4)';
    auraCtx.font = '400 20px "Inter", sans-serif';
    auraCtx.fillText('discover yours — read your own energy', cx, H * 0.965);
  }

  function wrapText(text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '', lines = [];
    for (const w of words) {
      const test = line + w + ' ';
      if (auraCtx.measureText(test).width > maxWidth && line) {
        lines.push(line); line = w + ' ';
      } else { line = test; }
    }
    lines.push(line);
    const startY = y - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((l, i) => auraCtx.fillText(l.trim(), x, startY + i * lineHeight));
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hexA(hex, alpha) {
    const c = hex.replace('#', '');
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function revealLoop() {
    rotation += 0.0016;
    renderAuraCard(rotation);
    rafReveal = requestAnimationFrame(revealLoop);
  }

  /* ------------------------------------------------------------------ *
   *  Reveal chime — a small three-note arpeggio, synthesized live
   * ------------------------------------------------------------------ */
  function playChime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t0 = ctx.currentTime + i * 0.09;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.16, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 1);
      });
    } catch (e) { /* audio not critical to the experience */ }
  }

  /* ------------------------------------------------------------------ *
   *  Reveal flow
   * ------------------------------------------------------------------ */
  function reveal() {
    if (state.finished) return;
    state.finished = true;
    state.tracking = false;

    const traits = computeTraits();
    const { archetype, rarity } = pickArchetype(traits);
    const seedStr = [traits.chaos, traits.speed, traits.coverage, traits.calm, Math.round(state.totalDistance)].join('-');
    const rand = hashSeed(seedStr);

    cardData = { traits, archetype, rarity, rand };

    hud.classList.add('hidden');
    revealScreen.classList.remove('hidden');
    revealScreen.style.display = 'flex';

    playChime();
    if (rafReveal) cancelAnimationFrame(rafReveal);
    revealLoop();
  }

  revealBtn.addEventListener('click', (e) => {
    if (revealBtn.disabled) return;
    ripple(e, revealBtn);
    reveal();
  });

  // Also auto-suggest once ready: subtle nudge, but user stays in control.
  // (No auto-trigger — pressing "Reveal" is itself a satisfying, deliberate action.)

  /* ------------------------------------------------------------------ *
   *  Actions: download / share / copy / restart
   * ------------------------------------------------------------------ */
  downloadBtn.addEventListener('click', (e) => {
    ripple(e, downloadBtn);
    // Freeze current rotation frame at a pleasing angle for the export
    renderAuraCard(rotation);
    auraCanvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `my-aura-${cardData.archetype.name.replace(/\s+/g, '-').toLowerCase()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showToast('Saved ✦ your Aura image is downloading');
    }, 'image/png');
  });

  shareBtn.addEventListener('click', (e) => {
    ripple(e, shareBtn);
    const text = `I just read my energy on AURA. I'm ${cardData.archetype.name} — a ${cardData.rarity}% rare signature. What's yours?`;
    const url = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(location.href);
    window.open(url, '_blank', 'noopener,noreferrer');
  });

  copyBtn.addEventListener('click', (e) => {
    ripple(e, copyBtn);
    const link = location.href;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link).then(() => showToast('Link copied ✦'));
    } else {
      showToast('Link copied ✦');
    }
  });

  restartBtn.addEventListener('click', (e) => {
    ripple(e, restartBtn);
    if (rafReveal) cancelAnimationFrame(rafReveal);
    revealScreen.classList.add('hidden');
    setTimeout(() => {
      revealScreen.style.display = 'none';
      state = freshState();
      progressReady = false;
      revealBtn.disabled = true;
      revealBtn.classList.remove('ready');
      ringProgress.style.stroke = 'var(--cyan)';
      ringProgress.style.strokeDashoffset = RING_CIRC;
      ringLabel.textContent = '0%';
      [barChaos, barFlow, barReach, barCalm].forEach(b => b.style.width = '0%');
      introScreen.classList.remove('hidden');
    }, 400);
  });

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), 2400);
  }

  function ripple(e, el) {
    const rect = el.getBoundingClientRect();
    const span = document.createElement('span');
    const size = Math.max(rect.width, rect.height);
    span.className = 'ripple';
    span.style.width = span.style.height = size + 'px';
    const clientX = e.clientX !== undefined ? e.clientX : rect.left + rect.width / 2;
    const clientY = e.clientY !== undefined ? e.clientY : rect.top + rect.height / 2;
    span.style.left = (clientX - rect.left - size / 2) + 'px';
    span.style.top  = (clientY - rect.top - size / 2) + 'px';
    el.appendChild(span);
    setTimeout(() => span.remove(), 650);
  }

  /* ------------------------------------------------------------------ *
   *  Init: seed ring dash + a gentle idle particle drift so the page
   *  feels alive even before the very first move.
   * ------------------------------------------------------------------ */
  ringProgress.style.strokeDasharray = RING_CIRC;
  ringProgress.style.strokeDashoffset = RING_CIRC;

  let idlePhase = 0;
  function idleDrift() {
    if (!state.started) {
      idlePhase += 0.01;
      const x = window.innerWidth / 2 + Math.cos(idlePhase) * 40;
      const y = window.innerHeight / 2 + Math.sin(idlePhase * 1.3) * 40;
      if (Math.random() < 0.5) spawnParticles(x, y, 4);
    }
    requestAnimationFrame(idleDrift);
  }
  requestAnimationFrame(idleDrift);

})();
