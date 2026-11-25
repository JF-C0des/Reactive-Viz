/**
 * js/hud.js
 * Glass bezel cache, Chamfered Album Art Card with GSAP 3D Transition, Beat-Reactive Radial
 * Frequency Aura, Optional Auto-Fading Spotify Playback Controls (PREV, PLAY/PAUSE, NEXT),
 * Non-Overflowing Top-Left Telemetry HUD, Mode Switcher Pills, and CRT Film Grain.
 */

import {
  CONFIG,
  VIBES,
  gsapApi,
  dom,
  buffers,
  themePalette,
  trackState,
  panel,
  dsp,
  animState,
  particles,
  hitRegions,
  shapeBand,
  roundedRectPath,
  chamferedRectPath,
  truncateTextToWidth,
  getWaveAndRippleScale,
  getEffectiveVibe,
  applyVibeVisualBlend,
  triggerTrackTitleEntrance,
} from './state.js';
import {
  startSpotifyPkceAuth,
  clearSpotifySession,
  controlSpotifyPlayback,
} from './spotify.js';

export function buildHudAssets() {
  const { noiseCanvas, noiseCtx } = buffers;
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
  buffers.noisePattern = dom.ctx.createPattern(noiseCanvas, 'repeat');
}

export function computePanelGeometry() {
  const { viewportWidth, viewportHeight } = panel;

  if (animState.showGlassFrame && viewportWidth > 560 && viewportHeight > 380) {
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

export function buildGlassEnclosureCache() {
  const { glassCanvas, glassCtx } = buffers;
  const { viewportWidth, viewportHeight, dpr, x, y, w, h, radius } = panel;

  glassCanvas.width = dom.canvas.width;
  glassCanvas.height = dom.canvas.height;

  glassCtx.save();
  glassCtx.scale(dpr, dpr);
  glassCtx.clearRect(0, 0, viewportWidth, viewportHeight);

  glassCtx.save();
  if (animState.showGlassFrame && radius > 0) {
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

  if (animState.showGlassFrame && radius > 0) {
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

export function handleResize() {
  panel.dpr = Math.min(window.devicePixelRatio || 1, 2);
  panel.viewportWidth = window.innerWidth;
  panel.viewportHeight = window.innerHeight;

  dom.canvas.width = Math.floor(panel.viewportWidth * panel.dpr);
  dom.canvas.height = Math.floor(panel.viewportHeight * panel.dpr);
  dom.ctx.setTransform(panel.dpr, 0, 0, panel.dpr, 0, 0);

  dom.ctx.fillStyle = CONFIG.BG_HEX;
  dom.ctx.fillRect(0, 0, panel.viewportWidth, panel.viewportHeight);

  computePanelGeometry();
  buildGlassEnclosureCache();
}

// ============================================================================
// CHAMFERED ALBUM ART CARD, RADIAL FREQUENCY AURA & HOVER PLAYBACK CONTROLS
// ============================================================================

export function drawFramedGlassAlbumCard(modeAlpha) {
  const { backdrop, fx, mouseX, mouseY, hudHoverId } = animState;
  if (backdrop.cardAlpha <= 0.01 || !trackState.albumImg || panel.w < 680) {
    return;
  }

  const alpha = backdrop.cardAlpha * modeAlpha;
  if (alpha <= 0.01) return;

  const { ctx } = dom;
  const { haloBinIndices, haloSmoothed } = particles;

  const cardShiftX =
    mouseX * CONFIG.PARALLAX_CARD + fx.shakeX * 0.25 + backdrop.cardSlideX;
  const cardShiftY = mouseY * CONFIG.PARALLAX_CARD + fx.shakeY * 0.25;

  const enterScale = 0.88 + 0.12 * backdrop.cardEnterProgress;
  const waveScale = getWaveAndRippleScale(animState.motionIntensity);
  const cardSize = Math.round(
    Math.min(panel.w * 0.215, panel.h * 0.37, 234) *
      enterScale *
      (1 + (dsp.smoothSub * 0.026 + dsp.kickPulse * 0.02) * waveScale)
  );
  const cx = panel.cx + panel.w * 0.22 + cardShiftX;
  const cy = panel.cy + panel.h * 0.01 + cardShiftY;
  const pad = 9;
  const outerHalf = cardSize * 0.5 + pad;

  ctx.save();
  ctx.globalAlpha *= alpha;

  // --- 1. BEAT-REACTIVE RADIAL FREQUENCY AURA / HALO AROUND ALBUM CARD ---
  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  const auraRadius =
    outerHalf * (1.38 + (dsp.smoothSub * 0.34 + dsp.beatPulse * 0.22) * waveScale);
  const auraGrad = ctx.createRadialGradient(cx, cy, outerHalf * 0.65, cx, cy, auraRadius);
  auraGrad.addColorStop(
    0,
    `rgba(${themePalette.primaryRgb}, ${(0.18 + (dsp.smoothSub * 0.32 + dsp.beatPulse * 0.24) * waveScale).toFixed(3)})`
  );
  auraGrad.addColorStop(
    0.55,
    `rgba(${themePalette.secondaryRgb}, ${(0.08 + dsp.smoothMid * 0.18 * waveScale).toFixed(3)})`
  );
  auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = auraGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, auraRadius, 0, Math.PI * 2);
  ctx.fill();

  // 64-spoke polar spectral halo radiating around the chamfered card perimeter (vibe-calibrated)
  const bins = CONFIG.HALO_BINS;
  const innerHaloR = outerHalf * 1.06;
  const maxSpike = outerHalf * (0.28 + dsp.chorusIntensity * 0.18) * waveScale;

  ctx.lineWidth = 1.6;
  for (let i = 0; i < bins; i++) {
    let targetVal = 0.04;
    if (dsp.isAudioActive && dsp.freqData) {
      targetVal = shapeBand(dsp.freqData[haloBinIndices[i]] / 255, dsp.agcGain * 0.92);
    }
    haloSmoothed[i] += (targetVal - haloSmoothed[i]) * 0.38;

    const val = haloSmoothed[i];
    if (val < 0.03) continue;

    const ang = (i / bins) * Math.PI * 2 - Math.PI * 0.5;
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    const len = val * maxSpike;

    ctx.strokeStyle =
      val > 0.68
        ? `rgba(${themePalette.peakRgb}, ${(0.55 + val * 0.4).toFixed(3)})`
        : `rgba(${themePalette.primaryRgb}, ${(0.22 + val * 0.62).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(cx + cosA * innerHaloR, cy + sinA * innerHaloR);
    ctx.lineTo(cx + cosA * (innerHaloR + len), cy + sinA * (innerHaloR + len));
    ctx.stroke();
  }
  ctx.restore();

  // --- 2. CHAMFERED GLASS ALBUM CARD WITH GSAP 3D TILT & CROSSFADE ---
  ctx.save();
  ctx.translate(cx, cy);
  if (backdrop.cardTilt !== 0) {
    ctx.transform(1, backdrop.cardTilt * 0.35, -backdrop.cardTilt, 1, 0, 0);
  }

  const x = -cardSize * 0.5;
  const y = -cardSize * 0.5;

  // Smoked-glass chamfered outer frame + physical shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.86)';
  ctx.shadowBlur = 32;
  ctx.shadowOffsetX = -mouseX * 8;
  ctx.shadowOffsetY = 12 - mouseY * 6;
  chamferedRectPath(ctx, x - pad, y - pad, cardSize + pad * 2, cardSize + pad * 2, 13);
  ctx.fillStyle = 'rgba(12, 11, 16, 0.68)';
  ctx.fill();
  ctx.restore();

  // Bass-reactive chamfered rim glow
  ctx.save();
  ctx.shadowColor = themePalette.primaryHex;
  ctx.shadowBlur = 8 + dsp.smoothSub * 18 + dsp.beatPulse * 12;
  chamferedRectPath(ctx, x - pad, y - pad, cardSize + pad * 2, cardSize + pad * 2, 13);
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = `rgba(${themePalette.primaryRgb}, ${(0.46 + dsp.smoothSub * 0.42).toFixed(3)})`;
  ctx.stroke();
  ctx.restore();

  // Clipped Album Artwork (crossfades cleanly from prevAlbumImg on track change)
  ctx.save();
  chamferedRectPath(ctx, x, y, cardSize, cardSize, 8);
  ctx.clip();
  if (backdrop.cardEnterProgress < 0.99 && trackState.prevAlbumImg) {
    ctx.drawImage(trackState.prevAlbumImg, x, y, cardSize, cardSize);
    ctx.globalAlpha *= backdrop.cardEnterProgress;
  }
  ctx.drawImage(trackState.albumImg, x, y, cardSize, cardSize);

  const gloss = ctx.createLinearGradient(x, y, x + cardSize, y + cardSize);
  gloss.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
  gloss.addColorStop(0.35, 'rgba(255, 255, 255, 0.02)');
  gloss.addColorStop(0.6, 'rgba(0, 0, 0, 0)');
  gloss.addColorStop(1, 'rgba(0, 0, 0, 0.24)');
  ctx.fillStyle = gloss;
  ctx.fillRect(x, y, cardSize, cardSize);
  ctx.restore();

  chamferedRectPath(ctx, x, y, cardSize, cardSize, 8);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.stroke();

  ctx.restore();

  // --- 3. OPTIONAL AUTO-FADING HOVER SPOTIFY PLAYBACK CONTROLS (PREV, PLAY/PAUSE, NEXT) ---
  const cardZoneDistX = Math.abs(animState.pointerX - cx);
  const cardZoneDistY = Math.abs(animState.pointerY - (cy + outerHalf * 0.35));
  const pointerNearCard =
    animState.pointerInside &&
    cardZoneDistX < outerHalf + 46 &&
    cardZoneDistY < outerHalf + 64;

  const targetCtrlAlpha = trackState.connected && pointerNearCard ? 0.96 : 0;
  backdrop.cardControlsAlpha += (targetCtrlAlpha - backdrop.cardControlsAlpha) * 0.16;

  if (backdrop.cardControlsAlpha > 0.02 && animState.fontsReady) {
    const ctrlY = cy + outerHalf + 24;
    const btnW = 46;
    const btnH = 24;
    const gap = 8;
    const controls = [
      { id: 'sp-prev', label: 'PREV', cx: cx - btnW - gap },
      { id: 'sp-toggle', label: trackState.isPlaying ? 'PAUSE' : 'PLAY', cx },
      { id: 'sp-next', label: 'NEXT', cx: cx + btnW + gap },
    ];

    ctx.save();
    ctx.globalAlpha *= backdrop.cardControlsAlpha;
    ctx.font = '700 10px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < controls.length; i++) {
      const btn = controls[i];
      const bx = btn.cx - btnW * 0.5;
      const by = ctrlY - btnH * 0.5;
      const hovered = hudHoverId === btn.id;

      roundedRectPath(ctx, bx, by, btnW, btnH, 12);
      ctx.fillStyle = hovered
        ? `rgba(${themePalette.primaryRgb}, 0.88)`
        : 'rgba(10, 9, 14, 0.82)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${themePalette.primaryRgb}, ${hovered ? 0.95 : 0.45})`;
      ctx.stroke();

      ctx.fillStyle = hovered ? '#050507' : `rgba(${themePalette.peakRgb}, 0.95)`;
      ctx.fillText(btn.label, btn.cx, ctrlY + 0.5);

      hitRegions.push({ id: btn.id, x: bx, y: by, w: btnW, h: btnH });
    }
    ctx.restore();
  } else if (animState.fontsReady && trackState.albumName) {
    // Subtle album caption when hover controls are faded out
    ctx.save();
    ctx.globalAlpha *= 1 - backdrop.cardControlsAlpha;
    ctx.font = '10px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = `rgba(${themePalette.peakRgb}, 0.72)`;
    ctx.fillText(
      truncateTextToWidth(ctx, trackState.albumName, cardSize + 18),
      cx,
      cy + outerHalf + 8
    );
    ctx.restore();
  }

  ctx.restore();
}

// ============================================================================
// TELEMETRY HUD (WITH SAFE TRUNCATION) & INTERACTIVE MODE / VIBE PILLS
// ============================================================================

export function drawHudAndControls(now) {
  // Clear hitRegions before frame controls register their bounds (note: card controls register earlier in frame, so reset at start of frame in main.js)
  if (!animState.fontsReady) return;

  const { ctx } = dom;
  const { mouseX, mouseY, poster, hudHoverId, lastPointerMove, showGlassFrame } = animState;
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

  // Beat-reactive LED
  const ledR = 3.5 + dsp.kickPulse * 2.0;
  ctx.fillStyle = dsp.isAudioActive
    ? themePalette.primaryHex
    : `rgba(${themePalette.secondaryRgb}, 0.6)`;
  ctx.beginPath();
  ctx.arc(padX + 4, topY, ledR, 0, Math.PI * 2);
  ctx.fill();

  const brandStr = 'MORNING BLUES // SONICGLASS A1';
  ctx.fillStyle = 'rgba(255, 240, 228, 0.92)';
  ctx.fillText(brandStr, padX + 15, topY);

  // Active Vibe Badge
  const badgeX = padX + 24 + ctx.measureText(brandStr).width;
  const modePrefix = animState.autoVibeEnabled ? 'AUTO' : 'LOCK';
  const vibeText = `${modePrefix}: ${effectiveVibe}`;
  const badgeW = ctx.measureText(vibeText).width + 14;
  const badgeH = 18;

  // Only draw badge if it won't collide with top-right clock (clock occupies ~165px on the right)
  if (badgeX + badgeW < rightEdge - 175) {
    roundedRectPath(ctx, badgeX, topY - badgeH * 0.5, badgeW, badgeH, 9);
    ctx.fillStyle = `rgba(${themePalette.primaryRgb}, ${(0.18 + poster.vibeBadgeGlow * 0.35).toFixed(3)})`;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${themePalette.primaryRgb}, ${(0.55 + poster.vibeBadgeGlow * 0.4).toFixed(3)})`;
    ctx.stroke();

    ctx.fillStyle = `rgba(${themePalette.peakRgb}, 0.96)`;
    ctx.fillText(vibeText, badgeX + 7, topY + 0.5);
  }

  // Strictly truncated Top-Left ARTIST // TRACK status line (prevents any collision with top-right clock)
  const maxHudLineWidth = Math.max(120, rightEdge - padX - 195);
  let rawSubTelemetry = animState.statusMessage;
  if (trackState.connected && trackState.trackName) {
    const playState = trackState.isPlaying ? 'SPOTIFY LIVE' : 'SPOTIFY PAUSED';
    rawSubTelemetry = `${playState} // ${trackState.artistName} — ${trackState.trackName}`;
  }
  const safeSubTelemetry = truncateTextToWidth(ctx, rawSubTelemetry, maxHudLineWidth);
  ctx.fillStyle = `rgba(${themePalette.secondaryRgb}, 0.8)`;
  ctx.fillText(safeSubTelemetry, padX + 15, topY + 19);

  // Bottom-Right Interactive Mode & Spotify Pills
  const idleAge = now - lastPointerMove;
  const controlsAlpha = idleAge > 4800 && !hudHoverId ? 0.48 : 0.95;
  const pillH = 22;
  let cursorRight = rightEdge;

  function drawPill(id, label, isActive, customAccentRgb = null) {
    const rgb = customAccentRgb || themePalette.primaryRgb;
    const w = ctx.measureText(label).width + 13;
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

    ctx.fillText(label, cursorRight + 6.5, bottomY + 0.5);
    if (isActive) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.88)';
      ctx.shadowBlur = 10;
    }

    hitRegions.push({ id, x: cursorRight, y: bottomY - pillH * 0.5, w, h: pillH });
    cursorRight -= 5;
  }

  drawPill('toggle-frame', showGlassFrame ? '[G] BEZEL' : '[G] FULL', false);
  drawPill(
    'spotify-auth',
    trackState.connected ? 'SPOTIFY ✓' : 'CONNECT SPOTIFY',
    trackState.connected,
    trackState.connected ? themePalette.primaryRgb : '29, 185, 84'
  );
  drawPill('toggle-clock', '[T] CLOCK', animState.clockMode);

  cursorRight -= 3;

  // Responsive Vibe Selector: individual 1-6 pills on wide panels, compact cycler on narrower panels
  if (panel.w >= 1180) {
    for (let i = VIBES.length - 1; i >= 0; i--) {
      const v = VIBES[i];
      const isSelected = !animState.autoVibeEnabled && animState.lockedVibeIndex === i;
      drawPill(`vibe-${i}`, `${v.code} ${v.label}`, isSelected);
      hitRegions[hitRegions.length - 1].vibeIndex = i;
    }
  } else {
    drawPill('cycle-vibe', `[1-6] ${effectiveVibe}`, !animState.autoVibeEnabled);
  }

  drawPill('auto-vibe', '[0] AUTO', animState.autoVibeEnabled);

  ctx.restore();
}

