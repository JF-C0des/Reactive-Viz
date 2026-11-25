/**
 * js/audio.js
 * Expressive Web Audio API DSP, Full-Spectrum Transient & BPM Tracker, Chorus Velocity
 * Detector, and Weighted 6-Vibe Classifier (fixing false 'SLOW' on upbeat Praise/Pop/Rock).
 */

import {
  CONFIG,
  NOTE_NAMES,
  gsapApi,
  dom,
  trackState,
  dsp,
  animState,
  ripples,
  shapeBand,
  getWaveAndRippleScale,
  getEffectiveVibe,
  applyVibeVisualBlend,
  triggerTrackTitleEntrance,
} from './state.js';
import {
  pollSpotifyCurrentlyPlaying,
  updateSpectralFallbackPalette,
} from './spotify.js';
import { updateLyricsPlaybackSync } from './lyrics.js';

function calculateFrequencyBins(sampleRate, fftSize) {
  const nyquist = sampleRate / 2;
  const binCount = fftSize / 2;
  const hzPerBin = nyquist / binCount;
  const { bandBins } = dsp;

  bandBins.subBass = {
    start: Math.max(1, Math.floor(20 / hzPerBin)),
    end: Math.max(2, Math.ceil(90 / hzPerBin)),
  };
  bandBins.bass = {
    start: Math.max(2, Math.floor(90 / hzPerBin)),
    end: Math.ceil(250 / hzPerBin),
  };
  bandBins.lowMid = {
    start: Math.floor(250 / hzPerBin),
    end: Math.ceil(650 / hzPerBin),
  };
  bandBins.mid = {
    start: Math.floor(650 / hzPerBin),
    end: Math.ceil(2400 / hzPerBin),
  };
  bandBins.highMid = {
    start: Math.floor(2400 / hzPerBin),
    end: Math.ceil(5000 / hzPerBin),
  };
  bandBins.treble = {
    start: Math.floor(5000 / hzPerBin),
    end: Math.min(binCount - 1, Math.ceil(13500 / hzPerBin)),
  };
}

function handleStreamEnded() {
  dsp.isAudioActive = false;
  animState.statusMessage = 'STREAM ENDED // AWAITING RECONNECT';
  dom.startBtn.textContent = 'Connect System Audio';
  dom.startBtn.classList.remove('hidden');
}

