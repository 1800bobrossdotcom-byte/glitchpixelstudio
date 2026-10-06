// vj-io / audio-features
//
// Port of the Terminal Velocity audio engine's analysis core
// (lovebeing/public/collections/terminalvelocity/audio-react.js → sampleAudio),
// which is what makes those pieces move to a quiet captured stream:
//
//   · fftSize 512, smoothingTimeConstant 0.15, dB range -85..-20 ("hot")
//   · a gain-boosted ANALYSIS tap (4.5×) with auto-gain that keeps the peak
//     band near 0.55, so a quiet phone mic drives the same thresholds as a
//     loud line-in — the audible path is never touched
//   · bands: bass bins 1–6, mid 7–39, treble 40+ (of 256), spectral flux,
//     centroid, rolloff, depth
//   · beat: bass > 1.12 × slow average and > 0.18, 3-frame hold, 0.14 decay
//   · per-band hit detectors against slow adaptive averages, positive
//     per-frame deltas ("new energy this frame"), and a ~3 s flow envelope
//
// Framework-free. Call `sample()` once per rendered frame.

export interface AudioFeatures {
  level: number; bass: number; mid: number; treble: number;
  flux: number; centroid: number; rolloff: number; depth: number;
  beat: number; beatHold: number;
  bassHit: number; midHit: number; trebleHit: number;
  bassDelta: number; midDelta: number; trebDelta: number;
  flow: number;
  /** current analysis-tap gain (auto-gain), for diagnostics */
  gain: number;
  /** pre-gain RMS level (0..1); below `gate` everything else is held at zero */
  rawLevel: number;
  /** true while the input is below the noise gate */
  gated: boolean;
  /** running count of detected beats (monotonic) */
  beatCount: number;
}

/** What the render loop reads: the latest features plus everything transient
 *  that happened since the previous `consume()` — peak-held, so a 5 fps
 *  renderer still sees every beat the 60 Hz analysis found. */
export interface AudioFrame extends AudioFeatures {
  /** beats detected since the last consume() */
  beatsSince: number;
  /** peak transient values since the last consume() */
  beatPeak: number; bassHitPeak: number; midHitPeak: number; trebleHitPeak: number;
  bassDeltaPeak: number; midDeltaPeak: number; trebDeltaPeak: number; fluxPeak: number;
}

export interface AudioFeatureAnalyser {
  readonly features: AudioFeatures;
  readonly analyser: AnalyserNode;
  readonly fft: Uint8Array;
  readonly wave: Uint8Array;
  /** Analyse the current frame. Cheap (256 bins). Returns `features`. */
  sample(): AudioFeatures;
  /**
   * v1.6.0 — run `sample()` on its own clock (default 60 Hz) so analysis no
   * longer depends on the render frame rate. A WebView rendering at 5–18 fps
   * with datamosh on was sampling the beat detector five times a second;
   * the beats fell between frames and the picture "did nothing".
   */
  startTicker(hz?: number): void;
  stopTicker(): void;
  /** Latest features + peak-held transients since the previous consume(). */
  consume(): AudioFrame;
  dispose(): void;
}

export interface AudioFeatureOptions {
  /** Target for the auto-gain peak band. TV uses 0.55 (headroom for deltas). */
  targetPeak?: number;
  /** Initial tap gain. TV uses 4.5. */
  initialGain?: number;
  /** Per-band EMA for level/bass/mid/treble. TV uses 0.65. */
  bandSmoothing?: number;
  /** Noise gate on the PRE-gain RMS (0..1). Room tone on a phone mic sits
   *  around 0.002–0.006; a kick in the room is > 0.02. Default 0.012. */
  gate?: number;
}