export function drawGlassBezelOverlay() {
  dom.ctx.drawImage(buffers.glassCanvas, 0, 0, panel.viewportWidth, panel.viewportHeight);
}

export function drawAnalogGrain() {
  if (!buffers.noisePattern) return;
  const { ctx } = dom;
  const offsetX = -((Math.random() * CONFIG.NOISE_SIZE) | 0);
  const offsetY = -((Math.random() * CONFIG.NOISE_SIZE) | 0);

  ctx.save();
  // Slightly warmer analog grain density when in ACOUSTIC vibe
  ctx.globalAlpha = 1 + animState.vibeBlends.ACOUSTIC * 0.45;
  ctx.translate(offsetX, offsetY);
  ctx.fillStyle = buffers.noisePattern;
  ctx.fillRect(
    -offsetX,
    -offsetY,
    panel.viewportWidth + CONFIG.NOISE_SIZE,
    panel.viewportHeight + CONFIG.NOISE_SIZE
  );
  ctx.restore();
}

// ============================================================================
// INTERACTION, PARALLAX & HIT-TESTING
// ============================================================================

export function updateParallaxState(now) {
  let tx = animState.targetMouseX;
  let ty = animState.targetMouseY;
  if (!animState.pointerInside && now - animState.lastPointerMove > 2500) {
    tx = Math.sin(now * 0.00046) * 0.18;
    ty = Math.cos(now * 0.00035) * 0.14;
  }
  animState.mouseX += (tx - animState.mouseX) * 0.08;
  animState.mouseY += (ty - animState.mouseY) * 0.08;
}

