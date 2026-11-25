/**
 * Morning Blues // SonicGlass A1 — Zero-Rate-Limit Spotify Album & Procedural Visual Engine
 * Vanilla JS + HTML5 Canvas 2D + GSAP 3.12 + Web Audio API (getDisplayMedia) + Spotify PKCE
 * 100% Local Rendering · Album-Art Atmospheric Backdrop · Procedural Aurora Fallback
 */

const APP_CONFIG = window.APP_CONFIG || {};
const SPOTIFY_CLIENT_ID = (APP_CONFIG.SPOTIFY_CLIENT_ID || '').trim();
const SPOTIFY_REDIRECT_URI =
  (APP_CONFIG.SPOTIFY_REDIRECT_URI || '').trim() ||
  `${window.location.origin}${window.location.pathname}`;
const IS_SPOTIFY_CONFIGURED =
  Boolean(SPOTIFY_CLIENT_ID) && SPOTIFY_CLIENT_ID !== 'YOUR_SPOTIFY_CLIENT_ID';
const SPOTIFY_SCOPES = 'user-read-currently-playing user-read-playback-state';

const CONFIG = {
  FFT_SIZE: 2048,
  SMOOTHING: 0.74,            // Balanced, musical FFT smoothing (dialed down from twitchy 0.58)
  MIN_DECIBELS: -90,
  MAX_DECIBELS: -22,
  BG_HEX: '#050507',
  SCENE_W: 1280,
  SCENE_H: 720,
  SPOTIFY_POLL_MS: 3500,      // Poll currently-playing every 3.5s
  SILENCE_GAP_MS: 1750,       // Silence boundary detector when Spotify isn't connected
  PARALLAX_BG: -15,
  PARALLAX_MID: 9,
  PARALLAX_CARD: 14,          // Floating sharp glass album card plane
  PARALLAX_FG: 20,
  EQ_BAR_COUNT: 48,
  RAIN_COUNT: 50,
  BOKEH_COUNT: 20,
  DUST_COUNT: 46,
  AURORA_ORB_COUNT: 5,
  SHOCKWAVE_MAX: 6,
  GLITCH_SLICE_COUNT: 4,
  NOISE_SIZE: 128,
};

const MODES = [
  { id: 'auto', code: '01', label: 'AUTO SCENE', forcedVibe: null },
  { id: 'slow', code: '02', label: 'SLOW // RAIN', forcedVibe: 'SLOW' },
  { id: 'edm', code: '03', label: 'EDM // KINETIC', forcedVibe: 'EDM' },
  { id: 'clock', code: '04', label: 'TIMEPIECE', forcedVibe: null },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const STORAGE_KEYS = {
  VERIFIER: 'mb_spotify_pkce_verifier',
  ACCESS_TOKEN: 'mb_spotify_access_token',
  REFRESH_TOKEN: 'mb_spotify_refresh_token',
  EXPIRES_AT: 'mb_spotify_expires_at',
};

// Magazine-style asymmetrical editorial poster headlines per vibe
const EDITORIAL_PHRASES = {
  SLOW: [
    { kicker: 'NOCTURNE // RAIN STUDY', lines: ['CARRY ME', 'AWAY'] },
    { kicker: 'SLOW_WAVE // 02:00 AM', lines: ['MIDNIGHT', 'DRIFT'] },
    { kicker: 'ANALOG // CONDENSATION', lines: ['VELVET', 'SILENCE'] },
    { kicker: 'BALLAD // LOW_TIDE', lines: ['AFTER THE', 'RAIN'] },
    { kicker: 'LO-FI // BOKEH', lines: ['QUIET', 'GRAVITY'] },
  ],
  EDM: [
    { kicker: 'HIGH_VOLTAGE // BRUTAL', lines: ['KINETIC', 'PULSE'] },
    { kicker: 'TRANSIENT // OVERDRIVE', lines: ['OVERDRIVE', 'SYSTEM'] },
    { kicker: 'SUB_BASS // PRESSURE', lines: ['TECTONIC', 'IMPACT'] },
    { kicker: 'WIREFRAME // KINETICS', lines: ['HYPER', 'VOLTAGE'] },
    { kicker: 'SYNTH // MONOLITH', lines: ['BRUTAL', 'VELOCITY'] },
  ],
  AMBIENT: [
    { kicker: 'SCENESYNC // GALLERY', lines: ['SOLAR', 'STILLNESS'] },
    { kicker: 'FROSTED // HORIZON', lines: ['LUMINOUS', 'HAZE'] },
    { kicker: 'DIFFUSED // EQUINOX', lines: ['LUCID', 'AETHER'] },
    { kicker: 'ARCHITECTURAL // LIGHT', lines: ['WARM', 'HORIZON'] },
    { kicker: 'SONICGLASS // STUDIO', lines: ['GOLDEN', 'DRIFT'] },
  ],
};

// 3D Cube Vertices & Edges for EDM Wireframe Bounding Box
const CUBE_VERTICES = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1],  [1, -1, 1],  [1, 1, 1],  [-1, 1, 1],
];
const CUBE_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

// ============================================================================
// GSAP BRIDGE (Uses window.gsap with safe fallback)
// ============================================================================
const gsapApi = window.gsap || {
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
// STATE & DYNAMIC THEME PALETTE
// ============================================================================
const canvas = document.getElementById('visualizer-canvas');
const ctx = canvas.getContext('2d', { alpha: false });
const startBtn = document.getElementById('start-btn');
const spotifyBtn = document.getElementById('spotify-btn');

let audioCtx = null;
let analyser = null;
let sourceNode = null;
let freqData = null;
let timeData = null;
let isAudioActive = false;
let statusMessage = 'STANDBY // AWAITING SYSTEM AUDIO';
let fontsReady = false;

let viewportWidth = 0;
let viewportHeight = 0;
let dpr = 1;

// Dynamic GSAP-tweened Theme Palette (morphs to exact Spotify album cover colors over 1.5s)
const themePalette = {
  pr: 255, pg: 77,  pb: 0,     // Primary vibrant color
  sr: 255, sg: 142, sb: 62,    // Secondary midtone color
  hr: 255, hg: 222, hb: 184,   // Contrasting highlight / peak color
  primaryHex: '#ff4d00',
  primaryRgb: '255, 77, 0',
  secondaryRgb: '255, 142, 62',
  peakRgb: '255, 222, 184',
  lockedToAlbum: false,
};

// Spotify Web API PKCE & Now-Playing State
const spotify = {
  accessToken: localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN) || null,
  refreshToken: localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN) || null,
  expiresAt: Number(localStorage.getItem(STORAGE_KEYS.EXPIRES_AT) || 0),
  connected: false,
  isPlaying: false,
  pollInFlight: false,
  lastPollTime: 0,
  currentTrackId: null,
  trackName: '',
  artistName: '',
  albumName: '',
  albumArtUrl: '',
  albumImg: null,
  hasAlbumBackdrop: false,
  pendingTrackLock: false,
  trackChangeTime: 0,
};

// Multi-plane mouse parallax [-1, 1]
let targetMouseX = 0;
let targetMouseY = 0;
let mouseX = 0;
let mouseY = 0;
let pointerInside = false;

