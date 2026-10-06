// Web fallback for the VjDisplay plugin: uses the Window Management API
// (Chromium) when the page has permission, otherwise reports no externals.
import { WebPlugin } from "@capacitor/core";
import type { DisplayState } from "./display-output";

type ScreenDetailed = { label?: string; width: number; height: number; isPrimary?: boolean; isInternal?: boolean };
type ScreenDetails = { screens: ScreenDetailed[]; addEventListener(type: "screenschange", cb: () => void): void };
type WM = Window & { getScreenDetails?: () => Promise<ScreenDetails> };

export class VjDisplayWeb extends WebPlugin {
  private details: ScreenDetails | null = null;

  private async ensure(): Promise<ScreenDetails | null> {
    if (this.details) return this.details;
    const w = window as WM;
    if (!w.getScreenDetails) return null;
    try {
      this.details = await w.getScreenDetails();
      this.details.addEventListener("screenschange", () => { void this.getState().then((s) => this.notifyListeners("displayChange", s)); });
    } catch { this.details = null; }
    return this.details;
  }

  async getState(): Promise<DisplayState> {
    const d = await this.ensure();
    if (!d) return { externalCount: 0 };
    const ext = d.screens.filter((s) => !(s.isInternal ?? s.isPrimary));
    const first = ext[0];
    return { externalCount: ext.length, name: first?.label, width: first?.width, height: first?.height };
  }

  async setKeepAwake(): Promise<void> { /* handled by display-output.ts via the Wake Lock API */ }
}
