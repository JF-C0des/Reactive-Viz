/**
 * js/lyrics.js
 * Free real-time synced lyrics engine powered by LRCLIB (lrclib.net),
 * 60 FPS sub-frame playback clock interpolator, and SonicGlass 3-line
 * holographic lyrics renderer with vibe-tailored GSAP transitions.
 */

import {
  CONFIG,
  gsapApi,
  dom,
  themePalette,
  trackState,
  lyricsState,
  panel,
  dsp,
  animState,
  truncateTextToWidth,
  wrapTitleTwoLines,
  getEffectiveVibe,
} from './state.js';

const LRCLIB_BASE = 'https://lrclib.net/api';

/**
 * Strips common remaster / featured / live suffixes to maximize `/api/search` hit rate
 * when an exact `/api/get` lookup returns 404.
 */
export function cleanTrackQueryTitle(rawTitle) {
  if (!rawTitle) return '';
  return rawTitle
    .replace(/\s*\((?:feat\.?|ft\.?|with\s)[^)]*\)/gi, '')
    .replace(/\s*\[(?:feat\.?|ft\.?|from\s)[^\]]*\]/gi, '')
    .replace(/\s*-\s*(?:remastered|remaster|live|mono|stereo|single|radio edit|deluxe).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses `.lrc` synced lyric strings (`[mm:ss.xx]` or `[mm:ss.xxx]`) into a sorted array
 * of `{ timeMs, text, isBreak }` objects.
 */
export function parseSyncedLrc(lrcString) {
  if (!lrcString || typeof lrcString !== 'string') return [];

  let offsetMs = 0;
  const offsetMatch = lrcString.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
  if (offsetMatch) {
    offsetMs = parseInt(offsetMatch[1], 10) || 0;
  }

  const rawRows = lrcString.split(/\r?\n/);
  const parsed = [];
  const timeTagRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

  for (let i = 0; i < rawRows.length; i++) {
    const line = rawRows[i];
    timeTagRegex.lastIndex = 0;

    const timestamps = [];
    let match;
    while ((match = timeTagRegex.exec(line)) !== null) {
      const mins = parseInt(match[1], 10);
      const secs = parseInt(match[2], 10);
      const fracStr = match[3] || '0';
      let fracMs = 0;
      if (fracStr.length === 1) fracMs = parseInt(fracStr, 10) * 100;
      else if (fracStr.length === 2) fracMs = parseInt(fracStr, 10) * 10;
      else fracMs = parseInt(fracStr.slice(0, 3), 10);

      const totalMs = Math.max(0, mins * 60000 + secs * 1000 + fracMs - offsetMs);
      timestamps.push(totalMs);
    }

    if (timestamps.length === 0) continue;

    // Remove [mm:ss.xx] and enhanced inline <mm:ss.xx> tags
    const cleanText = line
      .replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, '')
      .replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    for (let t = 0; t < timestamps.length; t++) {
      parsed.push({
        timeMs: timestamps[t],
        text: cleanText,
      });
    }
  }

  parsed.sort((a, b) => a.timeMs - b.timeMs);

  // Filter empty lines, keeping a subtle '· · ·' breather only on long instrumental gaps (>= 6.5s)
  const finalLines = [];
  for (let i = 0; i < parsed.length; i++) {
    const curr = parsed[i];
    if (curr.text.length > 0) {
      finalLines.push({ timeMs: curr.timeMs, text: curr.text, isBreak: false });
    } else {
      const nextTime = i + 1 < parsed.length ? parsed[i + 1].timeMs : curr.timeMs + 8000;
      const prevWasBreak = finalLines.length > 0 && finalLines[finalLines.length - 1].isBreak;
      if (nextTime - curr.timeMs >= 6500 && finalLines.length > 0 && !prevWasBreak) {
        finalLines.push({ timeMs: curr.timeMs, text: '· · ·', isBreak: true });
      }
    }
  }

  return finalLines;
}

function pickBestSearchCandidate(candidates, targetArtist, durationSec) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const normArtist = (targetArtist || '').toLowerCase().trim();
  let best = null;
  let bestScore = -9999;

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    if (!item || !item.syncedLyrics) continue;

    let score = 100;
    const candArtist = String(item.artistName || '').toLowerCase();
    if (normArtist && (candArtist.includes(normArtist) || normArtist.includes(candArtist))) {
      score += 45;
    }

    if (durationSec > 0 && typeof item.duration === 'number') {
      const diff = Math.abs(item.duration - durationSec);
      if (diff <= 2) score += 40;
      else if (diff <= 6) score += 20;
      else score -= Math.min(80, diff * 2.5);
    }

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return best;
}

