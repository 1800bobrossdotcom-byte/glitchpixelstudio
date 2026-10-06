// Glitch Pixel Studio — audio analysis AudioWorklet (v1.7.0)
//
// Runs on the AUDIO thread, so the beat detector and tempo tracker tick at a
// rock-steady ~86–94 Hz (one tick per 512 samples) no matter how busy the
// main thread is with WebGL. The main thread only drains timestamped
// feature frames (src/lib/vj-io/audio-features.ts → consume()).
//
// The maths mirrors the Terminal Velocity analysis core that shipped on the
// main thread in 1.5.4–1.6.0 (bands, flux, hits, deltas, flow, auto-gain,
// float noise gate) plus the 1.7.0 tempo grid (autocorrelation BPM + PLL).

const N = 512, HALF = 256;

function makeHann(n) { const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)); return w; }
function makeRev(n) { const r = new Uint16Array(n); const bits = Math.log2(n) | 0; for (let i = 0; i < n; i++) { let x = i, y = 0; for (let b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; } r[i] = y; } return r; }
const HANN = makeHann(N), REV = makeRev(N);
const COS = new Float32Array(N / 2), SIN = new Float32Array(N / 2);
for (let i = 0; i < N / 2; i++) { COS[i] = Math.cos((-2 * Math.PI * i) / N); SIN[i] = Math.sin((-2 * Math.PI * i) / N); }