// SonicGlass A1 panel geometry
const panel = {
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

// Interactive UI & Mode Transition State
let activeModeIndex = 0;
let prevModeIndex = 0;
let userSensitivity = 1.05;   // Dialed down for smoother, composed reactivity (+ / - to adjust)
let showGlassFrame = true;
let hudHoverId = null;
let lastPointerMove = performance.now();
const hitRegions = [];

const modeTransition = { progress: 1 };

// Balanced Audio DSP, Composed AGC & 1-Song-1-Vibe State
const bandBins = {
  subBass: { start: 1, end: 5 },
  bass: { start: 5, end: 12 },
  mid: { start: 12, end: 95 },
  highMid: { start: 95, end: 185 },
  treble: { start: 185, end: 512 },
};

const dsp = {
  subBass: 0,
  bass: 0,
  mid: 0,
  highMid: 0,
  treble: 0,
  rms: 0,
  rawRms: 0,
  db: -60,
  peakTracker: 0.34,
  agcGain: 1.05,
  smoothSub: 0,
  smoothMid: 0,
  smoothTreble: 0,
  smoothRms: 0,
  prevSub: 0,
  prevHigh: 0,
  subAvg: 0,
  highAvg: 0,
  rollingSub: 0,
  rollingMid: 0,
  rollingTreble: 0,
  rollingRms: 0,
  rollingBpm: 0,
  onsetDensity: 0,
  kickPulse: 0,
  snarePulse: 0,
  beatPulse: 0,
  lastKickTime: 0,
  lastSnareTime: 0,
  dominantHz: 0,
  dominantNote: '--',
  vibe: 'AMBIENT', // 'SLOW' | 'EDM' | 'AMBIENT' (Strictly locked 1-per-song)
  silenceStart: 0,
  awaitingFallbackSongLock: true,
  fallbackAnalyzeReadyAt: 0,
};

// Offscreen Canvases (Pre-Blurred Album Art Backdrops, 16x16 Palette Sampler, Bezel, Grain)
const prevAlbumBackdropCanvas = document.createElement('canvas');
const prevAlbumBackdropCtx = prevAlbumBackdropCanvas.getContext('2d');
const currAlbumBackdropCanvas = document.createElement('canvas');
const currAlbumBackdropCtx = currAlbumBackdropCanvas.getContext('2d');

const paletteCanvas = document.createElement('canvas');
paletteCanvas.width = 16;
paletteCanvas.height = 16;
const paletteCtx = paletteCanvas.getContext('2d', { willReadFrequently: true });

const glassCanvas = document.createElement('canvas');
const glassCtx = glassCanvas.getContext('2d');
const halftoneCanvas = document.createElement('canvas');
const halftoneCtx = halftoneCanvas.getContext('2d');
let halftonePattern = null;
const noiseCanvas = document.createElement('canvas');
const noiseCtx = noiseCanvas.getContext('2d');
let noisePattern = null;

const eqBinIndices = new Uint16Array(CONFIG.EQ_BAR_COUNT);
const eqBarPeaks = new Float32Array(CONFIG.EQ_BAR_COUNT);

// Hybrid Backdrop State (GSAP crossfades between tracks & between Album Art <-> Procedural Aurora)
const backdropState = {
  trackCrossfade: 1,      // 0 -> 1 crossfade when switching from prev album art to new album art
  albumVisibility: 0,     // 0 = Procedural Aurora Field, 1 = Blurred Spotify Album Art Backdrop
  cardAlpha: 0,           // Floating sharp glass album card visibility
  cardScale: 0.94,
  kenBurnsPhase: 0,
  kenBurnsDirX: 1,
  kenBurnsDirY: -1,
  vibeBlendSLOW: 0,
  vibeBlendEDM: 0,
  vibeBlendAMBIENT: 1,
};

const posterState = {
  kicker: EDITORIAL_PHRASES.AMBIENT[0].kicker,
  lines: EDITORIAL_PHRASES.AMBIENT[0].lines,
  prevLines: null,
  phraseIdx: 0,
  line1X: 0,
  line1Y: 0,
  line1Alpha: 1,
  line2X: 0,
  line2Y: 0,
  line2Alpha: 1,
  prevAlpha: 0,
  prevShiftY: 0,
  scalePunch: 1,
  skewX: 0,
  ruleProgress: 1,
  vibeBadgeGlow: 0,
};

const fxState = {
  driverRecoil: 0,
  driverGlow: 0,
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
};

// Procedural Aurora Mesh Nodes (for rich zero-API fallback scene)
const auroraNodes = Array.from({ length: CONFIG.AURORA_ORB_COUNT }, (_, idx) => ({
  cx: 0.2 + (idx / (CONFIG.AURORA_ORB_COUNT - 1)) * 0.6,
  cy: 0.3 + ((idx * 37) % 10) * 0.045,
  freqX: 0.00024 + idx * 0.00007,
  freqY: 0.00019 + idx * 0.00006,
  phaseX: idx * 1.4,
  phaseY: idx * 2.1,
  radiusRatio: 0.42 + (idx % 3) * 0.14,
  colorRole: idx % 3, // 0 = primary, 1 = secondary, 2 = peak
}));

// Procedural Weather & Particle Pools
const raindrops = Array.from({ length: CONFIG.RAIN_COUNT }, () => ({
  x: Math.random(),
  y: Math.random(),
  radius: 1.4 + Math.random() * 2.4,
  speed: 0.0008 + Math.random() * 0.0022,
  trailLen: 0.05 + Math.random() * 0.15,
  wobblePhase: Math.random() * Math.PI * 2,
  pauseTimer: Math.random() * 75,
}));

const bokehOrbs = Array.from({ length: CONFIG.BOKEH_COUNT }, () => ({
  x: 0.08 + Math.random() * 0.84,
  y: 0.12 + Math.random() * 0.76,
  vx: (Math.random() - 0.5) * 0.00018,
  vy: (Math.random() - 0.5) * 0.00014,
  baseR: 26 + Math.random() * 76,
  alpha: 0.035 + Math.random() * 0.09,
  hueType: Math.floor(Math.random() * 3),
  phase: Math.random() * Math.PI * 2,
}));

const dustMotes = Array.from({ length: CONFIG.DUST_COUNT }, () => ({
  x: Math.random(),
  y: Math.random(),
  z: 0.15 + Math.random() * 0.85,
  size: 1 + Math.random() * 1.9,
  alpha: 0.2 + Math.random() * 0.58,
  phase: Math.random() * Math.PI * 2,
}));

const shockwaves = Array.from({ length: CONFIG.SHOCKWAVE_MAX }, () => ({
  active: false,
  z: 1.0,
  radiusMult: 0.5,
  alpha: 0,
}));

const projectedCubePts = Array.from({ length: 8 }, () => ({ x: 0, y: 0, scale: 1 }));

// ============================================================================
// 1. ALBUM ART COLOR EXTRACTION & SPECTRAL FALLBACK PALETTE
// ============================================================================

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function rgbToHex(r, g, b) {
  const hr = clampByte(r).toString(16).padStart(2, '0');
  const hg = clampByte(g).toString(16).padStart(2, '0');
  const hb = clampByte(b).toString(16).padStart(2, '0');
  return `#${hr}${hg}${hb}`;
}

function rgbToHsl(r, g, b) {
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

function hslToRgb(hDeg, s, l) {
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

function syncThemePaletteStrings() {
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

function tweenThemePalette(primary, secondary, peak, duration = 1.5) {
  gsapApi.killTweensOf(themePalette);
  gsapApi.to(themePalette, {
    pr: primary[0],
    pg: primary[1],
    pb: primary[2],
    sr: secondary[0],
    sg: secondary[1],
    sb: secondary[2],
    hr: peak[0],
    hg: peak[1],
    hb: peak[2],
    duration,
    ease: 'power2.inOut',
    onUpdate: () => {
      syncThemePaletteStrings();
    },
    onComplete: () => {
      syncThemePaletteStrings();
      buildGlassEnclosureCache();
      buildHalftonePattern();
    },
  });
}

/**
 * Pre-renders the loaded Spotify album cover onto `currAlbumBackdropCanvas` (1280x720)
 * using `blur(24px) saturate(1.35) brightness(0.55)` ONCE on track change so 60 FPS
 * Ken Burns zoom/drift runs hardware-accelerated with zero per-frame blur cost.
 */
function commitBlurredAlbumBackdrop(img) {
  const w = CONFIG.SCENE_W;
  const h = CONFIG.SCENE_H;

  // Snapshot previous blurred backdrop for smooth GSAP crossfade
  prevAlbumBackdropCtx.clearRect(0, 0, w, h);
  if (spotify.hasAlbumBackdrop) {
    prevAlbumBackdropCtx.drawImage(currAlbumBackdropCanvas, 0, 0, w, h);
  }

  // Overscan by 64px on all sides so the 24px Gaussian blur never bleeds dark transparent edges
  const pad = 64;
  const targetW = w + pad * 2;
  const targetH = h + pad * 2;
  const imgAspect = (img.naturalWidth || 640) / (img.naturalHeight || 640);
  const boxAspect = targetW / targetH;

  let drawW = targetW;
  let drawH = targetH;
  let dx = -pad;
  let dy = -pad;

  if (imgAspect > boxAspect) {
    drawH = targetH;
    drawW = targetH * imgAspect;
    dx = (w - drawW) * 0.5;
  } else {
    drawW = targetW;
    drawH = targetW / imgAspect;
    dy = (h - drawH) * 0.5;
  }

  currAlbumBackdropCtx.save();
  currAlbumBackdropCtx.clearRect(0, 0, w, h);
  currAlbumBackdropCtx.filter = 'blur(24px) saturate(1.35) brightness(0.55)';
  currAlbumBackdropCtx.drawImage(img, dx, dy, drawW, drawH);
  currAlbumBackdropCtx.filter = 'none';

  // Subtle smoked-glass vignette baked into backdrop
  const grade = currAlbumBackdropCtx.createLinearGradient(0, 0, 0, h);
  grade.addColorStop(0, 'rgba(5, 5, 8, 0.24)');
  grade.addColorStop(0.5, 'rgba(5, 5, 8, 0.08)');
  grade.addColorStop(1, 'rgba(4, 4, 7, 0.42)');
  currAlbumBackdropCtx.fillStyle = grade;
  currAlbumBackdropCtx.fillRect(0, 0, w, h);
  currAlbumBackdropCtx.restore();

  const hadPrevious = spotify.hasAlbumBackdrop;
  spotify.albumImg = img;
  spotify.hasAlbumBackdrop = true;

  backdropState.kenBurnsDirX = Math.random() > 0.5 ? 1 : -1;
  backdropState.kenBurnsDirY = Math.random() > 0.5 ? 1 : -1;

  if (hadPrevious) {
    gsapApi.killTweensOf(backdropState, 'trackCrossfade');
    backdropState.trackCrossfade = 0;
    gsapApi.to(backdropState, {
      trackCrossfade: 1,
      duration: 2.0,
      ease: 'power2.inOut',
    });
  } else {
    backdropState.trackCrossfade = 1;
  }

  // Smoothly fade in the album backdrop & sharp floating glass album card
  gsapApi.to(backdropState, {
    albumVisibility: spotify.isPlaying ? 1 : 0,
    cardAlpha: spotify.isPlaying ? 1 : 0,
    cardScale: 1,
    duration: 1.6,
    ease: 'power3.out',
  });
}

/**
 * Loads `albumArtUrl` once (`crossOrigin = 'anonymous'`), bakes the stylized blurred
 * atmospheric backdrop, and samples a 16x16 offscreen canvas to morph `themePalette`.
 */
function loadAlbumArtAndExtractPalette(imageUrl) {
  return new Promise((resolve) => {
    if (!imageUrl) {
      resolve();
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      // 1. Bake stylized blurred full-bleed atmospheric backdrop + sharp card image
      commitBlurredAlbumBackdrop(img);

      // 2. Sample 16x16 pixels for vibrant & highlight color extraction
      try {
        paletteCtx.clearRect(0, 0, 16, 16);
        paletteCtx.drawImage(img, 0, 0, 16, 16);
        const data = paletteCtx.getImageData(0, 0, 16, 16).data;

        const buckets = Array.from({ length: 12 }, () => ({
          weight: 0,
          rSum: 0,
          gSum: 0,
          bSum: 0,
          count: 0,
        }));

        let bestHighlight = null;
        let bestHighlightScore = -1;
        let colorfulPixelCount = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 180) continue;

          const maxC = Math.max(r, g, b);
          if (maxC < 32) continue;

          const { h, s, l } = rgbToHsl(r, g, b);
          if (s < 0.14 && l < 0.65) continue;

          if (s >= 0.15 && l > 0.12 && l < 0.88) {
            colorfulPixelCount++;
            const vibrancy = (0.25 + s * 0.75) * (1 - Math.abs(l - 0.52) * 1.25);
            const bIdx = Math.floor(h / 30) % 12;
            buckets[bIdx].weight += Math.max(0.05, vibrancy);
            buckets[bIdx].rSum += r * vibrancy;
            buckets[bIdx].gSum += g * vibrancy;
            buckets[bIdx].bSum += b * vibrancy;
            buckets[bIdx].count++;
          }

          const hlScore = l * 0.7 + s * 0.5;
          if (l > 0.45 && hlScore > bestHighlightScore) {
            bestHighlightScore = hlScore;
            bestHighlight = { h, s, l };
          }
        }

        let primaryRgbArr;
        let secondaryRgbArr;
        let peakRgbArr;

        if (colorfulPixelCount >= 5) {
          const sorted = buckets
            .map((bk, idx) => ({ ...bk, idx }))
            .filter((bk) => bk.count > 0 && bk.weight > 0)
            .sort((a, b) => b.weight - a.weight);

          const top = sorted[0];
          const domHsl = rgbToHsl(
            top.rSum / top.weight,
            top.gSum / top.weight,
            top.bSum / top.weight
          );

          const vividS = Math.min(1, Math.max(0.62, domHsl.s * 1.2));
          const vividL = Math.min(0.64, Math.max(0.52, domHsl.l));
          primaryRgbArr = hslToRgb(domHsl.h, vividS, vividL);

          const second = sorted.find((bk) => Math.abs(bk.idx - top.idx) >= 2 && bk.idx !== top.idx);
          if (second && second.weight > top.weight * 0.2) {
            const secHsl = rgbToHsl(
              second.rSum / second.weight,
              second.gSum / second.weight,
              second.bSum / second.weight
            );
            secondaryRgbArr = hslToRgb(
              secHsl.h,
              Math.max(0.5, secHsl.s),
              Math.min(0.7, Math.max(0.5, secHsl.l))
            );
          } else {
            secondaryRgbArr = hslToRgb(domHsl.h + 24, vividS * 0.88, Math.min(0.72, vividL + 0.1));
          }

          const peakHue = bestHighlight ? bestHighlight.h : domHsl.h + 15;
          const peakSat = bestHighlight ? Math.min(0.85, Math.max(0.35, bestHighlight.s)) : 0.55;
          peakRgbArr = hslToRgb(peakHue, peakSat, 0.84);
        } else {
          // Crisp monochrome silver-ivory palette for B&W album covers
          primaryRgbArr = [215, 222, 235];
          secondaryRgbArr = [150, 162, 182];
          peakRgbArr = [248, 250, 255];
        }

        themePalette.lockedToAlbum = true;
        tweenThemePalette(primaryRgbArr, secondaryRgbArr, peakRgbArr, 1.5);
      } catch (_) {
        // Keep current palette if canvas read fails
      }

      resolve();
    };

    img.onerror = () => {
      resolve();
    };

    img.src = imageUrl;
  });
}

function updateSpectralFallbackPalette(now) {
  if (spotify.connected && spotify.isPlaying && themePalette.lockedToAlbum) return;

  themePalette.lockedToAlbum = false;
  const spectralHue = isAudioActive
    ? 15 + dsp.smoothTreble * 26 - dsp.smoothSub * 7 + Math.sin(now * 0.00028) * 5
    : 19 + Math.sin(now * 0.00035) * 5;

  const pRgb = hslToRgb(spectralHue, 0.95, 0.52);
  const sRgb = hslToRgb(spectralHue + 16, 0.9, 0.62);
  const hRgb = hslToRgb(spectralHue + 24, 0.82, 0.82);

  themePalette.pr += (pRgb[0] - themePalette.pr) * 0.035;
  themePalette.pg += (pRgb[1] - themePalette.pg) * 0.035;
  themePalette.pb += (pRgb[2] - themePalette.pb) * 0.035;

  themePalette.sr += (sRgb[0] - themePalette.sr) * 0.035;
  themePalette.sg += (sRgb[1] - themePalette.sg) * 0.035;
  themePalette.sb += (sRgb[2] - themePalette.sb) * 0.035;

  themePalette.hr += (hRgb[0] - themePalette.hr) * 0.035;
  themePalette.hg += (hRgb[1] - themePalette.hg) * 0.035;
  themePalette.hb += (hRgb[2] - themePalette.hb) * 0.035;

  syncThemePaletteStrings();
}

// ============================================================================
// 2. SPOTIFY OAUTH 2.0 PKCE FLOW & 3.5s NOW-PLAYING POLLER
// ============================================================================

function generateRandomVerifier(length = 64) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const randomValues = new Uint8Array(length);
  window.crypto.getRandomValues(randomValues);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += possible[randomValues[i] % possible.length];
  }
  return out;
}

function base64UrlEncode(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function startSpotifyPkceAuth() {
  if (!IS_SPOTIFY_CONFIGURED) {
    statusMessage = 'SPOTIFY // SET CLIENT_ID IN config.js (SEE config.example.js)';
    return;
  }

  try {
    const redirectOrigin = new URL(SPOTIFY_REDIRECT_URI).origin;
    if (
      window.location.hostname === 'localhost' &&
      redirectOrigin.includes('127.0.0.1') &&
      window.location.port === new URL(SPOTIFY_REDIRECT_URI).port
    ) {
      window.location.href = `${redirectOrigin}${window.location.pathname}?spotify_autostart=1`;
      return;
    }
  } catch (_) {
    // Ignore URL parse issues
  }

  const verifier = generateRandomVerifier(64);
  localStorage.setItem(STORAGE_KEYS.VERIFIER, verifier);

  const data = new TextEncoder().encode(verifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  const challenge = base64UrlEncode(digest);

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('client_id', SPOTIFY_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', SPOTIFY_REDIRECT_URI);
  authUrl.searchParams.set('scope', SPOTIFY_SCOPES);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('code_challenge', challenge);

  window.location.href = authUrl.toString();
}

function saveSpotifyTokens(tokenData) {
  spotify.accessToken = tokenData.access_token;
  if (tokenData.refresh_token) {
    spotify.refreshToken = tokenData.refresh_token;
    localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, spotify.refreshToken);
  }
  spotify.expiresAt = Date.now() + (tokenData.expires_in || 3600) * 1000;
  localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, spotify.accessToken);
  localStorage.setItem(STORAGE_KEYS.EXPIRES_AT, String(spotify.expiresAt));
  spotify.connected = true;
  updateSpotifyButtonVisibility();
}

function setAlbumBackdropActive(active) {
  gsapApi.to(backdropState, {
    albumVisibility: active && spotify.hasAlbumBackdrop ? 1 : 0,
    cardAlpha: active && spotify.hasAlbumBackdrop ? 1 : 0,
    cardScale: active ? 1 : 0.94,
    duration: 1.4,
    ease: 'power2.inOut',
  });
}

function clearSpotifySession() {
  spotify.accessToken = null;
  spotify.refreshToken = null;
  spotify.expiresAt = 0;
  spotify.connected = false;
  spotify.isPlaying = false;
  spotify.currentTrackId = null;
  spotify.trackName = '';
  spotify.artistName = '';
  spotify.albumName = '';
  spotify.albumArtUrl = '';
  spotify.albumImg = null;
  spotify.hasAlbumBackdrop = false;
  themePalette.lockedToAlbum = false;

  setAlbumBackdropActive(false);

  localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.EXPIRES_AT);
  localStorage.removeItem(STORAGE_KEYS.VERIFIER);
  updateSpotifyButtonVisibility();
}