export function clearLyricsState() {
  lyricsState.trackId = null;
  lyricsState.lines = [];
  lyricsState.activeIndex = -1;
  lyricsState.hasSynced = false;
  lyricsState.instrumental = false;
  lyricsState.plainText = '';
  lyricsState.loading = false;

  gsapApi.killTweensOf(lyricsState);
  gsapApi.to(lyricsState, {
    blockAlpha: 0,
    duration: 0.45,
    ease: 'power2.out',
  });
}

/**
 * Fetches synced `.lrc` lyrics from `lrclib.net/api/get`, automatically falling back
 * to `/api/search` if exact metadata match returns 404 or lacks synced timestamps.
 */
export async function fetchLyricsForTrack({
  trackId,
  trackName,
  primaryArtist,
  artistName,
  albumName,
  durationMs,
}) {
  if (!trackId || !trackName) {
    clearLyricsState();
    return;
  }

  lyricsState.trackId = trackId;
  lyricsState.loading = true;
  lyricsState.hasSynced = false;
  lyricsState.lines = [];
  lyricsState.activeIndex = -1;
  lyricsState.plainText = '';
  lyricsState.instrumental = false;

  gsapApi.killTweensOf(lyricsState);
  gsapApi.to(lyricsState, {
    blockAlpha: 0,
    duration: 0.3,
    ease: 'power2.out',
  });

  const durationSec = durationMs > 0 ? Math.round(durationMs / 1000) : 0;
  const artistQuery = primaryArtist || artistName || '';
  let matchedRecord = null;

  try {
    // 1. Primary exact lookup: GET https://lrclib.net/api/get
    const getParams = new URLSearchParams({
      artist_name: artistQuery,
      track_name: trackName,
    });
    if (albumName) getParams.set('album_name', albumName);
    if (durationSec > 0) getParams.set('duration', String(durationSec));

    const getRes = await fetch(`${LRCLIB_BASE}/get?${getParams.toString()}`);
    if (trackState.currentTrackId !== trackId) return;

    if (getRes.ok) {
      const data = await getRes.json();
      if (data && (data.syncedLyrics || data.instrumental)) {
        matchedRecord = data;
      } else if (data && data.plainLyrics) {
        lyricsState.plainText = data.plainLyrics;
      }
    }

    // 2. Fallback search if /api/get returned 404 or lacked syncedLyrics
    if (!matchedRecord || (!matchedRecord.syncedLyrics && !matchedRecord.instrumental)) {
      const cleanedTitle = cleanTrackQueryTitle(trackName) || trackName;
      const searchParams = new URLSearchParams({
        track_name: cleanedTitle,
        artist_name: artistQuery,
      });

      const searchRes = await fetch(`${LRCLIB_BASE}/search?${searchParams.toString()}`);
      if (trackState.currentTrackId !== trackId) return;

      if (searchRes.ok) {
        const list = await searchRes.json();
        matchedRecord = pickBestSearchCandidate(list, artistQuery, durationSec) || matchedRecord;
      }

      // Secondary broader `q=` fallback if structured fields still missed
      if (!matchedRecord || !matchedRecord.syncedLyrics) {
        const broadParams = new URLSearchParams({
          q: `${cleanedTitle} ${artistQuery}`.trim(),
        });
        const broadRes = await fetch(`${LRCLIB_BASE}/search?${broadParams.toString()}`);
        if (trackState.currentTrackId !== trackId) return;

        if (broadRes.ok) {
          const broadList = await broadRes.json();
          matchedRecord =
            pickBestSearchCandidate(broadList, artistQuery, durationSec) || matchedRecord;
        }
      }
    }

    if (trackState.currentTrackId !== trackId) return;
    lyricsState.loading = false;

    if (matchedRecord) {
      lyricsState.instrumental = Boolean(matchedRecord.instrumental);
      lyricsState.plainText = matchedRecord.plainLyrics || lyricsState.plainText || '';
    }

    const parsedLines =
      matchedRecord && matchedRecord.syncedLyrics
        ? parseSyncedLrc(matchedRecord.syncedLyrics)
        : [];

    if (parsedLines.length > 0) {
      lyricsState.lines = parsedLines;
      lyricsState.hasSynced = true;
      lyricsState.activeIndex = findLyricIndexAtTime(
        parsedLines,
        trackState.liveProgressMs + 60
      );
      lyricsState.slideY = 0;
      lyricsState.activeScale = 1;
      lyricsState.lineFade = 1;

      gsapApi.to(lyricsState, {
        blockAlpha: trackState.isPlaying ? 1 : 0.72,
        duration: 0.75,
        ease: 'power2.out',
      });
    } else {
      // Gracefully hide lyric block on instrumentals or unlisted tracks
      lyricsState.lines = [];
      lyricsState.hasSynced = false;
      gsapApi.to(lyricsState, {
        blockAlpha: 0,
        duration: 0.45,
        ease: 'power2.out',
      });
    }
  } catch (_) {
    if (trackState.currentTrackId === trackId) {
      lyricsState.loading = false;
      lyricsState.hasSynced = false;
      lyricsState.lines = [];
    }
  }
}

