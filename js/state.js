/**
 * js/state.js
 * Shared mutable application state, offscreen buffers, 6-vibe definitions & pure helpers.
 * Leaf module (zero imports) to guarantee a 100% circular-dependency-free graph.
 */

export const CONFIG = {
  FFT_SIZE: 2048,
  SMOOTHING: 0.62,            // Snappy, expressive FFT response
  MIN_DECIBELS: -93,
  MAX_DECIBELS: -19,
  BG_HEX: '#050507',
  SCENE_W: 1280,
  SCENE_H: 720,
  SPOTIFY_POLL_MS: 3500,
  SILENCE_GAP_MS: 1700,
  PARALLAX_BG: -15,
  PARALLAX_MID: 9,
  PARALLAX_CARD: 14,
  PARALLAX_FG: 20,
  EQ_BAR_COUNT: 48,
  HALO_BINS: 64,
  RAIN_COUNT: 52,
  BOKEH_COUNT: 20,
  DUST_COUNT: 58,
  GODRAY_COUNT: 6,
  AURORA_ORB_COUNT: 5,
  SHOCKWAVE_MAX: 7,
  GLITCH_SLICE_COUNT: 5,
  NOISE_SIZE: 128,
};

export const VIBES = [
  { id: 'ANTHEM',   code: '1', label: 'ANTHEM' },
  { id: 'EDM',      code: '2', label: 'EDM' },
  { id: 'HIPHOP',   code: '3', label: 'HIPHOP' },
  { id: 'SLOW',     code: '4', label: 'SLOW' },
  { id: 'ACOUSTIC', code: '5', label: 'ACOUSTIC' },
  { id: 'AMBIENT',  code: '6', label: 'AMBIENT' },
];

// Kept as MODES alias for compatibility
export const MODES = VIBES;

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const STORAGE_KEYS = {
  VERIFIER: 'mb_spotify_pkce_verifier',
  ACCESS_TOKEN: 'mb_spotify_access_token',
  REFRESH_TOKEN: 'mb_spotify_refresh_token',
  EXPIRES_AT: 'mb_spotify_expires_at',
  HAS_MODIFY_SCOPE: 'mb_spotify_modify_scope_v1',
};

export const CUBE_VERTICES = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1],  [1, -1, 1],  [1, 1, 1],  [-1, 1, 1],
];

export const CUBE_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

// ============================================================================
// GSAP BRIDGE (Uses window.gsap with safe fallback)
// ============================================================================
export const gsapApi = window.gsap || {
  to(target, vars) {
    for (const k in vars) {
      if (!['duration', 'ease', 'overwrite', 'stagger', 'onComplete', 'onUpdate', 'delay'].includes(k)) {
        if (Array.isArray(target)) target.forEach((el) => { el[k] = vars[k]; });
        else target[k] = vars[k];
      }
    }
    if (typeof vars.onUpdate === 'function') vars.onUpdate();
    if (typeof vars.onComplete === 'function') vars.onComplete();
  },
  fromTo(target, fromVars, toVars) {
    this.to(target, fromVars);
    this.to(target, toVars);
  },
  killTweensOf() {},
};

// ============================================================================
// DOM & OFFSCREEN CANVAS BUFFERS
// ============================================================================
export const dom = {
  canvas: document.getElementById('visualizer-canvas'),
  ctx: document.getElementById('visualizer-canvas').getContext('2d', { alpha: false }),
  startBtn: document.getElementById('start-btn'),
  spotifyBtn: document.getElementById('spotify-btn'),
};

export const buffers = {
  prevAlbumBackdropCanvas: document.createElement('canvas'),
  prevAlbumBackdropCtx: null,
  currAlbumBackdropCanvas: document.createElement('canvas'),
  currAlbumBackdropCtx: null,
  paletteCanvas: document.createElement('canvas'),
  paletteCtx: null,
  glassCanvas: document.createElement('canvas'),
  glassCtx: null,
  halftoneCanvas: document.createElement('canvas'),
  halftoneCtx: null,
  noiseCanvas: document.createElement('canvas'),
  noiseCtx: null,
  halftonePattern: null,
  noisePattern: null,
};

