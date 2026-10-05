import { useCallback, useRef } from "react";
import type { DependencyList } from "react";

/**
 * Performance optimization utilities
 * - Throttle: limit function call frequency (for high-frequency events)
 * - Debounce: delay function call until quiet period (for search/filter)
 * - Batch: collect updates and flush in single batch
 */

/**
 * Throttle: execute at most once every `ms` milliseconds
 * Used for: resize, scroll, mousemove, slider input
 * @param fn Function to throttle
 * @param ms Minimum interval between calls
 */
export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: NodeJS.Timeout | null = null;

  return function throttled(...args: Parameters<T>) {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= ms) {
      lastCall = now;
      fn(...args);
    } else if (!timeoutId) {
      const remaining = ms - timeSinceLastCall;
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        fn(...args);
      }, remaining);
    }
  };
}

/**
 * Debounce: execute only after `ms` milliseconds of inactivity
 * Used for: search input, filter panels, config changes
 * @param fn Function to debounce
 * @param ms Delay before execution
 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return function debounced(...args: Parameters<T>) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, ms);
  };
}

/**
 * Batch updates: collect calls and execute once per frame (RAF)
 * Dramatically reduces render cycles when multiple state updates fire together
 * Used for: slider groups, multi-knob gestures
 */
export class BatchedUpdater {
  private pendingUpdates = new Set<() => void>();
  private rafId: number | null = null;
  private flushing = false;

  schedule(update: () => void) {
    this.pendingUpdates.add(update);
    if (!this.rafId && !this.flushing) {
      this.rafId = requestAnimationFrame(() => this.flush());
    }
  }

  flush() {
    this.flushing = true;
    this.rafId = null;

    const updates = Array.from(this.pendingUpdates);
    this.pendingUpdates.clear();

    // Execute all updates in a single batch
    updates.forEach((u) => u());

    this.flushing = false;
  }

  cancel() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingUpdates.clear();
  }
}

/**
 * EWMA (Exponential Weighted Moving Average) for smooth metrics
 * Reduces jitter in frametime tracking
 */
export class EWMA {
  private value: number;
  private alpha: number;

  constructor(initialValue: number, alpha: number = 0.1) {
    this.value = initialValue;
    this.alpha = alpha;
  }

  update(sample: number): number {
    this.value = this.alpha * sample + (1 - this.alpha) * this.value;
    return this.value;
  }

  get current(): number {
    return this.value;
  }

  reset(value: number) {
    this.value = value;
  }
}

/**
 * Memoization: cache expensive computations
 * LRU cache with max size
 */
export class MemoCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K, compute: () => V): V {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const value = compute();
    this.cache.set(key, value);

    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    return value;
  }

  clear() {
    this.cache.clear();
  }
}

/**
 * useThrottle React hook
 * Wraps a callback with throttling
 */
export function useThrottle<T extends (...args: any[]) => any>(
  callback: T,
  ms: number,
  deps?: DependencyList
): T {
  const throttledRef = useRef<T | null>(null);

  const throttled = useCallback(
    (...args: Parameters<T>) => {
      if (!throttledRef.current) {
        throttledRef.current = throttle(callback, ms) as T;
      }
      return throttledRef.current(...args);
    },
    deps ? deps : [callback, ms]
  );

  return throttled as T;
}

/**
 * useDebounce React hook
 * Wraps a callback with debouncing
 */
export function useDebounce<T extends (...args: any[]) => any>(
  callback: T,
  ms: number,
  deps?: DependencyList
): T {
  const debouncedRef = useRef<T | null>(null);

  const debounced = useCallback(
    (...args: Parameters<T>) => {
      if (!debouncedRef.current) {
        debouncedRef.current = debounce(callback, ms) as T;
      }
      return debouncedRef.current(...args);
    },
    deps ? deps : [callback, ms]
  );

  return debounced as T;
}
