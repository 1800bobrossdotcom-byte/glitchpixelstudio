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
// v1.7.0 — TEMPO / BEAT GRID. On top of the onset detector a tempo tracker
// estimates the BPM by autocorrelating an onset-strength history (8.5 s),
// then phase-locks a beat grid to the detected onsets (a small PLL on the
// grid anchor + period). The grid keeps ticking through breakdowns and
// quiet bars where no onset is detected, so visuals stay on the beat and
// bars (4 beats) give a slower clock for scene changes. `beatPhase` and
// `barPhase` are 0..1 sawtooths the shader can ease.
//
// Framework-free. Call `sample()` once per analysis tick (the ticker does).

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
  // ── tempo grid (v1.7.0) ──
  /** estimated tempo; 0 until the tracker has a confident estimate */
  bpm: number;
  /** 0..1 confidence in bpm (autocorrelation peak prominence × stability) */
  tempoConf: number;
  /** 0..1 position inside the current grid beat */
  beatPhase: number;
  /** 0..1 position inside the current 4-beat bar */
  barPhase: number;
  /** impulse at each grid beat (1 → decays), independent of onsets */
  gridBeat: number;
  /** monotonic grid beat counter */
  gridBeatCount: number;
  /** monotonic bar counter (gridBeatCount / 4, aligned to the downbeat guess) */
  barCount: number;
  /** diagnostics: measured analysis rate and total ticks */
  tickHz: number;
  ticks: number;
}

/** What the render loop reads: the latest features plus everything transient
 *  that happened since the previous `consume()` — peak-held, so a 5 fps
 *  renderer still sees every beat the 60 Hz analysis found. */
export interface AudioFrame extends AudioFeatures {
  /** beats detected since the last consume() */
  beatsSince: number;
  /** grid beats (tempo clock) since the last consume() */
  gridBeatsSince: number;
  /** bars started since the last consume() */
  barsSince: number;
  /** peak transient values since the last consume() */
  beatPeak: number; bassHitPeak: number; midHitPeak: number; trebleHitPeak: number;
  bassDeltaPeak: number; midDeltaPeak: number; trebDeltaPeak: number; fluxPeak: number;
  gridBeatPeak: number;
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
  /** Tap the beat by hand: re-anchors the grid (and a second tap sets the period). */
  tapTempo(): void;
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
   *  around 0.002–0.006; a kick in the room is > 0.02. Default 0.008. */
  gate?: number;
  /** Tempo search range. Default 68..184 BPM. */
  bpmMin?: number;
  bpmMax?: number;
  /**
   * v1.7.0 — run the analysis in an AudioWorklet (audio thread). Default
   * true; the main-thread ticker is the fallback when the WebView has no
   * AudioWorklet or the module fails to load.
   */
  worklet?: boolean;
  workletUrl?: string;
}

/** A feature frame posted by the worklet (features + audio-clock time). */
type WorkletFrame = AudioFeatures & { t: number; fft?: Uint8Array };
const FRAME_KEYS: ReadonlyArray<keyof AudioFeatures> = [
  "level", "bass", "mid", "treble", "flux", "centroid", "rolloff", "depth", "beat", "beatHold",
  "bassHit", "midHit", "trebleHit", "bassDelta", "midDelta", "trebDelta", "flow", "gain", "rawLevel", "gated", "beatCount",
  "bpm", "tempoConf", "beatPhase", "barPhase", "gridBeat", "gridBeatCount", "barCount", "tickHz", "ticks",
];

const ONSET_LEN = 512;        // ticks of onset history (~8.5 s at 60 Hz)
const AC_WINDOW = 480;        // ticks used for autocorrelation (8 s)
const AC_EVERY = 30;          // recompute every 0.5 s

