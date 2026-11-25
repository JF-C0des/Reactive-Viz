/**
 * js/spotify.js
 * Spotify PKCE OAuth flow, token storage/refresh, /me/player/currently-playing poller,
 * remote playback controls (PREV, PLAY/PAUSE, NEXT), metadata mood hint detector,
 * blurred album backdrop baker, and 16x16 offscreen album-art color extractor.
 */

import {
  CONFIG,
  STORAGE_KEYS,
  gsapApi,
  dom,
  buffers,
  themePalette,
  trackState,
  lyricsState,
  dsp,
  animState,
  rgbToHsl,
  hslToRgb,
  syncThemePaletteStrings,
  notifyPaletteCommit,
  getEffectiveVibe,
  applyVibeVisualBlend,
  triggerTrackTitleEntrance,
} from './state.js';
import {
  fetchLyricsForTrack,
  clearLyricsState,
} from './lyrics.js';

const APP_CONFIG = window.APP_CONFIG || {};
export const SPOTIFY_CLIENT_ID = (APP_CONFIG.SPOTIFY_CLIENT_ID || '').trim();
export const SPOTIFY_REDIRECT_URI =
  (APP_CONFIG.SPOTIFY_REDIRECT_URI || '').trim() ||
  `${window.location.origin}${window.location.pathname}`;
export const IS_SPOTIFY_CONFIGURED =
  Boolean(SPOTIFY_CLIENT_ID) && SPOTIFY_CLIENT_ID !== 'YOUR_SPOTIFY_CLIENT_ID';

// Includes user-modify-playback-state for optional hover PREV / PLAY / PAUSE / NEXT controls
const SPOTIFY_SCOPES =
  'user-read-currently-playing user-read-playback-state user-modify-playback-state';

// ============================================================================
// 1. TRACK / ARTIST METADATA GENRE & MOOD HINT EXTRACTOR
// ============================================================================

/**
 * Inspects Spotify's `trackName` and `artistName` for genre/mood hints so the initial
 * 1-song-1-vibe lock biases accurately right from the start of a track.
 */
export function inferMetadataVibeBias(trackTitle, artistNames) {
  const hay = `${trackTitle || ''} ${artistNames || ''}`.toLowerCase();

  if (
    /\b(remix|club|vip|dubstep|techno|house|trance|rave|hardstyle|edm|festival|skrillex|illenium|fred again|calvin harris|martin garrix|tiesto|deadmau5|daft punk|zedd|avicii|fisher|subtronics)\b/.test(
      hay
    )
  ) {
    return 'EDM';
  }

  if (
    /\b(praise|worship|elevation|bethel|hillsong|maverick city|brandon lake|phil wickham|upperroom|passion|anthem|hallelujah|glory|hosanna|revival|choir|coldplay|imagine dragons|onerepublic|u2)\b/.test(
      hay
    )
  ) {
    return 'ANTHEM';
  }

  if (
    /\b(trap|808|phonk|drill|freestyle|cypher|metro boomin|travis scott|drake|kendrick|future|21 savage|don toliver|playboi carti|kanye|baby keem|gunna|lil )\b/.test(
      hay
    )
  ) {
    return 'HIPHOP';
  }

  if (
    /\b(acoustic|unplugged|stripped|folk|campfire|guitar|banjo|hozier|bon iver|noah kahan|john mayer|sufjan|iron & wine|fleet foxes|lumineers|mumford)\b/.test(
      hay
    )
  ) {
    return 'ACOUSTIC';
  }

  if (
    /\b(lofi|lo-fi|ambient|chillhop|study|meditation|zen|instrumental|synthwave|interlude|soundtrack|ost|hans zimmer|brian eno|nils frahm|olafur)\b/.test(
      hay
    )
  ) {
    return 'AMBIENT';
  }

  if (
    /\b(ballad|lullaby|nocturne|adagio|rain|sad|slowed|piano solo|melancholy|heartbreak)\b/.test(
      hay
    )
  ) {
    return 'SLOW';
  }

  return null;
}

// ============================================================================
// 2. ALBUM BACKDROP BAKER, CARD ANIMATION & 16x16 COLOR PALETTE EXTRACTOR
// ============================================================================

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
      notifyPaletteCommit();
    },
  });
}