export async function initSystemAudio() {
  try {
    animState.statusMessage = 'REQUESTING SYSTEM AUDIO...';

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

    if (dsp.audioCtx) {
      await dsp.audioCtx.close();
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    dsp.audioCtx = new AudioContextClass();

    if (dsp.audioCtx.state === 'suspended') {
      await dsp.audioCtx.resume();
    }

    dsp.analyser = dsp.audioCtx.createAnalyser();
    dsp.analyser.fftSize = CONFIG.FFT_SIZE;
    dsp.analyser.smoothingTimeConstant = CONFIG.SMOOTHING;
    dsp.analyser.minDecibels = CONFIG.MIN_DECIBELS;
    dsp.analyser.maxDecibels = CONFIG.MAX_DECIBELS;

    const audioOnlyStream = new MediaStream([audioTracks[0]]);
    dsp.sourceNode = dsp.audioCtx.createMediaStreamSource(audioOnlyStream);
    dsp.sourceNode.connect(dsp.analyser);

    dsp.freqData = new Uint8Array(dsp.analyser.frequencyBinCount);
    dsp.timeData = new Uint8Array(dsp.analyser.fftSize);

    calculateFrequencyBins(dsp.audioCtx.sampleRate, dsp.analyser.fftSize);

    dsp.isAudioActive = true;
    dsp.awaitingFallbackSongLock = !trackState.connected;
    dsp.fallbackAnalyzeReadyAt = performance.now() + 2800;
    if (trackState.connected && trackState.currentTrackId) {
      trackState.pendingTrackLock = true;
      trackState.trackChangeTime = performance.now() + 2800;
    }

    animState.statusMessage = trackState.connected
      ? 'LIVE // SPOTIFY + SYSTEM AUDIO SYNCED'
      : 'LIVE // SONICGLASS AUDIO LOCKED';
    dom.startBtn.classList.add('hidden');

    audioTracks[0].addEventListener('ended', handleStreamEnded);
  } catch (err) {
    dsp.isAudioActive = false;
    if (err.message === 'NO_SYSTEM_AUDIO_TRACK') {
      animState.statusMessage = 'ENABLE "SHARE SYSTEM/TAB AUDIO" IN PROMPT';
      dom.startBtn.textContent = 'Retry (Enable Share Audio)';
    } else if (err.name === 'NotAllowedError') {
      animState.statusMessage = 'STANDBY // AUDIO PERMISSION DISMISSED';
      dom.startBtn.textContent = 'Connect System Audio';
    } else {
      animState.statusMessage = `ERR // ${err.name || 'STREAM FAILED'}`;
      dom.startBtn.textContent = 'Connect System Audio';
    }
    dom.startBtn.classList.remove('hidden');
  }
}

function getBandEnergy(data, startBin, endBin) {
  let sum = 0;
  const count = Math.max(1, endBin - startBin + 1);
  for (let i = startBin; i <= endBin; i++) {
    sum += data[i];
  }
  return sum / (count * 255);
}

function hzToMusicalNote(hz) {
  if (hz < 25) return '--';
  const midi = Math.round(12 * Math.log2(hz / 440) + 69);
  if (midi < 12 || midi > 119) return '--';
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/**
 * Overhauled Weighted 6-Vibe Classifier:
 * Evaluates BPM (>115 boosts upbeat vibes), Full-Spectrum Transient Flux (snares, vocals,
 * guitars—not just sub-bass!), RMS loudness, spectral balance, and Spotify metadata hints.
 * Eliminates false 'SLOW' classification on 120+ BPM Praise / Pop / Rock anthems.
 */
export function classifyCurrentAudioSnapshot() {
  const hint = trackState.metadataBiasVibe;
  if (!dsp.isAudioActive || dsp.rollingRms < 0.006) {
    return hint || dsp.vibe || 'AMBIENT';
  }

  const bpm = dsp.rollingBpm;
  const sub = dsp.rollingSub;
  const mid = dsp.rollingMid;
  const high = dsp.rollingHigh;
  const trb = dsp.rollingTreble;
  const flux = dsp.transientFluxAvg; // Full-spectrum transient activity (~0..1)
  const rms = dsp.rollingRms;
  const upbeatBpm = bpm >= 115;

  const scores = {
    ANTHEM: 0.15,
    EDM: 0.1,
    HIPHOP: 0.1,
    SLOW: 0.1,
    ACOUSTIC: 0.12,
    AMBIENT: 0.15,
  };

  // Apply strong metadata genre/mood hint when recognized from Track/Artist
  if (hint && scores[hint] !== undefined) {
    scores[hint] += 0.62;
  }

  // 1. Upbeat BPM (> 115) & Full-Spectrum Percussion/Vocal Flux strongly boost upbeat vibes
  //    and actively penalize 'SLOW' so 120+ BPM Praise/Pop/Rock NEVER land in 'SLOW'.
  if (upbeatBpm || flux > 0.24) {
    scores.SLOW -= 0.45;
    scores.AMBIENT -= 0.2;
    scores.ANTHEM += (upbeatBpm ? 0.42 : 0.2) + mid * 0.35 + high * 0.25 + Math.min(0.25, rms * 1.4);
    scores.EDM += (bpm >= 120 ? 0.38 : 0.15) + sub * 0.35 + trb * 0.3;
  }

  // 2. ANTHEM (Praise / Pop / Uplifting Rock): Strong vocal/guitar mids + snare/high energy + uplift
  if (mid > 0.32 && (high > 0.22 || flux > 0.18) && sub < mid * 1.35) {
    scores.ANTHEM += 0.44 + (bpm >= 108 ? 0.22 : 0);
  }

  // 3. EDM: High BPM + strong sub-bass + crisp high-frequency synth/hat energy + high flux
  if (sub > 0.38 && trb > 0.26 && (bpm >= 118 || flux > 0.3)) {
    scores.EDM += 0.55;
  }

  // 4. HIPHOP (Trap / R&B / 808): Heavy sub-bass dominating mids + punchy kick transients
  if (sub > 0.4 && sub > mid * 1.18 && (bpm < 116 || dsp.kickDensity > dsp.snareDensity)) {
    scores.HIPHOP += 0.65;
  }

  // 5. ACOUSTIC (Indie / Folk / Warm): Organic mid warmth > sub-bass, moderate flux & tempo
  if (mid > 0.26 && mid > sub * 1.15 && sub < 0.38 && trb < 0.34 && bpm < 118) {
    scores.ACOUSTIC += 0.48;
  }

  // 6. SLOW (Ballad / Sad / Rain): Strictly slow tempo (< 102 BPM), gentle transients & low RMS
  if ((bpm === 0 || bpm < 102) && flux < 0.17 && sub < 0.38 && high < 0.26) {
    scores.SLOW += 0.58;
  }

  // 7. AMBIENT (Lo-Fi / Instrumental / Chill): Very smooth low transient flux
  if (flux < 0.12 && rms < 0.14) {
    scores.AMBIENT += 0.52;
  }

  let winner = 'ANTHEM';
  let topScore = -99;
  for (const key in scores) {
    if (scores[key] > topScore) {
      topScore = scores[key];
      winner = key;
    }
  }
  return winner;
}

function triggerExpressiveBeatReaction(strength, isKick) {
  const vibe = getEffectiveVibe();
  const dir = Math.random() > 0.5 ? 1 : -1;
  const { fx, poster, motionIntensity: mi } = animState;
  const waveRippleScale = getWaveAndRippleScale(mi);
  const isHighEnergy = vibe === 'EDM' || vibe === 'ANTHEM' || vibe === 'HIPHOP';

  // Vibe-calibrated ambient light bloom: serene in SLOW/AMBIENT, sharp in EDM/ANTHEM
  const bloomPeak = Math.min(
    1,
    strength * (isHighEnergy ? 1.08 : 0.42) * Math.min(1.25, waveRippleScale)
  );
  gsapApi.fromTo(
    fx,
    { ambientBloom: bloomPeak },
    {
      ambientBloom: 0,
      duration: isHighEnergy ? 0.44 : 0.82,
      ease: 'power2.out',
      overwrite: 'auto',
    }
  );

  if (isKick) {
    const baseShake =
      vibe === 'EDM' || vibe === 'HIPHOP' ? 8.5 : vibe === 'ANTHEM' ? 5.2 : 0.6;
    const shakeAmp = baseShake * (mi < 0.45 ? 0.15 : Math.min(1.2, mi));

    gsapApi.fromTo(
      fx,
      {
        driverRecoil: strength * 0.95 * waveRippleScale,
        driverGlow: Math.min(1, strength * (isHighEnergy ? 1.2 : 0.65) * waveRippleScale),
        shakeX: (Math.random() - 0.5) * 2 * shakeAmp * strength,
        shakeY: (Math.random() - 0.5) * 2 * shakeAmp * strength,
        chromaSplit:
          mi < 0.6 ? 0 : strength * (vibe === 'EDM' || vibe === 'HIPHOP' ? 6.5 : 2.5),
      },
      {
        driverRecoil: 0,
        driverGlow: 0,
        shakeX: 0,
        shakeY: 0,
        chromaSplit: 0,
        duration: vibe === 'EDM' ? 0.48 : mi < 0.45 ? 0.92 : 0.68,
        ease: mi < 0.45 ? 'power2.out' : 'elastic.out(1.15, 0.4)',
        overwrite: 'auto',
      }
    );

    for (let i = 0; i < ripples.length; i++) {
      const sw = ripples[i];
      if (!sw.active) {
        gsapApi.killTweensOf(sw);
        sw.active = true;
        const dur = vibe === 'EDM' || vibe === 'HIPHOP' ? 0.82 : mi < 0.45 ? 1.65 : 1.15;
        // Soften ripple opacity by 60% in SLOW/AMBIENT via waveRippleScale (0.40 at mi=0.28)
        const peakRippleAlpha =
          Math.min(0.58, 0.2 + strength * 0.38) * waveRippleScale;
        gsapApi.fromTo(
          sw,
          { z: 1.0, radiusMult: 0.44 },
          {
            z: 0.12,
            radiusMult: 1.44,
            duration: dur,
            ease: 'expo.out',
            onComplete: () => {
              sw.active = false;
            },
          }
        );
        gsapApi.fromTo(
          sw,
          { alpha: peakRippleAlpha },
          { alpha: 0, duration: dur, ease: 'power2.out' }
        );
        break;
      }
    }
  }

  if (vibe === 'EDM') {
    fx.glitchSeed = Math.random() * 1000;
    gsapApi.fromTo(
      fx,
      {
        cubeScale: 1 + strength * 0.28,
        edmFlash: Math.min(0.42, strength * 0.38),
        glitchIntensity: strength > 0.48 ? strength * 0.88 : 0,
      },
      {
        cubeScale: 1,
        edmFlash: 0,
        glitchIntensity: 0,
        duration: 0.42,
        ease: 'expo.out',
        overwrite: 'auto',
      }
    );
  }

  // Restrained, readable beat scale on Track Title (ultra-calm in SLOW/AMBIENT)
  if (strength > 0.42 && mi > 0.35) {
    const maxScale =
      (vibe === 'EDM' || vibe === 'HIPHOP' ? 0.055 : 0.032) * Math.min(1.15, mi);
    gsapApi.fromTo(
      poster,
      {
        scalePunch: 1 + strength * maxScale,
        skewX: vibe === 'EDM' ? dir * strength * 0.04 : 0,
      },
      {
        scalePunch: 1,
        skewX: 0,
        duration: 0.5,
        ease: 'power2.out',
        overwrite: 'auto',
      }
    );
  }
}

export function updateAudioAndLifecycle(now) {
  if (trackState.connected) {
    pollSpotifyCurrentlyPlaying(false);
    updateLyricsPlaybackSync(now);
  }

  if (dsp.isAudioActive && dsp.analyser) {
    const { freqData, timeData, bandBins } = dsp;
    dsp.analyser.getByteFrequencyData(freqData);
    dsp.analyser.getByteTimeDomainData(timeData);

    const rawSub = getBandEnergy(freqData, bandBins.subBass.start, bandBins.subBass.end);
    const rawBass = getBandEnergy(freqData, bandBins.bass.start, bandBins.bass.end);
    const rawLowMid = getBandEnergy(freqData, bandBins.lowMid.start, bandBins.lowMid.end);
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

    // Expressive Adaptive Auto-Gain Control
    const rawPeak = Math.max(rawSub, rawBass, rawMid, rawHighMid, rawTreble, rawRms * 2.2);
    if (rawPeak > dsp.peakTracker) {
      dsp.peakTracker += (rawPeak - dsp.peakTracker) * 0.2;
    } else {
      dsp.peakTracker = Math.max(0.16, dsp.peakTracker * 0.997);
    }
    dsp.agcGain = Math.min(2.8, Math.max(0.9, 0.68 / dsp.peakTracker)) * dsp.userSensitivity;

    dsp.prevSub = dsp.subBass;
    dsp.prevMid = dsp.mid;
    dsp.prevHigh = dsp.highMid * 0.55 + dsp.treble * 0.45;

    dsp.subBass = shapeBand(rawSub, dsp.agcGain);
    dsp.bass = shapeBand(rawBass, dsp.agcGain);
    dsp.lowMid = shapeBand(rawLowMid, dsp.agcGain);
    dsp.mid = shapeBand(rawMid, dsp.agcGain);
    dsp.highMid = shapeBand(rawHighMid, dsp.agcGain);
    dsp.treble = shapeBand(rawTreble, dsp.agcGain);
    dsp.rms = Math.min(1, rawRms * dsp.agcGain * 1.75);

    // Fast-attack expressive envelopes (0.48 attack so hits snap immediately!)
    dsp.smoothSub += (dsp.subBass - dsp.smoothSub) * (dsp.subBass > dsp.smoothSub ? 0.48 : 0.13);
    dsp.smoothBass += (dsp.bass - dsp.smoothBass) * (dsp.bass > dsp.smoothBass ? 0.45 : 0.13);
    dsp.smoothMid += (dsp.mid - dsp.smoothMid) * (dsp.mid > dsp.smoothMid ? 0.44 : 0.13);
    dsp.smoothHighMid +=
      (dsp.highMid - dsp.smoothHighMid) * (dsp.highMid > dsp.smoothHighMid ? 0.46 : 0.15);
    dsp.smoothTreble +=
      (dsp.treble - dsp.smoothTreble) * (dsp.treble > dsp.smoothTreble ? 0.48 : 0.15);
    dsp.smoothRms += (dsp.rms - dsp.smoothRms) * 0.28;

    // Full-Spectrum Positive Spectral Flux (captures snares, vocals, guitars & kicks)
    const highCombined = dsp.highMid * 0.55 + dsp.treble * 0.45;
    const instantSpectralFlux =
      Math.max(0, dsp.subBass - dsp.prevSub) * 0.4 +
      Math.max(0, dsp.mid - dsp.prevMid) * 0.35 +
      Math.max(0, highCombined - dsp.prevHigh) * 0.45;

    dsp.transientFluxAvg =
      dsp.transientFluxAvg * 0.96 + Math.min(1, instantSpectralFlux * 3.2) * 0.04;

    // Sustained Chorus / Drop Velocity Intensity [0..1]
    const targetChorus = Math.min(
      1,
      Math.max(0, (dsp.smoothRms * 0.65 + dsp.transientFluxAvg * 0.55 - 0.18) * 1.55)
    );
    dsp.chorusIntensity += (targetChorus - dsp.chorusIntensity) * 0.06;

    // Rolling song descriptors
    dsp.rollingSub = dsp.rollingSub * 0.985 + dsp.subBass * 0.015;
    dsp.rollingMid = dsp.rollingMid * 0.985 + (dsp.lowMid * 0.4 + dsp.mid * 0.6) * 0.015;
    dsp.rollingHigh = dsp.rollingHigh * 0.985 + dsp.highMid * 0.015;
    dsp.rollingTreble = dsp.rollingTreble * 0.985 + dsp.treble * 0.015;
    dsp.rollingRms = dsp.rollingRms * 0.985 + dsp.rms * 0.015;
    dsp.kickDensity *= 0.985;
    dsp.snareDensity *= 0.985;

    // 1. Kick / Low-End Onset Detector
    const lowEnergy = dsp.subBass * 0.7 + dsp.bass * 0.3;
    dsp.subAvg = dsp.subAvg * 0.9 + lowEnergy * 0.1;
    const kickFlux = lowEnergy - dsp.subAvg + Math.max(0, dsp.subBass - dsp.prevSub) * 0.58;

    let rhythmHit = false;
    if (kickFlux > 0.065 && lowEnergy > 0.16 && now - dsp.lastKickTime > 135) {
      dsp.lastKickTime = now;
      const strength = Math.min(1, 0.46 + kickFlux * 2.4);
      dsp.kickPulse = strength;
      dsp.beatPulse = Math.max(dsp.beatPulse, strength);
      dsp.kickDensity = Math.min(4.5, dsp.kickDensity + 0.48);
      rhythmHit = true;
      triggerExpressiveBeatReaction(strength, true);
    }

    // 2. Full-Band Snare / Vocal / Clap Transient Detector (catches Praise/Pop/Rock rhythm!)
    const midHighEnergy = dsp.mid * 0.38 + highCombined * 0.62;
    dsp.highAvg = dsp.highAvg * 0.9 + midHighEnergy * 0.1;
    const snareFlux =
      midHighEnergy - dsp.highAvg + Math.max(0, highCombined - dsp.prevHigh) * 0.62;

    if (snareFlux > 0.062 && midHighEnergy > 0.15 && now - dsp.lastSnareTime > 120) {
      dsp.lastSnareTime = now;
      const snareStrength = Math.min(1, 0.42 + snareFlux * 2.3);
      dsp.snarePulse = snareStrength;
      dsp.beatPulse = Math.max(dsp.beatPulse, snareStrength * 0.85);
      dsp.snareDensity = Math.min(4.5, dsp.snareDensity + 0.45);
      if (!rhythmHit) {
        rhythmHit = true;
        triggerExpressiveBeatReaction(snareStrength * 0.8, false);
      }
    }

    // Full-Spectrum Rhythm BPM Estimator (works on snares/strums AND kicks)
    if (rhythmHit) {
      const dt = now - dsp.lastRhythmTime;
      if (dt > 230 && dt < 1500) {
        let instantBpm = 60000 / dt;
        while (instantBpm < 76) instantBpm *= 2;
        while (instantBpm > 172) instantBpm *= 0.5;
        dsp.rollingBpm =
          dsp.rollingBpm === 0 ? instantBpm : dsp.rollingBpm * 0.82 + instantBpm * 0.18;
      }
      if (dt > 230) {
        dsp.lastRhythmTime = now;
      }
    }

    // Dominant Pitch Tracking
    const hzPerBin = dsp.audioCtx.sampleRate / CONFIG.FFT_SIZE;
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
    if (peakVal > 30) {
      const targetHz = peakBin * hzPerBin;
      dsp.dominantHz = dsp.dominantHz === 0 ? targetHz : dsp.dominantHz * 0.74 + targetHz * 0.26;
      dsp.dominantNote = hzToMusicalNote(dsp.dominantHz);
    } else {
      dsp.dominantHz *= 0.95;
      if (dsp.dominantHz < 25) dsp.dominantNote = '--';
    }

    // Complete 1-Song-1-Vibe confirmation after sampling 2.8s of a new Spotify track
    if (trackState.connected && trackState.pendingTrackLock && now >= trackState.trackChangeTime) {
      trackState.pendingTrackLock = false;
      dsp.vibe = classifyCurrentAudioSnapshot();
      applyVibeVisualBlend(getEffectiveVibe());
    }

    // Fallback Silence-Boundary Song Detector (when Spotify is disconnected)
    if (!trackState.connected) {
      if (rawRms < 0.006) {
        if (dsp.silenceStart === 0) dsp.silenceStart = now;
        else if (now - dsp.silenceStart >= CONFIG.SILENCE_GAP_MS) {
          dsp.awaitingFallbackSongLock = true;
        }
      } else {
        if (dsp.silenceStart !== 0 && dsp.awaitingFallbackSongLock) {
          dsp.fallbackAnalyzeReadyAt = now + 2800;
        }
        dsp.silenceStart = 0;

        if (dsp.awaitingFallbackSongLock && now >= dsp.fallbackAnalyzeReadyAt) {
          dsp.awaitingFallbackSongLock = false;
          dsp.vibe = classifyCurrentAudioSnapshot();
          applyVibeVisualBlend(getEffectiveVibe());
          triggerTrackTitleEntrance();
        }
      }
    }
  } else {
    const breath = 0.5 + 0.5 * Math.sin(now * 0.0013);
    dsp.smoothSub = 0.04 + breath * 0.035;
    dsp.smoothMid = 0.035 + 0.02 * Math.sin(now * 0.0018);
    dsp.smoothTreble = 0.025;
    dsp.smoothRms = 0.02 + breath * 0.012;
    dsp.chorusIntensity *= 0.94;
    dsp.db = -60;
  }

  dsp.kickPulse *= 0.85;
  dsp.snarePulse *= 0.83;
  dsp.beatPulse *= 0.85;

  updateSpectralFallbackPalette(now);

  // Vibe-calibrated Ken Burns speed: ultra-slow & serene in SLOW/AMBIENT, energetic on EDM/ANTHEM
  const mi = animState.motionIntensity;
  const kbSpeedScale = mi <= 0.35 ? 0.24 : mi < 0.7 ? 0.52 : mi * 0.98;
  animState.backdrop.kenBurnsPhase +=
    (0.00042 +
      dsp.smoothRms * 0.0015 +
      dsp.chorusIntensity * 0.0012 +
      (mi >= 1 ? dsp.beatPulse * 0.0014 : 0)) *
    kbSpeedScale;
}