buffers.prevAlbumBackdropCtx = buffers.prevAlbumBackdropCanvas.getContext('2d');
buffers.currAlbumBackdropCtx = buffers.currAlbumBackdropCanvas.getContext('2d');
buffers.paletteCanvas.width = 16;
buffers.paletteCanvas.height = 16;
buffers.paletteCtx = buffers.paletteCanvas.getContext('2d', { willReadFrequently: true });
buffers.glassCtx = buffers.glassCanvas.getContext('2d');
buffers.halftoneCtx = buffers.halftoneCanvas.getContext('2d');
buffers.noiseCtx = buffers.noiseCanvas.getContext('2d');

// ============================================================================
// SHARED MUTABLE STATE OBJECTS
// ============================================================================

export const themePalette = {
  pr: 255, pg: 77,  pb: 0,
  sr: 255, sg: 142, sb: 62,
  hr: 255, hg: 222, hb: 184,
  primaryHex: '#ff4d00',
  primaryRgb: '255, 77, 0',
  secondaryRgb: '255, 142, 62',
  peakRgb: '255, 222, 184',
  lockedToAlbum: false,
};

export const trackState = {
  accessToken: localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN) || null,
  refreshToken: localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN) || null,
  expiresAt: Number(localStorage.getItem(STORAGE_KEYS.EXPIRES_AT) || 0),
  connected: false,
  isPlaying: false,
  pollInFlight: false,
  actionInFlight: false,
  lastPollTime: 0,
  currentTrackId: null,
  trackName: '',
  artistName: '',
  albumName: '',
  albumArtUrl: '',
  albumImg: null,
  prevAlbumImg: null,
  hasAlbumBackdrop: false,
  pendingTrackLock: false,
  trackChangeTime: 0,
  metadataBiasVibe: null,
};

export const panel = {
  viewportWidth: 0,
  viewportHeight: 0,
  dpr: 1,
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  cx: 0,
  cy: 0,
  radius: 18,
  leftDriverX: 0,
  rightDriverX: 0,
  driverY: 0,
  driverRadius: 0,
};

export const dsp = {
  audioCtx: null,
  analyser: null,
  sourceNode: null,
  freqData: null,
  timeData: null,
  isAudioActive: false,
  userSensitivity: 1.3,       // Expressive, punchy default sensitivity (+ / - to adjust)
  bandBins: {
    subBass: { start: 1, end: 5 },
    bass: { start: 5, end: 12 },
    lowMid: { start: 12, end: 28 },
    mid: { start: 28, end: 95 },
    highMid: { start: 95, end: 185 },
    treble: { start: 185, end: 512 },
  },
  subBass: 0,
  bass: 0,
  lowMid: 0,
  mid: 0,
  highMid: 0,
  treble: 0,
  rms: 0,
  rawRms: 0,
  db: -60,
  peakTracker: 0.28,
  agcGain: 1.3,
  // Fast-attack expressive envelopes
  smoothSub: 0,
  smoothBass: 0,
  smoothMid: 0,
  smoothHighMid: 0,
  smoothTreble: 0,
  smoothRms: 0,
  chorusIntensity: 0,         // Sustained drop / chorus energy [0..1] for velocity boosts
  prevSub: 0,
  prevMid: 0,
  prevHigh: 0,
  subAvg: 0,
  fullBandAvg: 0,
  highAvg: 0,
  // Rolling song features for accurate 6-vibe classification
  rollingSub: 0,
  rollingMid: 0,
  rollingHigh: 0,
  rollingTreble: 0,
  rollingRms: 0,
  rollingCrest: 1,
  rollingBpm: 0,
  transientFluxAvg: 0,        // Full-spectrum transient flux (snares, vocals, strums, kicks)
  kickDensity: 0,
  snareDensity: 0,
  kickPulse: 0,
  snarePulse: 0,
  beatPulse: 0,
  lastKickTime: 0,
  lastSnareTime: 0,
  lastRhythmTime: 0,
  dominantHz: 0,
  dominantNote: '--',
  vibe: 'ANTHEM',             // 'ANTHEM' | 'EDM' | 'HIPHOP' | 'SLOW' | 'ACOUSTIC' | 'AMBIENT'
  silenceStart: 0,
  awaitingFallbackSongLock: true,
  fallbackAnalyzeReadyAt: 0,
};