export function setManualVibe(index) {
  const prevEffective = getEffectiveVibe();
  animState.autoVibeEnabled = false;
  animState.lockedVibeIndex = ((index % VIBES.length) + VIBES.length) % VIBES.length;
  if (animState.clockMode) toggleClockMode();

  const nextEffective = getEffectiveVibe();
  if (nextEffective !== prevEffective) {
    applyVibeVisualBlend(nextEffective);
    triggerTrackTitleEntrance();
  }
}

export function enableAutoVibe() {
  const prevEffective = getEffectiveVibe();
  animState.autoVibeEnabled = true;
  if (animState.clockMode) toggleClockMode();

  const nextEffective = getEffectiveVibe();
  if (nextEffective !== prevEffective) {
    applyVibeVisualBlend(nextEffective);
  }
}

export function toggleClockMode() {
  animState.clockMode = !animState.clockMode;
  gsapApi.to(animState, {
    clockBlend: animState.clockMode ? 1 : 0,
    duration: 0.75,
    ease: 'power3.out',
  });
}

export function toggleGlassFrame() {
  animState.showGlassFrame = !animState.showGlassFrame;
  computePanelGeometry();
  buildGlassEnclosureCache();
}

export function handlePointerMove(e) {
  animState.lastPointerMove = performance.now();
  animState.pointerInside = true;

  const rect = dom.canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  animState.pointerX = mx;
  animState.pointerY = my;

  const halfW = Math.max(1, panel.viewportWidth * 0.5);
  const halfH = Math.max(1, panel.viewportHeight * 0.5);
  animState.targetMouseX = Math.max(-1, Math.min(1, (mx - panel.viewportWidth * 0.5) / halfW));
  animState.targetMouseY = Math.max(-1, Math.min(1, (my - panel.viewportHeight * 0.5) / halfH));

  let found = null;
  for (let i = 0; i < hitRegions.length; i++) {
    const r = hitRegions[i];
    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
      found = r.id;
      break;
    }
  }
  animState.hudHoverId = found;
  dom.canvas.style.cursor = found ? 'pointer' : 'default';
}