export function findLyricIndexAtTime(lines, timeMs) {
  if (!lines || lines.length === 0 || timeMs < lines[0].timeMs) {
    return -1;
  }
  let low = 0;
  let high = lines.length - 1;
  let ans = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].timeMs <= timeMs) {
      ans = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return ans;
}

function triggerLyricLineTransition() {
  const vibe = getEffectiveVibe();
  const isCalmVibe = vibe === 'SLOW' || vibe === 'AMBIENT' || vibe === 'ACOUSTIC';

  gsapApi.killTweensOf(lyricsState);

  if (isCalmVibe) {
    // Gentle vertical glide and silky alpha crossfade — zero jarring bounce
    gsapApi.fromTo(
      lyricsState,
      {
        slideY: 14,
        activeScale: 1,
        activeGlow: 0.42,
        lineFade: 0.14,
      },
      {
        blockAlpha: trackState.isPlaying ? 1 : 0.72,
        slideY: 0,
        activeScale: 1,
        activeGlow: 0.22,
        lineFade: 1,
        duration: 0.75,
        ease: 'power2.out',
      }
    );
  } else {
    // Crisp kinetic slide-up with subtle scale pop for EDM / ANTHEM / HIPHOP
    gsapApi.fromTo(
      lyricsState,
      {
        slideY: 20,
        activeScale: 1.06,
        activeGlow: 0.96,
        lineFade: 0.28,
      },
      {
        blockAlpha: trackState.isPlaying ? 1 : 0.72,
        slideY: 0,
        activeScale: 1,
        activeGlow: 0.38,
        lineFade: 1,
        duration: 0.35,
        ease: 'back.out(1.4)',
      }
    );
  }
}

/**
 * Frame-accurate 60 FPS playback timer combining Spotify's `progress_ms` + `is_playing`
 * with local `performance.now()` delta between 3.5s polls.
 */
export function updateLyricsPlaybackSync(now) {
  if (!trackState.connected || !trackState.currentTrackId) {
    return;
  }

  const elapsed = trackState.isPlaying
    ? Math.max(0, now - trackState.lastProgressSyncPerf)
    : 0;
  const rawProgress = trackState.baseProgressMs + elapsed;
  trackState.liveProgressMs =
    trackState.durationMs > 0 ? Math.min(trackState.durationMs, rawProgress) : rawProgress;

  if (!lyricsState.hasSynced || lyricsState.lines.length === 0) {
    return;
  }

  // Slight +60ms visual anticipation keeps vocal syllables feeling frame-locked
  const nextIndex = findLyricIndexAtTime(lyricsState.lines, trackState.liveProgressMs + 60);
  if (nextIndex !== lyricsState.activeIndex) {
    lyricsState.activeIndex = nextIndex;
    triggerLyricLineTransition();
  }
}

/**
 * Renders the floating 3-line SonicGlass Holographic Lyrics window in the left/center
 * editorial zone without colliding with the Top HUD, Track Title, or Right Album Card.
 */