export const animState = {
  statusMessage: 'STANDBY // AWAITING SYSTEM AUDIO',
  fontsReady: false,
  autoVibeEnabled: true,
  lockedVibeIndex: 0,
  clockMode: false,
  clockBlend: 0,
  showGlassFrame: true,
  hudHoverId: null,
  pointerX: -999,
  pointerY: -999,
  lastPointerMove: performance.now(),
  targetMouseX: 0,
  targetMouseY: 0,
  mouseX: 0,
  mouseY: 0,
  pointerInside: false,
  backdrop: {
    trackCrossfade: 1,
    albumVisibility: 0,
    cardAlpha: 0,
    cardEnterProgress: 1,
    cardSlideX: 0,
    cardTilt: 0,
    cardControlsAlpha: 0,
    kenBurnsPhase: 0,
    kenBurnsDirX: 1,
    kenBurnsDirY: -1,
  },
  // Smooth GSAP blend weights across all 6 distinct vibe scenes
  vibeBlends: {
    ANTHEM: 0,
    EDM: 0,
    HIPHOP: 0,
    SLOW: 0,
    ACOUSTIC: 0,
    AMBIENT: 1,
  },
  poster: {
    line1Y: 0,
    line1Alpha: 1,
    line2Y: 0,
    line2Alpha: 1,
    artistY: 0,
    artistAlpha: 1,
    scalePunch: 1,
    skewX: 0,
    ruleProgress: 1,
    vibeBadgeGlow: 0,
  },
  fx: {
    driverRecoil: 0,
    driverGlow: 0,
    ambientBloom: 0,
    shakeX: 0,
    shakeY: 0,
    chromaSplit: 0,
    cubeScale: 1,
    cubeRotX: 0.4,
    cubeRotY: 0.6,
    cubeRotZ: 0.15,
    edmFlash: 0,
    glitchIntensity: 0,
    glitchSeed: 0,
    orbitPhase: 0,
  },
};

export const particles = {
  eqBinIndices: new Uint16Array(CONFIG.EQ_BAR_COUNT),
  eqBarPeaks: new Float32Array(CONFIG.EQ_BAR_COUNT),
  haloBinIndices: new Uint16Array(CONFIG.HALO_BINS),
  haloSmoothed: new Float32Array(CONFIG.HALO_BINS),
  auroraNodes: Array.from({ length: CONFIG.AURORA_ORB_COUNT }, (_, idx) => ({
    cx: 0.2 + (idx / (CONFIG.AURORA_ORB_COUNT - 1)) * 0.6,
    cy: 0.3 + ((idx * 37) % 10) * 0.045,
    freqX: 0.00026 + idx * 0.00007,
    freqY: 0.00021 + idx * 0.00006,
    phaseX: idx * 1.4,
    phaseY: idx * 2.1,
    radiusRatio: 0.42 + (idx % 3) * 0.14,
    colorRole: idx % 3,
  })),
  godRays: Array.from({ length: CONFIG.GODRAY_COUNT }, (_, idx) => ({
    originX: 0.18 + (idx / (CONFIG.GODRAY_COUNT - 1)) * 0.64,
    spread: 0.07 + (idx % 3) * 0.035,
    tilt: -0.18 + idx * 0.07,
    phase: idx * 1.15,
    alpha: 0.06 + (idx % 2) * 0.035,
  })),
  raindrops: Array.from({ length: CONFIG.RAIN_COUNT }, () => ({
    x: Math.random(),
    y: Math.random(),
    radius: 1.4 + Math.random() * 2.5,
    speed: 0.0009 + Math.random() * 0.0024,
    trailLen: 0.05 + Math.random() * 0.16,
    wobblePhase: Math.random() * Math.PI * 2,
    pauseTimer: Math.random() * 70,
  })),
  bokehOrbs: Array.from({ length: CONFIG.BOKEH_COUNT }, () => ({
    x: 0.08 + Math.random() * 0.84,
    y: 0.12 + Math.random() * 0.76,
    vx: (Math.random() - 0.5) * 0.0002,
    vy: (Math.random() - 0.5) * 0.00016,
    baseR: 26 + Math.random() * 78,
    alpha: 0.04 + Math.random() * 0.095,
    hueType: Math.floor(Math.random() * 3),
    phase: Math.random() * Math.PI * 2,
  })),
  dustMotes: Array.from({ length: CONFIG.DUST_COUNT }, () => ({
    x: Math.random(),
    y: Math.random(),
    z: 0.15 + Math.random() * 0.85,
    size: 1.1 + Math.random() * 2.1,
    alpha: 0.24 + Math.random() * 0.62,
    phase: Math.random() * Math.PI * 2,
  })),
  projectedCubePts: Array.from({ length: 8 }, () => ({ x: 0, y: 0, scale: 1 })),
};