export function handlePointerLeave() {
  animState.pointerInside = false;
  animState.pointerX = -999;
  animState.pointerY = -999;
  animState.targetMouseX = 0;
  animState.targetMouseY = 0;
  animState.hudHoverId = null;
  dom.canvas.style.cursor = 'default';
}

export function handleCanvasClick(e) {
  const rect = dom.canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  for (let i = 0; i < hitRegions.length; i++) {
    const r = hitRegions[i];
    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
      if (r.id === 'sp-prev') {
        controlSpotifyPlayback('prev');
      } else if (r.id === 'sp-toggle') {
        controlSpotifyPlayback('toggle');
      } else if (r.id === 'sp-next') {
        controlSpotifyPlayback('next');
      } else if (r.id === 'toggle-frame') {
        toggleGlassFrame();
      } else if (r.id === 'toggle-clock') {
        toggleClockMode();
      } else if (r.id === 'auto-vibe') {
        enableAutoVibe();
      } else if (r.id === 'cycle-vibe') {
        setManualVibe(animState.autoVibeEnabled ? 0 : animState.lockedVibeIndex + 1);
      } else if (r.id === 'spotify-auth') {
        if (trackState.connected) {
          clearSpotifySession();
          animState.statusMessage = dsp.isAudioActive
            ? 'SPOTIFY DISCONNECTED // AURORA MESH'
            : 'STANDBY // SPOTIFY DISCONNECTED';
        } else {
          startSpotifyPkceAuth();
        }
      } else if (typeof r.vibeIndex === 'number') {
        setManualVibe(r.vibeIndex);
      }
      return;
    }
  }
}

export function handleKeyDown(e) {
  animState.lastPointerMove = performance.now();
  if (e.key === '0' || e.key === 'a' || e.key === 'A') {
    enableAutoVibe();
  } else if (e.key >= '1' && e.key <= '6') {
    setManualVibe(Number(e.key) - 1);
  } else if (e.key === 't' || e.key === 'T') {
    toggleClockMode();
  } else if (e.key === 'g' || e.key === 'G') {
    toggleGlassFrame();
  } else if (e.key === '+' || e.key === '=') {
    dsp.userSensitivity = Math.min(2.4, Math.round((dsp.userSensitivity + 0.15) * 100) / 100);
  } else if (e.key === '-' || e.key === '_') {
    dsp.userSensitivity = Math.max(0.6, Math.round((dsp.userSensitivity - 0.15) * 100) / 100);
  }
}