export function drawHolographicLyrics(modeAlpha, maxBottomY) {
  if (
    !animState.fontsReady ||
    !lyricsState.hasSynced ||
    lyricsState.lines.length === 0 ||
    lyricsState.blockAlpha <= 0.01 ||
    modeAlpha <= 0.01 ||
    panel.h < 340
  ) {
    return;
  }

  const alpha = lyricsState.blockAlpha * modeAlpha;
  if (alpha <= 0.01) return;

  const { lines, activeIndex, slideY, activeScale, activeGlow, lineFade } = lyricsState;
  const firstLine = lines[0];

  // Before the first vocal line: stay hidden during long intros, preview gently within 7.5s
  if (activeIndex < 0 && firstLine.timeMs - trackState.liveProgressMs > 7500) {
    return;
  }

  const { ctx } = dom;
  const { mouseX, mouseY, fx, motionIntensity } = animState;
  const fgX = mouseX * (CONFIG.PARALLAX_FG * 0.88) + fx.shakeX * 0.18;
  const fgY = mouseY * (CONFIG.PARALLAX_FG * 0.88) + fx.shakeY * 0.18;

  const leftMargin = panel.x + Math.max(48, panel.w * 0.06) + fgX;
  const hasCardVisible = trackState.albumImg && panel.w >= 680;
  const maxLyricWidth = hasCardVisible ? panel.w * 0.45 : panel.w * 0.72;

  const minTopY = panel.y + 92 + fgY;
  const safeBottomY = Math.max(minTopY + 76, maxBottomY - 34);
  const idealCenterY = panel.y + panel.h * 0.355 + fgY;
  const centerY = Math.max(minTopY + 34, Math.min(safeBottomY - 38, idealCenterY));

  const activePx = Math.round(Math.max(17, Math.min(panel.w * 0.021, panel.h * 0.039, 29)));
  const subPx = Math.round(Math.max(12, activePx * 0.64));

  const prevObj = activeIndex > 0 ? lines[activeIndex - 1] : null;
  const currObj =
    activeIndex >= 0
      ? lines[activeIndex]
      : { text: '♪', isBreak: true };
  const nextObj =
    activeIndex + 1 < lines.length ? lines[activeIndex + 1] : null;

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  // Wrap active lyric line up to 2 clean lines so long lyrics never clip mid-thought
  ctx.font = `600 ${activePx}px "Space Grotesk", sans-serif`;
  const wrappedActive = wrapTitleTwoLines(
    ctx,
    currObj.text,
    Math.max(140, maxLyricWidth / Math.max(1, activeScale) - 18)
  );
  const activeLineHeight = activePx * 1.24;
  const activeBlockHalfH =
    wrappedActive.length > 1 ? activeLineHeight * 0.56 : activePx * 0.25;
  const rowGap = Math.max(24, activePx * 1.18);

  // 1. Previous lyric line (faded above)
  if (prevObj && prevObj.text) {
    ctx.save();
    ctx.globalAlpha *= 0.26 * (0.45 + lineFade * 0.55);
    ctx.font = `400 ${subPx}px "Space Grotesk", sans-serif`;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = 'rgba(255, 244, 236, 0.92)';
    const prevStr = truncateTextToWidth(ctx, prevObj.text, maxLyricWidth - 16);
    ctx.fillText(
      prevStr,
      leftMargin + 14,
      centerY - activeBlockHalfH - rowGap + slideY * 0.55
    );
    ctx.restore();
  }

  // 2. Active lyric line (sharp, glowing holographic focal line with accent bar)
  ctx.save();
  const beatScale = 1 + dsp.beatPulse * 0.016 * Math.min(1.2, motionIntensity);
  const totalScale = activeScale * beatScale;

  ctx.translate(leftMargin, centerY + slideY);
  if (totalScale !== 1) {
    ctx.scale(totalScale, totalScale);
  }

  // Holographic accent bar on left edge of active lyric
  const barH =
    wrappedActive.length > 1
      ? activeLineHeight * 1.72
      : Math.max(16, activePx * 0.86);
  ctx.save();
  ctx.shadowColor = themePalette.primaryHex;
  ctx.shadowBlur = 10 + activeGlow * 12;
  ctx.fillStyle = currObj.isBreak
    ? `rgba(${themePalette.secondaryRgb}, 0.55)`
    : themePalette.primaryHex;
  ctx.fillRect(0, -barH * 0.5, 2.5, barH);
  ctx.restore();

  ctx.globalAlpha *= 0.25 + lineFade * 0.75;
  ctx.font = `600 ${activePx}px "Space Grotesk", sans-serif`;

  for (let l = 0; l < wrappedActive.length; l++) {
    const ly =
      wrappedActive.length === 1
        ? 0
        : (l - 0.5) * activeLineHeight;

    // Pass 1: Crisp smoked-glass dark backing shadow for legibility over bright covers
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = -mouseX * 5;
    ctx.shadowOffsetY = 5 - mouseY * 4;
    ctx.fillStyle = currObj.isBreak
      ? `rgba(${themePalette.peakRgb}, 0.72)`
      : '#fffaf5';
    ctx.fillText(wrappedActive[l], 14, ly);

    // Pass 2: Holographic album-tinted glow bloom
    if (!currObj.isBreak) {
      ctx.shadowColor = themePalette.primaryHex;
      ctx.shadowBlur =
        12 + activeGlow * 18 + dsp.beatPulse * 12 * Math.min(1.2, motionIntensity);
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = '#fffaf5';
      ctx.fillText(wrappedActive[l], 14, ly);
    }
  }
  ctx.restore();

  // 3. Next lyric line (previewed softly below)
  if (nextObj && nextObj.text) {
    ctx.save();
    ctx.globalAlpha *= (activeIndex < 0 ? 0.52 : 0.35) * (0.5 + lineFade * 0.5);
    ctx.font = `400 ${subPx}px "Space Grotesk", sans-serif`;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = `rgb(${themePalette.peakRgb})`;
    const nextStr = truncateTextToWidth(ctx, nextObj.text, maxLyricWidth - 16);
    ctx.fillText(
      nextStr,
      leftMargin + 14,
      centerY + activeBlockHalfH + rowGap + slideY * 0.75
    );
    ctx.restore();
  }

  ctx.restore();
}