export const ripples = Array.from({ length: CONFIG.SHOCKWAVE_MAX }, () => ({
  active: false,
  z: 1.0,
  radiusMult: 0.5,
  alpha: 0,
}));

export const hitRegions = [];

const paletteListeners = [];
export function onPaletteCommit(fn) {
  paletteListeners.push(fn);
}
export function notifyPaletteCommit() {
  for (let i = 0; i < paletteListeners.length; i++) {
    paletteListeners[i]();
  }
}

// ============================================================================
// SHARED PURE HELPERS & VIBE / TYPOGRAPHY TRANSITION CONTROLLERS
// ============================================================================

export function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function rgbToHex(r, g, b) {
  const hr = clampByte(r).toString(16).padStart(2, '0');
  const hg = clampByte(g).toString(16).padStart(2, '0');
  const hb = clampByte(b).toString(16).padStart(2, '0');
  return `#${hr}${hg}${hb}`;
}

export function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) * 0.5;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        break;
      case gn:
        h = ((bn - rn) / d + 2) / 6;
        break;
      default:
        h = ((rn - gn) / d + 4) / 6;
        break;
    }
  }
  return { h: h * 360, s, l };
}

export function hslToRgb(hDeg, s, l) {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  if (s === 0) {
    const v = clampByte(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p, q, t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    clampByte(hue2rgb(p, q, h + 1 / 3) * 255),
    clampByte(hue2rgb(p, q, h) * 255),
    clampByte(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

export function syncThemePaletteStrings() {
  const pr = clampByte(themePalette.pr);
  const pg = clampByte(themePalette.pg);
  const pb = clampByte(themePalette.pb);
  const sr = clampByte(themePalette.sr);
  const sg = clampByte(themePalette.sg);
  const sb = clampByte(themePalette.sb);
  const hr = clampByte(themePalette.hr);
  const hg = clampByte(themePalette.hg);
  const hb = clampByte(themePalette.hb);

  themePalette.primaryHex = rgbToHex(pr, pg, pb);
  themePalette.primaryRgb = `${pr}, ${pg}, ${pb}`;
  themePalette.secondaryRgb = `${sr}, ${sg}, ${sb}`;
  themePalette.peakRgb = `${hr}, ${hg}, ${hb}`;

  document.documentElement.style.setProperty('--accent-rgb', themePalette.primaryRgb);
  document.documentElement.style.setProperty('--accent-orange', themePalette.primaryHex);
}

/**
 * Responsive perceptual shaping (`pow(..., 0.9)`) so subtle musical detail & vocals pop
 * while preserving punchy headroom for drops and choruses.
 */
export function shapeBand(raw, gain) {
  return Math.min(1, Math.pow(Math.min(1, raw * gain), 0.9));
}

export function roundedRectPath(context, x, y, w, h, r) {
  const radius = Math.min(r, w * 0.5, h * 0.5);
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + w - radius, y);
  context.quadraticCurveTo(x + w, y, x + w, y + radius);
  context.lineTo(x + w, y + h - radius);
  context.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  context.lineTo(x + radius, y + h);
  context.quadraticCurveTo(x, y + h, x, y + h - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

export function chamferedRectPath(context, x, y, w, h, cut) {
  const c = Math.min(cut, w * 0.25, h * 0.25);
  context.beginPath();
  context.moveTo(x + c, y);
  context.lineTo(x + w - c, y);
  context.lineTo(x + w, y + c);
  context.lineTo(x + w, y + h - c);
  context.lineTo(x + w - c, y + h);
  context.lineTo(x + c, y + h);
  context.lineTo(x, y + h - c);
  context.lineTo(x, y + c);
  context.closePath();
}

export function truncateTextToWidth(context, text, maxWidth) {
  if (!text) return '';
  if (maxWidth <= 24) return '';
  if (context.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 3 && context.measureText(`${trimmed}...`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}...`;
}

/**
 * Intelligently wraps a long Track Title into at most 2 balanced lines within `maxWidth`,
 * cleanly truncating line 2 with an ellipsis if needed.
 */
export function wrapTitleTwoLines(context, text, maxWidth) {
  if (!text) return ['SONICGLASS A1'];
  if (context.measureText(text).width <= maxWidth) return [text];

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return [truncateTextToWidth(context, text, maxWidth)];
  }

  let line1 = '';
  let splitIdx = 0;
  for (let i = 0; i < words.length; i++) {
    const candidate = line1 ? `${line1} ${words[i]}` : words[i];
    if (context.measureText(candidate).width <= maxWidth || i === 0) {
      line1 = candidate;
      splitIdx = i + 1;
    } else {
      break;
    }
  }

  if (splitIdx >= words.length) {
    return [truncateTextToWidth(context, line1, maxWidth)];
  }

  const remaining = words.slice(splitIdx).join(' ');
  return [
    truncateTextToWidth(context, line1, maxWidth),
    truncateTextToWidth(context, remaining, maxWidth),
  ];
}

export function getFormattedClock() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const dateStr = d
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' })
    .toUpperCase();
  return { hh, mm, ss, dateStr };
}

export function getEffectiveVibe() {
  return animState.autoVibeEnabled ? dsp.vibe : VIBES[animState.lockedVibeIndex].id;
}

export function applyVibeVisualBlend(vibe) {
  const blendVars = { duration: 1.4, ease: 'power2.inOut' };
  for (let i = 0; i < VIBES.length; i++) {
    const id = VIBES[i].id;
    blendVars[id] = id === vibe ? 1 : 0;
  }
  gsapApi.to(animState.vibeBlends, blendVars);

  gsapApi.fromTo(
    animState.poster,
    { vibeBadgeGlow: 1 },
    { vibeBadgeGlow: 0, duration: 1.1, ease: 'power2.out' }
  );
}

export function triggerTrackTitleEntrance() {
  const { poster } = animState;
  gsapApi.killTweensOf(poster);

  gsapApi.fromTo(
    poster,
    {
      line1Y: 26,
      line1Alpha: 0,
      line2Y: 36,
      line2Alpha: 0,
      artistY: 18,
      artistAlpha: 0,
      scalePunch: 0.97,
      skewX: 0,
      ruleProgress: 0,
    },
    {
      line1Y: 0,
      line1Alpha: 1,
      line2Y: 0,
      line2Alpha: 1,
      artistY: 0,
      artistAlpha: 1,
      scalePunch: 1,
      skewX: 0,
      ruleProgress: 1,
      duration: 0.95,
      ease: 'power3.out',
    }
  );
}