function updateSpotifyButtonVisibility() {
  if (!spotifyBtn) return;
  if (spotify.connected) {
    spotifyBtn.classList.add('hidden');
  } else {
    spotifyBtn.classList.remove('hidden');
  }
}

async function handleSpotifyRedirectCallback() {
  const params = new URLSearchParams(window.location.search);

  if (params.get('spotify_autostart') === '1') {
    window.history.replaceState({}, document.title, window.location.pathname);
    await startSpotifyPkceAuth();
    return;
  }

  const code = params.get('code');
  const error = params.get('error');

  if (error) {
    window.history.replaceState({}, document.title, window.location.pathname);
    statusMessage = `SPOTIFY AUTH // ${error.toUpperCase()}`;
    return;
  }

  if (!code) {
    if (!IS_SPOTIFY_CONFIGURED) {
      if (spotifyBtn) spotifyBtn.classList.add('hidden');
      return;
    }
    if (spotify.accessToken) {
      spotify.connected = true;
      updateSpotifyButtonVisibility();
      pollSpotifyCurrentlyPlaying(true);
    }
    return;
  }

  if (!IS_SPOTIFY_CONFIGURED) {
    window.history.replaceState({}, document.title, window.location.pathname);
    return;
  }

  window.history.replaceState({}, document.title, window.location.pathname);

  const verifier = localStorage.getItem(STORAGE_KEYS.VERIFIER);
  if (!verifier) {
    statusMessage = 'SPOTIFY // MISSING PKCE VERIFIER (RETRY CONNECT)';
    return;
  }

  try {
    statusMessage = 'SPOTIFY // EXCHANGING PKCE TOKEN...';
    const body = new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
      code_verifier: verifier,
    });

    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) throw new Error(`TOKEN_${res.status}`);

    const tokenData = await res.json();
    localStorage.removeItem(STORAGE_KEYS.VERIFIER);
    saveSpotifyTokens(tokenData);
    statusMessage = isAudioActive
      ? 'LIVE // SPOTIFY + SYSTEM AUDIO SYNCED'
      : 'SPOTIFY LINKED // CONNECT SYSTEM AUDIO';
    await pollSpotifyCurrentlyPlaying(true);
  } catch (_) {
    clearSpotifySession();
    statusMessage = 'SPOTIFY // AUTH EXCHANGE FAILED';
  }
}

async function refreshSpotifyAccessToken() {
  if (!spotify.refreshToken) {
    clearSpotifySession();
    return false;
  }

  try {
    const body = new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: spotify.refreshToken,
    });

    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      clearSpotifySession();
      return false;
    }

    const tokenData = await res.json();
    saveSpotifyTokens(tokenData);
    return true;
  } catch (_) {
    return false;
  }
}

async function pollSpotifyCurrentlyPlaying(forceImmediate = false) {
  if (!spotify.connected || !spotify.accessToken || spotify.pollInFlight) return;

  const now = performance.now();
  if (!forceImmediate && now - spotify.lastPollTime < CONFIG.SPOTIFY_POLL_MS) return;

  spotify.pollInFlight = true;
  spotify.lastPollTime = now;

  try {
    if (Date.now() > spotify.expiresAt - 60000 && spotify.refreshToken) {
      await refreshSpotifyAccessToken();
    }

    let res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${spotify.accessToken}` },
    });

    if (res.status === 401) {
      const refreshed = await refreshSpotifyAccessToken();
      if (refreshed && spotify.accessToken) {
        res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
          headers: { Authorization: `Bearer ${spotify.accessToken}` },
        });
      } else {
        clearSpotifySession();
        return;
      }
    }

    if (res.status === 204) {
      if (spotify.isPlaying) {
        spotify.isPlaying = false;
        setAlbumBackdropActive(false); // Crossfade smoothly to Procedural Aurora Field
      }
      return;
    }

    if (!res.ok) return;

    const payload = await res.json();
    if (!payload || !payload.item) {
      if (spotify.isPlaying) {
        spotify.isPlaying = false;
        setAlbumBackdropActive(false);
      }
      return;
    }

    const nowPlaying = Boolean(payload.is_playing);
    if (nowPlaying !== spotify.isPlaying) {
      spotify.isPlaying = nowPlaying;
      setAlbumBackdropActive(nowPlaying);
    }

    const item = payload.item;
    const newTrackId = item.id || `${item.name}-${item.duration_ms}`;

    // STRICT 1-SONG-1-VIBE LOCK: Only trigger on brand-new track ID
    if (newTrackId !== spotify.currentTrackId) {
      spotify.currentTrackId = newTrackId;
      spotify.trackName = (item.name || 'UNKNOWN TRACK').toUpperCase();
      spotify.artistName = Array.isArray(item.artists)
        ? item.artists.map((a) => a.name).join(', ').toUpperCase()
        : 'UNKNOWN ARTIST';
      spotify.albumName = item.album && item.album.name ? item.album.name.toUpperCase() : '';

      const images = item.album && Array.isArray(item.album.images) ? item.album.images : [];
      const newArtUrl = images.length > 0 ? images[0].url : '';
      spotify.albumArtUrl = newArtUrl;

      await onNewTrackStarted(newArtUrl);
    }
  } catch (_) {
    // Keep current visual state seamlessly on transient network hiccups
  } finally {
    spotify.pollInFlight = false;
  }
}

async function onNewTrackStarted(albumArtUrl) {
  const trackIdAtStart = spotify.currentTrackId;

  // Pop-in animation on sharp glass album card
  backdropState.cardScale = 0.92;
  await loadAlbumArtAndExtractPalette(albumArtUrl);
  if (spotify.currentTrackId !== trackIdAtStart) return;

  // Reset rolling audio stats so previous song never biases the new song's vibe
  dsp.rollingBpm = 0;
  dsp.onsetDensity = 0;
  dsp.rollingSub = dsp.subBass;
  dsp.rollingMid = dsp.mid;
  dsp.rollingTreble = dsp.treble;

  if (isAudioActive) {
    spotify.pendingTrackLock = true;
    spotify.trackChangeTime = performance.now() + 3400;
  } else {
    spotify.pendingTrackLock = false;
    const eff = getEffectiveVibe();
    applyVibeVisualBlend(eff);
    cycleEditorialPhrase(eff, true);
  }
}

// ============================================================================
// 3. VIBE BLENDING, GSAP EDITORIAL TYPOGRAPHY & COMPOSED BEAT REACTIONS
// ============================================================================

function getEffectiveVibe() {
  const forced = MODES[activeModeIndex].forcedVibe;
  return forced || dsp.vibe;
}

function applyVibeVisualBlend(vibe) {
  gsapApi.to(backdropState, {
    vibeBlendSLOW: vibe === 'SLOW' ? 1 : 0,
    vibeBlendEDM: vibe === 'EDM' ? 1 : 0,
    vibeBlendAMBIENT: vibe === 'AMBIENT' ? 1 : 0,
    duration: 1.6,
    ease: 'power2.inOut',
  });

  gsapApi.fromTo(
    posterState,
    { vibeBadgeGlow: 1 },
    { vibeBadgeGlow: 0, duration: 1.1, ease: 'power2.out' }
  );
}

function cycleEditorialPhrase(vibe, forceRandom = false) {
  const bank = EDITORIAL_PHRASES[vibe] || EDITORIAL_PHRASES.AMBIENT;
  posterState.phraseIdx = forceRandom
    ? Math.floor(Math.random() * bank.length)
    : (posterState.phraseIdx + 1) % bank.length;

  const next = bank[posterState.phraseIdx];
  posterState.prevLines = posterState.lines;
  posterState.kicker = next.kicker;
  posterState.lines = next.lines;

  gsapApi.killTweensOf(posterState);

  if (vibe === 'EDM') {
    gsapApi.fromTo(
      posterState,
      {
        line1X: -36,
        line1Y: 0,
        line1Alpha: 0,
        line2X: 42,
        line2Y: 0,
        line2Alpha: 0,
        prevAlpha: 0.5,
        prevShiftY: 0,
        scalePunch: 1.1,
        skewX: -0.09,
        ruleProgress: 0,
      },
      {
        line1X: 0,
        line1Y: 0,
        line1Alpha: 1,
        line2X: 0,
        line2Y: 0,
        line2Alpha: 1,
        prevAlpha: 0,
        prevShiftY: -24,
        scalePunch: 1,
        skewX: 0,
        ruleProgress: 1,
        duration: 0.85,
        ease: 'elastic.out(1.1, 0.42)',
      }
    );
  } else {
    gsapApi.fromTo(
      posterState,
      {
        line1X: 0,
        line1Y: 20,
        line1Alpha: 0,
        line2X: 0,
        line2Y: 30,
        line2Alpha: 0,
        prevAlpha: 0.6,
        prevShiftY: 0,
        scalePunch: 0.985,
        skewX: 0,
        ruleProgress: 0.15,
      },
      {
        line1X: 0,
        line1Y: 0,
        line1Alpha: 1,
        line2X: 0,
        line2Y: 0,
        line2Alpha: 1,
        prevAlpha: 0,
        prevShiftY: -20,
        scalePunch: 1,
        skewX: 0,
        ruleProgress: 1,
        duration: 1.55,
        ease: 'sine.inOut',
      }
    );
  }
}

/**
 * Dialed-in, composed beat reactions (smooth physical weight without nervous twitching).
 */
function triggerKickReaction(strength) {
  const vibe = getEffectiveVibe();
  const dir = Math.random() > 0.5 ? 1 : -1;
  const shakeAmp = vibe === 'EDM' ? 5.2 : 2.0;

  gsapApi.fromTo(
    fxState,
    {
      driverRecoil: strength * 0.78,
      driverGlow: Math.min(0.9, strength * 0.9),
      shakeX: (Math.random() - 0.5) * 2 * shakeAmp * strength,
      shakeY: (Math.random() - 0.5) * 2 * shakeAmp * strength,
      chromaSplit: strength * (vibe === 'EDM' ? 4.5 : 1.8),
    },
    {
      driverRecoil: 0,
      driverGlow: 0,
      shakeX: 0,
      shakeY: 0,
      chromaSplit: 0,
      duration: vibe === 'EDM' ? 0.58 : 0.85,
      ease: 'elastic.out(1.1, 0.44)',
      overwrite: 'auto',
    }
  );

  for (let i = 0; i < shockwaves.length; i++) {
    const sw = shockwaves[i];
    if (!sw.active) {
      gsapApi.killTweensOf(sw);
      sw.active = true;
      const dur = vibe === 'EDM' ? 0.95 : 1.35;
      gsapApi.fromTo(
        sw,
        { z: 1.0, radiusMult: 0.46 },
        {
          z: 0.14,
          radiusMult: 1.32,
          duration: dur,
          ease: 'expo.out',
          onComplete: () => { sw.active = false; },
        }
      );
      gsapApi.fromTo(
        sw,
        { alpha: Math.min(0.4, 0.14 + strength * 0.28) },
        { alpha: 0, duration: dur, ease: 'power2.out' }
      );
      break;
    }
  }

  if (vibe === 'EDM') {
    fxState.glitchSeed = Math.random() * 1000;
    gsapApi.fromTo(
      fxState,
      {
        cubeScale: 1 + strength * 0.18,
        edmFlash: Math.min(0.28, strength * 0.24),
        glitchIntensity: strength > 0.62 ? strength * 0.75 : 0,
      },
      {
        cubeScale: 1,
        edmFlash: 0,
        glitchIntensity: 0,
        duration: 0.52,
        ease: 'expo.out',
        overwrite: 'auto',
      }
    );

    gsapApi.fromTo(
      posterState,
      { scalePunch: 1 + strength * 0.08, skewX: dir * strength * 0.05 },
      {
        scalePunch: 1,
        skewX: 0,
        duration: 0.58,
        ease: 'elastic.out(1.12, 0.4)',
        overwrite: 'auto',
      }
    );
  } else if (strength > 0.6) {
    gsapApi.fromTo(
      posterState,
      { scalePunch: 1 + strength * 0.025 },
      { scalePunch: 1, duration: 0.9, ease: 'sine.inOut', overwrite: 'auto' }
    );
  }
}

// ============================================================================
// 4. SYSTEM AUDIO CAPTURE & REFINED, TAMED SENSITIVITY DSP
// ============================================================================

function calculateFrequencyBins(sampleRate, fftSize) {
  const nyquist = sampleRate / 2;
  const binCount = fftSize / 2;
  const hzPerBin = nyquist / binCount;

  bandBins.subBass = {
    start: Math.max(1, Math.floor(20 / hzPerBin)),
    end: Math.max(2, Math.ceil(95 / hzPerBin)),
  };
  bandBins.bass = {
    start: Math.max(2, Math.floor(95 / hzPerBin)),
    end: Math.ceil(260 / hzPerBin),
  };
  bandBins.mid = {
    start: Math.floor(260 / hzPerBin),
    end: Math.ceil(2200 / hzPerBin),
  };
  bandBins.highMid = {
    start: Math.floor(2200 / hzPerBin),
    end: Math.ceil(4500 / hzPerBin),
  };
  bandBins.treble = {
    start: Math.floor(4500 / hzPerBin),
    end: Math.min(binCount - 1, Math.ceil(13000 / hzPerBin)),
  };
}

async function initSystemAudio() {
  try {
    statusMessage = 'REQUESTING SYSTEM AUDIO...';

    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });

    const videoTracks = displayStream.getVideoTracks();
    for (let i = 0; i < videoTracks.length; i++) {
      videoTracks[i].enabled = false;
      videoTracks[i].stop();
      displayStream.removeTrack(videoTracks[i]);
    }

    const audioTracks = displayStream.getAudioTracks();
    if (audioTracks.length === 0) {
      throw new Error('NO_SYSTEM_AUDIO_TRACK');
    }

    if (audioCtx) {
      await audioCtx.close();
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();

    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = CONFIG.FFT_SIZE;
    analyser.smoothingTimeConstant = CONFIG.SMOOTHING;
    analyser.minDecibels = CONFIG.MIN_DECIBELS;
    analyser.maxDecibels = CONFIG.MAX_DECIBELS;

    const audioOnlyStream = new MediaStream([audioTracks[0]]);
    sourceNode = audioCtx.createMediaStreamSource(audioOnlyStream);
    sourceNode.connect(analyser);

    freqData = new Uint8Array(analyser.frequencyBinCount);
    timeData = new Uint8Array(analyser.fftSize);

    calculateFrequencyBins(audioCtx.sampleRate, analyser.fftSize);

    isAudioActive = true;
    dsp.awaitingFallbackSongLock = !spotify.connected;
    dsp.fallbackAnalyzeReadyAt = performance.now() + 3400;
    if (spotify.connected && spotify.currentTrackId) {
      spotify.pendingTrackLock = true;
      spotify.trackChangeTime = performance.now() + 3400;
    }

    statusMessage = spotify.connected
      ? 'LIVE // SPOTIFY + SYSTEM AUDIO SYNCED'
      : 'LIVE // SONICGLASS AUDIO LOCKED';
    startBtn.classList.add('hidden');

    audioTracks[0].addEventListener('ended', handleStreamEnded);
  } catch (err) {
    isAudioActive = false;
    if (err.message === 'NO_SYSTEM_AUDIO_TRACK') {
      statusMessage = 'ENABLE "SHARE SYSTEM/TAB AUDIO" IN PROMPT';
      startBtn.textContent = 'Retry (Enable Share Audio)';
    } else if (err.name === 'NotAllowedError') {
      statusMessage = 'STANDBY // AUDIO PERMISSION DISMISSED';
      startBtn.textContent = 'Connect System Audio';
    } else {
      statusMessage = `ERR // ${err.name || 'STREAM FAILED'}`;
      startBtn.textContent = 'Connect System Audio';
    }
    startBtn.classList.remove('hidden');
  }
}

