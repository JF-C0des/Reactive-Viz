/**
 * js/main.js
 * Modular entry point: bootstraps precomputed assets, binds window/pointer/keyboard
 * events, initializes Spotify PKCE callback handling, and drives the 60 FPS render loop.
 */

import {
  CONFIG,
  dom,
  panel,
  animState,
  hitRegions,
  syncThemePaletteStrings,
  onPaletteCommit,
  roundedRectPath,
  getEffectiveVibe,
  applyVibeVisualBlend,
} from './state.js';
import {
  startSpotifyPkceAuth,
  handleSpotifyRedirectCallback,
} from './spotify.js';
import {
  initSystemAudio,
  updateAudioAndLifecycle,
} from './audio.js';
import {
  buildSceneAssets,
  buildHalftonePattern,
  drawHybridBackdrop,
  drawTransparentAcousticDrivers,
  drawActiveVibeScenes,
  drawEditorialPosterAndCornerClock,
  renderGalleryTimepieceForeground,
} from './scenes.js';
import {
  buildHudAssets,
  buildGlassEnclosureCache,
  handleResize,
  drawFramedGlassAlbumCard,
  drawHudAndControls,
  drawGlassBezelOverlay,
  drawAnalogGrain,
  updateParallaxState,
  handlePointerMove,
  handlePointerLeave,
  handleCanvasClick,
  handleKeyDown,
} from './hud.js';

function renderFrame(now) {
  const { ctx } = dom;
  hitRegions.length = 0;

  ctx.fillStyle = CONFIG.BG_HEX;
  ctx.fillRect(0, 0, panel.viewportWidth, panel.viewportHeight);

  updateAudioAndLifecycle(now);
  updateParallaxState(now);

  ctx.save();
  if (animState.showGlassFrame && panel.radius > 0) {
    roundedRectPath(ctx, panel.x, panel.y, panel.w, panel.h, panel.radius);
    ctx.clip();
  }

  // Layer 1: Hybrid Zero-Rate-Limit Backdrop + Ambient Beat Light Bloom
  drawHybridBackdrop(now);

  // Layer 2: See-Through SonicGlass A1 Dual Acoustic Drivers
  drawTransparentAcousticDrivers();

  // Layer 3: All 6 Vibe Scenes (ANTHEM, EDM, HIPHOP, SLOW, ACOUSTIC, AMBIENT)
  drawActiveVibeScenes(now);

  // Layer 4: Live Track Title + Artist Poster & Chamfered Album Card OR Gallery Timepiece
  const cb = animState.clockBlend;
  if (cb < 0.999) {
    drawEditorialPosterAndCornerClock(now, 1 - cb, drawFramedGlassAlbumCard);
  }
  if (cb > 0.001) {
    renderGalleryTimepieceForeground(cb);
  }

  // Layer 5: Non-Overflowing Telemetry Header & Interactive Mode/Vibe Pills
  drawHudAndControls(now);

  ctx.restore();

  // Layer 6: Anchored Glass Bezel & Analog Film Grain Overlay
  drawGlassBezelOverlay();
  drawAnalogGrain();

  window.requestAnimationFrame(renderFrame);
}

function bootstrap() {
  onPaletteCommit(() => {
    buildGlassEnclosureCache();
    buildHalftonePattern();
  });

  syncThemePaletteStrings();
  buildSceneAssets();
  buildHudAssets();
  applyVibeVisualBlend(getEffectiveVibe());
  handleResize();

  window.addEventListener('resize', handleResize);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('mousemove', handlePointerMove);
  window.addEventListener('mouseleave', handlePointerLeave);
  dom.canvas.addEventListener('click', handleCanvasClick);
  dom.startBtn.addEventListener('click', initSystemAudio);
  if (dom.spotifyBtn) {
    dom.spotifyBtn.addEventListener('click', startSpotifyPkceAuth);
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      animState.fontsReady = true;
    });
  } else {
    animState.fontsReady = true;
  }

  handleSpotifyRedirectCallback();
  window.requestAnimationFrame(renderFrame);
}

bootstrap();