function commitBlurredAlbumBackdrop(img) {
  const w = CONFIG.SCENE_W;
  const h = CONFIG.SCENE_H;
  const { prevAlbumBackdropCtx, currAlbumBackdropCanvas, currAlbumBackdropCtx } = buffers;

  prevAlbumBackdropCtx.clearRect(0, 0, w, h);
  if (trackState.hasAlbumBackdrop) {
    prevAlbumBackdropCtx.drawImage(currAlbumBackdropCanvas, 0, 0, w, h);
  }

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

  const grade = currAlbumBackdropCtx.createLinearGradient(0, 0, 0, h);
  grade.addColorStop(0, 'rgba(5, 5, 8, 0.24)');
  grade.addColorStop(0.5, 'rgba(5, 5, 8, 0.08)');
  grade.addColorStop(1, 'rgba(4, 4, 7, 0.44)');
  currAlbumBackdropCtx.fillStyle = grade;
  currAlbumBackdropCtx.fillRect(0, 0, w, h);
  currAlbumBackdropCtx.restore();

  const hadPrevious = trackState.hasAlbumBackdrop;
  trackState.prevAlbumImg = trackState.albumImg;
  trackState.albumImg = img;
  trackState.hasAlbumBackdrop = true;

  animState.backdrop.kenBurnsDirX = Math.random() > 0.5 ? 1 : -1;
  animState.backdrop.kenBurnsDirY = Math.random() > 0.5 ? 1 : -1;

  if (hadPrevious) {
    gsapApi.killTweensOf(animState.backdrop, 'trackCrossfade');
    animState.backdrop.trackCrossfade = 0;
    gsapApi.to(animState.backdrop, {
      trackCrossfade: 1,
      duration: 2.0,
      ease: 'power2.inOut',
    });
  } else {
    animState.backdrop.trackCrossfade = 1;
  }

  // Smooth GSAP 3D tilt + slide + scale entrance on the floating Album Art Card
  gsapApi.fromTo(
    animState.backdrop,
    {
      cardEnterProgress: 0,
      cardSlideX: 30,
      cardTilt: 0.085,
    },
    {
      albumVisibility: trackState.isPlaying ? 1 : 0,
      cardAlpha: trackState.isPlaying ? 1 : 0.65,
      cardEnterProgress: 1,
      cardSlideX: 0,
      cardTilt: 0,
      duration: 0.95,
      ease: 'expo.out',
    }
  );
}

