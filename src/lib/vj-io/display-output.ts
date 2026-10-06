// vj-io / display-output
//
// Plug-and-play video output for VJ mode.
//
// Android mirrors the phone screen to anything plugged into USB-C (HDMI /
// DisplayPort adapters, capture sticks, TVs) and to cast targets. What a VJ
// wants when that happens is: chrome gone, canvas full-bleed, screen kept
// awake. This module tells the shell *when* an external display is attached
// (native: a tiny Capacitor plugin over Android's DisplayManager; web: the
// Window Management API where available) and lets it keep the screen on.

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface DisplayState {
  /** Number of displays excluding the phone's own panel. */
  externalCount: number;
  /** Name / size of the first external display, when known. */
  name?: string;
  width?: number;
  height?: number;
}

interface VjDisplayPlugin {
  getState(): Promise<DisplayState>;
  setKeepAwake(opts: { on: boolean }): Promise<void>;
  addListener(event: "displayChange", cb: (state: DisplayState) => void): Promise<PluginListenerHandle>;
}

const VjDisplay = registerPlugin<VjDisplayPlugin>("VjDisplay", {
  web: () => import("./display-output.web").then((m) => new m.VjDisplayWeb()),
});

export interface DisplayOutputOptions {
  onChange: (state: DisplayState) => void;
}

export interface DisplayOutput {
  getState(): Promise<DisplayState>;
  setKeepAwake(on: boolean): Promise<void>;
  dispose(): void;
}

export function createDisplayOutput(opts: DisplayOutputOptions): DisplayOutput {
  let handle: PluginListenerHandle | null = null;
  let disposed = false;
  let wakeLock: { release(): Promise<void> } | null = null;

  VjDisplay.addListener("displayChange", (s) => { if (!disposed) opts.onChange(s); })
    .then((h) => { if (disposed) h.remove(); else handle = h; })
    .catch(() => {});
  // Report the initial state once so a display that was already attached at
  // launch is treated the same as one plugged in later.
  VjDisplay.getState().then((s) => { if (!disposed) opts.onChange(s); }).catch(() => {});

  return {
    getState: () => VjDisplay.getState(),
    async setKeepAwake(on) {
      if (Capacitor.isNativePlatform()) {
        try { await VjDisplay.setKeepAwake({ on }); } catch { /* ignore */ }
        return;
      }
      // Web: Screen Wake Lock API.
      try {
        const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
        if (on && !wakeLock && nav.wakeLock) wakeLock = await nav.wakeLock.request("screen");
        if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
      } catch { /* ignore */ }
    },
    dispose() {
      disposed = true;
      handle?.remove();
      handle = null;
      if (wakeLock) { void wakeLock.release(); wakeLock = null; }
    },
  };
}
