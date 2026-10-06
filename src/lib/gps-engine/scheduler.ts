// gps-engine / scheduler
//
// The frame loop lifted from SpectraAfter.tsx: visibility gating (6591),
// low-power frame skipping (6601), rAF re-armed before the work (6691),
// and the v1.2.55 adaptive resolution + FPS counter (7789–7826). Every
// browser touchpoint is injectable so it runs identically in a Worker or
// a test.

export interface SchedulerHooks {
  /** Called once per rendered frame. */
  render: () => void;
  /**
   * Adaptive resolution changed. The shell measures the canvas and calls
   * engine.resize({ …, scale }) — synchronously, like the original.
   */
  onScaleChange: (scale: number) => void;
  onFps?: (fps: number) => void;
  /** Return true to drop every other frame (low-power / battery-low). */
  shouldSkipFrames?: () => boolean;
  /**
   * Adaptive resolution. v1.6.0 — stepped: 1.0 → 0.75 → 0.55 → 0.42 while
   * the average frame stays over SLOW_MS for ~1.5 s per step, back up one
   * step after ~2 s under FAST_MS. A phone that rendered datamosh at 5 fps
   * at full DPR sits at 0.42 (≈ 6× fewer pixels) and moves again. Default
   * true; pass false to pin 1.0.
   */
  adaptiveResolution?: boolean;
  isVisible?: () => boolean;
  now?: () => number;
  raf?: (cb: () => void) => number;
  caf?: (id: number) => void;
}

export interface Scheduler {
  start(): void;
  stop(): void;
  /** Re-arm after the page becomes visible again (9168). */
  resume(): void;
  readonly running: boolean;
  readonly renderScale: number;
  readonly frameTimeMs: number;
}

const SCALE_STEPS = [1.0, 0.75, 0.55, 0.42];
const SLOW_MS = 30;          // < 33 fps sustained → step down
const FAST_MS = 15;          // > 66 fps sustained → step up
const DEADBAND_MS = 18;
const DOWN_STREAK = 40;      // frames over SLOW_MS before stepping down (~1.5 s at 25 fps)
const RECOVER_STREAK = 120;  // frames under FAST_MS before stepping up (~2 s)

export function createScheduler(hooks: SchedulerHooks): Scheduler {
  const now = hooks.now ?? (() => performance.now());
  const raf = hooks.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = hooks.caf ?? ((id) => cancelAnimationFrame(id));
  const isVisible = hooks.isVisible ?? (() => document.visibilityState === "visible");

  let rafId = 0;
  let running = false;
  let skipToggle = false;
  let scaleIdx = 0;
  let frametimeAvg = 16.7; // 4832: seeded at ~60 fps so the first second isn't skewed
  let fastStreak = 0;
  let slowStreak = 0;
  let lastTs = 0;
  let fpsFrames = 0;
  let fpsTime = 0;

  const tick = () => {
    rafId = 0;
    if (!running) return;
    if (!isVisible()) return; // 6591: park until resume()

    if (hooks.shouldSkipFrames?.()) {
      skipToggle = !skipToggle;
      if (skipToggle) { rafId = raf(tick); return; } // 6601: drop every other frame
    }

    rafId = raf(tick); // 6691: re-arm before the work
    hooks.render();

    // 7789–7826
    fpsFrames++;
    const t = now();
    if (lastTs > 0) {
      const dt = t - lastTs;
      frametimeAvg = frametimeAvg * 0.92 + dt * 0.08;
      const avg = frametimeAvg;
      if (hooks.adaptiveResolution === false) {
        // frame time still tracked (segmenter cadence reads it); scale stays 1.0
      } else if (avg > SLOW_MS && scaleIdx < SCALE_STEPS.length - 1) {
        fastStreak = 0;
        slowStreak++;
        if (slowStreak > DOWN_STREAK) {
          scaleIdx++;
          slowStreak = 0;
          frametimeAvg = Math.min(frametimeAvg, SLOW_MS); // give the new scale a fair start
          hooks.onScaleChange(SCALE_STEPS[scaleIdx]);
        }
      } else if (avg < FAST_MS && scaleIdx > 0) {
        slowStreak = 0;
        fastStreak++;
        if (fastStreak > RECOVER_STREAK) {
          scaleIdx--;
          fastStreak = 0;
          frametimeAvg = Math.max(frametimeAvg, DEADBAND_MS);
          hooks.onScaleChange(SCALE_STEPS[scaleIdx]);
        }
      } else {
        if (avg > DEADBAND_MS) fastStreak = Math.max(0, fastStreak - 1);
        if (avg < SLOW_MS) slowStreak = Math.max(0, slowStreak - 1);
      }
    }
    lastTs = t;
    if (t - fpsTime >= 1000) {
      hooks.onFps?.(fpsFrames);
      fpsFrames = 0;
      fpsTime = t;
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      lastTs = 0;
      fpsTime = now();
      if (!rafId) rafId = raf(tick);
    },
    stop() {
      running = false;
      if (rafId) { caf(rafId); rafId = 0; }
    },
    resume() {
      if (running && !rafId) { lastTs = 0; rafId = raf(tick); }
    },
    get running() { return running; },
    get renderScale() { return SCALE_STEPS[scaleIdx]; },
    get frameTimeMs() { return frametimeAvg; },
  };
}