export function loadAlbumArtAndExtractPalette(imageUrl) {
  return new Promise((resolve) => {
    if (!imageUrl) {
      resolve();
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      commitBlurredAlbumBackdrop(img);

      try {
        const { paletteCtx } = buffers;
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

          const vividS = Math.min(1, Math.max(0.64, domHsl.s * 1.22));
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
          peakRgbArr = hslToRgb(peakHue, peakSat, 0.85);
        } else {
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

export function updateSpectralFallbackPalette(now) {
  if (trackState.connected && trackState.isPlaying && themePalette.lockedToAlbum) return;

  themePalette.lockedToAlbum = false;
  const spectralHue = dsp.isAudioActive
    ? 15 + dsp.smoothTreble * 28 - dsp.smoothSub * 8 + Math.sin(now * 0.0003) * 5
    : 19 + Math.sin(now * 0.00035) * 5;

  const pRgb = hslToRgb(spectralHue, 0.95, 0.52);
  const sRgb = hslToRgb(spectralHue + 16, 0.9, 0.62);
  const hRgb = hslToRgb(spectralHue + 24, 0.82, 0.82);

  themePalette.pr += (pRgb[0] - themePalette.pr) * 0.04;
  themePalette.pg += (pRgb[1] - themePalette.pg) * 0.04;
  themePalette.pb += (pRgb[2] - themePalette.pb) * 0.04;

  themePalette.sr += (sRgb[0] - themePalette.sr) * 0.04;
  themePalette.sg += (sRgb[1] - themePalette.sg) * 0.04;
  themePalette.sb += (sRgb[2] - themePalette.sb) * 0.04;

  themePalette.hr += (hRgb[0] - themePalette.hr) * 0.04;
  themePalette.hg += (hRgb[1] - themePalette.hg) * 0.04;
  themePalette.hb += (hRgb[2] - themePalette.hb) * 0.04;

  syncThemePaletteStrings();
}

// ============================================================================
// 3. SPOTIFY PKCE OAUTH FLOW, PLAYBACK CONTROLS & POLLER
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

export async function startSpotifyPkceAuth() {
  if (!IS_SPOTIFY_CONFIGURED) {
    animState.statusMessage = 'SPOTIFY // SET CLIENT_ID IN config.js (SEE config.example.js)';
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

function saveSpotifyTokens(tokenData, fromFreshLogin = false) {
  trackState.accessToken = tokenData.access_token;
  if (tokenData.refresh_token) {
    trackState.refreshToken = tokenData.refresh_token;
    localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, trackState.refreshToken);
  }
  trackState.expiresAt = Date.now() + (tokenData.expires_in || 3600) * 1000;
  localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, trackState.accessToken);
  localStorage.setItem(STORAGE_KEYS.EXPIRES_AT, String(trackState.expiresAt));
  if (fromFreshLogin) {
    localStorage.setItem(STORAGE_KEYS.HAS_MODIFY_SCOPE, '1');
  }
  trackState.connected = true;
  updateSpotifyButtonVisibility();
}

function setAlbumBackdropActive(active) {
  gsapApi.to(animState.backdrop, {
    albumVisibility: active && trackState.hasAlbumBackdrop ? 1 : 0,
    cardAlpha: trackState.hasAlbumBackdrop ? (active ? 1 : 0.68) : 0,
    duration: 1.4,
    ease: 'power2.inOut',
  });
  if (lyricsState.hasSynced) {
    gsapApi.to(lyricsState, {
      blockAlpha: active ? 1 : 0.68,
      duration: 0.8,
      ease: 'power2.out',
    });
  }
}

export function clearSpotifySession() {
  trackState.accessToken = null;
  trackState.refreshToken = null;
  trackState.expiresAt = 0;
  trackState.connected = false;
  trackState.isPlaying = false;
  trackState.currentTrackId = null;
  trackState.trackName = '';
  trackState.artistName = '';
  trackState.albumName = '';
  trackState.rawTrackName = '';
  trackState.rawArtistName = '';
  trackState.primaryArtistName = '';
  trackState.rawAlbumName = '';
  trackState.durationMs = 0;
  trackState.baseProgressMs = 0;
  trackState.lastProgressSyncPerf = 0;
  trackState.liveProgressMs = 0;
  trackState.albumArtUrl = '';
  trackState.albumImg = null;
  trackState.prevAlbumImg = null;
  trackState.hasAlbumBackdrop = false;
  trackState.metadataBiasVibe = null;
  themePalette.lockedToAlbum = false;
  clearLyricsState();

  gsapApi.to(animState.backdrop, {
    albumVisibility: 0,
    cardAlpha: 0,
    duration: 1.2,
    ease: 'power2.out',
  });

  localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.EXPIRES_AT);
  localStorage.removeItem(STORAGE_KEYS.VERIFIER);
  localStorage.removeItem(STORAGE_KEYS.HAS_MODIFY_SCOPE);
  updateSpotifyButtonVisibility();
}

export function updateSpotifyButtonVisibility() {
  if (!dom.spotifyBtn) return;
  if (trackState.connected) {
    dom.spotifyBtn.classList.add('hidden');
  } else {
    dom.spotifyBtn.classList.remove('hidden');
  }
}

export async function handleSpotifyRedirectCallback() {
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
    animState.statusMessage = `SPOTIFY AUTH // ${error.toUpperCase()}`;
    return;
  }

  if (!code) {
    if (!IS_SPOTIFY_CONFIGURED) {
      if (dom.spotifyBtn) dom.spotifyBtn.classList.add('hidden');
      return;
    }
    if (trackState.accessToken) {
      trackState.connected = true;
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
    animState.statusMessage = 'SPOTIFY // MISSING PKCE VERIFIER (RETRY CONNECT)';
    return;
  }

  try {
    animState.statusMessage = 'SPOTIFY // EXCHANGING PKCE TOKEN...';
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
    saveSpotifyTokens(tokenData, true);
    animState.statusMessage = dsp.isAudioActive
      ? 'LIVE // SPOTIFY + SYSTEM AUDIO SYNCED'
      : 'SPOTIFY LINKED // CONNECT SYSTEM AUDIO';
    await pollSpotifyCurrentlyPlaying(true);
  } catch (_) {
    clearSpotifySession();
    animState.statusMessage = 'SPOTIFY // AUTH EXCHANGE FAILED';
  }
}

async function refreshSpotifyAccessToken() {
  if (!trackState.refreshToken) {
    clearSpotifySession();
    return false;
  }

  try {
    const body = new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: trackState.refreshToken,
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
    saveSpotifyTokens(tokenData, false);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Wired to Spotify Web API playback endpoints:
 * - 'prev'   -> POST /v1/me/player/previous
 * - 'next'   -> POST /v1/me/player/next
 * - 'toggle' -> PUT /v1/me/player/pause or PUT /v1/me/player/play
 */
export async function controlSpotifyPlayback(action) {
  if (!trackState.connected || !trackState.accessToken || trackState.actionInFlight) return;

  trackState.actionInFlight = true;
  try {
    let method = 'POST';
    let endpoint = 'next';

    if (action === 'prev') {
      endpoint = 'previous';
    } else if (action === 'next') {
      endpoint = 'next';
    } else if (action === 'toggle') {
      method = 'PUT';
      endpoint = trackState.isPlaying ? 'pause' : 'play';
    }

    let res = await fetch(`https://api.spotify.com/v1/me/player/${endpoint}`, {
      method,
      headers: { Authorization: `Bearer ${trackState.accessToken}` },
    });

    if (res.status === 401) {
      const refreshed = await refreshSpotifyAccessToken();
      if (refreshed && trackState.accessToken) {
        res = await fetch(`https://api.spotify.com/v1/me/player/${endpoint}`, {
          method,
          headers: { Authorization: `Bearer ${trackState.accessToken}` },
        });
      }
    }

    if (res.status === 403) {
      const hasScope = localStorage.getItem(STORAGE_KEYS.HAS_MODIFY_SCOPE) === '1';
      animState.statusMessage = hasScope
        ? 'SPOTIFY // PLAYBACK CONTROLS REQUIRE PREMIUM'
        : 'SPOTIFY // RECONNECT [SPOTIFY ✓] TO ENABLE CONTROLS';
      return;
    }

    if (res.ok || res.status === 204) {
      if (action === 'toggle') {
        // Anchor interpolated progress at the exact instant of play/pause toggle
        const nowPerf = performance.now();
        if (trackState.isPlaying) {
          trackState.baseProgressMs =
            trackState.baseProgressMs + Math.max(0, nowPerf - trackState.lastProgressSyncPerf);
        }
        trackState.lastProgressSyncPerf = nowPerf;
        trackState.isPlaying = !trackState.isPlaying;
        setAlbumBackdropActive(trackState.isPlaying);
      }
      // Force quick re-poll after skipping/toggling so UI updates promptly
      trackState.lastPollTime = performance.now() - (CONFIG.SPOTIFY_POLL_MS - 420);
    }
  } catch (_) {
    // Ignore transient network errors
  } finally {
    trackState.actionInFlight = false;
  }
}

async function onNewTrackStarted(albumArtUrl) {
  const trackIdAtStart = trackState.currentTrackId;

  // 1. Infer metadata genre/mood bias immediately from Track Title + Artist
  const hintVibe = inferMetadataVibeBias(trackState.trackName, trackState.artistName);
  trackState.metadataBiasVibe = hintVibe;

  if (hintVibe) {
    dsp.vibe = hintVibe;
    applyVibeVisualBlend(getEffectiveVibe());
  }

  // 2. Fetch synced LRCLIB lyrics in parallel (non-blocking)
  fetchLyricsForTrack({
    trackId: trackIdAtStart,
    trackName: trackState.rawTrackName,
    primaryArtist: trackState.primaryArtistName,
    artistName: trackState.rawArtistName,
    albumName: trackState.rawAlbumName,
    durationMs: trackState.durationMs,
  });

  // 3. Animate Live Track Title & Artist entrance
  triggerTrackTitleEntrance();

  // 3. Load album art, bake blurred backdrop, animate 3D card & morph palette
  await loadAlbumArtAndExtractPalette(albumArtUrl);
  if (trackState.currentTrackId !== trackIdAtStart) return;

  // 4. Reset rolling audio accumulators for clean 2.8s audio confirmation of this track
  dsp.rollingBpm = 0;
  dsp.transientFluxAvg = 0;
  dsp.kickDensity = 0;
  dsp.snareDensity = 0;
  dsp.rollingSub = dsp.subBass;
  dsp.rollingMid = dsp.mid;
  dsp.rollingHigh = dsp.highMid;
  dsp.rollingTreble = dsp.treble;

  if (dsp.isAudioActive) {
    trackState.pendingTrackLock = true;
    trackState.trackChangeTime = performance.now() + 2800;
  } else {
    trackState.pendingTrackLock = false;
    applyVibeVisualBlend(getEffectiveVibe());
  }
}

export async function pollSpotifyCurrentlyPlaying(forceImmediate = false) {
  if (!trackState.connected || !trackState.accessToken || trackState.pollInFlight) return;

  const now = performance.now();
  if (!forceImmediate && now - trackState.lastPollTime < CONFIG.SPOTIFY_POLL_MS) return;

  trackState.pollInFlight = true;
  trackState.lastPollTime = now;

  try {
    if (Date.now() > trackState.expiresAt - 60000 && trackState.refreshToken) {
      await refreshSpotifyAccessToken();
    }

    let res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${trackState.accessToken}` },
    });

    if (res.status === 401) {
      const refreshed = await refreshSpotifyAccessToken();
      if (refreshed && trackState.accessToken) {
        res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
          headers: { Authorization: `Bearer ${trackState.accessToken}` },
        });
      } else {
        clearSpotifySession();
        return;
      }
    }

    if (res.status === 204) {
      if (trackState.isPlaying) {
        trackState.isPlaying = false;
        setAlbumBackdropActive(false);
      }
      return;
    }

    if (!res.ok) return;

    const payload = await res.json();
    if (!payload || !payload.item) {
      if (trackState.isPlaying) {
        trackState.isPlaying = false;
        setAlbumBackdropActive(false);
      }
      return;
    }

    const nowPlaying = Boolean(payload.is_playing);
    const item = payload.item;
    const newTrackId = item.id || `${item.name}-${item.duration_ms}`;
    const polledProgress = Math.max(0, Number(payload.progress_ms || 0));
    const syncPerf = performance.now();

    trackState.durationMs = Math.max(0, Number(item.duration_ms || 0));

    // Synchronize 60 FPS local playback timer with Spotify's `progress_ms`
    if (newTrackId !== trackState.currentTrackId || !nowPlaying || !trackState.isPlaying) {
      trackState.baseProgressMs = polledProgress;
      trackState.lastProgressSyncPerf = syncPerf;
      trackState.liveProgressMs = polledProgress;
    } else {
      const predicted =
        trackState.baseProgressMs + Math.max(0, syncPerf - trackState.lastProgressSyncPerf);
      const drift = polledProgress - predicted;
      // Snap immediately if user scrubbed (> 380ms), else gently converge without jitter
      trackState.baseProgressMs =
        Math.abs(drift) > 380 ? polledProgress : predicted + drift * 0.45;
      trackState.lastProgressSyncPerf = syncPerf;
    }

    if (nowPlaying !== trackState.isPlaying) {
      trackState.isPlaying = nowPlaying;
      setAlbumBackdropActive(nowPlaying);
    }

    // STRICT 1-SONG-1-VIBE LOCK: Only trigger on brand-new track ID
    if (newTrackId !== trackState.currentTrackId) {
      trackState.currentTrackId = newTrackId;
      trackState.rawTrackName = item.name || '';
      trackState.primaryArtistName =
        Array.isArray(item.artists) && item.artists[0] && item.artists[0].name
          ? item.artists[0].name
          : '';
      trackState.rawArtistName = Array.isArray(item.artists)
        ? item.artists.map((a) => a.name).join(', ')
        : '';
      trackState.rawAlbumName = item.album && item.album.name ? item.album.name : '';

      trackState.trackName = (trackState.rawTrackName || 'UNKNOWN TRACK').toUpperCase();
      trackState.artistName = (trackState.rawArtistName || 'UNKNOWN ARTIST').toUpperCase();
      trackState.albumName = trackState.rawAlbumName.toUpperCase();

      const images = item.album && Array.isArray(item.album.images) ? item.album.images : [];
      const newArtUrl = images.length > 0 ? images[0].url : '';
      trackState.albumArtUrl = newArtUrl;

      await onNewTrackStarted(newArtUrl);
    }
  } catch (_) {
    // Keep current visual state seamlessly on transient network hiccups
  } finally {
    trackState.pollInFlight = false;
  }
}
