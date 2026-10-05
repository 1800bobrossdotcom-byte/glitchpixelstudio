/**
 * Performance profiling utilities
 * Measure rendering performance, identify bottlenecks
 */

interface PerformanceMarker {
  name: string;
  startTime: number;
  duration: number;
  count: number;
}

export class PerformanceProfiler {
  private markers: Map<string, PerformanceMarker> = new Map();
  private timings: Map<string, number[]> = new Map();
  private enabled: boolean = false;

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }

  mark(name: string) {
    if (!this.enabled) return;
    performance.mark(`${name}-start`);
  }

  measure(name: string) {
    if (!this.enabled) return;
    try {
      performance.measure(name, `${name}-start`);
    } catch {
      // Ignore if mark doesn't exist
    }

    const duration = performance.getEntriesByName(name).pop()?.duration ?? 0;
    this.recordTiming(name, duration);
  }

  profile<T>(name: string, fn: () => T): T {
    if (!this.enabled) return fn();

    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;

    this.recordTiming(name, duration);
    return result;
  }

  async profileAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (!this.enabled) return fn();

    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;

    this.recordTiming(name, duration);
    return result;
  }

  private recordTiming(name: string, duration: number) {
    if (!this.timings.has(name)) {
      this.timings.set(name, []);
    }
    this.timings.get(name)!.push(duration);

    // Auto-warn if slow
    if (duration > 5) {
      console.warn(`⚠️ [${name}] slow: ${duration.toFixed(2)}ms`);
    }
  }

  stats(name: string) {
    const timings = this.timings.get(name) ?? [];
    if (timings.length === 0) return null;

    const sorted = [...timings].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const avg = sum / sorted.length;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];

    return { count: sorted.length, min, max, avg, p50, p95, p99 };
  }

  report() {
    if (this.timings.size === 0) {
      console.log('No timings recorded');
      return;
    }

    console.group('📊 Performance Report');

    // Sort by total time
    const sorted = Array.from(this.timings.entries())
      .map(([name, times]) => ({
        name,
        total: times.reduce((a, b) => a + b, 0),
        stats: this.stats(name),
      }))
      .sort((a, b) => b.total - a.total);

    sorted.forEach(({ name, total, stats }) => {
      if (!stats) return;
      console.log(
        `${name.padEnd(30)} | Total: ${total.toFixed(1)}ms | Samples: ${stats.count} | Avg: ${stats.avg.toFixed(2)}ms | P95: ${stats.p95.toFixed(2)}ms`
      );
    });

    console.groupEnd();
  }

  reset() {
    this.markers.clear();
    this.timings.clear();
  }
}

/**
 * Global profiler instance
 * Enable with: window.__perf?.enable()
 */
export const profiler = new PerformanceProfiler();

// Expose to window for DevTools access
if (typeof window !== 'undefined') {
  (window as any).__perf = profiler;
}

/**
 * Hook for React components
 */
import { useEffect, useRef } from 'react';

export function useProfiler(componentName: string) {
  const ref = useRef<PerformanceProfiler | null>(null);

  useEffect(() => {
    ref.current = profiler;
  }, []);

  return {
    profile: <T,>(name: string, fn: () => T) => {
      return profiler.profile(`${componentName}:${name}`, fn);
    },
    measure: (name: string) => {
      profiler.measure(`${componentName}:${name}`);
    },
  };
}

/**
 * Frame rate monitor
 * Shows FPS and frame time distribution
 */
export class FrameRateMonitor {
  private frameCount = 0;
  private lastSecond = performance.now();
  private fps = 60;
  private frameTimes: number[] = [];
  private lastFrameTime = performance.now();
  private callback?: (fps: number, avgFrameTime: number) => void;
  private rafId: number | null = null;

  start(callback?: (fps: number, avgFrameTime: number) => void) {
    this.callback = callback;
    const tick = () => {
      const now = performance.now();
      const frameTime = now - this.lastFrameTime;
      this.lastFrameTime = now;

      this.frameCount++;
      this.frameTimes.push(frameTime);

      // Keep only last 60 frames
      if (this.frameTimes.length > 60) {
        this.frameTimes.shift();
      }

      // Update FPS every second
      if (now - this.lastSecond >= 1000) {
        this.fps = this.frameCount;
        this.frameCount = 0;
        this.lastSecond = now;

        const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
        this.callback?.(this.fps, avgFrameTime);
      }

      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  getFPS(): number {
    return this.fps;
  }

  getAverageFrameTime(): number {
    if (this.frameTimes.length === 0) return 0;
    return this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
  }

  getFrameTimeP95(): number {
    if (this.frameTimes.length === 0) return 0;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)];
  }

  getStats() {
    const times = this.frameTimes;
    if (times.length === 0) return null;

    const sorted = [...times].sort((a, b) => a - b);
    return {
      fps: this.fps,
      avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
    };
  }
}

/**
 * React hook for frame rate monitoring
 */
export function useFrameRateMonitor() {
  const monitorRef = useRef<FrameRateMonitor | null>(null);

  useEffect(() => {
    monitorRef.current = new FrameRateMonitor();
    monitorRef.current.start();

    return () => {
      monitorRef.current?.stop();
    };
  }, []);

  return monitorRef.current!;
}

/**
 * Memory usage tracker
 */
export function getMemoryUsage() {
  const perf = performance as Performance & {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  };

  if (perf.memory) {
    return {
      usedJSHeapSize: (perf.memory.usedJSHeapSize / 1048576).toFixed(2) + ' MB',
      totalJSHeapSize: (perf.memory.totalJSHeapSize / 1048576).toFixed(2) + ' MB',
      jsHeapSizeLimit: (perf.memory.jsHeapSizeLimit / 1048576).toFixed(2) + ' MB',
    };
  }
  return null;
}

/**
 * Log memory usage periodically
 */
export function watchMemory(intervalMs: number = 5000) {
  const interval = setInterval(() => {
    const mem = getMemoryUsage();
    if (mem) {
      console.log(
        `💾 Memory: ${mem.usedJSHeapSize} / ${mem.totalJSHeapSize} (limit: ${mem.jsHeapSizeLimit})`
      );
    }
  }, intervalMs);

  return () => clearInterval(interval);
}