export function createAudioFeatures(
  context: AudioContext,
  source: AudioNode,
  opts: AudioFeatureOptions = {},
): AudioFeatureAnalyser {
  const target = opts.targetPeak ?? 0.55;
  const gate = opts.gate ?? 0.008;
  const bpmMin = opts.bpmMin ?? 68;
  const bpmMax = opts.bpmMax ?? 184;
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
    bpm: 0, tempoConf: 0, beatPhase: 0, barPhase: 0, gridBeat: 0, gridBeatCount: 0, barCount: 0,
    tickHz: 60, ticks: 0,
  };
  // Peak-hold accumulators between consume() calls.
  const held = { beat: 0, bassHit: 0, midHit: 0, trebleHit: 0, bassDelta: 0, midDelta: 0, trebDelta: 0, flux: 0, gridBeat: 0 };
  const hold = () => {
    if (f.beat > held.beat) held.beat = f.beat;
    if (f.bassHit > held.bassHit) held.bassHit = f.bassHit;
    if (f.midHit > held.midHit) held.midHit = f.midHit;
    if (f.trebleHit > held.trebleHit) held.trebleHit = f.trebleHit;
    if (f.bassDelta > held.bassDelta) held.bassDelta = f.bassDelta;
    if (f.midDelta > held.midDelta) held.midDelta = f.midDelta;
    if (f.trebDelta > held.trebDelta) held.trebDelta = f.trebDelta;
    if (f.flux > held.flux) held.flux = f.flux;
    if (f.gridBeat > held.gridBeat) held.gridBeat = f.gridBeat;
  };
  let ticker: number | null = null;
  let lastBeatCount = 0;
  let lastGridCount = 0;
  let lastBarCount = 0;
  let disposed = false;

  // ── AudioWorklet path (v1.7.0) ──
  // The analysis runs on the audio thread and posts a frame per 512 samples
  // (~86–94 Hz). We drain the queue in consume(): every frame is applied in
  // order with peak-hold, so a starved main thread (5–18 fps WebGL) still
  // sees every beat, and the tempo grid is driven by the audio clock.
  let worklet: AudioWorkletNode | null = null;
  let workletReady = false;
  const queue: WorkletFrame[] = [];
  const applyFrame = (fr: WorkletFrame) => {
    for (const k of FRAME_KEYS) {
      const v = fr[k];
      if (v !== undefined) (f as unknown as Record<string, unknown>)[k] = v;
    }
    if (fr.fft && fr.fft.length === N) fft.set(fr.fft);
  };
  const attachWorklet = async () => {
    if (opts.worklet === false) return;
    const ctxW = context as AudioContext & { audioWorklet?: AudioWorklet };
    if (!ctxW.audioWorklet || typeof AudioWorkletNode === "undefined") return;
    try {
      await ctxW.audioWorklet.addModule(opts.workletUrl ?? "/gps-analyser.worklet.js");
      if (disposed) return;
      const node = new AudioWorkletNode(context, "gps-analyser", {
        numberOfInputs: 1, numberOfOutputs: 0,
        processorOptions: { targetPeak: target, gate, bpmMin, bpmMax, initialGain: opts.initialGain ?? 4.5, bandSmoothing: a },
      });
      node.port.onmessage = (e: MessageEvent) => {
        const d = e.data as WorkletFrame | undefined;
        if (!d || typeof d.t !== "number") return;
        queue.push(d);
        if (queue.length > 600) queue.splice(0, queue.length - 600);
      };
      source.connect(node);
      worklet = node;
      workletReady = true;
      if (ticker != null) { clearInterval(ticker); ticker = null; }
    } catch (e) {
      try { console.warn("[GPS] audio worklet unavailable, main-thread analysis:", (e as Error)?.message ?? e); } catch { /* ignore */ }
    }
  };
  void attachWorklet();

  const sm = { level: 0, bass: 0, mid: 0, treble: 0, centroid: 0, rolloff: 0, depth: 0 };
  let bassAvg = -1, midAvg = -1, trebAvg = -1;
  let bassPrev = 0, midPrev = 0, trebPrev = 0;
  let bassHold = 0, midHold = 0, trebHold = 0;
  let peakEnv = 0;

  // ── tempo tracker state ──
  const onset = new Float32Array(ONSET_LEN);
  let onsetIdx = 0;
  let tickCount = 0;
  let tickMs = 1000 / 60;          // measured analysis interval (EMA)
  let lastTickAt = 0;
  let periodMs = 0;                // grid period; 0 = no estimate yet
  let anchorMs = 0;                // time of a grid beat
  let candBpm = 0;                 // last autocorrelation winner
  let stableRuns = 0;              // consecutive agreeing estimates
  let lastDetMs = 0;               // last detected onset time (for tap/PLL)
  let lastPhase = 0;
  let downbeatOffset = 0;          // grid beats to subtract so bars start on the loudest beat
  const barEnergy = [0, 0, 0, 0];  // onset energy per beat-in-bar slot (for downbeat guess)
  let tapTimes: number[] = [];

  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  const estimateTempo = () => {
    // Autocorrelation of the mean-removed onset history over lags that map to
    // the BPM range; score adds half the lag×2 correlation so a kick-on-every
    // -other-beat pattern doesn't win at double tempo (octave guard).
    const n = Math.min(AC_WINDOW, tickCount);
    if (n < 180) return; // need ~3 s
    const lagMin = Math.max(8, Math.floor((60000 / bpmMax) / tickMs));
    const lagMax = Math.min(n >> 1, Math.ceil((60000 / bpmMin) / tickMs));
    if (lagMax <= lagMin + 2) return;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += onset[(onsetIdx - 1 - i + ONSET_LEN) % ONSET_LEN];
    mean /= n;
    let varSum = 0;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) { const v = onset[(onsetIdx - 1 - i + ONSET_LEN) % ONSET_LEN] - mean; x[i] = v; varSum += v * v; }
    if (varSum < 1e-6) return;
    const ac = new Float32Array(lagMax * 2 + 2);
    for (let L = lagMin; L <= Math.min(lagMax * 2, n - 1); L++) {
      let s = 0;
      for (let i = L; i < n; i++) s += x[i] * x[i - L];
      ac[L] = s / varSum;
    }
    let bestL = -1, bestScore = -1, sum = 0, cnt = 0;
    for (let L = lagMin; L <= lagMax; L++) {
      const s = ac[L] + (2 * L < ac.length ? 0.5 * ac[2 * L] : 0) + (L % 2 === 0 && L / 2 >= lagMin ? 0.25 * ac[L / 2] : 0);
      sum += s; cnt++;
      if (s > bestScore) { bestScore = s; bestL = L; }
    }
    if (bestL < 0) return;
    // Parabolic interpolation around the peak for a sub-lag period.
    let Lf = bestL;
    if (bestL > lagMin && bestL < lagMax) {
      const y0 = ac[bestL - 1], y1 = ac[bestL], y2 = ac[bestL + 1];
      const d = y0 - 2 * y1 + y2;
      if (Math.abs(d) > 1e-6) Lf = bestL + 0.5 * (y0 - y2) / d;
    }
    const meanScore = sum / Math.max(1, cnt);
    const prominence = Math.max(0, bestScore - meanScore) / Math.max(0.05, Math.abs(bestScore) + 0.05);
    const bpm = 60000 / (Lf * tickMs);
    // Stability: consecutive estimates within 3 %.
    if (candBpm > 0 && Math.abs(bpm - candBpm) / candBpm < 0.03) stableRuns = Math.min(8, stableRuns + 1);
    else stableRuns = 0;
    candBpm = bpm;
    const conf = Math.min(1, prominence * 1.6) * (0.35 + 0.65 * Math.min(1, stableRuns / 3));
    f.tempoConf = f.tempoConf * 0.6 + conf * 0.4;
    if (stableRuns >= 1 || periodMs === 0) {
      const newPeriod = 60000 / bpm;
      if (periodMs === 0) { periodMs = newPeriod; anchorMs = lastDetMs || nowMs(); }
      else {
        // Period follows the estimate, but never jumps across an octave at once.
        const ratio = newPeriod / periodMs;
        if (ratio > 0.6 && ratio < 1.6) periodMs = periodMs * 0.7 + newPeriod * 0.3;
        else if (f.tempoConf > 0.6 && stableRuns >= 3) periodMs = newPeriod;
      }
      f.bpm = Math.round((60000 / periodMs) * 10) / 10;
    }
  };

  const onDetectedBeat = (t: number, strength: number) => {
    lastDetMs = t;
    if (periodMs <= 0) return;
    // PLL: where did this onset land relative to the grid?
    const ph = ((t - anchorMs) / periodMs) % 1;
    const err = ph > 0.5 ? ph - 1 : ph; // signed, beats
    if (Math.abs(err) < 0.22) {
      // onset near a grid beat: pull the anchor toward it (gain by confidence)
      const g = 0.18 + 0.22 * (1 - Math.min(1, f.tempoConf));
      anchorMs += err * periodMs * g;
      // downbeat guess: accumulate onset strength per beat-in-bar slot
      const slot = ((Math.round((t - anchorMs) / periodMs) - downbeatOffset) % 4 + 4) % 4;
      barEnergy[slot] = barEnergy[slot] * 0.9 + strength * 0.1;
    } else if (f.tempoConf < 0.35) {
      // unsure grid, a clear onset: re-anchor on it
      anchorMs = t;
    }
  };

  const advanceGrid = (t: number) => {
    if (periodMs <= 0) { f.gridBeat = Math.max(0, f.gridBeat - 0.14); return; }
    const beatsF = (t - anchorMs) / periodMs;
    const phase = ((beatsF % 1) + 1) % 1;
    const beatIdx = Math.floor(beatsF);
    if (phase < lastPhase - 0.5 || (lastPhase === 0 && phase > 0 && f.gridBeatCount === 0)) {
      // wrapped → a grid beat
      f.gridBeatCount++;
      f.gridBeat = 1;
      // re-evaluate downbeat every bar: strongest slot becomes slot 0
      if (f.gridBeatCount % 4 === 0) {
        let best = 0; for (let i = 1; i < 4; i++) if (barEnergy[i] > barEnergy[best] * 1.25) best = i;
        if (best !== 0) { downbeatOffset = (downbeatOffset + best) % 4; const tmp = barEnergy.slice(); for (let i = 0; i < 4; i++) barEnergy[i] = tmp[(i + best) % 4]; }
      }
    } else {
      f.gridBeat = Math.max(0, f.gridBeat - 0.14);
    }
    lastPhase = phase;
    f.beatPhase = phase;
    const beatInBar = (((beatIdx - downbeatOffset) % 4) + 4) % 4;
    f.barPhase = (beatInBar + phase) / 4;
    f.barCount = Math.floor((beatIdx - downbeatOffset) / 4);
  };

  const sample = (): AudioFeatures => {
    const t = nowMs();
    if (lastTickAt > 0) { const dt = t - lastTickAt; if (dt > 4 && dt < 200) tickMs = tickMs * 0.95 + dt * 0.05; }
    lastTickAt = t;
    tickCount++;
    f.ticks = tickCount; f.tickHz = 1000 / tickMs;

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
    // The gate releases 450 ms after the last above-threshold sample so the
    // silence between two kicks never closes it.
    if (raw >= gate) gateOpenUntil = t + 450;
    if (f.rawLevel < gate && t > gateOpenUntil) {
      f.gated = true;
      // decay everything toward zero, hold the auto-gain where it is
      sm.level *= 0.85; sm.bass *= 0.85; sm.mid *= 0.85; sm.treble *= 0.85;
      f.level = sm.level; f.bass = sm.bass; f.mid = sm.mid; f.treble = sm.treble;
      f.flux = 0; f.bassDelta = 0; f.midDelta = 0; f.trebDelta = 0;
      f.beat = Math.max(0, f.beat - 0.14); f.beatHold = Math.max(0, f.beatHold - 1);
      f.bassHit = Math.max(0, f.bassHit - 0.16); f.midHit = Math.max(0, f.midHit - 0.16); f.trebleHit = Math.max(0, f.trebleHit - 0.18);
      f.flow = f.flow * 0.96;
      f.gain = gainNode.gain.value;
      onset[onsetIdx] = 0; onsetIdx = (onsetIdx + 1) % ONSET_LEN;
      // the grid keeps running through silence, confidence leaks away slowly
      f.tempoConf *= 0.9985;
      advanceGrid(t);
      hold();
      return f;
    }
    f.gated = false;
    let sumB = 0, nB = 0, sumM = 0, nM = 0, sumT = 0, nT = 0, sumAll = 0;
    let centNum = 0, centDen = 0, fluxSum = 0, fluxLow = 0;
    for (let i = 1; i < N; i++) {
      const v = fft[i];
      sumAll += v;
      if (i < 7) { sumB += v; nB++; }
      else if (i < 40) { sumM += v; nM++; }
      else { sumT += v; nT++; }
      centNum += i * v; centDen += v;
      const d = v - last[i];
      if (d > 0) { fluxSum += d; if (i < 24) fluxLow += d; }
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

    // Onset strength for the tempo tracker: low-band flux (kicks, snares)
    // plus the bass delta. Normalised to ~0..1.
    const onsetNow = Math.min(1, fluxLow / (23 * 50) + f.bassDelta * 2.5);
    onset[onsetIdx] = onsetNow; onsetIdx = (onsetIdx + 1) % ONSET_LEN;
    if (tickCount % AC_EVERY === 0) estimateTempo();

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
    if (beatNow && f.beatHold <= 0) { f.beat = 1; f.beatHold = 3; f.beatCount++; onDetectedBeat(t, bass + onsetNow); }
    else { f.beat = Math.max(0, f.beat - 0.14); f.beatHold = Math.max(0, f.beatHold - 1); }
    const bassHitNow = bass > bassAvg * 1.08 && bass > 0.10;
    const midHitNow = mid > midAvg * 1.08 && mid > 0.08;
    const trebHitNow = treble > trebAvg * 1.10 && treble > 0.06;
    if (bassHitNow && bassHold <= 0) { f.bassHit = 1; bassHold = 2; } else { f.bassHit = Math.max(0, f.bassHit - 0.16); bassHold = Math.max(0, bassHold - 1); }
    if (midHitNow && midHold <= 0) { f.midHit = 1; midHold = 2; } else { f.midHit = Math.max(0, f.midHit - 0.16); midHold = Math.max(0, midHold - 1); }
    if (trebHitNow && trebHold <= 0) { f.trebleHit = 1; trebHold = 2; } else { f.trebleHit = Math.max(0, f.trebleHit - 0.18); trebHold = Math.max(0, trebHold - 1); }
    advanceGrid(t);
    hold();
    return f;
  };

  const stopTicker = () => { if (ticker != null) { clearInterval(ticker); ticker = null; } };
  const startTicker = (hz = 60) => {
    stopTicker();
    if (workletReady) return;
    ticker = window.setInterval(() => { if (context.state === "running" && !workletReady) sample(); }, Math.max(8, Math.round(1000 / hz)));
  };
  const consume = (): AudioFrame => {
    if (workletReady) {
      // Drain every frame the audio thread produced since the last render.
      if (queue.length) {
        for (let i = 0; i < queue.length; i++) { applyFrame(queue[i]); hold(); }
        queue.length = 0;
      }
    } else if (ticker == null) {
      sample();
    }
    const out: AudioFrame = {
      ...f,
      beatsSince: f.beatCount - lastBeatCount,
      gridBeatsSince: f.gridBeatCount - lastGridCount,
      barsSince: Math.max(0, f.barCount - lastBarCount),
      beatPeak: Math.max(held.beat, f.beat), bassHitPeak: Math.max(held.bassHit, f.bassHit),
      midHitPeak: Math.max(held.midHit, f.midHit), trebleHitPeak: Math.max(held.trebleHit, f.trebleHit),
      bassDeltaPeak: held.bassDelta, midDeltaPeak: held.midDelta, trebDeltaPeak: held.trebDelta, fluxPeak: held.flux,
      gridBeatPeak: Math.max(held.gridBeat, f.gridBeat),
    };
    lastBeatCount = f.beatCount;
    lastGridCount = f.gridBeatCount;
    lastBarCount = f.barCount;
    held.beat = 0; held.bassHit = 0; held.midHit = 0; held.trebleHit = 0;
    held.bassDelta = 0; held.midDelta = 0; held.trebDelta = 0; held.flux = 0; held.gridBeat = 0;
    return out;
  };
  const tapTempo = () => {
    if (worklet) { try { worklet.port.postMessage({ type: "tap" }); } catch { /* ignore */ } return; }
    const t = nowMs();
    tapTimes = tapTimes.filter((x) => t - x < 3000);
    tapTimes.push(t);
    anchorMs = t;
    downbeatOffset = 0;
    if (tapTimes.length >= 2) {
      const ivs: number[] = [];
      for (let i = 1; i < tapTimes.length; i++) ivs.push(tapTimes[i] - tapTimes[i - 1]);
      const p = ivs.reduce((s, v) => s + v, 0) / ivs.length;
      if (p > 60000 / bpmMax && p < 60000 / bpmMin) { periodMs = p; f.bpm = Math.round((60000 / p) * 10) / 10; f.tempoConf = Math.max(f.tempoConf, 0.75); candBpm = f.bpm; stableRuns = 3; }
    }
  };

  return {
    features: f, analyser, fft, wave, sample, startTicker, stopTicker, consume, tapTempo,
    dispose() {
      disposed = true;
      stopTicker();
      if (worklet) { try { source.disconnect(worklet); } catch { /* ignore */ } try { worklet.port.onmessage = null; worklet.disconnect(); } catch { /* ignore */ } worklet = null; workletReady = false; }
      try { source.disconnect(gainNode); } catch { /* ignore */ }
      try { gainNode.disconnect(); } catch { /* ignore */ }
      try { analyser.disconnect(); } catch { /* ignore */ }
    },
  };
}
