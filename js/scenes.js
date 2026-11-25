/**
 * js/scenes.js
 * Hybrid Backdrop (Blurred Album Art + Procedural Aurora), Ambient Beat Light Bloom,
 * See-Through Acoustic Cones, All 6 Vibe Scenes (ANTHEM, EDM, HIPHOP, SLOW, ACOUSTIC, AMBIENT),
 * and Live Track Title + Artist Editorial Typography (replacing generic mood words).
 */

import {
  CONFIG,
  CUBE_VERTICES,
  CUBE_EDGES,
  dom,
  buffers,
  themePalette,
  trackState,
  lyricsState,
  panel,
  dsp,
  animState,
  particles,
  ripples,
  shapeBand,
  truncateTextToWidth,
  wrapTitleTwoLines,
  getFormattedClock,
  getParticleDensityScale,
  getDriftSpeedScale,
  getWaveAndRippleScale,
  getEffectiveVibe,
} from './state.js';
import { drawHolographicLyrics } from './lyrics.js';

export function buildHalftonePattern() {
  const { halftoneCanvas, halftoneCtx } = buffers;
  halftoneCanvas.width = 8;
  halftoneCanvas.height = 8;
  halftoneCtx.clearRect(0, 0, 8, 8);
  halftoneCtx.fillStyle = 'rgba(5, 5, 8, 0.54)';
  halftoneCtx.fillRect(0, 0, 3, 3);
  halftoneCtx.fillRect(4, 4, 2, 2);
  halftoneCtx.fillStyle = `rgba(${themePalette.primaryRgb}, 0.24)`;
  halftoneCtx.fillRect(4, 0, 1.5, 1.5);
  buffers.halftonePattern = dom.ctx.createPattern(halftoneCanvas, 'repeat');
}

export function buildSceneAssets() {
  buffers.currAlbumBackdropCanvas.width = CONFIG.SCENE_W;
  buffers.currAlbumBackdropCanvas.height = CONFIG.SCENE_H;
  buffers.prevAlbumBackdropCanvas.width = CONFIG.SCENE_W;
  buffers.prevAlbumBackdropCanvas.height = CONFIG.SCENE_H;

  const usableBins = Math.floor((CONFIG.FFT_SIZE / 2) * 0.52);
  for (let i = 0; i < CONFIG.EQ_BAR_COUNT; i++) {
    const ratio = i / (CONFIG.EQ_BAR_COUNT - 1);
    particles.eqBinIndices[i] = Math.min(
      usableBins - 1,
      Math.floor(Math.pow(ratio, 1.65) * usableBins) + 1
    );
  }

  for (let i = 0; i < CONFIG.HALO_BINS; i++) {
    const ratio = i / (CONFIG.HALO_BINS - 1);
    particles.haloBinIndices[i] = Math.min(
      usableBins - 1,
      Math.floor(Math.pow(ratio, 1.5) * usableBins) + 1
    );
  }

  buildHalftonePattern();
}

// ============================================================================
// 1. HYBRID BACKDROP + DYNAMIC AMBIENT BEAT LIGHT BLOOM
// ============================================================================