function fft(re, im) {
  for (let i = 0; i < N; i++) { const j = REV[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let start = 0; start < N; start += size) {
      for (let k = 0; k < half; k++) {
        const tw = k * step; const wr = COS[tw], wi = SIN[tw];
        const a = start + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
}

const ONSET_LEN = 1024, AC_WINDOW = 760, AC_EVERY = 45; // ~8 s window at ~94 Hz, re-estimate every ~0.5 s

class GpsAnalyser extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const p = (options && options.processorOptions) || {};
    this.target = p.targetPeak ?? 0.55;
    this.gate = p.gate ?? 0.008;
    this.bpmMin = p.bpmMin ?? 68;
    this.bpmMax = p.bpmMax ?? 184;
    this.gain = p.initialGain ?? 4.5;
    this.a = p.bandSmoothing ?? 0.65;
    this.ring = new Float32Array(N); this.pos = 0; this.since = 0;
    this.re = new Float32Array(N); this.im = new Float32Array(N);
    this.mag = new Float32Array(HALF); this.fft = new Uint8Array(HALF); this.last = new Uint8Array(HALF);
    this.sm = { level: 0, bass: 0, mid: 0, treble: 0, centroid: 0, rolloff: 0, depth: 0 };
    this.bassAvg = -1; this.midAvg = -1; this.trebAvg = -1;
    this.bassPrev = 0; this.midPrev = 0; this.trebPrev = 0;
    this.bassHold = 0; this.midHold = 0; this.trebHold = 0;
    this.peakEnv = 0; this.gateOpenUntil = 0; this.rawLevel = 0;
    this.f = {
      level: 0, bass: 0, mid: 0, treble: 0, flux: 0, centroid: 0, rolloff: 0, depth: 0,
      beat: 0, beatHold: 0, bassHit: 0, midHit: 0, trebleHit: 0, bassDelta: 0, midDelta: 0, trebDelta: 0, flow: 0,
      gain: this.gain, rawLevel: 0, gated: true, beatCount: 0,
      bpm: 0, tempoConf: 0, beatPhase: 0, barPhase: 0, gridBeat: 0, gridBeatCount: 0, barCount: 0, tickHz: 0, ticks: 0,
    };
    // tempo
    this.onset = new Float32Array(ONSET_LEN); this.onsetIdx = 0; this.tickCount = 0;
    this.tickMs = (N / sampleRate) * 1000;
    this.periodMs = 0; this.anchorMs = 0; this.candBpm = 0; this.stableRuns = 0; this.lastDetMs = 0; this.lastPhase = 0;
    this.downbeatOffset = 0; this.barEnergy = [0, 0, 0, 0]; this.tapTimes = [];
    this.port.onmessage = (e) => { const d = e.data; if (d && d.type === "tap") this.tap(); };
  }

  process(inputs) {
    const inp = inputs[0];
    if (!inp || !inp.length) return true;
    const c0 = inp[0], c1 = inp[1];
    const n = c0.length;
    for (let i = 0; i < n; i++) { const s = c1 ? (c0[i] + c1[i]) * 0.5 : c0[i]; this.ring[this.pos] = s; this.pos = (this.pos + 1) & (N - 1); }
    this.since += n;
    while (this.since >= N) { this.since -= N; this.tick(); }
    return true;
  }

  tick() {
    const f = this.f;
    const t = currentTime * 1000;
    this.tickCount++;
    f.ticks = this.tickCount; f.tickHz = 1000 / this.tickMs;
    // pre-gain RMS (float) → noise gate
    let rms2 = 0; for (let i = 0; i < N; i++) { const v = this.ring[i]; rms2 += v * v; }
    const raw = Math.sqrt(rms2 / N);
    this.rawLevel = Math.max(raw, this.rawLevel * 0.8 + raw * 0.2);
    f.rawLevel = this.rawLevel;
    if (raw >= this.gate) this.gateOpenUntil = t + 450;
    // FFT of the gain-boosted, windowed block (newest sample last)
    for (let i = 0; i < N; i++) { this.re[i] = this.ring[(this.pos + i) & (N - 1)] * HANN[i] * this.gain; this.im[i] = 0; }
    fft(this.re, this.im);
    // AnalyserNode-compatible bytes: magnitude/N, smoothing 0.15, dB -85..-20
    for (let k = 0; k < HALF; k++) {
      const m = Math.sqrt(this.re[k] * this.re[k] + this.im[k] * this.im[k]) / N;
      const sm = 0.15 * this.mag[k] + 0.85 * m;
      this.mag[k] = sm;
      const db = sm > 1e-9 ? 20 * Math.log10(sm) : -200;
      let b = ((db + 85) / 65) * 255;
      this.fft[k] = b < 0 ? 0 : b > 255 ? 255 : b | 0;
    }
    const sm = this.sm;
    if (this.rawLevel < this.gate && t > this.gateOpenUntil) {
      f.gated = true;
      sm.level *= 0.85; sm.bass *= 0.85; sm.mid *= 0.85; sm.treble *= 0.85;
      f.level = sm.level; f.bass = sm.bass; f.mid = sm.mid; f.treble = sm.treble;
      f.flux = 0; f.bassDelta = 0; f.midDelta = 0; f.trebDelta = 0;
      f.beat = Math.max(0, f.beat - 0.14); f.beatHold = Math.max(0, f.beatHold - 1);
      f.bassHit = Math.max(0, f.bassHit - 0.16); f.midHit = Math.max(0, f.midHit - 0.16); f.trebleHit = Math.max(0, f.trebleHit - 0.18);
      f.flow *= 0.96; f.gain = this.gain;
      this.onset[this.onsetIdx] = 0; this.onsetIdx = (this.onsetIdx + 1) % ONSET_LEN;
      f.tempoConf *= 0.9985;
      this.advanceGrid(t);
      this.post(t);
      return;
    }
    f.gated = false;
    const fftB = this.fft, last = this.last;
    let sumB = 0, nB = 0, sumM = 0, nM = 0, sumT = 0, nT = 0, sumAll = 0, centNum = 0, centDen = 0, fluxSum = 0, fluxLow = 0;
    for (let i = 1; i < HALF; i++) {
      const v = fftB[i];
      sumAll += v;
      if (i < 7) { sumB += v; nB++; } else if (i < 40) { sumM += v; nM++; } else { sumT += v; nT++; }
      centNum += i * v; centDen += v;
      const d = v - last[i];
      if (d > 0) { fluxSum += d; if (i < 24) fluxLow += d; }
      last[i] = v;
    }
    const bass = (nB ? sumB / nB : 0) / 255, mid = (nM ? sumM / nM : 0) / 255, treble = (nT ? sumT / nT : 0) / 255;
    const level = sumAll / ((HALF - 1) * 255);
    const flux = Math.min(1, fluxSum / ((HALF - 1) * 60));
    const centroid = centDen ? (centNum / centDen) / HALF : 0;
    let rollCum = 0; const rollThresh = sumAll * 0.85; let rollBin = HALF - 1;
    for (let i = 1; i < HALF; i++) { rollCum += fftB[i]; if (rollCum >= rollThresh) { rollBin = i; break; } }
    let sumLow = 0; for (let i = 1; i < 13; i++) sumLow += fftB[i];
    const depth = sumAll ? Math.min(1, sumLow / sumAll) : 0;
    const a = this.a;
    sm.level = sm.level * (1 - a) + level * a; sm.bass = sm.bass * (1 - a) + bass * a;
    sm.mid = sm.mid * (1 - a) + mid * a; sm.treble = sm.treble * (1 - a) + treble * a;
    sm.centroid = sm.centroid * 0.88 + centroid * 0.12; sm.rolloff = sm.rolloff * 0.88 + (rollBin / HALF) * 0.12; sm.depth = sm.depth * 0.88 + depth * 0.12;
    f.level = sm.level; f.bass = sm.bass; f.mid = sm.mid; f.treble = sm.treble; f.centroid = sm.centroid; f.rolloff = sm.rolloff; f.depth = sm.depth; f.flux = flux;
    f.bassDelta = Math.max(0, bass - this.bassPrev); f.midDelta = Math.max(0, mid - this.midPrev); f.trebDelta = Math.max(0, treble - this.trebPrev);
    this.bassPrev = bass; this.midPrev = mid; this.trebPrev = treble;
    f.flow = f.flow * 0.96 + level * 0.04;
    const onsetNow = Math.min(1, fluxLow / (23 * 50) + f.bassDelta * 2.5);
    this.onset[this.onsetIdx] = onsetNow; this.onsetIdx = (this.onsetIdx + 1) % ONSET_LEN;
    if (this.tickCount % AC_EVERY === 0) this.estimateTempo(t);
    // auto-gain (software, on the analysis only)
    const peakNow = Math.max(bass, mid, treble);
    this.peakEnv = Math.max(peakNow, this.peakEnv * 0.965);
    if (this.peakEnv > 0.01) {
      const wanted = Math.max(1.0, Math.min(24.0, (this.target / this.peakEnv) * this.gain));
      const alpha = wanted < this.gain ? 0.30 : 0.12;
      this.gain = this.gain * (1 - alpha) + wanted * alpha;
    }
    f.gain = this.gain;
    // beat + hits
    this.bassAvg = this.bassAvg < 0 ? bass : this.bassAvg * 0.985 + bass * 0.015;
    this.midAvg = this.midAvg < 0 ? mid : this.midAvg * 0.985 + mid * 0.015;
    this.trebAvg = this.trebAvg < 0 ? treble : this.trebAvg * 0.985 + treble * 0.015;
    const beatNow = bass > this.bassAvg * 1.12 && bass > 0.18;
    if (beatNow && f.beatHold <= 0) { f.beat = 1; f.beatHold = 4; f.beatCount++; this.onBeat(t, bass + onsetNow); }
    else { f.beat = Math.max(0, f.beat - 0.10); f.beatHold = Math.max(0, f.beatHold - 1); }
    const bassHitNow = bass > this.bassAvg * 1.08 && bass > 0.10;
    const midHitNow = mid > this.midAvg * 1.08 && mid > 0.08;
    const trebHitNow = treble > this.trebAvg * 1.10 && treble > 0.06;
    if (bassHitNow && this.bassHold <= 0) { f.bassHit = 1; this.bassHold = 3; } else { f.bassHit = Math.max(0, f.bassHit - 0.12); this.bassHold = Math.max(0, this.bassHold - 1); }
    if (midHitNow && this.midHold <= 0) { f.midHit = 1; this.midHold = 3; } else { f.midHit = Math.max(0, f.midHit - 0.12); this.midHold = Math.max(0, this.midHold - 1); }
    if (trebHitNow && this.trebHold <= 0) { f.trebleHit = 1; this.trebHold = 3; } else { f.trebleHit = Math.max(0, f.trebleHit - 0.14); this.trebHold = Math.max(0, this.trebHold - 1); }
    this.advanceGrid(t);
    this.post(t);
  }

  post(t) {
    const f = this.f;
    const msg = { t, ...f };
    if (this.tickCount % 3 === 0) msg.fft = this.fft.slice();
    this.port.postMessage(msg);
  }

  estimateTempo() {
    const n = Math.min(AC_WINDOW, this.tickCount);
    if (n < 240) return;
    const tickMs = this.tickMs;
    const lagMin = Math.max(8, Math.floor((60000 / this.bpmMax) / tickMs));
    const lagMax = Math.min(n >> 1, Math.ceil((60000 / this.bpmMin) / tickMs));
    if (lagMax <= lagMin + 2) return;
    const on = this.onset, idx = this.onsetIdx;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += on[(idx - 1 - i + ONSET_LEN) % ONSET_LEN];
    mean /= n;
    const x = new Float32Array(n); let varSum = 0;
    for (let i = 0; i < n; i++) { const v = on[(idx - 1 - i + ONSET_LEN) % ONSET_LEN] - mean; x[i] = v; varSum += v * v; }
    if (varSum < 1e-6) return;
    const acLen = lagMax * 2 + 2; const ac = new Float32Array(acLen);
    const Lend = Math.min(lagMax * 2, n - 1);
    for (let L = lagMin; L <= Lend; L++) { let s = 0; for (let i = L; i < n; i++) s += x[i] * x[i - L]; ac[L] = s / varSum; }
    let bestL = -1, bestScore = -1, sum = 0, cnt = 0;
    for (let L = lagMin; L <= lagMax; L++) {
      const s = ac[L] + (2 * L < acLen ? 0.5 * ac[2 * L] : 0) + (L % 2 === 0 && L / 2 >= lagMin ? 0.25 * ac[L / 2] : 0);
      sum += s; cnt++;
      if (s > bestScore) { bestScore = s; bestL = L; }
    }
    if (bestL < 0) return;
    let Lf = bestL;
    if (bestL > lagMin && bestL < lagMax) { const y0 = ac[bestL - 1], y1 = ac[bestL], y2 = ac[bestL + 1]; const d = y0 - 2 * y1 + y2; if (Math.abs(d) > 1e-6) Lf = bestL + 0.5 * (y0 - y2) / d; }
    const meanScore = sum / Math.max(1, cnt);
    const prominence = Math.max(0, bestScore - meanScore) / Math.max(0.05, Math.abs(bestScore) + 0.05);
    const bpm = 60000 / (Lf * tickMs);
    if (this.candBpm > 0 && Math.abs(bpm - this.candBpm) / this.candBpm < 0.03) this.stableRuns = Math.min(8, this.stableRuns + 1); else this.stableRuns = 0;
    this.candBpm = bpm;
    const conf = Math.min(1, prominence * 1.6) * (0.35 + 0.65 * Math.min(1, this.stableRuns / 3));
    const f = this.f;
    f.tempoConf = f.tempoConf * 0.6 + conf * 0.4;
    if (this.stableRuns >= 1 || this.periodMs === 0) {
      const newPeriod = 60000 / bpm;
      if (this.periodMs === 0) { this.periodMs = newPeriod; this.anchorMs = this.lastDetMs || currentTime * 1000; }
      else {
        const ratio = newPeriod / this.periodMs;
        if (ratio > 0.6 && ratio < 1.6) this.periodMs = this.periodMs * 0.7 + newPeriod * 0.3;
        else if (f.tempoConf > 0.6 && this.stableRuns >= 3) this.periodMs = newPeriod;
      }
      f.bpm = Math.round((60000 / this.periodMs) * 10) / 10;
    }
  }

  onBeat(t, strength) {
    this.lastDetMs = t;
    if (this.periodMs <= 0) return;
    const ph = ((t - this.anchorMs) / this.periodMs) % 1;
    const err = ph > 0.5 ? ph - 1 : ph;
    if (Math.abs(err) < 0.22) {
      const g = 0.18 + 0.22 * (1 - Math.min(1, this.f.tempoConf));
      this.anchorMs += err * this.periodMs * g;
      const slot = ((Math.round((t - this.anchorMs) / this.periodMs) - this.downbeatOffset) % 4 + 4) % 4;
      this.barEnergy[slot] = this.barEnergy[slot] * 0.9 + strength * 0.1;
    } else if (this.f.tempoConf < 0.35) {
      this.anchorMs = t;
    }
  }

  advanceGrid(t) {
    const f = this.f;
    if (this.periodMs <= 0) { f.gridBeat = Math.max(0, f.gridBeat - 0.10); return; }
    const beatsF = (t - this.anchorMs) / this.periodMs;
    const phase = ((beatsF % 1) + 1) % 1;
    const beatIdx = Math.floor(beatsF);
    if (phase < this.lastPhase - 0.5) {
      f.gridBeatCount++;
      f.gridBeat = 1;
      if (f.gridBeatCount % 4 === 0) {
        const be = this.barEnergy; let best = 0;
        for (let i = 1; i < 4; i++) if (be[i] > be[best] * 1.25) best = i;
        if (best !== 0) { this.downbeatOffset = (this.downbeatOffset + best) % 4; const tmp = be.slice(); for (let i = 0; i < 4; i++) be[i] = tmp[(i + best) % 4]; }
      }
    } else {
      f.gridBeat = Math.max(0, f.gridBeat - 0.10);
    }
    this.lastPhase = phase;
    f.beatPhase = phase;
    const beatInBar = (((beatIdx - this.downbeatOffset) % 4) + 4) % 4;
    f.barPhase = (beatInBar + phase) / 4;
    f.barCount = Math.floor((beatIdx - this.downbeatOffset) / 4);
  }

  tap() {
    const t = currentTime * 1000;
    this.tapTimes = this.tapTimes.filter((x) => t - x < 3000);
    this.tapTimes.push(t);
    this.anchorMs = t; this.downbeatOffset = 0;
    if (this.tapTimes.length >= 2) {
      let s = 0; for (let i = 1; i < this.tapTimes.length; i++) s += this.tapTimes[i] - this.tapTimes[i - 1];
      const p = s / (this.tapTimes.length - 1);
      if (p > 60000 / this.bpmMax && p < 60000 / this.bpmMin) { this.periodMs = p; this.f.bpm = Math.round((60000 / p) * 10) / 10; this.f.tempoConf = Math.max(this.f.tempoConf, 0.75); this.candBpm = this.f.bpm; this.stableRuns = 3; }
    }
  }
}

registerProcessor("gps-analyser", GpsAnalyser);