function handleStreamEnded() {
  isAudioActive = false;
  statusMessage = 'STREAM ENDED // AWAITING RECONNECT';
  startBtn.textContent = 'Connect System Audio';
  startBtn.classList.remove('hidden');
}

function getBandEnergy(data, startBin, endBin) {
  let sum = 0;
  const count = Math.max(1, endBin - startBin + 1);
  for (let i = startBin; i <= endBin; i++) {
    sum += data[i];
  }
  return sum / (count * 255);
}

/**
 * Slightly expander-shaped curve (`pow(..., 1.08)`) so quiet passages remain calm
 * while real musical peaks bloom naturally without over-triggering.
 */
function shapeBand(raw, gain) {
  return Math.min(1, Math.pow(Math.min(1, raw * gain), 1.08));
}

function hzToMusicalNote(hz) {
  if (hz < 25) return '--';
  const midi = Math.round(12 * Math.log2(hz / 440) + 69);
  if (midi < 12 || midi > 119) return '--';
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function classifyCurrentAudioSnapshot() {
  if (!isAudioActive || dsp.rollingRms < 0.008) {
    return dsp.vibe || 'AMBIENT';
  }

  const bpm = dsp.rollingBpm;
  const sub = dsp.rollingSub;
  const trb = dsp.rollingTreble;
  const density = dsp.onsetDensity;

  if (
    (bpm >= 118 && (sub > 0.28 || density > 1.35)) ||
    (sub > 0.4 && density > 1.25) ||
    density > 2.0
  ) {
    return 'EDM';
  }

  if (((bpm > 40 && bpm < 105) || density < 1.05) && sub < 0.38 && trb < 0.32) {
    return 'SLOW';
  }

  return 'AMBIENT';
}

function updateAudioAndLifecycle(now) {
  if (spotify.connected) {
    pollSpotifyCurrentlyPlaying(false);
  }

  if (isAudioActive && analyser) {
    analyser.getByteFrequencyData(freqData);
    analyser.getByteTimeDomainData(timeData);

    const rawSub = getBandEnergy(freqData, bandBins.subBass.start, bandBins.subBass.end);
    const rawBass = getBandEnergy(freqData, bandBins.bass.start, bandBins.bass.end);
    const rawMid = getBandEnergy(freqData, bandBins.mid.start, bandBins.mid.end);
    const rawHighMid = getBandEnergy(freqData, bandBins.highMid.start, bandBins.highMid.end);
    const rawTreble = getBandEnergy(freqData, bandBins.treble.start, bandBins.treble.end);

    let sumSq = 0;
    for (let i = 0; i < timeData.length; i += 2) {
      const sample = (timeData[i] - 128) / 128;
      sumSq += sample * sample;
    }
    const rawRms = Math.sqrt(sumSq / (timeData.length * 0.5));
    dsp.rawRms = rawRms;
    dsp.db = Math.max(-60, 20 * Math.log10(Math.max(0.001, rawRms)));

    // Gentle, composed Auto-Gain Control (capped at 2.1x with higher 0.22 noise floor)
    const rawPeak = Math.max(rawSub, rawBass, rawMid, rawTreble, rawRms * 2.0);
    if (rawPeak > dsp.peakTracker) {
      dsp.peakTracker += (rawPeak - dsp.peakTracker) * 0.16;
    } else {
      dsp.peakTracker = Math.max(0.22, dsp.peakTracker * 0.9975);
    }
    dsp.agcGain = Math.min(2.1, Math.max(0.85, 0.58 / dsp.peakTracker)) * userSensitivity;

    dsp.prevSub = dsp.subBass;
    dsp.prevHigh = dsp.highMid * 0.5 + dsp.treble * 0.5;

    dsp.subBass = shapeBand(rawSub, dsp.agcGain);
    dsp.bass = shapeBand(rawBass, dsp.agcGain);
    dsp.mid = shapeBand(rawMid, dsp.agcGain);
    dsp.highMid = shapeBand(rawHighMid, dsp.agcGain);
    dsp.treble = shapeBand(rawTreble, dsp.agcGain);
    dsp.rms = Math.min(1, rawRms * dsp.agcGain * 1.45);

    // Smooth, weighted envelopes (no jitter)
    dsp.smoothSub += (dsp.subBass - dsp.smoothSub) * (dsp.subBass > dsp.smoothSub ? 0.3 : 0.09);
    dsp.smoothMid += (dsp.mid - dsp.smoothMid) * (dsp.mid > dsp.smoothMid ? 0.26 : 0.09);
    dsp.smoothTreble +=
      (dsp.treble - dsp.smoothTreble) * (dsp.treble > dsp.smoothTreble ? 0.28 : 0.1);
    dsp.smoothRms += (dsp.rms - dsp.smoothRms) * 0.2;

    dsp.rollingSub = dsp.rollingSub * 0.986 + dsp.subBass * 0.014;
    dsp.rollingMid = dsp.rollingMid * 0.986 + dsp.mid * 0.014;
    dsp.rollingTreble = dsp.rollingTreble * 0.986 + dsp.treble * 0.014;
    dsp.rollingRms = dsp.rollingRms * 0.986 + rawRms * 0.014;
    dsp.onsetDensity *= 0.986;

    // Selective Kick Onset Detector (higher threshold & 195ms gate so only real beats trigger)
    const lowEnergy = dsp.subBass * 0.72 + dsp.bass * 0.28;
    dsp.subAvg = dsp.subAvg * 0.92 + lowEnergy * 0.08;
    const kickFlux = lowEnergy - dsp.subAvg + Math.max(0, dsp.subBass - dsp.prevSub) * 0.5;

    if (kickFlux > 0.092 && lowEnergy > 0.21 && now - dsp.lastKickTime > 195) {
      const dt = now - dsp.lastKickTime;
      dsp.lastKickTime = now;
      const strength = Math.min(1, 0.4 + kickFlux * 2.1);
      dsp.kickPulse = strength;
      dsp.beatPulse = Math.max(dsp.beatPulse, strength);
      dsp.onsetDensity = Math.min(4.0, dsp.onsetDensity + 0.45);

      if (dt > 260 && dt < 1650) {
        let instantBpm = 60000 / dt;
        if (instantBpm < 70) instantBpm *= 2;
        if (instantBpm > 175) instantBpm *= 0.5;
        dsp.rollingBpm =
          dsp.rollingBpm === 0 ? instantBpm : dsp.rollingBpm * 0.85 + instantBpm * 0.15;
      }

      triggerKickReaction(strength);
    }

    // Selective Snare / Accent Detector
    const highEnergy = dsp.highMid * 0.5 + dsp.treble * 0.5;
    dsp.highAvg = dsp.highAvg * 0.92 + highEnergy * 0.08;
    const snareFlux = highEnergy - dsp.highAvg + Math.max(0, highEnergy - dsp.prevHigh) * 0.5;
    if (snareFlux > 0.088 && highEnergy > 0.19 && now - dsp.lastSnareTime > 170) {
      dsp.lastSnareTime = now;
      dsp.snarePulse = Math.min(1, 0.35 + snareFlux * 2.0);
    }

    // Dominant Pitch Tracking
    const hzPerBin = audioCtx.sampleRate / CONFIG.FFT_SIZE;
    const minBin = Math.max(2, Math.floor(40 / hzPerBin));
    const maxBin = Math.min(freqData.length - 1, Math.ceil(2400 / hzPerBin));
    let peakVal = 0;
    let peakBin = minBin;
    for (let b = minBin; b <= maxBin; b++) {
      if (freqData[b] > peakVal) {
        peakVal = freqData[b];
        peakBin = b;
      }
    }
    if (peakVal > 34) {
      const targetHz = peakBin * hzPerBin;
      dsp.dominantHz = dsp.dominantHz === 0 ? targetHz : dsp.dominantHz * 0.76 + targetHz * 0.24;
      dsp.dominantNote = hzToMusicalNote(dsp.dominantHz);
    } else {
      dsp.dominantHz *= 0.95;
      if (dsp.dominantHz < 25) dsp.dominantNote = '--';
    }

    // 1-Song-1-Vibe confirmation after sampling 3.4s of a new Spotify track
    if (spotify.connected && spotify.pendingTrackLock && now >= spotify.trackChangeTime) {
      spotify.pendingTrackLock = false;
      dsp.vibe = classifyCurrentAudioSnapshot();
      const eff = getEffectiveVibe();
      applyVibeVisualBlend(eff);
      cycleEditorialPhrase(eff, true);
    }

    // Fallback Silence-Boundary Song Detector (only when Spotify is disconnected)
    if (!spotify.connected) {
      if (rawRms < 0.006) {
        if (dsp.silenceStart === 0) dsp.silenceStart = now;
        else if (now - dsp.silenceStart >= CONFIG.SILENCE_GAP_MS) {
          dsp.awaitingFallbackSongLock = true;
        }
      } else {
        if (dsp.silenceStart !== 0 && dsp.awaitingFallbackSongLock) {
          dsp.fallbackAnalyzeReadyAt = now + 3400;
        }
        dsp.silenceStart = 0;

        if (dsp.awaitingFallbackSongLock && now >= dsp.fallbackAnalyzeReadyAt) {
          dsp.awaitingFallbackSongLock = false;
          dsp.vibe = classifyCurrentAudioSnapshot();
          const eff = getEffectiveVibe();
          applyVibeVisualBlend(eff);
          cycleEditorialPhrase(eff, true);
        }
      }
    }
  } else {
    const breath = 0.5 + 0.5 * Math.sin(now * 0.0012);
    dsp.smoothSub = 0.04 + breath * 0.035;
    dsp.smoothMid = 0.035 + 0.02 * Math.sin(now * 0.0018);
    dsp.smoothTreble = 0.025;
    dsp.smoothRms = 0.02 + breath * 0.012;
    dsp.db = -60;
  }

  dsp.kickPulse *= 0.86;
  dsp.snarePulse *= 0.84;
  dsp.beatPulse *= 0.86;

  updateSpectralFallbackPalette(now);
  backdropState.kenBurnsPhase += 0.00036 + dsp.smoothRms * 0.0011;
}

function updateParallaxState(now) {
  let tx = targetMouseX;
  let ty = targetMouseY;
  if (!pointerInside && now - lastPointerMove > 2500) {
    tx = Math.sin(now * 0.00046) * 0.18;
    ty = Math.cos(now * 0.00035) * 0.14;
  }
  mouseX += (tx - mouseX) * 0.075;
  mouseY += (ty - mouseY) * 0.075;
}

// ============================================================================
// 5. PRE-COMPUTATION & SONICGLASS A1 HARDWARE ENCLOSURE
// ============================================================================

function buildHalftonePattern() {
  halftoneCanvas.width = 8;
  halftoneCanvas.height = 8;
  halftoneCtx.clearRect(0, 0, 8, 8);
  halftoneCtx.fillStyle = 'rgba(5, 5, 8, 0.52)';
  halftoneCtx.fillRect(0, 0, 3, 3);
  halftoneCtx.fillRect(4, 4, 2, 2);
  halftoneCtx.fillStyle = `rgba(${themePalette.primaryRgb}, 0.22)`;
  halftoneCtx.fillRect(4, 0, 1.5, 1.5);
  halftonePattern = ctx.createPattern(halftoneCanvas, 'repeat');
}

function buildPrecomputedAssets() {
  currAlbumBackdropCanvas.width = CONFIG.SCENE_W;
  currAlbumBackdropCanvas.height = CONFIG.SCENE_H;
  prevAlbumBackdropCanvas.width = CONFIG.SCENE_W;
  prevAlbumBackdropCanvas.height = CONFIG.SCENE_H;

  const usableBins = Math.floor((CONFIG.FFT_SIZE / 2) * 0.52);
  for (let i = 0; i < CONFIG.EQ_BAR_COUNT; i++) {
    const ratio = i / (CONFIG.EQ_BAR_COUNT - 1);
    eqBinIndices[i] = Math.min(
      usableBins - 1,
      Math.floor(Math.pow(ratio, 1.65) * usableBins) + 1
    );
  }

  buildHalftonePattern();

  noiseCanvas.width = CONFIG.NOISE_SIZE;
  noiseCanvas.height = CONFIG.NOISE_SIZE;
  const imgData = noiseCtx.createImageData(CONFIG.NOISE_SIZE, CONFIG.NOISE_SIZE);
  const buf = imgData.data;
  for (let i = 0; i < buf.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    buf[i] = 240;
    buf[i + 1] = 225;
    buf[i + 2] = 215;
    buf[i + 3] = v > 215 ? 11 : 3;
  }
  noiseCtx.putImageData(imgData, 0, 0);
  noisePattern = ctx.createPattern(noiseCanvas, 'repeat');
}

function roundedRectPath(context, x, y, w, h, r) {
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

function computePanelGeometry() {
  if (showGlassFrame && viewportWidth > 560 && viewportHeight > 380) {
    const maxW = viewportWidth * 0.86;
    const maxH = viewportHeight * 0.78;
    const targetAspect = 16 / 9;

    let w = maxW;
    let h = w / targetAspect;
    if (h > maxH) {
      h = maxH;
      w = h * targetAspect;
    }

    panel.w = Math.floor(w);
    panel.h = Math.floor(h);
    panel.x = Math.floor((viewportWidth - panel.w) * 0.5);
    panel.y = Math.floor((viewportHeight - panel.h) * 0.47);
    panel.radius = Math.max(12, Math.min(22, panel.w * 0.018));
  } else {
    panel.x = 0;
    panel.y = 0;
    panel.w = viewportWidth;
    panel.h = viewportHeight;
    panel.radius = 0;
  }

  panel.cx = panel.x + panel.w * 0.5;
  panel.cy = panel.y + panel.h * 0.5;
  panel.driverRadius = Math.min(panel.w * 0.155, panel.h * 0.27);
  panel.leftDriverX = panel.cx - panel.w * 0.22;
  panel.rightDriverX = panel.cx + panel.w * 0.22;
  panel.driverY = panel.cy + panel.h * 0.02;
}

function buildGlassEnclosureCache() {
  glassCanvas.width = canvas.width;
  glassCanvas.height = canvas.height;

  glassCtx.save();
  glassCtx.scale(dpr, dpr);
  glassCtx.clearRect(0, 0, viewportWidth, viewportHeight);

  const { x, y, w, h, radius } = panel;

  glassCtx.save();
  if (showGlassFrame && radius > 0) {
    roundedRectPath(glassCtx, x, y, w, h, radius);
    glassCtx.clip();
  }

  const sheen = glassCtx.createLinearGradient(x, y, x + w * 0.72, y + h);
  sheen.addColorStop(0, 'rgba(255, 245, 238, 0.055)');
  sheen.addColorStop(0.26, `rgba(${themePalette.primaryRgb}, 0.02)`);
  sheen.addColorStop(0.52, 'rgba(0, 0, 0, 0)');
  sheen.addColorStop(1, `rgba(${themePalette.secondaryRgb}, 0.03)`);
  glassCtx.fillStyle = sheen;
  glassCtx.fillRect(x, y, w, h);
  glassCtx.restore();

  if (showGlassFrame && radius > 0) {
    const baseW = w * 0.64;
    const baseH = Math.max(16, Math.min(26, h * 0.042));
    const baseX = panel.cx - baseW * 0.5;
    const baseY = y + h + 2;

    const baseGrad = glassCtx.createLinearGradient(baseX, baseY, baseX + baseW, baseY);
    baseGrad.addColorStop(0, 'rgba(18, 17, 20, 0.94)');
    baseGrad.addColorStop(0.5, 'rgba(38, 34, 38, 0.98)');
    baseGrad.addColorStop(1, 'rgba(16, 15, 18, 0.94)');

    roundedRectPath(glassCtx, baseX, baseY, baseW, baseH, 5);
    glassCtx.fillStyle = baseGrad;
    glassCtx.fill();
    glassCtx.lineWidth = 1;
    glassCtx.strokeStyle = `rgba(${themePalette.primaryRgb}, 0.28)`;
    glassCtx.stroke();

    roundedRectPath(glassCtx, x, y, w, h, radius);
    glassCtx.lineWidth = 2;
    glassCtx.strokeStyle = 'rgba(255, 242, 234, 0.16)';
    glassCtx.stroke();

    roundedRectPath(glassCtx, x + 2.5, y + 2.5, w - 5, h - 5, Math.max(4, radius - 2.5));
    glassCtx.lineWidth = 1;
    glassCtx.strokeStyle = `rgba(${themePalette.primaryRgb}, 0.32)`;
    glassCtx.stroke();

    const inset = 22;
    const bolts = [
      [x + inset, y + inset],
      [x + w - inset, y + inset],
      [x + inset, y + h - inset],
      [x + w - inset, y + h - inset],
    ];
    for (let i = 0; i < bolts.length; i++) {
      const [bx, by] = bolts[i];
      glassCtx.beginPath();
      glassCtx.arc(bx, by, 5.5, 0, Math.PI * 2);
      glassCtx.fillStyle = 'rgba(14, 13, 16, 0.88)';
      glassCtx.fill();
      glassCtx.lineWidth = 1;
      glassCtx.strokeStyle = `rgba(${themePalette.secondaryRgb}, 0.4)`;
      glassCtx.stroke();

      glassCtx.beginPath();
      glassCtx.arc(bx, by, 1.6, 0, Math.PI * 2);
      glassCtx.fillStyle = `rgba(${themePalette.primaryRgb}, 0.68)`;
      glassCtx.fill();
    }
  }

  glassCtx.restore();
}

function handleResize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewportWidth = window.innerWidth;
  viewportHeight = window.innerHeight;

  canvas.width = Math.floor(viewportWidth * dpr);
  canvas.height = Math.floor(viewportHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = CONFIG.BG_HEX;
  ctx.fillRect(0, 0, viewportWidth, viewportHeight);

  computePanelGeometry();
  buildGlassEnclosureCache();
}

// ============================================================================
// 6. ZERO-RATE-LIMIT HYBRID BACKDROP (PROCEDURAL AURORA + BLURRED ALBUM ART)
// ============================================================================

/**
 * Fallback Multi-Layered Procedural Mesh Gradient / Aurora Field:
 * Active whenever Spotify is paused/disconnected (or crossfading into album art).
 */
function drawProceduralAuroraBackdrop(now, alpha) {
  if (alpha <= 0.005) return;

  const bgShiftX = mouseX * CONFIG.PARALLAX_BG;
  const bgShiftY = mouseY * CONFIG.PARALLAX_BG;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Deep obsidian-charcoal architectural base gradient
  const base = ctx.createLinearGradient(panel.x, panel.y, panel.x + panel.w, panel.y + panel.h);
  base.addColorStop(0, '#050508');
  base.addColorStop(0.55, '#0b0a10');
  base.addColorStop(1, '#120c0c');
  ctx.fillStyle = base;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);

  // 5 Volumetric Lissajous Mesh / Aurora Orbs driven by `themePalette` & `dsp` bands
  ctx.globalCompositeOperation = 'screen';
  const minDim = Math.min(panel.w, panel.h);

  for (let i = 0; i < auroraNodes.length; i++) {
    const node = auroraNodes[i];
    const speedBoost = 1 + dsp.smoothRms * 0.6;
    const nx =
      node.cx +
      Math.sin(now * node.freqX * speedBoost + node.phaseX) * 0.24 +
      Math.cos(now * node.freqY * 0.7 + i) * 0.08;
    const ny =
      node.cy +
      Math.cos(now * node.freqY * speedBoost + node.phaseY) * 0.22 +
      Math.sin(now * node.freqX * 0.8 + i) * 0.07;

    const ox = panel.x + nx * panel.w + bgShiftX * (0.6 + i * 0.15);
    const oy = panel.y + ny * panel.h + bgShiftY * (0.6 + i * 0.15);

    const bandMod =
      node.colorRole === 0
        ? dsp.smoothSub * 0.32
        : node.colorRole === 1
          ? dsp.smoothMid * 0.28
          : dsp.smoothTreble * 0.28;
    const radius = minDim * (node.radiusRatio + bandMod);

    const rgb =
      node.colorRole === 0
        ? themePalette.primaryRgb
        : node.colorRole === 1
          ? themePalette.secondaryRgb
          : themePalette.peakRgb;
    const coreAlpha =
      (node.colorRole === 2 ? 0.11 : 0.2) +
      dsp.smoothSub * 0.08 +
      dsp.smoothMid * 0.06;

    const grad = ctx.createRadialGradient(ox, oy, 8, ox, oy, radius);
    grad.addColorStop(0, `rgba(${rgb}, ${Math.min(0.42, coreAlpha).toFixed(3)})`);
    grad.addColorStop(0.48, `rgba(${rgb}, ${(coreAlpha * 0.42).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ox, oy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Subtle architectural frosted-glass diagonal shadow louvers over the aurora mesh
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(4, 4, 7, 0.3)';
  const slatSpan = panel.w * 0.16;
  const slatDrift = Math.sin(now * 0.00022) * 35 + bgShiftX * 0.5;
  for (let s = -2; s < 8; s++) {
    const sx = panel.x + s * slatSpan + slatDrift;
    ctx.beginPath();
    ctx.moveTo(sx, panel.y);
    ctx.lineTo(sx + slatSpan * 0.42, panel.y);
    ctx.lineTo(sx - slatSpan * 0.55, panel.y + panel.h);
    ctx.lineTo(sx - slatSpan * 0.97, panel.y + panel.h);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Primary Hybrid Backdrop Renderer:
 * Blends Procedural Aurora Fallback <-> Pre-Blurred Full-Bleed Spotify Album Art
 * with GSAP track crossfading & slow RMS-synchronized Ken Burns camera drift.
 */
function drawHybridBackdrop(now) {
  const albumVis = backdropState.albumVisibility;

  // Draw Procedural Aurora Field whenever album art isn't 100% opaque
  if (albumVis < 0.999 || !spotify.hasAlbumBackdrop) {
    drawProceduralAuroraBackdrop(now, 1);
  }

  // Overlay Blurred Spotify Album Art Backdrop when available
  if (albumVis > 0.005 && spotify.hasAlbumBackdrop) {
    const breathZoom =
      1.08 +
      (0.5 + 0.5 * Math.sin(backdropState.kenBurnsPhase)) * 0.075 +
      dsp.smoothSub * 0.024 +
      dsp.kickPulse * 0.018;

    const panX =
      Math.sin(backdropState.kenBurnsPhase * 0.68) *
        panel.w *
        0.028 *
        backdropState.kenBurnsDirX +
      mouseX * CONFIG.PARALLAX_BG +
      fxState.shakeX;
    const panY =
      Math.cos(backdropState.kenBurnsPhase * 0.54) *
        panel.h *
        0.024 *
        backdropState.kenBurnsDirY +
      mouseY * CONFIG.PARALLAX_BG +
      fxState.shakeY;

    const drawW = panel.w * breathZoom;
    const drawH = panel.h * breathZoom;
    const dx = panel.cx - drawW * 0.5 + panX;
    const dy = panel.cy - drawH * 0.5 + panY;

    ctx.save();
    if (backdropState.trackCrossfade < 0.999) {
      ctx.globalAlpha = albumVis;
      ctx.drawImage(prevAlbumBackdropCanvas, dx, dy, drawW, drawH);
      ctx.globalAlpha = albumVis * backdropState.trackCrossfade;
      ctx.drawImage(currAlbumBackdropCanvas, dx, dy, drawW, drawH);
    } else {
      ctx.globalAlpha = albumVis;
      ctx.drawImage(currAlbumBackdropCanvas, dx, dy, drawW, drawH);
    }

    if (fxState.chromaSplit > 0.8) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(0.18, fxState.chromaSplit * 0.025) * albumVis;
      ctx.drawImage(currAlbumBackdropCanvas, dx + fxState.chromaSplit, dy, drawW, drawH);
    }
    ctx.restore();
  }

  // Editorial readability gradient (keeps foreground typography razor-sharp over any cover)
  const vignette = ctx.createLinearGradient(panel.x, panel.y, panel.x, panel.y + panel.h);
  vignette.addColorStop(0, 'rgba(5, 5, 8, 0.34)');
  vignette.addColorStop(
    0.48,
    `rgba(${themePalette.primaryRgb}, ${(0.04 + dsp.smoothSub * 0.09).toFixed(3)})`
  );
  vignette.addColorStop(1, 'rgba(4, 4, 7, 0.76)');
  ctx.fillStyle = vignette;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
}

/**
 * Renders a sharp, framed glass album card in the right-center focal area during
 * `01 AUTO SCENE` mode (inspired by the SonicGlass A1 promo layout).
 */
function drawFramedGlassAlbumCard(modeAlpha) {
  if (
    MODES[activeModeIndex].id !== 'auto' ||
    backdropState.cardAlpha <= 0.01 ||
    !spotify.albumImg ||
    panel.w < 680
  ) {
    return;
  }

  const alpha = backdropState.cardAlpha * modeAlpha;
  if (alpha <= 0.01) return;

  const cardShiftX = mouseX * CONFIG.PARALLAX_CARD + fxState.shakeX * 0.25;
  const cardShiftY = mouseY * CONFIG.PARALLAX_CARD + fxState.shakeY * 0.25;

  const cardSize = Math.round(
    Math.min(panel.w * 0.215, panel.h * 0.38, 236) *
      backdropState.cardScale *
      (1 + dsp.smoothSub * 0.018)
  );
  const cx = panel.cx + panel.w * 0.22 + cardShiftX;
  const cy = panel.cy + panel.h * 0.02 + cardShiftY;
  const x = cx - cardSize * 0.5;
  const y = cy - cardSize * 0.5;
  const pad = 8;

  ctx.save();
  ctx.globalAlpha *= alpha;

  // Outer smoked-glass frame mat with deep physical drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 32;
  ctx.shadowOffsetX = -mouseX * 8;
  ctx.shadowOffsetY = 12 - mouseY * 6;
  roundedRectPath(ctx, x - pad, y - pad, cardSize + pad * 2, cardSize + pad * 2, 12);
  ctx.fillStyle = 'rgba(12, 11, 15, 0.62)';
  ctx.fill();
  ctx.restore();

  // Subtle album-colored rim glow around glass frame
  roundedRectPath(ctx, x - pad, y - pad, cardSize + pad * 2, cardSize + pad * 2, 12);
  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(${themePalette.primaryRgb}, ${(0.38 + dsp.smoothMid * 0.25).toFixed(3)})`;
  ctx.stroke();

  // Sharp high-res album artwork clipped inside rounded inner frame
  ctx.save();
  roundedRectPath(ctx, x, y, cardSize, cardSize, 7);
  ctx.clip();
  ctx.drawImage(spotify.albumImg, x, y, cardSize, cardSize);

  // Subtle diagonal glass specular highlight across the album cover
  const gloss = ctx.createLinearGradient(x, y, x + cardSize, y + cardSize);
  gloss.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
  gloss.addColorStop(0.35, 'rgba(255, 255, 255, 0.02)');
  gloss.addColorStop(0.6, 'rgba(0, 0, 0, 0)');
  gloss.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
  ctx.fillStyle = gloss;
  ctx.fillRect(x, y, cardSize, cardSize);
  ctx.restore();

  // Crisp inner hairline border
  roundedRectPath(ctx, x, y, cardSize, cardSize, 7);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.stroke();

  // Minimalist catalog caption under the glass album frame
  if (fontsReady && spotify.albumName) {
    ctx.font = '10px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = `rgba(${themePalette.peakRgb}, 0.72)`;
    ctx.fillText(
      truncateTextToWidth(spotify.albumName, cardSize + 16),
      cx,
      y + cardSize + pad + 8
    );
  }

  ctx.restore();
}

// ============================================================================
// 7. TRANSPARENT HARDWARE DRIVERS & VIBE PROCEDURAL OVERLAYS
// ============================================================================

function drawTransparentAcousticDrivers() {
  const sub = dsp.smoothSub;
  const mid = dsp.smoothMid;
  const recoil = fxState.driverRecoil;
  const flash = fxState.driverGlow;
  const bgX = mouseX * (CONFIG.PARALLAX_BG * 0.85) + fxState.shakeX * 0.4;
  const bgY = mouseY * (CONFIG.PARALLAX_BG * 0.85) + fxState.shakeY * 0.4;

  const outerR = panel.driverRadius * (1 + sub * 0.055 + dsp.kickPulse * 0.03);
  const piston = sub * 0.42 + recoil * 0.5;
  const drivers = [panel.leftDriverX, panel.rightDriverX];

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  for (let d = 0; d < 2; d++) {
    const rimX = drivers[d] + bgX;
    const rimY = panel.driverY + bgY;
    const throatX = rimX - mouseX * 9 * (1 - piston * 0.6);
    const throatY = rimY - mouseY * 9 * (1 - piston * 0.6);

    const aura = ctx.createRadialGradient(throatX, throatY, 2, rimX, rimY, outerR * 1.2);
    aura.addColorStop(
      0,
      `rgba(${themePalette.primaryRgb}, ${Math.min(0.46, 0.06 + sub * 0.24 + flash * 0.14).toFixed(3)})`
    );
    aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(rimX, rimY, outerR * 1.2, 0, Math.PI * 2);
    ctx.fill();

    for (let c = 0; c <= 4; c++) {
      const t = c / 4;
      const r = outerR * (1 - t * 0.68) * (1 + t * piston * 0.14);
      const cx = rimX + (throatX - rimX) * t;
      const cy = rimY + (throatY - rimY) * t;

      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, r), 0, Math.PI * 2);
      ctx.lineWidth = c === 0 ? 1.3 : 0.9;
      ctx.strokeStyle =
        c === 4
          ? `rgba(${themePalette.peakRgb}, ${Math.min(0.75, 0.1 + sub * 0.3 + flash * 0.22).toFixed(3)})`
          : `rgba(${themePalette.secondaryRgb}, ${(0.05 + sub * 0.16).toFixed(3)})`;
      ctx.stroke();
    }

    if (isAudioActive && timeData) {
      const segs = 64;
      const baseWaveR = outerR * 0.62;
      const waveAmp = outerR * (0.05 + mid * 0.14 + sub * 0.1);
      ctx.beginPath();
      for (let s = 0; s <= segs; s++) {
        const idx = ((s % segs) * 16 + d * 256) % CONFIG.FFT_SIZE;
        const sample = (timeData[idx] - 128) / 128;
        const ang = (s / segs) * Math.PI * 2;
        const rr = baseWaveR + sample * waveAmp;
        const wx = rimX + (throatX - rimX) * 0.45 + Math.cos(ang) * rr;
        const wy = rimY + (throatY - rimY) * 0.45 + Math.sin(ang) * rr;
        if (s === 0) ctx.moveTo(wx, wy);
        else ctx.lineTo(wx, wy);
      }
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = `rgba(${themePalette.peakRgb}, ${(0.14 + mid * 0.4).toFixed(3)})`;
      ctx.stroke();
    }
  }

  const fov = 0.68;
  const baseScale = fov / (fov + 1.0);
  for (let i = 0; i < shockwaves.length; i++) {
    const sw = shockwaves[i];
    if (!sw.active || sw.alpha <= 0.005) continue;

    const progress = (1.0 - sw.z) / 0.86;
    const persp = fov / (fov + sw.z) / baseScale;
    const r = panel.driverRadius * sw.radiusMult * persp;
    const shiftX = mouseX * (-13 * (1 - progress) + 14 * progress);
    const shiftY = mouseY * (-13 * (1 - progress) + 14 * progress);

    ctx.lineWidth = Math.max(0.8, 1.9 * (1 - progress * 0.5));
    ctx.strokeStyle = `rgba(${themePalette.peakRgb}, ${sw.alpha.toFixed(3)})`;

    for (let d = 0; d < 2; d++) {
      ctx.beginPath();
      ctx.arc(drivers[d] + shiftX, panel.driverY + shiftY, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawSlowRainAndBokehEffects(now, blend) {
  if (blend <= 0.01) return;

  const sub = dsp.smoothSub;
  const mid = dsp.smoothMid;
  const midShiftX = mouseX * CONFIG.PARALLAX_MID;
  const midShiftY = mouseY * CONFIG.PARALLAX_MID;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < bokehOrbs.length; i++) {
    const b = bokehOrbs[i];
    b.x += b.vx * (1 + mid * 0.9);
    b.y += b.vy * (1 + mid * 0.9);
    if (b.x < -0.1) b.x = 1.1;
    if (b.x > 1.1) b.x = -0.1;
    if (b.y < -0.1) b.y = 1.1;
    if (b.y > 1.1) b.y = -0.1;

    const pulse = 1 + sub * 0.32 + 0.07 * Math.sin(now * 0.0015 + b.phase);
    const r = b.baseR * pulse;
    const bx = panel.x + b.x * panel.w - mouseX * 10;
    const by = panel.y + b.y * panel.h - mouseY * 10;
    const alpha = Math.min(0.38, b.alpha * blend * (0.75 + sub * 1.35 + mid * 0.45));

    const rgb =
      b.hueType === 0
        ? themePalette.primaryRgb
        : b.hueType === 1
          ? themePalette.secondaryRgb
          : themePalette.peakRgb;

    const grad = ctx.createRadialGradient(bx, by, r * 0.15, bx, by, r);
    grad.addColorStop(0, `rgba(${rgb}, ${(alpha * 0.65).toFixed(3)})`);
    grad.addColorStop(0.76, `rgba(${rgb}, ${(alpha * 0.92).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < raindrops.length; i++) {
    const drop = raindrops[i];
    if (drop.pauseTimer > 0) {
      drop.pauseTimer -= 1 + sub * 1.4;
      drop.y += drop.speed * 0.12;
    } else {
      const speedMult = 1 + mid * 0.85 + sub * 0.6;
      drop.y += drop.speed * speedMult;
      drop.x += Math.sin(now * 0.002 + drop.wobblePhase + drop.y * 18) * 0.00026;
      if (Math.random() < 0.007) drop.pauseTimer = 22 + Math.random() * 60;
    }

    if (drop.y - drop.trailLen > 1.04) {
      drop.y = -0.04 - Math.random() * 0.15;
      drop.x = 0.03 + Math.random() * 0.94;
      drop.pauseTimer = Math.random() * 38;
    }

    const dx = panel.x + drop.x * panel.w + midShiftX * 0.7;
    const dy = panel.y + drop.y * panel.h + midShiftY * 0.7;
    const streakPixels = drop.trailLen * panel.h;

    const trailGrad = ctx.createLinearGradient(dx, dy - streakPixels, dx, dy);
    trailGrad.addColorStop(0, `rgba(${themePalette.peakRgb}, 0)`);
    trailGrad.addColorStop(1, `rgba(${themePalette.peakRgb}, ${(0.24 * blend).toFixed(3)})`);

    ctx.beginPath();
    ctx.moveTo(dx, dy - streakPixels);
    ctx.lineTo(dx, dy);
    ctx.lineWidth = Math.max(1, drop.radius * 0.66);
    ctx.strokeStyle = trailGrad;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(dx, dy, drop.radius * 0.85, drop.radius * 1.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(8, 8, 12, ${(0.45 * blend).toFixed(3)})`;
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = `rgba(${themePalette.secondaryRgb}, ${(0.44 * blend).toFixed(3)})`;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(dx - drop.radius * 0.25, dy - drop.radius * 0.3, Math.max(0.7, drop.radius * 0.32), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${themePalette.peakRgb}, ${(0.78 * blend).toFixed(3)})`;
    ctx.fill();
  }

  ctx.restore();
}

function drawEdmBrutalistEffects(blend) {
  if (blend <= 0.01) return;

  const sub = dsp.smoothSub;
  const mid = dsp.smoothMid;
  const trb = dsp.smoothTreble;

  ctx.save();

  // Glitch slices sampled from blurred album backdrop (or clean accent bars when on aurora)
  if (fxState.glitchIntensity > 0.08) {
    const intensity = fxState.glitchIntensity * blend;
    for (let s = 0; s < CONFIG.GLITCH_SLICE_COUNT; s++) {
      const hash = Math.sin(fxState.glitchSeed + s * 73.17) * 0.5 + 0.5;
      const sliceYNorm = hash * 0.84 + 0.08;
      const sliceHNorm = 0.012 + ((s * 19) % 6) * 0.007;
      const shiftPx = (s % 2 === 0 ? 1 : -1) * (14 + hash * 32) * intensity;

      const dy = panel.y + sliceYNorm * panel.h;
      const dh = sliceHNorm * panel.h;

      ctx.save();
      if (spotify.hasAlbumBackdrop && backdropState.albumVisibility > 0.3) {
        ctx.globalAlpha = Math.min(0.85, intensity) * backdropState.albumVisibility;
        ctx.drawImage(
          currAlbumBackdropCanvas,
          0,
          sliceYNorm * CONFIG.SCENE_H,
          CONFIG.SCENE_W,
          sliceHNorm * CONFIG.SCENE_H,
          panel.x + shiftPx,
          dy,
          panel.w,
          dh
        );
      }
      ctx.fillStyle = `rgba(${themePalette.primaryRgb}, ${(0.38 * intensity).toFixed(3)})`;
      ctx.fillRect(panel.x, dy, panel.w, 1.5);
      ctx.restore();
    }
  }

  if (halftonePattern) {
    ctx.save();
    ctx.globalAlpha = blend * (0.28 + trb * 0.36 + fxState.edmFlash * 0.25);
    ctx.fillStyle = halftonePattern;
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    ctx.restore();
  }

  if (fxState.edmFlash > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgba(${themePalette.primaryRgb}, ${(fxState.edmFlash * blend).toFixed(3)})`;
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    ctx.restore();
  }

  // Rotating 3D Wireframe Bounding Cube orbiting around the right-center focal area
  const rotSpeed = 0.0055 + mid * 0.018 + dsp.kickPulse * 0.016;
  fxState.cubeRotX += rotSpeed * 0.72;
  fxState.cubeRotY += rotSpeed * 1.05;
  fxState.cubeRotZ += rotSpeed * 0.4;

  const cubeCx = panel.cx + panel.w * 0.22 + mouseX * CONFIG.PARALLAX_MID;
  const cubeCy = panel.cy + panel.h * 0.02 + mouseY * CONFIG.PARALLAX_MID;
  const cubeRadius = Math.min(panel.w, panel.h) * 0.215 * fxState.cubeScale * (1 + sub * 0.11);
  const fov = 3.2;

  const cosX = Math.cos(fxState.cubeRotX + mouseY * 0.32);
  const sinX = Math.sin(fxState.cubeRotX + mouseY * 0.32);
  const cosY = Math.cos(fxState.cubeRotY + mouseX * 0.32);
  const sinY = Math.sin(fxState.cubeRotY + mouseX * 0.32);
  const cosZ = Math.cos(fxState.cubeRotZ);
  const sinZ = Math.sin(fxState.cubeRotZ);

  for (let i = 0; i < 8; i++) {
    const [vx, vy, vz] = CUBE_VERTICES[i];
    const y1 = vy * cosX - vz * sinX;
    const z1 = vy * sinX + vz * cosX;
    const x2 = vx * cosY + z1 * sinY;
    const z2 = -vx * sinY + z1 * cosY;
    const x3 = x2 * cosZ - y1 * sinZ;
    const y3 = x2 * sinZ + y1 * cosZ;

    const persp = fov / (fov + z2 + 1.2);
    projectedCubePts[i].x = cubeCx + x3 * cubeRadius * persp;
    projectedCubePts[i].y = cubeCy + y3 * cubeRadius * persp;
    projectedCubePts[i].scale = persp;
  }

  ctx.shadowColor = themePalette.primaryHex;
  ctx.shadowBlur = 14 + dsp.beatPulse * 12;
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = `rgba(${themePalette.primaryRgb}, ${(0.78 * blend).toFixed(3)})`;

  ctx.beginPath();
  for (let e = 0; e < CUBE_EDGES.length; e++) {
    const p1 = projectedCubePts[CUBE_EDGES[e][0]];
    const p2 = projectedCubePts[CUBE_EDGES[e][1]];
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  }
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = `rgba(${themePalette.peakRgb}, ${(0.88 * blend).toFixed(3)})`;
  for (let i = 0; i < 8; i++) {
    const pt = projectedCubePts[i];
    const sz = Math.max(2.4, 4.2 * pt.scale);
    ctx.fillRect(pt.x - sz * 0.5, pt.y - sz * 0.5, sz, sz);
  }

  ctx.restore();
}

function drawAmbientGalleryEffects(now, blend) {
  if (blend <= 0.01) return;

  const mid = dsp.smoothMid;
  const trb = dsp.smoothTreble;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  const beamShift = Math.sin(now * 0.00048) * panel.w * 0.055 - mouseX * 10;
  const beamGrad = ctx.createLinearGradient(
    panel.x + panel.w * 0.2 + beamShift,
    panel.y,
    panel.x + panel.w * 0.78 + beamShift,
    panel.y + panel.h
  );
  beamGrad.addColorStop(0, `rgba(${themePalette.secondaryRgb}, 0)`);
  beamGrad.addColorStop(
    0.5,
    `rgba(${themePalette.secondaryRgb}, ${(0.075 * blend * (1 + mid * 1.1)).toFixed(3)})`
  );
  beamGrad.addColorStop(1, `rgba(${themePalette.primaryRgb}, 0)`);
  ctx.fillStyle = beamGrad;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);

  for (let i = 0; i < dustMotes.length; i++) {
    const m = dustMotes[i];
    m.y -= (0.00018 + trb * 0.00055) * (1.2 - m.z * 0.5);
    m.x += Math.sin(now * 0.0009 + m.phase) * 0.00018;
    if (m.y < -0.02) {
      m.y = 1.02;
      m.x = Math.random();
    }

    const px = panel.x + m.x * panel.w + mouseX * (1 - m.z) * 16;
    const py = panel.y + m.y * panel.h + mouseY * (1 - m.z) * 16;
    const twinkle = 0.6 + 0.4 * Math.sin(now * 0.0038 + m.phase);
    const alpha = Math.min(0.88, m.alpha * twinkle * blend * (0.38 + trb * 1.3));

    ctx.fillStyle = `rgba(${themePalette.peakRgb}, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(px, py, m.size * (1.3 - m.z * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// ============================================================================
// 8. EDITORIAL POSTER TYPOGRAPHY, CORNER CLOCK & HUD CONTROLS
// ============================================================================

function getFormattedClock() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const dateStr = d
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: '2-digit' })
    .toUpperCase();
  return { hh, mm, ss, dateStr };
}

function truncateTextToWidth(text, maxWidth) {
  if (!text || ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 4 && ctx.measureText(`${trimmed}...`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}...`;
}

function drawEditorialPosterAndCornerClock(now, alpha) {
  if (!fontsReady || alpha <= 0.01) return;

  const fgX = mouseX * CONFIG.PARALLAX_FG + fxState.shakeX * 0.25;
  const fgY = mouseY * CONFIG.PARALLAX_FG + fxState.shakeY * 0.25;
  const effectiveVibe = getEffectiveVibe();
  const { hh, mm, ss, dateStr } = getFormattedClock();

  ctx.save();
  ctx.globalAlpha *= alpha;

  // --- TOP-RIGHT CORNER DIGITAL CLOCK (`HH:MM`) ---
  const rightX = panel.x + panel.w - 48 + fgX;
  const topClockY = panel.y + 50 + fgY;
  const clockPx = Math.round(Math.min(panel.w * 0.044, panel.h * 0.08, 52));

  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.88)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetX = -mouseX * 5;
  ctx.shadowOffsetY = 5 - mouseY * 5;

  ctx.font = `500 ${clockPx}px "Space Grotesk", sans-serif`;
  ctx.fillStyle = `rgba(${themePalette.peakRgb}, 0.95)`;
  ctx.fillText(`${hh}:${mm}`, rightX, topClockY - 6);

  ctx.font = '11px "Space Mono", monospace';
  ctx.fillStyle = `rgba(${themePalette.secondaryRgb}, 0.85)`;
  ctx.fillText(`${dateStr} · :${ss}`, rightX, topClockY + clockPx + 2);
  ctx.restore();

  // --- SHARP FLOATING GLASS ALBUM CARD (in 01 AUTO SCENE when Spotify is playing) ---
  drawFramedGlassAlbumCard(alpha);

  // --- LOWER-LEFT ASYMMETRICAL EDITORIAL POSTER ---
  const leftMargin = panel.x + Math.max(48, panel.w * 0.062) + fgX;
  const posterBaseY = panel.y + panel.h - Math.max(114, panel.h * 0.175) + fgY;
  const headlinePx = Math.round(
    Math.min(panel.w * 0.074, panel.h * 0.14, 88) * (1 + dsp.smoothSub * 0.022)
  );
  const lineHeight = headlinePx * 0.94;
  const ambientDriftY = effectiveVibe === 'EDM' ? 0 : Math.sin(now * 0.0014) * 4;

  ctx.save();
  ctx.translate(leftMargin, posterBaseY + ambientDriftY);
  if (posterState.scalePunch !== 1 || posterState.skewX !== 0) {
    ctx.transform(
      posterState.scalePunch,
      0,
      posterState.skewX * posterState.scalePunch,
      posterState.scalePunch,
      0,
      0
    );
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.88)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetX = -mouseX * 7;
  ctx.shadowOffsetY = 8 - mouseY * 6;

  // Editorial Kicker: Live Spotify `ARTIST // TRACK TITLE` or Vibe Kicker
  ctx.font = '700 11px "Space Mono", monospace';
  const maxKickerW = Math.min(panel.w * 0.48, 520);

  if (spotify.connected && spotify.trackName) {
    let textStartX = 0;
    if (spotify.albumImg && MODES[activeModeIndex].id !== 'auto') {
      const thumbSize = 22;
      const thumbY = -lineHeight * 2 - 30;
      ctx.save();
      roundedRectPath(ctx, 0, thumbY, thumbSize, thumbSize, 4);
      ctx.clip();
      ctx.drawImage(spotify.albumImg, 0, thumbY, thumbSize, thumbSize);
      ctx.restore();

      ctx.save();
      roundedRectPath(ctx, 0, thumbY, thumbSize, thumbSize, 4);
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${themePalette.primaryRgb}, 0.75)`;
      ctx.stroke();
      ctx.restore();

      textStartX = 30;
    }

    ctx.fillStyle = themePalette.primaryHex;
    const rawTrackLine = `${spotify.artistName}  //  ${spotify.trackName}`;
    ctx.fillText(
      truncateTextToWidth(rawTrackLine, maxKickerW - textStartX),
      textStartX,
      -lineHeight * 2 - 15
    );
  } else {
    ctx.fillStyle = themePalette.primaryHex;
    const lockTag = MODES[activeModeIndex].forcedVibe ? 'LOCKED' : 'AURORA ENGINE';
    ctx.fillText(
      `${posterState.kicker}   [${effectiveVibe} · ${lockTag}]`,
      0,
      -lineHeight * 2 - 15
    );
  }

  if (posterState.prevLines && posterState.prevAlpha > 0.02) {
    ctx.save();
    ctx.globalAlpha *= posterState.prevAlpha;
    ctx.font = `700 ${headlinePx}px "Space Grotesk", sans-serif`;
    ctx.fillStyle = `rgba(${themePalette.secondaryRgb}, 0.65)`;
    ctx.fillText(posterState.prevLines[0], 0, -lineHeight + posterState.prevShiftY);
    ctx.fillText(posterState.prevLines[1], 0, posterState.prevShiftY);
    ctx.restore();
  }

  ctx.font = `700 ${headlinePx}px "Space Grotesk", sans-serif`;

  ctx.save();
  ctx.globalAlpha *= posterState.line1Alpha;
  ctx.fillStyle = '#fff7f0';
  ctx.fillText(posterState.lines[0], posterState.line1X, -lineHeight + posterState.line1Y);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha *= posterState.line2Alpha;
  ctx.fillStyle =
    effectiveVibe === 'EDM' ? themePalette.primaryHex : `rgb(${themePalette.peakRgb})`;
  ctx.fillText(posterState.lines[1], posterState.line2X, posterState.line2Y);

  if (dsp.beatPulse > 0.28) {
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.15;
    ctx.strokeStyle = `rgba(${themePalette.peakRgb}, ${(dsp.beatPulse * 0.55).toFixed(3)})`;
    ctx.strokeText(
      posterState.lines[1],
      posterState.line2X + dsp.beatPulse * 6,
      posterState.line2Y - dsp.beatPulse * 4
    );
  }
  ctx.restore();

  // Composed 48-Bar Album-Tinted Spectrum Equalizer Strip
  const eqTotalW = Math.min(panel.w * 0.42, 410) * posterState.ruleProgress;
  const eqBaseY = 24;
  const maxBarH = 18;
  const stepX = eqTotalW / CONFIG.EQ_BAR_COUNT;
  const barW = Math.max(2, stepX * 0.62);

  ctx.shadowBlur = 0;
  ctx.fillStyle = `rgba(${themePalette.peakRgb}, 0.18)`;
  ctx.fillRect(0, eqBaseY, eqTotalW, 1);

  for (let i = 0; i < CONFIG.EQ_BAR_COUNT; i++) {
    let val = 0.05;
    if (isAudioActive && freqData) {
      val = shapeBand(freqData[eqBinIndices[i]] / 255, dsp.agcGain * 0.88);
    } else {
      val = 0.05 + 0.03 * Math.sin(now * 0.0026 + i * 0.3);
    }

    if (val > eqBarPeaks[i]) eqBarPeaks[i] = val;
    else eqBarPeaks[i] *= 0.95;

    const bh = Math.max(1.5, val * maxBarH);
    const bx = i * stepX;

    ctx.fillStyle =
      val > 0.76
        ? `rgba(${themePalette.peakRgb}, 0.92)`
        : `rgba(${themePalette.primaryRgb}, ${(0.38 + val * 0.58).toFixed(3)})`;
    ctx.fillRect(bx, eqBaseY - bh, barW, bh);

    if (isAudioActive && eqBarPeaks[i] > 0.18) {
      ctx.fillStyle = `rgba(${themePalette.peakRgb}, 0.72)`;
      ctx.fillRect(bx, eqBaseY - eqBarPeaks[i] * maxBarH - 2, barW, 1.5);
    }
  }

  // Acoustic & Scene Source Metadata Footnote
  ctx.font = '400 11px "Space Mono", monospace';
  ctx.fillStyle = `rgba(${themePalette.peakRgb}, 0.8)`;
  const bpmText = dsp.rollingBpm > 42 ? `${Math.round(dsp.rollingBpm)} BPM` : 'SYNC BPM';
  const hzText =
    dsp.dominantHz > 25 ? `${dsp.dominantNote} (${Math.round(dsp.dominantHz)} HZ)` : 'STANDBY';
  const backdropSource =
    backdropState.albumVisibility > 0.5 ? 'ALBUM BACKDROP' : 'AURORA MESH';
  ctx.fillText(`${bpmText}  ·  ${hzText}  ·  ${effectiveVibe}  ·  ${backdropSource}`, 0, eqBaseY + 17);

  ctx.restore();
  ctx.restore();
}

function renderGalleryTimepieceForeground(alpha) {
  if (!fontsReady || alpha <= 0.01) return;

  const { hh, mm, ss, dateStr } = getFormattedClock();
  const fgX = panel.cx + mouseX * CONFIG.PARALLAX_FG;
  const fgY = panel.cy + mouseY * CONFIG.PARALLAX_FG;
  const digitSize = Math.round(
    Math.min(panel.w * 0.165, panel.h * 0.3, 156) * (1 + dsp.smoothSub * 0.02)
  );

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.shadowColor = 'rgba(0, 0, 0, 0.86)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetX = -mouseX * 7;
  ctx.shadowOffsetY = 8 - mouseY * 6;

  ctx.font = `300 ${digitSize}px "Space Grotesk", sans-serif`;
  ctx.fillStyle = `rgba(${themePalette.peakRgb}, 0.96)`;
  ctx.fillText(`${hh}:${mm}`, fgX, fgY - panel.h * 0.03);

  ctx.font = '12px "Space Mono", monospace';
  ctx.fillStyle = `rgba(${themePalette.secondaryRgb}, 0.88)`;
  const trackSub =
    spotify.connected && spotify.trackName
      ? truncateTextToWidth(`${spotify.artistName} — ${spotify.trackName}`, panel.w * 0.5)
      : isAudioActive
        ? `${getEffectiveVibe()} · ${dsp.db.toFixed(0)} dB`
        : 'AURORA STANDBY';
  ctx.fillText(`${dateStr}   //   :${ss}   //   ${trackSub}`, fgX, fgY + digitSize * 0.56);

  ctx.restore();
}

function drawHudAndControls(now) {
  if (!fontsReady) return;

  const fgShiftX = mouseX * (CONFIG.PARALLAX_FG * 0.72);
  const fgShiftY = mouseY * (CONFIG.PARALLAX_FG * 0.72);

  const padX = panel.x + 48 + fgShiftX;
  const topY = panel.y + 42 + fgShiftY;
  const rightEdge = panel.x + panel.w - 48 + fgShiftX;
  const bottomY = panel.y + panel.h - 36 + fgShiftY;
  const effectiveVibe = getEffectiveVibe();

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = '11px "Share Tech Mono", monospace';

  ctx.shadowColor = 'rgba(0, 0, 0, 0.88)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 3;

  const ledR = 3.5 + dsp.kickPulse * 1.6;
  ctx.fillStyle = isAudioActive ? themePalette.primaryHex : `rgba(${themePalette.secondaryRgb}, 0.6)`;
  ctx.beginPath();
  ctx.arc(padX + 4, topY, ledR, 0, Math.PI * 2);
  ctx.fill();

  const brandStr = 'MORNING BLUES // SONICGLASS A1';
  ctx.fillStyle = 'rgba(255, 240, 228, 0.92)';
  ctx.fillText(brandStr, padX + 15, topY);

  const badgeX = padX + 24 + ctx.measureText(brandStr).width;
  const vibeText = `VIBE: ${effectiveVibe}`;
  const badgeW = ctx.measureText(vibeText).width + 14;
  const badgeH = 18;
  roundedRectPath(ctx, badgeX, topY - badgeH * 0.5, badgeW, badgeH, 9);
  ctx.fillStyle = `rgba(${themePalette.primaryRgb}, ${(0.18 + posterState.vibeBadgeGlow * 0.35).toFixed(3)})`;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(${themePalette.primaryRgb}, ${(0.55 + posterState.vibeBadgeGlow * 0.4).toFixed(3)})`;
  ctx.stroke();

  ctx.fillStyle = `rgba(${themePalette.peakRgb}, 0.96)`;
  ctx.fillText(vibeText, badgeX + 7, topY + 0.5);

  let subTelemetry = statusMessage;
  if (spotify.connected && spotify.trackName) {
    const playState = spotify.isPlaying ? 'SPOTIFY LIVE' : 'SPOTIFY PAUSED · AURORA';
    subTelemetry = `${playState} // ${truncateTextToWidth(`${spotify.artistName} - ${spotify.trackName}`, panel.w * 0.48)}`;
  }
  ctx.fillStyle = `rgba(${themePalette.secondaryRgb}, 0.78)`;
  ctx.fillText(subTelemetry, padX + 15, topY + 19);

  // Bottom-Right Interactive Mode & Spotify Pills
  hitRegions.length = 0;
  const idleAge = now - lastPointerMove;
  const controlsAlpha = idleAge > 4800 && !hudHoverId ? 0.48 : 0.95;
  const pillH = 22;
  let cursorRight = rightEdge;

  function drawPill(id, label, isActive, customAccentRgb = null) {
    const rgb = customAccentRgb || themePalette.primaryRgb;
    const w = ctx.measureText(label).width + 15;
    cursorRight -= w;
    roundedRectPath(ctx, cursorRight, bottomY - pillH * 0.5, w, pillH, 11);

    if (isActive) {
      ctx.fillStyle = `rgba(${rgb}, ${(0.92 * controlsAlpha).toFixed(3)})`;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#050507';
    } else {
      ctx.fillStyle = hudHoverId === id ? `rgba(${rgb}, 0.3)` : 'rgba(8, 8, 12, 0.74)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${rgb}, ${(0.36 * controlsAlpha).toFixed(3)})`;
      ctx.stroke();
      ctx.fillStyle = `rgba(255, 232, 214, ${(0.85 * controlsAlpha).toFixed(3)})`;
    }

    ctx.fillText(label, cursorRight + 7.5, bottomY + 0.5);
    if (isActive) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.88)';
      ctx.shadowBlur = 10;
    }

    hitRegions.push({ id, x: cursorRight, y: bottomY - pillH * 0.5, w, h: pillH });
    cursorRight -= 6;
  }

  drawPill('toggle-frame', showGlassFrame ? '[G] BEZEL' : '[G] FULL', false);
  drawPill(
    'spotify-auth',
    spotify.connected ? 'SPOTIFY ✓' : 'CONNECT SPOTIFY',
    spotify.connected,
    spotify.connected ? themePalette.primaryRgb : '29, 185, 84'
  );

  cursorRight -= 4;

  for (let i = MODES.length - 1; i >= 0; i--) {
    const m = MODES[i];
    drawPill(`mode-${i}`, `${m.code} ${m.label}`, i === activeModeIndex);
    hitRegions[hitRegions.length - 1].modeIndex = i;
  }

  ctx.restore();
}

function drawAnalogGrain() {
  if (!noisePattern) return;
  const offsetX = -((Math.random() * CONFIG.NOISE_SIZE) | 0);
  const offsetY = -((Math.random() * CONFIG.NOISE_SIZE) | 0);

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.fillStyle = noisePattern;
  ctx.fillRect(
    -offsetX,
    -offsetY,
    viewportWidth + CONFIG.NOISE_SIZE,
    viewportHeight + CONFIG.NOISE_SIZE
  );
  ctx.restore();
}

// ============================================================================
// 9. MAIN 60 FPS RENDER LOOP & INTERACTION
// ============================================================================

function renderModeOverlay(modeIdx, now, alpha) {
  if (MODES[modeIdx].id === 'clock') {
    renderGalleryTimepieceForeground(alpha);
  } else {
    drawEditorialPosterAndCornerClock(now, alpha);
  }
}

function renderFrame(now) {
  ctx.fillStyle = CONFIG.BG_HEX;
  ctx.fillRect(0, 0, viewportWidth, viewportHeight);

  updateAudioAndLifecycle(now);
  updateParallaxState(now);

  ctx.save();
  if (showGlassFrame && panel.radius > 0) {
    roundedRectPath(ctx, panel.x, panel.y, panel.w, panel.h, panel.radius);
    ctx.clip();
  }

  // Layer 1: Hybrid Zero-Rate-Limit Backdrop (Blurred Spotify Album Art <-> Procedural Aurora)
  drawHybridBackdrop(now);

  // Layer 2: See-Through SonicGlass A1 Dual Acoustic Drivers
  drawTransparentAcousticDrivers();

  // Layer 3: Vibe-Specific Procedural Canvas Layers
  drawSlowRainAndBokehEffects(now, backdropState.vibeBlendSLOW);
  drawEdmBrutalistEffects(backdropState.vibeBlendEDM);
  drawAmbientGalleryEffects(now, backdropState.vibeBlendAMBIENT);

  // Layer 4: Editorial Poster, Framed Glass Album Card & Corner Clock
  const t = modeTransition.progress;
  if (t < 0.999 && prevModeIndex !== activeModeIndex) {
    renderModeOverlay(prevModeIndex, now, 1 - t);
    renderModeOverlay(activeModeIndex, now, t);
  } else {
    renderModeOverlay(activeModeIndex, now, 1);
  }

  // Layer 5: Telemetry Header & Interactive Controls
  drawHudAndControls(now);

  ctx.restore();

  ctx.drawImage(glassCanvas, 0, 0, viewportWidth, viewportHeight);
  drawAnalogGrain();

  window.requestAnimationFrame(renderFrame);
}

function switchVisualizerMode(nextIndex) {
  if (nextIndex === activeModeIndex || nextIndex < 0 || nextIndex >= MODES.length) return;

  const prevEffective = getEffectiveVibe();
  prevModeIndex = activeModeIndex;
  activeModeIndex = nextIndex;
  const nextEffective = getEffectiveVibe();

  gsapApi.killTweensOf(modeTransition);
  modeTransition.progress = 0;
  gsapApi.to(modeTransition, {
    progress: 1,
    duration: 0.75,
    ease: 'power3.out',
  });

  if (nextEffective !== prevEffective) {
    applyVibeVisualBlend(nextEffective);
    cycleEditorialPhrase(nextEffective, true);
  }
}

function toggleGlassFrame() {
  showGlassFrame = !showGlassFrame;
  computePanelGeometry();
  buildGlassEnclosureCache();
}

function handlePointerMove(e) {
  lastPointerMove = performance.now();
  pointerInside = true;

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const halfW = Math.max(1, viewportWidth * 0.5);
  const halfH = Math.max(1, viewportHeight * 0.5);
  targetMouseX = Math.max(-1, Math.min(1, (mx - viewportWidth * 0.5) / halfW));
  targetMouseY = Math.max(-1, Math.min(1, (my - viewportHeight * 0.5) / halfH));

  let found = null;
  for (let i = 0; i < hitRegions.length; i++) {
    const r = hitRegions[i];
    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
      found = r.id;
      break;
    }
  }
  hudHoverId = found;
  canvas.style.cursor = found ? 'pointer' : 'default';
}