function drawProceduralAuroraBackdrop(now, alpha) {
  if (alpha <= 0.005) return;

  const { ctx } = dom;
  const mi = animState.motionIntensity;
  const driftScale = getDriftSpeedScale(mi);
  const bgShiftX = animState.mouseX * CONFIG.PARALLAX_BG * (0.55 + Math.min(1, mi) * 0.45);
  const bgShiftY = animState.mouseY * CONFIG.PARALLAX_BG * (0.55 + Math.min(1, mi) * 0.45);
  const { auroraNodes } = particles;
  const velBoost =
    driftScale *
    (1 +
      dsp.smoothRms * 0.7 * Math.min(1.2, mi) +
      dsp.chorusIntensity * 0.85 * Math.min(1.3, mi));

  ctx.save();
  ctx.globalAlpha = alpha;

  const base = ctx.createLinearGradient(panel.x, panel.y, panel.x + panel.w, panel.y + panel.h);
  base.addColorStop(0, '#050508');
  base.addColorStop(0.55, '#0b0a10');
  base.addColorStop(1, '#120c0c');
  ctx.fillStyle = base;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);

  ctx.globalCompositeOperation = 'screen';
  const minDim = Math.min(panel.w, panel.h);
  const waveScale = getWaveAndRippleScale(mi);

  for (let i = 0; i < auroraNodes.length; i++) {
    const node = auroraNodes[i];
    const nx =
      node.cx +
      Math.sin(now * node.freqX * velBoost + node.phaseX) * 0.25 +
      Math.cos(now * node.freqY * 0.7 * driftScale + i) * 0.08;
    const ny =
      node.cy +
      Math.cos(now * node.freqY * velBoost + node.phaseY) * 0.22 +
      Math.sin(now * node.freqX * 0.8 * driftScale + i) * 0.07;

    const ox = panel.x + nx * panel.w + bgShiftX * (0.6 + i * 0.15);
    const oy = panel.y + ny * panel.h + bgShiftY * (0.6 + i * 0.15);

    const bandMod =
      (node.colorRole === 0
        ? dsp.smoothSub * 0.38
        : node.colorRole === 1
          ? dsp.smoothMid * 0.34
          : dsp.smoothTreble * 0.34) * waveScale;
    const radius = minDim * (node.radiusRatio + bandMod);

    const rgb =
      node.colorRole === 0
        ? themePalette.primaryRgb
        : node.colorRole === 1
          ? themePalette.secondaryRgb
          : themePalette.peakRgb;
    const coreAlpha =
      (node.colorRole === 2 ? 0.13 : 0.22) +
      (dsp.smoothSub * 0.1 + dsp.smoothMid * 0.08) * waveScale;

    const grad = ctx.createRadialGradient(ox, oy, 8, ox, oy, radius);
    grad.addColorStop(0, `rgba(${rgb}, ${Math.min(0.48, coreAlpha).toFixed(3)})`);
    grad.addColorStop(0.48, `rgba(${rgb}, ${(coreAlpha * 0.44).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ox, oy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function drawHybridBackdrop(now) {
  const { ctx } = dom;
  const { backdrop, fx, mouseX, mouseY, motionIntensity: mi } = animState;
  const albumVis = backdrop.albumVisibility;
  const waveScale = getWaveAndRippleScale(mi);
  const sereneFactor = mi <= 0.35 ? 0.42 : Math.min(1.15, mi);

  if (albumVis < 0.999 || !trackState.hasAlbumBackdrop) {
    drawProceduralAuroraBackdrop(now, 1);
  }

  if (albumVis > 0.005 && trackState.hasAlbumBackdrop) {
    // Ultra-serene Ken Burns camera in SLOW/AMBIENT; punchy beat zoom in EDM/ANTHEM
    const breathZoom =
      1.06 +
      (0.5 + 0.5 * Math.sin(backdrop.kenBurnsPhase)) * (0.075 * sereneFactor) +
      (dsp.smoothSub * 0.042 + dsp.kickPulse * 0.034) * waveScale;

    const panX =
      Math.sin(backdrop.kenBurnsPhase * 0.68) *
        panel.w *
        0.028 *
        sereneFactor *
        backdrop.kenBurnsDirX +
      mouseX * CONFIG.PARALLAX_BG +
      fx.shakeX;
    const panY =
      Math.cos(backdrop.kenBurnsPhase * 0.54) *
        panel.h *
        0.024 *
        sereneFactor *
        backdrop.kenBurnsDirY +
      mouseY * CONFIG.PARALLAX_BG +
      fx.shakeY;

    const drawW = panel.w * breathZoom;
    const drawH = panel.h * breathZoom;
    const dx = panel.cx - drawW * 0.5 + panX;
    const dy = panel.cy - drawH * 0.5 + panY;

    ctx.save();
    if (backdrop.trackCrossfade < 0.999) {
      ctx.globalAlpha = albumVis;
      ctx.drawImage(buffers.prevAlbumBackdropCanvas, dx, dy, drawW, drawH);
      ctx.globalAlpha = albumVis * backdrop.trackCrossfade;
      ctx.drawImage(buffers.currAlbumBackdropCanvas, dx, dy, drawW, drawH);
    } else {
      ctx.globalAlpha = albumVis;
      ctx.drawImage(buffers.currAlbumBackdropCanvas, dx, dy, drawW, drawH);
    }

    if (fx.chromaSplit > 0.7) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(0.24, fx.chromaSplit * 0.032) * albumVis;
      ctx.drawImage(buffers.currAlbumBackdropCanvas, dx + fx.chromaSplit, dy, drawW, drawH);
    }
    ctx.restore();
  }

  // Dynamic Kick/Snare Ambient Light Bloom: calm glow in SLOW/AMBIENT, sharp flash in EDM/ANTHEM
  const bloomIntensity =
    fx.ambientBloom * (mi >= 1 ? 0.28 : 0.14) +
    (dsp.smoothMid * 0.08 + dsp.chorusIntensity * 0.11) * waveScale;
  if (bloomIntensity > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const bloomGrad = ctx.createRadialGradient(
      panel.cx,
      panel.cy - panel.h * 0.08,
      12,
      panel.cx,
      panel.cy,
      Math.max(panel.w, panel.h) * 0.65
    );
    bloomGrad.addColorStop(0, `rgba(${themePalette.peakRgb}, ${(bloomIntensity * 0.68).toFixed(3)})`);
    bloomGrad.addColorStop(0.45, `rgba(${themePalette.primaryRgb}, ${(bloomIntensity * 0.52).toFixed(3)})`);
    bloomGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = bloomGrad;
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    ctx.restore();
  }

  // Smoked-glass readability gradient
  const vignette = ctx.createLinearGradient(panel.x, panel.y, panel.x, panel.y + panel.h);
  vignette.addColorStop(0, 'rgba(5, 5, 8, 0.32)');
  vignette.addColorStop(0.5, 'rgba(5, 5, 8, 0.12)');
  vignette.addColorStop(1, 'rgba(4, 4, 7, 0.78)');
  ctx.fillStyle = vignette;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
}

// ============================================================================
// 2. SEE-THROUGH ACOUSTIC DRIVERS
// ============================================================================

export function drawTransparentAcousticDrivers() {
  const { ctx } = dom;
  const { fx, mouseX, mouseY, motionIntensity: mi } = animState;
  const waveScale = getWaveAndRippleScale(mi); // 0.40 (-60%) in SLOW/AMBIENT, 1.0+ in EDM/ANTHEM/HIPHOP
  const sub = dsp.smoothSub;
  const mid = dsp.smoothMid;
  const recoil = fx.driverRecoil;
  const flash = fx.driverGlow;
  const bgX = mouseX * (CONFIG.PARALLAX_BG * 0.85) + fx.shakeX * 0.45;
  const bgY = mouseY * (CONFIG.PARALLAX_BG * 0.85) + fx.shakeY * 0.45;

  const outerR = panel.driverRadius * (1 + (sub * 0.075 + dsp.kickPulse * 0.045) * waveScale);
  const piston = (sub * 0.5 + recoil * 0.58) * waveScale;
  const drivers = [panel.leftDriverX, panel.rightDriverX];

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  for (let d = 0; d < 2; d++) {
    const rimX = drivers[d] + bgX;
    const rimY = panel.driverY + bgY;
    const throatX = rimX - mouseX * 9 * (1 - piston * 0.6);
    const throatY = rimY - mouseY * 9 * (1 - piston * 0.6);

    const aura = ctx.createRadialGradient(throatX, throatY, 2, rimX, rimY, outerR * 1.24);
    aura.addColorStop(
      0,
      `rgba(${themePalette.primaryRgb}, ${Math.min(0.55, 0.05 + (sub * 0.3 + flash * 0.2) * waveScale).toFixed(3)})`
    );
    aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(rimX, rimY, outerR * 1.24, 0, Math.PI * 2);
    ctx.fill();

    for (let c = 0; c <= 4; c++) {
      const t = c / 4;
      const r = outerR * (1 - t * 0.68) * (1 + t * piston * 0.16);
      const cx = rimX + (throatX - rimX) * t;
      const cy = rimY + (throatY - rimY) * t;

      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, r), 0, Math.PI * 2);
      ctx.lineWidth = c === 0 ? 1.35 : 0.95;
      ctx.strokeStyle =
        c === 4
          ? `rgba(${themePalette.peakRgb}, ${Math.min(0.82, 0.1 + (sub * 0.35 + flash * 0.25) * waveScale).toFixed(3)})`
          : `rgba(${themePalette.secondaryRgb}, ${(0.045 + sub * 0.18 * waveScale).toFixed(3)})`;
      ctx.stroke();
    }

    if (dsp.isAudioActive && dsp.timeData) {
      const segs = 64;
      const baseWaveR = outerR * 0.62;
      // Waveform amplitude softened by 60% in SLOW/AMBIENT via waveScale
      const waveAmp = outerR * (0.06 + mid * 0.18 + sub * 0.14) * waveScale;
      ctx.beginPath();
      for (let s = 0; s <= segs; s++) {
        const idx = ((s % segs) * 16 + d * 256) % CONFIG.FFT_SIZE;
        const sample = (dsp.timeData[idx] - 128) / 128;
        const ang = (s / segs) * Math.PI * 2;
        const rr = baseWaveR + sample * waveAmp;
        const wx = rimX + (throatX - rimX) * 0.45 + Math.cos(ang) * rr;
        const wy = rimY + (throatY - rimY) * 0.45 + Math.sin(ang) * rr;
        if (s === 0) ctx.moveTo(wx, wy);
        else ctx.lineTo(wx, wy);
      }
      ctx.lineWidth = 1.15;
      ctx.strokeStyle = `rgba(${themePalette.peakRgb}, ${(0.12 + mid * 0.48 * waveScale).toFixed(3)})`;
      ctx.stroke();
    }
  }

  const fov = 0.68;
  const baseScale = fov / (fov + 1.0);
  for (let i = 0; i < ripples.length; i++) {
    const sw = ripples[i];
    if (!sw.active || sw.alpha <= 0.005) continue;

    const progress = (1.0 - sw.z) / 0.88;
    const persp = fov / (fov + sw.z) / baseScale;
    const r = panel.driverRadius * sw.radiusMult * persp;
    const shiftX = mouseX * (-13 * (1 - progress) + 14 * progress);
    const shiftY = mouseY * (-13 * (1 - progress) + 14 * progress);

    ctx.lineWidth = Math.max(0.8, 2.0 * (1 - progress * 0.5));
    ctx.strokeStyle = `rgba(${themePalette.peakRgb}, ${sw.alpha.toFixed(3)})`;

    for (let d = 0; d < 2; d++) {
      ctx.beginPath();
      ctx.arc(drivers[d] + shiftX, panel.driverY + shiftY, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.restore();
}

// ============================================================================
// 3. SIX DISTINCT VIBE SCENES
// ============================================================================

function drawHarmonicSilkRibbons(now, blend, strands, baseAmpRatio, yOffsetRatio) {
  const { ctx } = dom;
  const { mouseX, mouseY, motionIntensity: mi } = animState;
  const waveScale = getWaveAndRippleScale(mi); // Softens amplitude by 60% at mi=0.28
  const driftScale = getDriftSpeedScale(mi);
  const mid = dsp.smoothMid;
  const sub = dsp.smoothSub;
  const chorus = dsp.chorusIntensity;

  const waveW = panel.w * 0.88;
  const startX = panel.cx - waveW * 0.5 + mouseX * CONFIG.PARALLAX_MID;
  const centerY = panel.cy + panel.h * yOffsetRatio + mouseY * CONFIG.PARALLAX_MID;
  const amp =
    panel.h *
    baseAmpRatio *
    (0.42 + mid * 1.15 + sub * 0.45 + chorus * 0.35) *
    waveScale;

  const pts = 120;
  const stride = Math.floor(CONFIG.FFT_SIZE / pts);

  for (let s = 0; s < strands; s++) {
    const ratio = s / Math.max(1, strands - 1);
    ctx.beginPath();
    for (let i = 0; i < pts; i++) {
      const t = i / (pts - 1);
      const win = Math.pow(Math.sin(t * Math.PI), 1.35);
      const raw =
        dsp.isAudioActive && dsp.timeData
          ? (dsp.timeData[(i * stride + s * 64) % CONFIG.FFT_SIZE] - 128) / 128
          : 0;
      const flow =
        Math.sin(
          t * Math.PI * (3 + s) -
            now * (0.0022 + chorus * 0.0022) * driftScale +
            s * 1.1
        ) *
        (0.22 + mid * 0.42);
      const y = centerY + (raw * 0.72 + flow) * amp * win * (1 - ratio * 0.35);
      if (i === 0) ctx.moveTo(startX + t * waveW, y);
      else ctx.lineTo(startX + t * waveW, y);
    }

    ctx.lineWidth = s === 0 ? 2.1 : 1.15;
    const opacityMod = 0.55 + 0.45 * Math.min(1, waveScale);
    ctx.strokeStyle =
      s === 0
        ? `rgba(${themePalette.peakRgb}, ${(0.82 * blend * opacityMod).toFixed(3)})`
        : `rgba(${themePalette.primaryRgb}, ${((0.46 - ratio * 0.2) * blend * opacityMod).toFixed(3)})`;
    ctx.stroke();
  }
}

// --- SCENE 1: 'ANTHEM' (Praise / Pop / Uplifting — God-Rays, Rising Golden Motes, Sweeping Ribbons) ---
function drawAnthemScene(now, blend) {
  if (blend <= 0.01) return;

  const { ctx } = dom;
  const { mouseX, mouseY, motionIntensity: mi } = animState;
  const { godRays, dustMotes } = particles;
  const mid = dsp.smoothMid;
  const trb = dsp.smoothTreble;
  const chorus = dsp.chorusIntensity;
  const densityScale = getParticleDensityScale(mi);
  const driftScale = getDriftSpeedScale(mi);
  // Faster velocity bursts on transients in ANTHEM
  const velBoost =
    driftScale *
    (1 + mid * 1.9 + chorus * 2.5 + dsp.beatPulse * 2.1 + dsp.snarePulse * 1.3);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  // 1. Volumetric Warm God-Rays fanning from upper canopy (sharper beat-reactive lighting)
  for (let i = 0; i < godRays.length; i++) {
    const ray = godRays[i];
    const sway = Math.sin(now * 0.0007 * driftScale * (1 + chorus) + ray.phase) * 0.055;
    const topX = panel.x + (ray.originX + sway) * panel.w - mouseX * 10;
    const botX = topX + (ray.tilt + sway * 1.6) * panel.w;
    const halfTop = panel.w * ray.spread * 0.35;
    const halfBot = panel.w * ray.spread * (1.35 + dsp.smoothSub * 0.42 + chorus * 0.38);

    const rayAlpha =
      ray.alpha *
      blend *
      (0.85 + mid * 1.55 + dsp.beatPulse * 1.15 + dsp.snarePulse * 0.65 + chorus * 0.85);
    const grad = ctx.createLinearGradient(topX, panel.y, botX, panel.y + panel.h);
    grad.addColorStop(0, `rgba(${themePalette.peakRgb}, ${Math.min(0.48, rayAlpha * 1.35).toFixed(3)})`);
    grad.addColorStop(0.55, `rgba(${themePalette.primaryRgb}, ${Math.min(0.34, rayAlpha * 0.78).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(topX - halfTop, panel.y);
    ctx.lineTo(topX + halfTop, panel.y);
    ctx.lineTo(botX + halfBot, panel.y + panel.h);
    ctx.lineTo(botX - halfBot, panel.y + panel.h);
    ctx.closePath();
    ctx.fill();
  }

  // 2. Sweeping Harmonic Ribbons
  drawHarmonicSilkRibbons(now, blend, 3, 0.16, -0.02);

  // 3. Full-Density Rising Golden Dust Motes with Transient Velocity Bursts
  const activeMotes = Math.max(1, Math.round(dustMotes.length * densityScale));
  for (let i = 0; i < activeMotes; i++) {
    const m = dustMotes[i];
    m.y -= (0.00046 + trb * 0.0013) * velBoost * (1.25 - m.z * 0.5);
    m.x += Math.sin(now * 0.0012 * driftScale + m.phase) * 0.0003 * driftScale;
    if (m.y < -0.03) {
      m.y = 1.03;
      m.x = Math.random();
    }

    const px = panel.x + m.x * panel.w + mouseX * (1 - m.z) * 16;
    const py = panel.y + m.y * panel.h + mouseY * (1 - m.z) * 16;
    const twinkle = 0.65 + 0.35 * Math.sin(now * 0.005 + m.phase);
    const alpha = Math.min(
      0.95,
      m.alpha * twinkle * blend * (0.52 + trb * 1.45 + chorus * 0.65 + dsp.beatPulse * 0.35)
    );
    const r = m.size * (1.35 - m.z * 0.5) * (1 + dsp.beatPulse * 0.4);

    ctx.fillStyle =
      i % 2 === 0
        ? `rgba(${themePalette.peakRgb}, ${alpha.toFixed(3)})`
        : `rgba(${themePalette.secondaryRgb}, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// --- SCENE 2: 'EDM' (Electronic / Dance — 3D Wireframe, Halftone Matrix, Beat Flashes) ---
function drawEdmScene(blend) {
  if (blend <= 0.01) return;

  const { ctx } = dom;
  const { fx, backdrop, mouseX, mouseY } = animState;
  const { projectedCubePts } = particles;
  const sub = dsp.smoothSub;
  const mid = dsp.smoothMid;
  const trb = dsp.smoothTreble;
  const chorus = dsp.chorusIntensity;

  ctx.save();

  if (fx.glitchIntensity > 0.06) {
    const intensity = fx.glitchIntensity * blend;
    for (let s = 0; s < CONFIG.GLITCH_SLICE_COUNT; s++) {
      const hash = Math.sin(fx.glitchSeed + s * 73.17) * 0.5 + 0.5;
      const sliceYNorm = hash * 0.84 + 0.08;
      const sliceHNorm = 0.013 + ((s * 19) % 6) * 0.008;
      const shiftPx = (s % 2 === 0 ? 1 : -1) * (18 + hash * 42) * intensity;
      const dy = panel.y + sliceYNorm * panel.h;
      const dh = sliceHNorm * panel.h;

      ctx.save();
      if (trackState.hasAlbumBackdrop && backdrop.albumVisibility > 0.3) {
        ctx.globalAlpha = Math.min(0.9, intensity * 1.1) * backdrop.albumVisibility;
        ctx.drawImage(
          buffers.currAlbumBackdropCanvas,
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
      ctx.fillStyle = `rgba(${themePalette.primaryRgb}, ${(0.48 * intensity).toFixed(3)})`;
      ctx.fillRect(panel.x, dy, panel.w, 1.5);
      ctx.restore();
    }
  }

  if (buffers.halftonePattern) {
    ctx.save();
    ctx.globalAlpha = blend * (0.28 + trb * 0.42 + fx.edmFlash * 0.3);
    ctx.fillStyle = buffers.halftonePattern;
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    ctx.restore();
  }

  if (fx.edmFlash > 0.01) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgba(${themePalette.primaryRgb}, ${(fx.edmFlash * blend).toFixed(3)})`;
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    ctx.restore();
  }

  const rotSpeed =
    (0.007 + mid * 0.028 + dsp.kickPulse * 0.034 + dsp.snarePulse * 0.02) *
    (1 + chorus * 0.85) *
    getDriftSpeedScale(animState.motionIntensity);
  fx.cubeRotX += rotSpeed * 0.74;
  fx.cubeRotY += rotSpeed * 1.08;
  fx.cubeRotZ += rotSpeed * 0.44;

  const cubeCx = panel.cx + panel.w * 0.22 + mouseX * CONFIG.PARALLAX_MID;
  const cubeCy = panel.cy + panel.h * 0.01 + mouseY * CONFIG.PARALLAX_MID;
  const cubeRadius = Math.min(panel.w, panel.h) * 0.22 * fx.cubeScale * (1 + sub * 0.16);
  const fov = 3.2;

  const cosX = Math.cos(fx.cubeRotX + mouseY * 0.32);
  const sinX = Math.sin(fx.cubeRotX + mouseY * 0.32);
  const cosY = Math.cos(fx.cubeRotY + mouseX * 0.32);
  const sinY = Math.sin(fx.cubeRotY + mouseX * 0.32);
  const cosZ = Math.cos(fx.cubeRotZ);
  const sinZ = Math.sin(fx.cubeRotZ);

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
  ctx.shadowBlur = 16 + dsp.beatPulse * 16;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = `rgba(${themePalette.primaryRgb}, ${(0.84 * blend).toFixed(3)})`;

  ctx.beginPath();
  for (let e = 0; e < CUBE_EDGES.length; e++) {
    const p1 = projectedCubePts[CUBE_EDGES[e][0]];
    const p2 = projectedCubePts[CUBE_EDGES[e][1]];
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  }
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = `rgba(${themePalette.peakRgb}, ${(0.92 * blend).toFixed(3)})`;
  for (let i = 0; i < 8; i++) {
    const pt = projectedCubePts[i];
    const sz = Math.max(2.5, 4.4 * pt.scale);
    ctx.fillRect(pt.x - sz * 0.5, pt.y - sz * 0.5, sz, sz);
  }

  ctx.restore();
}

// --- SCENE 3: 'HIPHOP' (Trap / R&B — Smoked Vignette, Sub-Bass Shockwaves, Liquid Bass Rings) ---
function drawHiphopScene(now, blend) {
  if (blend <= 0.01) return;

  const { ctx } = dom;
  const { mouseX, mouseY } = animState;
  const sub = dsp.smoothSub;
  const bass = dsp.smoothBass;

  ctx.save();

  // Deep dramatic smoked-glass perimeter vignette
  const radVignette = ctx.createRadialGradient(
    panel.cx,
    panel.cy,
    Math.min(panel.w, panel.h) * 0.22,
    panel.cx,
    panel.cy,
    Math.max(panel.w, panel.h) * 0.72
  );
  radVignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  radVignette.addColorStop(1, `rgba(3, 3, 6, ${(0.58 * blend).toFixed(3)})`);
  ctx.fillStyle = radVignette;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);

  // Deforming Liquid 808 Bass Rings
  ctx.globalCompositeOperation = 'screen';
  const ringCx = panel.cx + panel.w * 0.22 + mouseX * CONFIG.PARALLAX_MID;
  const ringCy = panel.cy + panel.h * 0.01 + mouseY * CONFIG.PARALLAX_MID;
  const baseR = Math.min(panel.w, panel.h) * (0.19 + sub * 0.16 + dsp.kickPulse * 0.08);

  for (let r = 0; r < 3; r++) {
    const ringRadius = baseR * (0.82 + r * 0.28);
    const wobbles = 5 + r * 2;
    const deformAmp = ringRadius * (0.04 + sub * 0.12 + bass * 0.08);

    ctx.beginPath();
    const steps = 72;
    for (let s = 0; s <= steps; s++) {
      const ang = (s / steps) * Math.PI * 2;
      const liquid =
        Math.sin(ang * wobbles + now * 0.004 * (r % 2 === 0 ? 1 : -1)) * deformAmp +
        Math.cos(ang * 3 - now * 0.003) * deformAmp * 0.6;
      const rad = ringRadius + liquid;
      const px = ringCx + Math.cos(ang) * rad;
      const py = ringCy + Math.sin(ang) * rad;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }

    ctx.lineWidth = r === 0 ? 2.2 : 1.2;
    const alpha = blend * (0.62 - r * 0.16) * (0.4 + sub * 0.9);
    ctx.strokeStyle =
      r === 0
        ? `rgba(${themePalette.primaryRgb}, ${alpha.toFixed(3)})`
        : `rgba(${themePalette.peakRgb}, ${(alpha * 0.75).toFixed(3)})`;
    ctx.stroke();
  }

  ctx.restore();
}

// --- SCENE 4: 'SLOW' (Ballad / Sad / Rain — Restrained 30% Particle Density & Half Drift Speed) ---
function drawSlowScene(now, blend) {
  if (blend <= 0.01) return;

  const { ctx } = dom;
  const { mouseX, mouseY, motionIntensity: mi } = animState;
  const { bokehOrbs, raindrops } = particles;
  const sub = dsp.smoothSub;
  const mid = dsp.smoothMid;
  const densityScale = getParticleDensityScale(mi); // 0.30 (30% of particles) in SLOW/AMBIENT
  const driftScale = getDriftSpeedScale(mi);       // 0.50 (half drift speed) in SLOW/AMBIENT
  const waveScale = getWaveAndRippleScale(mi);
  const midShiftX = mouseX * CONFIG.PARALLAX_MID * 0.75;
  const midShiftY = mouseY * CONFIG.PARALLAX_MID * 0.75;

  const activeBokehCount = Math.max(1, Math.round(bokehOrbs.length * densityScale));
  const activeRainCount = Math.max(1, Math.round(raindrops.length * densityScale));

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < activeBokehCount; i++) {
    const b = bokehOrbs[i];
    b.x += b.vx * driftScale * (1 + mid * 0.65);
    b.y += b.vy * driftScale * (1 + mid * 0.65);
    if (b.x < -0.1) b.x = 1.1;
    if (b.x > 1.1) b.x = -0.1;
    if (b.y < -0.1) b.y = 1.1;
    if (b.y > 1.1) b.y = -0.1;

    const pulse =
      1 +
      (sub * 0.34 + dsp.kickPulse * 0.14) * waveScale +
      0.06 * Math.sin(now * 0.0011 + b.phase);
    const r = b.baseR * pulse;
    const bx = panel.x + b.x * panel.w - mouseX * 8;
    const by = panel.y + b.y * panel.h - mouseY * 8;
    const alpha = Math.min(0.36, b.alpha * blend * (0.78 + (sub * 1.4 + mid * 0.45) * waveScale));

    const rgb =
      b.hueType === 0
        ? themePalette.primaryRgb
        : b.hueType === 1
          ? themePalette.secondaryRgb
          : themePalette.peakRgb;

    const grad = ctx.createRadialGradient(bx, by, r * 0.15, bx, by, r);
    grad.addColorStop(0, `rgba(${rgb}, ${(alpha * 0.65).toFixed(3)})`);
    grad.addColorStop(0.76, `rgba(${rgb}, ${(alpha * 0.94).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < activeRainCount; i++) {
    const drop = raindrops[i];
    if (drop.pauseTimer > 0) {
      drop.pauseTimer -= (1 + sub * 1.1) * driftScale;
      drop.y += drop.speed * 0.1 * driftScale;
    } else {
      const speedMult = driftScale * (1 + (mid * 0.75 + sub * 0.55) * waveScale);
      drop.y += drop.speed * speedMult;
      drop.x += Math.sin(now * 0.0014 + drop.wobblePhase + drop.y * 16) * 0.00018 * driftScale;
      if (Math.random() < 0.006) drop.pauseTimer = 25 + Math.random() * 60;
    }

    if (drop.y - drop.trailLen > 1.04) {
      drop.y = -0.04 - Math.random() * 0.15;
      drop.x = 0.03 + Math.random() * 0.94;
      drop.pauseTimer = Math.random() * 40;
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
    ctx.lineWidth = Math.max(1, drop.radius * 0.68);
    ctx.strokeStyle = trailGrad;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(dx, dy, drop.radius * 0.85, drop.radius * 1.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(8, 8, 12, ${(0.44 * blend).toFixed(3)})`;
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = `rgba(${themePalette.secondaryRgb}, ${(0.42 * blend).toFixed(3)})`;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(dx - drop.radius * 0.25, dy - drop.radius * 0.3, Math.max(0.7, drop.radius * 0.32), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${themePalette.peakRgb}, ${(0.76 * blend).toFixed(3)})`;
    ctx.fill();
  }

  ctx.restore();
}

// --- SCENE 5: 'ACOUSTIC' (Indie / Folk / Warm — Sunlit Prism Flare & Multi-Strand Silk Wave) ---
function drawAcousticScene(now, blend) {
  if (blend <= 0.01) return;

  const { ctx } = dom;
  const { mouseX, mouseY } = animState;
  const mid = dsp.smoothMid;
  const sub = dsp.smoothSub;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  // Sunlit Anamorphic Prism Lens Flare axis
  const sunX = panel.x + panel.w * 0.18 - mouseX * 14;
  const sunY = panel.y + panel.h * 0.18 - mouseY * 14;
  const sunR = Math.min(panel.w, panel.h) * (0.34 + mid * 0.16 + sub * 0.1);

  const sunGlow = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, sunR);
  sunGlow.addColorStop(0, `rgba(${themePalette.peakRgb}, ${(0.36 * blend * (0.8 + mid)).toFixed(3)})`);
  sunGlow.addColorStop(0.4, `rgba(${themePalette.secondaryRgb}, ${(0.2 * blend).toFixed(3)})`);
  sunGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = sunGlow;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
  ctx.fill();

  // Diagonal prism flare iris ghosts
  for (let f = 1; f <= 5; f++) {
    const t = f / 5;
    const fxX = sunX + (panel.cx + panel.w * 0.25 - sunX) * t * 1.25 + mouseX * t * 18;
    const fxY = sunY + (panel.cy + panel.h * 0.22 - sunY) * t * 1.25 + mouseY * t * 18;
    const fr = (14 + f * 12) * (1 + mid * 0.35 + dsp.snarePulse * 0.2);
    const rgb = f % 2 === 0 ? themePalette.peakRgb : themePalette.primaryRgb;

    ctx.beginPath();
    ctx.arc(fxX, fxY, fr, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${rgb}, ${(0.075 * blend * (1 + mid)).toFixed(3)})`;
    ctx.fill();
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = `rgba(${themePalette.peakRgb}, ${(0.14 * blend).toFixed(3)})`;
    ctx.stroke();
  }

  // Organic 4-Strand Acoustic Silk Wave
  drawHarmonicSilkRibbons(now, blend, 4, 0.14, 0.04);

  ctx.restore();
}

// --- SCENE 6: 'AMBIENT' (Lo-Fi / Instrumental / Chill — Serene Half-Speed Aurora & Zen Orbital Rings) ---
function drawAmbientScene(now, blend) {
  if (blend <= 0.01) return;

  const { ctx } = dom;
  const { fx, mouseX, mouseY, motionIntensity: mi } = animState;
  const driftScale = getDriftSpeedScale(mi); // 0.50 half drift speed in AMBIENT
  const waveScale = getWaveAndRippleScale(mi);
  const sub = dsp.smoothSub;
  const mid = dsp.smoothMid;
  const trb = dsp.smoothTreble;

  fx.orbitPhase += (0.002 + mid * 0.003 * waveScale) * driftScale;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  // Ensure flowing aurora wash even when blurred album art is active
  if (animState.backdrop.albumVisibility > 0.2) {
    drawProceduralAuroraBackdrop(now, blend * 0.32);
  }

  // Slow Zen Gyroscopic Orbital Rings + Optional AmbientDust (30% density at half speed)
  const { dustMotes } = particles;
  const activeAmbientMotes = Math.max(1, Math.round(dustMotes.length * getParticleDensityScale(mi)));
  for (let i = 0; i < activeAmbientMotes; i++) {
    const m = dustMotes[i];
    m.y -= 0.00024 * driftScale * (1.2 - m.z * 0.4);
    m.x += Math.sin(now * 0.0007 * driftScale + m.phase) * 0.00018 * driftScale;
    if (m.y < -0.03) {
      m.y = 1.03;
      m.x = Math.random();
    }
    const px = panel.x + m.x * panel.w + mouseX * (1 - m.z) * 10;
    const py = panel.y + m.y * panel.h + mouseY * (1 - m.z) * 10;
    const alpha = m.alpha * 0.34 * blend;
    ctx.fillStyle = `rgba(${themePalette.peakRgb}, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(px, py, m.size * 0.85, 0, Math.PI * 2);
    ctx.fill();
  }

  const zenCx = panel.cx + panel.w * 0.22 + mouseX * CONFIG.PARALLAX_MID;
  const zenCy = panel.cy + panel.h * 0.01 + mouseY * CONFIG.PARALLAX_MID;
  const baseR = Math.min(panel.w, panel.h) * (0.21 + sub * 0.05 * waveScale);

  for (let o = 0; o < 3; o++) {
    const r = baseR * (0.78 + o * 0.24);
    const tilt = 0.38 + o * 0.16;
    const rot = fx.orbitPhase * (o % 2 === 0 ? 1 : -0.75) + o * 1.05;

    ctx.beginPath();
    ctx.ellipse(zenCx, zenCy, r, r * tilt, rot, 0, Math.PI * 2);
    ctx.lineWidth = o === 0 ? 1.5 : 0.95;
    ctx.strokeStyle = `rgba(${o === 0 ? themePalette.peakRgb : themePalette.secondaryRgb}, ${(blend * (0.24 + trb * 0.28 * waveScale)).toFixed(3)})`;
    ctx.stroke();
  }

  ctx.restore();
}

export function drawActiveVibeScenes(now) {
  const b = animState.vibeBlends;
  drawAnthemScene(now, b.ANTHEM);
  drawEdmScene(b.EDM);
  drawHiphopScene(now, b.HIPHOP);
  drawSlowScene(now, b.SLOW);
  drawAcousticScene(now, b.ACOUSTIC);
  drawAmbientScene(now, b.AMBIENT);
}

// ============================================================================
// 4. LIVE TRACK TITLE & ARTIST EDITORIAL POSTER + TIMEPIECE
// ============================================================================

function drawSpacedArtistLine(ctx, text, x, y, spacingPx) {
  if (!text) return;
  let cursor = x;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + spacingPx;
  }
}

export function drawEditorialPosterAndCornerClock(now, alpha, drawAlbumCardCallback) {
  if (!animState.fontsReady || alpha <= 0.01) return;

  const { ctx } = dom;
  const { poster, fx, backdrop, mouseX, mouseY } = animState;
  const { eqBinIndices, eqBarPeaks } = particles;
  const fgX = mouseX * CONFIG.PARALLAX_FG + fx.shakeX * 0.25;
  const fgY = mouseY * CONFIG.PARALLAX_FG + fx.shakeY * 0.25;
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

  // --- FLOATING RIGHT-SIDE ALBUM CARD + RADIAL AURA + HOVER CONTROLS ---
  if (typeof drawAlbumCardCallback === 'function') {
    drawAlbumCardCallback(alpha);
  }

  // --- LOWER-LEFT EDITORIAL LIVE TRACK TITLE & ARTIST ---
  const lyricsVisible = lyricsState.hasSynced && lyricsState.blockAlpha > 0.08;
  const leftMargin = panel.x + Math.max(48, panel.w * 0.06) + fgX;
  const posterBaseY =
    panel.y +
    panel.h -
    Math.max(lyricsVisible ? 108 : 120, panel.h * (lyricsVisible ? 0.168 : 0.185)) +
    fgY;

  // Reserve clean right-side clearance so long titles never collide with the Album Card
  const hasCardVisible = trackState.albumImg && panel.w >= 680;
  const maxTitleWidth = hasCardVisible ? panel.w * 0.46 : panel.w * 0.76;

  const rawTitle =
    trackState.connected && trackState.trackName
      ? trackState.trackName
      : dsp.isAudioActive
        ? 'LIVE AUDIO STREAM'
        : 'SONICGLASS A1';

  const rawArtist =
    trackState.connected && trackState.artistName
      ? trackState.artistName
      : dsp.isAudioActive
        ? `${effectiveVibe} ENGINE · SYSTEM AUDIO`
        : 'CONNECT SPOTIFY OR SYSTEM AUDIO';

  // Adaptive headline font sizing (leaves generous upper clearance when 3-line lyrics are visible)
  const baseScale = rawTitle.length > 26 ? 0.044 : rawTitle.length > 15 ? 0.055 : 0.066;
  const maxHeadlineCap = lyricsVisible ? 68 : 82;
  const headlinePx = Math.round(
    Math.max(26, Math.min(panel.w * baseScale, panel.h * (lyricsVisible ? 0.108 : 0.13), maxHeadlineCap))
  );

  ctx.save();
  ctx.font = `700 ${headlinePx}px "Space Grotesk", sans-serif`;
  const wrappedLines = wrapTitleTwoLines(ctx, rawTitle, maxTitleWidth);
  const lineHeight = headlinePx * 1.02;
  const waveScale = getWaveAndRippleScale(animState.motionIntensity);
  const ambientDriftY = Math.sin(now * 0.0012) * (2.2 * Math.min(1, waveScale + 0.3));

  // Render floating 3-line SonicGlass Holographic Lyrics window cleanly above the Track Title
  const titleTopY =
    posterBaseY -
    28 -
    (wrappedLines.length > 1 ? lineHeight + headlinePx * 0.95 : headlinePx * 0.95);
  drawHolographicLyrics(alpha, titleTopY);

  ctx.translate(leftMargin, posterBaseY + ambientDriftY);
  if (poster.scalePunch !== 1 || poster.skewX !== 0) {
    ctx.transform(
      poster.scalePunch,
      0,
      poster.skewX * poster.scalePunch,
      poster.scalePunch,
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

  // Render 1 or 2 wrapped Track Title lines on top
  if (wrappedLines.length === 1) {
    ctx.save();
    ctx.globalAlpha *= poster.line1Alpha;
    ctx.fillStyle = '#fff8f2';
    ctx.fillText(wrappedLines[0], 0, -28 + poster.line1Y);
    if (dsp.beatPulse > 0.25) {
      ctx.shadowColor = themePalette.primaryHex;
      ctx.shadowBlur = 16 + dsp.beatPulse * 18;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillText(wrappedLines[0], 0, -28 + poster.line1Y);
    }
    ctx.restore();
  } else {
    ctx.save();
    ctx.globalAlpha *= poster.line1Alpha;
    ctx.fillStyle = '#fff8f2';
    ctx.fillText(wrappedLines[0], 0, -28 - lineHeight + poster.line1Y);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha *= poster.line2Alpha;
    ctx.fillStyle = `rgb(${themePalette.peakRgb})`;
    ctx.fillText(wrappedLines[1], 0, -28 + poster.line2Y);
    if (dsp.beatPulse > 0.25) {
      ctx.shadowColor = themePalette.primaryHex;
      ctx.shadowBlur = 16 + dsp.beatPulse * 18;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillText(wrappedLines[1], 0, -28 + poster.line2Y);
    }
    ctx.restore();
  }

  // Render Artist Name directly underneath in clean spaced-out typography
  ctx.save();
  ctx.globalAlpha *= poster.artistAlpha;
  const artistPx = Math.max(12, Math.min(16, Math.round(headlinePx * 0.24)));
  ctx.font = `500 ${artistPx}px "Space Grotesk", "Space Mono", sans-serif`;
  ctx.fillStyle = themePalette.primaryHex;
  const truncatedArtist = truncateTextToWidth(ctx, rawArtist, maxTitleWidth * 0.82);
  drawSpacedArtistLine(ctx, truncatedArtist, 2, -2 + poster.artistY, 2.4);
  ctx.restore();

  // Expressive 48-Bar Album-Tinted Spectrum Equalizer Strip (softened in SLOW/AMBIENT)
  const eqTotalW = Math.min(maxTitleWidth * 0.92, 420) * poster.ruleProgress;
  const eqBaseY = 28;
  const maxBarH = 22 * (0.45 + 0.55 * Math.min(1.15, waveScale));
  const stepX = eqTotalW / CONFIG.EQ_BAR_COUNT;
  const barW = Math.max(2, stepX * 0.62);

  ctx.shadowBlur = 0;
  ctx.fillStyle = `rgba(${themePalette.peakRgb}, 0.18)`;
  ctx.fillRect(0, eqBaseY, eqTotalW, 1);

  for (let i = 0; i < CONFIG.EQ_BAR_COUNT; i++) {
    let val = 0.05;
    if (dsp.isAudioActive && dsp.freqData) {
      val = shapeBand(dsp.freqData[eqBinIndices[i]] / 255, dsp.agcGain * 0.95);
    } else {
      val = 0.05 + 0.03 * Math.sin(now * 0.0026 + i * 0.3);
    }

    if (val > eqBarPeaks[i]) eqBarPeaks[i] = val;
    else eqBarPeaks[i] *= 0.94;

    const bh = Math.max(1.5, val * maxBarH);
    const bx = i * stepX;

    ctx.fillStyle =
      val > 0.72
        ? `rgba(${themePalette.peakRgb}, 0.95)`
        : `rgba(${themePalette.primaryRgb}, ${(0.42 + val * 0.58).toFixed(3)})`;
    ctx.fillRect(bx, eqBaseY - bh, barW, bh);

    if (dsp.isAudioActive && eqBarPeaks[i] > 0.15) {
      ctx.fillStyle = `rgba(${themePalette.peakRgb}, 0.78)`;
      ctx.fillRect(bx, eqBaseY - eqBarPeaks[i] * maxBarH - 2, barW, 1.5);
    }
  }

  // Acoustic Telemetry Footnote
  ctx.font = '400 11px "Space Mono", monospace';
  ctx.fillStyle = `rgba(${themePalette.peakRgb}, 0.8)`;
  const bpmText = dsp.rollingBpm > 42 ? `${Math.round(dsp.rollingBpm)} BPM` : 'SYNC BPM';
  const hzText =
    dsp.dominantHz > 25 ? `${dsp.dominantNote} (${Math.round(dsp.dominantHz)} HZ)` : 'STANDBY';
  const backdropSource =
    backdrop.albumVisibility > 0.5 ? 'ALBUM CANVAS' : 'AURORA MESH';
  const lrcTag = lyricsState.hasSynced ? '  ·  LRC SYNC' : '';
  ctx.fillText(
    `${bpmText}  ·  ${hzText}  ·  ${effectiveVibe}  ·  ${backdropSource}${lrcTag}`,
    0,
    eqBaseY + 17
  );

  ctx.restore();
  ctx.restore();
}

export function renderGalleryTimepieceForeground(alpha) {
  if (!animState.fontsReady || alpha <= 0.01) return;

  const { ctx } = dom;
  const { mouseX, mouseY } = animState;
  const { hh, mm, ss, dateStr } = getFormattedClock();
  const fgX = panel.cx + mouseX * CONFIG.PARALLAX_FG;
  const fgY = panel.cy + mouseY * CONFIG.PARALLAX_FG;
  const digitSize = Math.round(
    Math.min(panel.w * 0.165, panel.h * 0.3, 156) * (1 + dsp.smoothSub * 0.028)
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
    trackState.connected && trackState.trackName
      ? truncateTextToWidth(ctx, `${trackState.artistName} — ${trackState.trackName}`, panel.w * 0.54)
      : dsp.isAudioActive
        ? `${getEffectiveVibe()} · ${dsp.db.toFixed(0)} dB`
        : 'AURORA STANDBY';
  ctx.fillText(`${dateStr}   //   :${ss}   //   ${trackSub}`, fgX, fgY + digitSize * 0.56);

  ctx.restore();
}