export function createAudioFeatures(
  context: AudioContext,
  source: AudioNode,
  opts: AudioFeatureOptions = {},
): AudioFeatureAnalyser {
  const target = opts.targetPeak ?? 0.55;
  const gate = opts.gate ?? 0.008;
  const gainNode = context.createGain();
  gainNode.gain.value = opts.initialGain ?? 4.5;
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.15;
  analyser.minDecibels = -85;
  analyser.maxDecibels = -20;
  source.connect(gainNode);
  gainNode.connect(analyser);

  const N = analyser.frequencyBinCount;
  const fft = new Uint8Array(N);
  const wave = new Uint8Array(N);
  const waveF = new Float32Array(analyser.fftSize);
  const last = new Uint8Array(N);
  let gateOpenUntil = 0;
  const a = opts.bandSmoothing ?? 0.65;

  const f: AudioFeatures = {
    level: 0, bass: 0, mid: 0, treble: 0, flux: 0, centroid: 0, rolloff: 0, depth: 0,
    beat: 0, beatHold: 0, bassHit: 0, midHit: 0, trebleHit: 0,
    bassDelta: 0, midDelta: 0, trebDelta: 0, flow: 0, gain: gainNode.gain.value, rawLevel: 0, gated: true, beatCount: 0,
  };
  // Peak-hold accumulators between consume() calls.
  const held = { beats: 0, beat: 0, bassHit: 0, midHit: 0, trebleHit: 0, bassDelta: 0, midDelta: 0, trebDelta: 0, flux: 0 };
  const hold = () => {
    if (f.beat > held.beat) held.beat = f.beat;
    if (f.bassHit > held.bassHit) held.bassHit = f.bassHit;
    if (f.midHit > held.midHit) held.midHit = f.midHit;
    if (f.trebleHit > held.trebleHit) held.trebleHit = f.trebleHit;
    if (f.bassDelta > held.bassDelta) held.bassDelta = f.bassDelta;
    if (f.midDelta > held.midDelta) held.midDelta = f.midDelta;
    if (f.trebDelta > held.trebDelta) held.trebDelta = f.trebDelta;
    if (f.flux > held.flux) held.flux = f.flux;
  };
  let ticker: number | null = null;
  let lastBeatCount = 0;
  const sm = { level: 0, bass: 0, mid: 0, treble: 0, centroid: 0, rolloff: 0, depth: 0 };
  let bassAvg = -1, midAvg = -1, trebAvg = -1;
  let bassPrev = 0, midPrev = 0, trebPrev = 0;
  let bassHold = 0, midHold = 0, trebHold = 0;
  let peakEnv = 0;

  const sample = (): AudioFeatures => {
    analyser.getByteFrequencyData(fft);
    analyser.getByteTimeDomainData(wave);
    // Noise gate on the pre-gain signal. The time-domain buffer is post-gain,
    // so divide its RMS by the current tap gain. Terminal Velocity never
    // needed this (desktop audio is never silent); a phone in a quiet room is,
    // and without the gate auto-gain turns room tone into a full-time beat.
    // Float samples: the byte buffer quantises anything under −42 dBFS to
    // flat 128, which read a quiet line-in as silence.
    let rms2 = 0;
    try { analyser.getFloatTimeDomainData(waveF); for (let i = 0; i < waveF.length; i++) rms2 += waveF[i] * waveF[i]; rms2 /= waveF.length; }
    catch { for (let i = 0; i < N; i++) { const v = (wave[i] - 128) / 128; rms2 += v * v; } rms2 /= N; }
    const raw = Math.sqrt(rms2) / Math.max(1, gainNode.gain.value || 1);
    f.rawLevel = Math.max(raw, f.rawLevel * 0.8 + raw * 0.2);
    const nowMs = (typeof performance !== "undefined" ? performance.now() : Date.now());
    // The gate releases 450 ms after the last above-threshold sample so the
    // silence between two kicks never closes it.
    if (raw >= gate) gateOpenUntil = nowMs + 450;
    if (f.rawLevel < gate && nowMs > gateOpenUntil) {
      f.gated = true;
      // decay everything toward zero, hold the auto-gain where it is
      sm.level *= 0.85; sm.bass *= 0.85; sm.mid *= 0.85; sm.treble *= 0.85;
      f.level = sm.level; f.bass = sm.bass; f.mid = sm.mid; f.treble = sm.treble;
      f.flux = 0; f.bassDelta = 0; f.midDelta = 0; f.trebDelta = 0;
      f.beat = Math.max(0, f.beat - 0.14); f.beatHold = Math.max(0, f.beatHold - 1);
      f.bassHit = Math.max(0, f.bassHit - 0.16); f.midHit = Math.max(0, f.midHit - 0.16); f.trebleHit = Math.max(0, f.trebleHit - 0.18);
      f.flow = f.flow * 0.96;
      f.gain = gainNode.gain.value;
      hold();
      return f;
    }
    f.gated = false;
    let sumB = 0, nB = 0, sumM = 0, nM = 0, sumT = 0, nT = 0, sumAll = 0;
    let centNum = 0, centDen = 0, fluxSum = 0;
    for (let i = 1; i < N; i++) {
      const v = fft[i];
      sumAll += v;
      if (i < 7) { sumB += v; nB++; }
      else if (i < 40) { sumM += v; nM++; }
      else { sumT += v; nT++; }
      centNum += i * v; centDen += v;
      const d = v - last[i];
      if (d > 0) fluxSum += d;
      last[i] = v;
    }
    const bass = (nB ? sumB / nB : 0) / 255;
    const mid = (nM ? sumM / nM : 0) / 255;
    const treble = (nT ? sumT / nT : 0) / 255;
    const level = sumAll / ((N - 1) * 255);
    const flux = Math.min(1, fluxSum / ((N - 1) * 60));
    const centroid = centDen ? (centNum / centDen) / N : 0;

    let rollCum = 0; const rollThresh = sumAll * 0.85; let rollBin = N - 1;
    for (let i = 1; i < N; i++) { rollCum += fft[i]; if (rollCum >= rollThresh) { rollBin = i; break; } }
    const rolloff = rollBin / N;
    let sumLow = 0; for (let i = 1; i < 13 && i < N; i++) sumLow += fft[i];
    const depth = sumAll ? Math.min(1, sumLow / sumAll) : 0;

    sm.level = sm.level * (1 - a) + level * a;
    sm.bass = sm.bass * (1 - a) + bass * a;
    sm.mid = sm.mid * (1 - a) + mid * a;
    sm.treble = sm.treble * (1 - a) + treble * a;
    sm.centroid = sm.centroid * 0.88 + centroid * 0.12;
    sm.rolloff = sm.rolloff * 0.88 + rolloff * 0.12;
    sm.depth = sm.depth * 0.88 + depth * 0.12;

    f.level = sm.level; f.bass = sm.bass; f.mid = sm.mid; f.treble = sm.treble;
    f.centroid = sm.centroid; f.rolloff = sm.rolloff; f.depth = sm.depth; f.flux = flux;

    f.bassDelta = Math.max(0, bass - bassPrev);
    f.midDelta = Math.max(0, mid - midPrev);
    f.trebDelta = Math.max(0, treble - trebPrev);
    bassPrev = bass; midPrev = mid; trebPrev = treble;
    f.flow = f.flow * 0.96 + level * 0.04;

    // Auto-gain on the analysis tap: keep the peak band near `target`, ramp
    // down faster than up so a kick never blows the detectors out.
    const peakNow = Math.max(bass, mid, treble);
    peakEnv = Math.max(peakNow, peakEnv * 0.965);
    let g = gainNode.gain.value || 1;
    if (peakEnv > 0.01) {
      const wanted = Math.max(1.0, Math.min(24.0, (target / peakEnv) * g));
      const alpha = wanted < g ? 0.30 : 0.12;
      g = g * (1 - alpha) + wanted * alpha;
      try { gainNode.gain.setTargetAtTime(g, context.currentTime, 0.03); } catch { /* ignore */ }
    }
    f.gain = g;

    // Beat + per-band hits against slow adaptive averages.
    bassAvg = bassAvg < 0 ? bass : bassAvg * 0.985 + bass * 0.015;
    midAvg = midAvg < 0 ? mid : midAvg * 0.985 + mid * 0.015;
    trebAvg = trebAvg < 0 ? treble : trebAvg * 0.985 + treble * 0.015;
    const beatNow = bass > bassAvg * 1.12 && bass > 0.18;
    if (beatNow && f.beatHold <= 0) { f.beat = 1; f.beatHold = 3; f.beatCount++; }
    else { f.beat = Math.max(0, f.beat - 0.14); f.beatHold = Math.max(0, f.beatHold - 1); }
    const bassHitNow = bass > bassAvg * 1.08 && bass > 0.10;
    const midHitNow = mid > midAvg * 1.08 && mid > 0.08;
    const trebHitNow = treble > trebAvg * 1.10 && treble > 0.06;
    if (bassHitNow && bassHold <= 0) { f.bassHit = 1; bassHold = 2; } else { f.bassHit = Math.max(0, f.bassHit - 0.16); bassHold = Math.max(0, bassHold - 1); }
    if (midHitNow && midHold <= 0) { f.midHit = 1; midHold = 2; } else { f.midHit = Math.max(0, f.midHit - 0.16); midHold = Math.max(0, midHold - 1); }
    if (trebHitNow && trebHold <= 0) { f.trebleHit = 1; trebHold = 2; } else { f.trebleHit = Math.max(0, f.trebleHit - 0.18); trebHold = Math.max(0, trebHold - 1); }
    hold();
    return f;
  };

  const stopTicker = () => { if (ticker != null) { clearInterval(ticker); ticker = null; } };
  const startTicker = (hz = 60) => {
    stopTicker();
    ticker = window.setInterval(() => { if (context.state === "running") sample(); }, Math.max(8, Math.round(1000 / hz)));
  };
  const consume = (): AudioFrame => {
    if (ticker == null) sample();
    const out: AudioFrame = {
      ...f,
      beatsSince: f.beatCount - lastBeatCount,
      beatPeak: Math.max(held.beat, f.beat), bassHitPeak: Math.max(held.bassHit, f.bassHit),
      midHitPeak: Math.max(held.midHit, f.midHit), trebleHitPeak: Math.max(held.trebleHit, f.trebleHit),
      bassDeltaPeak: held.bassDelta, midDeltaPeak: held.midDelta, trebDeltaPeak: held.trebDelta, fluxPeak: held.flux,
    };
    lastBeatCount = f.beatCount;
    held.beat = 0; held.bassHit = 0; held.midHit = 0; held.trebleHit = 0;
    held.bassDelta = 0; held.midDelta = 0; held.trebDelta = 0; held.flux = 0;
    return out;
  };

  return {
    features: f, analyser, fft, wave, sample, startTicker, stopTicker, consume,
    dispose() {
      stopTicker();
      try { source.disconnect(gainNode); } catch { /* ignore */ }
      try { gainNode.disconnect(); } catch { /* ignore */ }
      try { analyser.disconnect(); } catch { /* ignore */ }
    },
  };
}