function handlePointerLeave() {
  pointerInside = false;
  targetMouseX = 0;
  targetMouseY = 0;
  hudHoverId = null;
  canvas.style.cursor = 'default';
}

function handleCanvasClick(e) {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  for (let i = 0; i < hitRegions.length; i++) {
    const r = hitRegions[i];
    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
      if (r.id === 'toggle-frame') {
        toggleGlassFrame();
      } else if (r.id === 'spotify-auth') {
        if (spotify.connected) {
          clearSpotifySession();
          statusMessage = isAudioActive
            ? 'SPOTIFY DISCONNECTED // AURORA MESH'
            : 'STANDBY // SPOTIFY DISCONNECTED';
        } else {
          startSpotifyPkceAuth();
        }
      } else if (typeof r.modeIndex === 'number') {
        switchVisualizerMode(r.modeIndex);
      }
      return;
    }
  }
}

function handleKeyDown(e) {
  lastPointerMove = performance.now();
  if (e.key >= '1' && e.key <= '4') {
    switchVisualizerMode(Number(e.key) - 1);
  } else if (e.key === 'g' || e.key === 'G') {
    toggleGlassFrame();
  } else if (e.key === '+' || e.key === '=') {
    userSensitivity = Math.min(2.2, Math.round((userSensitivity + 0.15) * 100) / 100);
  } else if (e.key === '-' || e.key === '_') {
    userSensitivity = Math.max(0.6, Math.round((userSensitivity - 0.15) * 100) / 100);
  }
}

function bootstrap() {
  syncThemePaletteStrings();
  buildPrecomputedAssets();
  handleResize();

  window.addEventListener('resize', handleResize);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('mousemove', handlePointerMove);
  window.addEventListener('mouseleave', handlePointerLeave);
  canvas.addEventListener('click', handleCanvasClick);
  startBtn.addEventListener('click', initSystemAudio);
  if (spotifyBtn) {
    spotifyBtn.addEventListener('click', startSpotifyPkceAuth);
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      fontsReady = true;
    });
  } else {
    fontsReady = true;
  }

  handleSpotifyRedirectCallback();
  window.requestAnimationFrame(renderFrame);
}

bootstrap();
