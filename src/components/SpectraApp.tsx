"use client";
// (Capacitor mirror — no next/link)
import { Fragment, useRef, useState, useEffect, useCallback, useMemo, useContext, createContext } from "react";
import { useReducer } from "react";
import type { Dispatch, SetStateAction } from "react";
import { throttle } from "@/utils/performance";
import { usePixelGenWorker } from "@/hooks/usePixelGenWorker";
import { usePixelGenWorkerPool } from "@/hooks/usePixelGenWorkerPool";
import { drawPixelGenerator, type GenParams, type GenStyleId } from "@/utils/pixelGenerator";
import { INITIAL_GENERATOR_STATE, generatorReducer } from "@/utils/stateReducers";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Media } from "@capacitor-community/media";
import { Share } from "@capacitor/share";
import { createAudioInputManager, type AudioInputDevice, type AudioInputInfo, type AudioInputManager, type AudioInputPref } from "@/lib/vj-io/audio-input";
import { createDisplayOutput, type DisplayState } from "@/lib/vj-io/display-output";
import { createAudioFeatures, type AudioFeatureAnalyser } from "@/lib/vj-io/audio-features";
// v1.3.41 — shaders moved out of JS template literals into standalone files
// loaded as raw strings via webpack asset/source (see next.config.ts +
// src/types/glsl.d.ts). Permanently retires the recurring
// "backtick inside GLSL comment terminates the JS template literal" footgun.
import VERT_SRC from "@/shaders/scene.vert";
import FRAG_SRC from "@/shaders/scene.frag";
import { createEngine, createScheduler, encodeGifAsync, type Engine, type FeedbackSource, type Scheduler } from "@/lib/gps-engine";
// Temporal feedback source for MOSH / CHRASH. "rendered" = previous rendered
// frame (true feedback, half-float on WebGL2); "camera" = the look the shipped
// builds effectively had. One constant so the two can be A/B'd on device.
const GPS_FEEDBACK_SOURCE: FeedbackSource = "rendered";

// ═══════════════════════════════════════════════════════════
//  GPS — WebGL computational vision engine
//  12 camera shader modes · glitch · datamosh · sort · kaleidoscope
//  animated boot screen
// ═══════════════════════════════════════════════════════════

// ── Mode definitions ────────────────────────────────────────
// Stripped to the two flagship effects. Other shader branches remain in
// FRAG_SRC for compatibility with persisted presets / sessions but are not
// exposed in the UI.
const MODES = [
  { id: 7, short: "PXL",  label: "Pixel Sort" },
  { id: 9, short: "MOSH", label: "Datamosh"  },
] as const;
type ModeId = 0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20|21|22|23|24|25|26;
const GPS_APP_ICON = "/spectra/gps_logo.png";
// v1.3.82 — removed GPS_WORDMARK + gps_logo_text.png (unused; wordmark
// is rendered as text). Frees ~1.13 MB from the APK asset bundle.
// Back-compat alias so legacy splash/boot/intro code that referenced the
// old SPECTRA_* constants still resolves to the GPS launcher art.
const SPECTRA_APP_ICON = GPS_APP_ICON;

// ── Pixel generator ────────────────────────────────────────────────────
// Procedurally draws a tile-based texture into an offscreen canvas, fed
// into the shader as a source. Designed to react beautifully when chained
// through pixel-sort + datamosh.

// Per-style visual identity for the style picker buttons
const GEN_STYLE_META: Record<string, { font: string; color: string; bg: string; glow: string; italic?: boolean }> = {
  BAYER:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#7FFF00", bg:"linear-gradient(135deg,#001a00,#003300)",   glow:"#7FFF00" },
  HALFT:   { font:"var(--font-nunito,'Nunito',sans-serif)", color:"#F5E6C8", bg:"linear-gradient(135deg,#1a1208,#2e1f08)",   glow:"#F5E6C8" },
  MOSAIC:  { font:"var(--font-nunito,'Nunito',sans-serif)",                 color:"#FFB347", bg:"linear-gradient(135deg,#1a0d00,#301800)",   glow:"#FFB347" },
  VORON:   { font:"var(--font-nunito,'Nunito',sans-serif)",  color:"#FF69B4", bg:"linear-gradient(135deg,#1a0010,#2e0020)",   glow:"#FF69B4", italic:true },
  GRID:    { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#00FFFF", bg:"linear-gradient(135deg,#001a1a,#002828)",   glow:"#00FFFF" },
  STRIP:   { font:"var(--font-nunito,'Nunito',sans-serif)",        color:"#20E8D4", bg:"linear-gradient(135deg,#001518,#002220)",   glow:"#20E8D4" },
  CHECK:   { font:"var(--font-nunito,'Nunito',sans-serif)", color:"#C8C8C8", bg:"linear-gradient(135deg,#0f0f0f,#1e1e1e)",   glow:"#CCCCCC" },
  PLASMA:  { font:"var(--font-nunito,'Nunito',sans-serif)",                    color:"#FF1493", bg:"linear-gradient(135deg,#1a0015,#320020)",   glow:"#FF1493", italic:true },
  WAVES:   { font:"var(--font-nunito,'Nunito',sans-serif)",        color:"#4FC3F7", bg:"linear-gradient(135deg,#000e1a,#001428)",   glow:"#4FC3F7", italic:true },
  RINGS:   { font:"var(--font-nunito,'Nunito',sans-serif)",                    color:"#FFD700", bg:"linear-gradient(135deg,#1a1400,#2a2000)",   glow:"#FFD700" },
  DOTS:    { font:"var(--font-nunito,'Nunito',sans-serif)",                 color:"#CE93D8", bg:"linear-gradient(135deg,#120018,#1e0028)",   glow:"#CE93D8" },
  ASCII:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#39FF14", bg:"linear-gradient(135deg,#001000,#002000)",   glow:"#39FF14" },
  BRICK:   { font:"var(--font-nunito,'Nunito',sans-serif)",                color:"#FF6B35", bg:"linear-gradient(135deg,#1a0800,#2e1000)",   glow:"#FF6B35" },
  HEX:     { font:"var(--font-nunito,'Nunito',sans-serif)",                 color:"#FFC107", bg:"linear-gradient(135deg,#1a1200,#2a1c00)",   glow:"#FFC107" },
  ISO:     { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#82B1FF", bg:"linear-gradient(135deg,#000e2a,#001640)",   glow:"#82B1FF" },
  RGBSP:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#FF4444", bg:"linear-gradient(135deg,#1a0000,#250010)",   glow:"#FF0000" },
  NOISE:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#9E9E9E", bg:"linear-gradient(135deg,#0a0a0a,#161616)",   glow:"#AAAAAA" },
  WORM:    { font:"var(--font-nunito,'Nunito',sans-serif)",                    color:"#76FF03", bg:"linear-gradient(135deg,#071200,#0e2000)",   glow:"#76FF03", italic:true },
  SHARDS:  { font:"var(--font-nunito,'Nunito',sans-serif)",                color:"#80DEEA", bg:"linear-gradient(135deg,#001418,#001e22)",   glow:"#80DEEA" },
  STAIR:   { font:"var(--font-nunito,'Nunito',sans-serif)",                 color:"#B39DDB", bg:"linear-gradient(135deg,#0d0018,#180028)",   glow:"#B39DDB" },
  CIRCS:   { font:"var(--font-nunito,'Nunito',sans-serif)",                    color:"#FFAB40", bg:"linear-gradient(135deg,#1a0d00,#2e1800)",   glow:"#FFAB40" },
  CROSS:   { font:"var(--font-nunito,'Nunito',sans-serif)",                 color:"#EF5350", bg:"linear-gradient(135deg,#1a0000,#280000)",   glow:"#EF5350" },
  WEAVE:   { font:"var(--font-nunito,'Nunito',sans-serif)",        color:"#A1887F", bg:"linear-gradient(135deg,#100a08,#1e1410)",   glow:"#A1887F" },
  DIAMOND: { font:"var(--font-nunito,'Nunito',sans-serif)",                 color:"#29B6F6", bg:"linear-gradient(135deg,#000e18,#001428)",   glow:"#29B6F6" },
  GLITCH:  { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#E040FB", bg:"linear-gradient(135deg,#14001a,#200028)",   glow:"#E040FB" },
  TRUCH:   { font:"var(--font-nunito,'Nunito',sans-serif)",                color:"#FF8F00", bg:"linear-gradient(135deg,#1a0d00,#2a1500)",   glow:"#FF8F00" },
  BAY8:    { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#00BCD4", bg:"linear-gradient(135deg,#001618,#002228)",   glow:"#00BCD4" },
  STACK:   { font:"var(--font-nunito,'Nunito',sans-serif)",        color:"#F9A825", bg:"linear-gradient(135deg,#1a1000,#2a1c00)",   glow:"#F9A825" },
  FLOWL:   { font:"var(--font-nunito,'Nunito',sans-serif)",                    color:"#66BB6A", bg:"linear-gradient(135deg,#001200,#001e00)",   glow:"#66BB6A", italic:true },
  RIBON:   { font:"var(--font-nunito,'Nunito',sans-serif)",        color:"#F48FB1", bg:"linear-gradient(135deg,#1a0012,#280018)",   glow:"#F48FB1", italic:true },
  ORBIT:   { font:"var(--font-nunito,'Nunito',sans-serif)",                    color:"#CE93D8", bg:"linear-gradient(135deg,#0e0018,#180028)",   glow:"#CE93D8" },
  PLIFE:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#69FF47", bg:"linear-gradient(135deg,#001800,#003000)",   glow:"#69FF47" },
  DLAUN:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#18FFFF", bg:"linear-gradient(135deg,#001818,#003030)",   glow:"#18FFFF" },
  BOIDS:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#FFAB00", bg:"linear-gradient(135deg,#1a1000,#2e2000)",   glow:"#FFAB00" },
  REACT:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#FF1744", bg:"linear-gradient(135deg,#1a0000,#300000)",   glow:"#FF1744" },
  LSYST:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#00E676", bg:"linear-gradient(135deg,#001200,#003000)",   glow:"#00E676" },
  // ── SDF / raymarched 3D fields (hg_sdf-inspired) ───────────────
  // CPU sphere-tracer that unions primitives with smooth-min and feeds
  // the resulting depth/normal field through the existing pixel palette
  // — lets the rest of the pipeline (sort, mosh, scatter) operate on
  // genuine 3D-shaded pixels instead of flat 2D fields.
  SDF3D:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#9D7CFF", bg:"linear-gradient(135deg,#0a0024,#180048)",   glow:"#B8A2FF" },
  SDLAT:   { font:"var(--font-nunito,'Nunito',sans-serif)",          color:"#7CFFD9", bg:"linear-gradient(135deg,#001a14,#003028)",   glow:"#A2FFE8" },
  SDTOR:   { font:"var(--font-nunito,'Nunito',sans-serif)",                    color:"#FF7AC6", bg:"linear-gradient(135deg,#1a0014,#28001e)",   glow:"#FFA2D8", italic:true },
  SDFRC:   { font:"var(--font-nunito,'Nunito',sans-serif)",                color:"#FFD166", bg:"linear-gradient(135deg,#1a1000,#2a1c00)",   glow:"#FFE38A" },
};

// v1.3.79 \u2014 drawPixelGenerator + GenStyleId + GenParams + helpers were moved to
// src/utils/pixelGenerator.ts so the same code runs in the main thread AND inside
// the Web Worker (see src/workers/pixelGenWorker.ts) via OffscreenCanvas.
// v1.3.80 \u2014 multi-layer fuse path pipelined through usePixelGenWorkerPool so all
// up to 4 active gen layers race on their own dedicated workers in parallel.


// ── Per-mode parameter schemas (rack architecture) ──────────
// Each mode declares 1–8 numeric/enum params occupying explicit slots in the
// shader uniform `uModeParams[8]`. Slot 0 is conventionally `amount` and is
// also mirrored into the legacy `uGain` uniform for back-compat with code
// paths that have not yet migrated.
type NumParamDef = {
  id: string; label: string; kind: "num";
  min: number; max: number; step: number; default: number;
  slot: number; unit?: string;
};
type EnumParamDef = {
  id: string; label: string; kind: "enum";
  options: readonly string[]; default: number; slot: number;
};
type ParamDef = NumParamDef | EnumParamDef;

const AMOUNT: NumParamDef = { id: "amount", label: "AMOUNT", kind: "num", min: 0, max: 1, step: 0.01, default: 0.5, slot: 0 };
const MIX:    NumParamDef = { id: "mix",    label: "MIX",    kind: "num", min: 0, max: 1, step: 0.01, default: 1.0, slot: 1 };

const MODE_SCHEMAS: Record<ModeId, readonly ParamDef[]> = {
  0: [AMOUNT, MIX],
  1: [
    AMOUNT,
    { id: "gamma",       label: "GAMMA",   kind: "num", min: 0.2, max: 3.0,  step: 0.01, default: 1.0,   slot: 1 },
    { id: "floor",       label: "FLOOR",   kind: "num", min: 0.0, max: 0.5,  step: 0.01, default: 0.015, slot: 2 },
    { id: "ceiling",     label: "CEIL",    kind: "num", min: 0.5, max: 1.0,  step: 0.01, default: 0.85,  slot: 3 },
    { id: "persistence", label: "PERSIST", kind: "num", min: 0.0, max: 0.95, step: 0.01, default: 0.5,   slot: 4 },
  ],
  2: [
    AMOUNT,
    { id: "gamma",       label: "GAMMA",   kind: "num", min: 0.2, max: 3.0,  step: 0.01, default: 1.0,  slot: 1 },
    { id: "floor",       label: "FLOOR",   kind: "num", min: 0.0, max: 0.5,  step: 0.01, default: 0.01, slot: 2 },
    { id: "ceiling",     label: "CEIL",    kind: "num", min: 0.5, max: 1.0,  step: 0.01, default: 0.9,  slot: 3 },
    { id: "persistence", label: "PERSIST", kind: "num", min: 0.0, max: 0.95, step: 0.01, default: 0.4,  slot: 4 },
  ],
  3: [
    AMOUNT,
    { id: "edgeGain",  label: "EDGE",   kind: "num", min: 0.5, max: 6.0, step: 0.05, default: 2.5,  slot: 1 },
    { id: "tint",      label: "TINT",   kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.33, slot: 2 },
    { id: "threshold", label: "THRESH", kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.0,  slot: 3 },
  ],
  4: [AMOUNT, MIX],
  5: [
    AMOUNT,
    { id: "cellSize", label: "CELL",  kind: "num", min: 2.0, max: 20.0, step: 0.5,  default: 7.5,  slot: 1 },
    { id: "ink",      label: "INK",   kind: "num", min: 0.0, max: 1.0,  step: 0.01, default: 1.0,  slot: 2 },
    { id: "paper",    label: "PAPER", kind: "num", min: 0.5, max: 1.0,  step: 0.01, default: 0.95, slot: 3 },
  ],
  6: [
    AMOUNT,
    { id: "cellSize", label: "CELL",  kind: "num", min: 2.0, max: 18.0, step: 0.5,  default: 8.0, slot: 1 },
    { id: "angle",    label: "ANGLE", kind: "num", min: 0.0, max: 1.0,  step: 0.01, default: 0.0, slot: 2 },
    { id: "ink",      label: "INK",   kind: "num", min: 0.0, max: 1.0,  step: 0.01, default: 1.0, slot: 3 },
  ],
  7: [
    AMOUNT,
    { id: "sortKey",        label: "KEY",    kind: "enum", options: ["LUM","HUE","SAT","R","G","B"], default: 0, slot: 1 },
    { id: "lowerThreshold", label: "LOWER",  kind: "num",  min: 0.0, max: 1.0, step: 0.01, default: 0.05, slot: 2 },
    { id: "upperThreshold", label: "UPPER",  kind: "num",  min: 0.0, max: 1.0, step: 0.01, default: 0.85, slot: 3 },
    { id: "direction",      label: "DIR",    kind: "enum", options: ["H","V","DIAG"], default: 0, slot: 4 },
    { id: "segmentLength",  label: "SEG",    kind: "num",  min: 0.0, max: 1.0, step: 0.01, default: 1.0, slot: 5 },
    { id: "noise",          label: "NOISE",  kind: "num",  min: 0.0, max: 1.0, step: 0.01, default: 0.0, slot: 6 },
    { id: "sinusoidal",     label: "WOBBLE", kind: "num",  min: 0.0, max: 1.0, step: 0.01, default: 0.0, slot: 7 },
  ],
  8: [
    AMOUNT,
    { id: "waveIntensity", label: "WAVE",   kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.6, slot: 1 },
    { id: "chromaSpread",  label: "CHROMA", kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.5, slot: 2 },
    { id: "burstRate",     label: "BURST",  kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.5, slot: 3 },
    { id: "noiseAmount",   label: "NOISE",  kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.4, slot: 4 },
  ],
  // 9 DATAMOSH — WebGL approximation; real datamoshing requires AVI/MPEG
  // bytestream editing. This shader emulates the *visual* effect only.
  9: [
    AMOUNT,
    { id: "iFrameKill",        label: "I-KILL", kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.7,  slot: 1 },
    { id: "motionProp",        label: "MOTION", kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.5,  slot: 2 },
    { id: "colorBleed",        label: "BLEED",  kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.6,  slot: 3 },
    { id: "moshMaskThreshold", label: "MASK",   kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.05, slot: 4 },
    { id: "compressionGlitch", label: "CODEC",  kind: "num", min: 0.0, max: 1.0, step: 0.01, default: 0.0,  slot: 5 },
  ],
  10: [
    AMOUNT,
    { id: "segments",   label: "SEG",  kind: "num", min: 2.0, max: 16.0, step: 1.0,  default: 6.0, slot: 1 },
    { id: "rotation",   label: "ROT",  kind: "num", min: -1.0, max: 1.0, step: 0.01, default: 0.0, slot: 2 },
    { id: "flowAmount", label: "FLOW", kind: "num", min: 0.0, max: 1.0,  step: 0.01, default: 0.5, slot: 3 },
  ],
  11: [
    AMOUNT,
    { id: "levels", label: "LEVELS", kind: "num", min: 2.0, max: 24.0, step: 1.0,  default: 8.0, slot: 1 },
    { id: "warp",   label: "WARP",   kind: "num", min: 0.0, max: 1.0,  step: 0.01, default: 0.5, slot: 2 },
  ],
  12: [AMOUNT, MIX],
  13: [
    AMOUNT,
    { id: "decay",          label: "DECAY", kind: "num", min: 0.0, max: 1.0,  step: 0.01, default: 0.5, slot: 1 },
    { id: "displaceAmount", label: "DISP",  kind: "num", min: 0.0, max: 1.0,  step: 0.01, default: 0.3, slot: 2 },
    { id: "hueRot",         label: "HUE/F", kind: "num", min: -1.0, max: 1.0, step: 0.01, default: 0.0, slot: 3 },
  ],
  14: [AMOUNT, MIX],
  15: [AMOUNT, MIX],
  16: [AMOUNT, MIX],
  17: [AMOUNT, MIX],
  18: [AMOUNT, MIX],
  19: [AMOUNT, MIX],
  20: [
    AMOUNT,
    { id: "levels",      label: "LEVELS", kind: "num",  min: 2.0, max: 8.0, step: 1.0, default: 2.0, slot: 1 },
    { id: "paletteMode", label: "PAL",    kind: "enum", options: ["DUAL","XOR","HUE"], default: 0, slot: 2 },
  ],
  21: [AMOUNT, MIX],
  // 22–26 use only the composite `fxA` value internally; richer schemas
  // can be added later when their shader branches are migrated to read
  // from uModeParams. Until then, expose AMOUNT only.
  22: [AMOUNT],
  23: [AMOUNT],
  24: [AMOUNT],
  25: [AMOUNT],
  26: [AMOUNT],
};

// ── Per-mode preset patches ─────────────────────────────────
type ModePreset = { name: string; values: Record<string, number> };
const MODE_PRESETS: Partial<Record<ModeId, readonly ModePreset[]>> = {
  1: [
    { name: "STANDARD",  values: { amount: 0.5, gamma: 1.0, floor: 0.015, ceiling: 0.85, persistence: 0.5 } },
    { name: "MOONLIGHT", values: { amount: 0.7, gamma: 1.6, floor: 0.04,  ceiling: 0.7,  persistence: 0.7 } },
    { name: "GHOST",     values: { amount: 0.8, gamma: 0.7, floor: 0.01,  ceiling: 0.95, persistence: 0.85 } },
  ],
  2: [
    { name: "STANDARD", values: { amount: 0.5, gamma: 1.0, floor: 0.01, ceiling: 0.9, persistence: 0.4 } },
    { name: "FLIR",     values: { amount: 0.7, gamma: 1.4, floor: 0.05, ceiling: 0.8, persistence: 0.6 } },
    { name: "MAGMA",    values: { amount: 0.9, gamma: 0.6, floor: 0.0,  ceiling: 1.0, persistence: 0.2 } },
  ],
  7: [
    { name: "STANDARD",        values: { amount: 0.5, sortKey: 0, lowerThreshold: 0.05, upperThreshold: 0.85, direction: 0, segmentLength: 1.0, noise: 0.0, sinusoidal: 0.0 } },
    { name: "HIGHLIGHT STREAK", values: { amount: 0.8, sortKey: 0, lowerThreshold: 0.6, upperThreshold: 1.0, direction: 0, segmentLength: 0.6, noise: 0.05, sinusoidal: 0.0 } },
    { name: "HUE CASCADE",     values: { amount: 0.9, sortKey: 1, lowerThreshold: 0.0, upperThreshold: 1.0, direction: 1, segmentLength: 0.4, noise: 0.0, sinusoidal: 0.0 } },
    { name: "WOBBLE GHOST",    values: { amount: 0.7, sortKey: 0, lowerThreshold: 0.1, upperThreshold: 0.9, direction: 2, segmentLength: 0.8, noise: 0.2, sinusoidal: 0.7 } },
    { name: "DEEP FRIED",      values: { amount: 1.0, sortKey: 2, lowerThreshold: 0.0, upperThreshold: 1.0, direction: 0, segmentLength: 0.2, noise: 1.0, sinusoidal: 0.0 } },
  ],
  8: [
    { name: "STANDARD", values: { amount: 0.5, waveIntensity: 0.6, chromaSpread: 0.5, burstRate: 0.5, noiseAmount: 0.4 } },
    { name: "VHS",      values: { amount: 0.4, waveIntensity: 0.3, chromaSpread: 0.8, burstRate: 0.2, noiseAmount: 0.6 } },
    { name: "STORM",    values: { amount: 1.0, waveIntensity: 1.0, chromaSpread: 1.0, burstRate: 1.0, noiseAmount: 0.8 } },
  ],
  9: [
    { name: "STANDARD",    values: { amount: 0.7, iFrameKill: 0.7, motionProp: 0.5, colorBleed: 0.6, moshMaskThreshold: 0.05, compressionGlitch: 0.0 } },
    { name: "SMEAR",       values: { amount: 0.8, iFrameKill: 1.0, motionProp: 0.9, colorBleed: 0.3, moshMaskThreshold: 0.02, compressionGlitch: 0.0 } },
    { name: "CODEC DEATH", values: { amount: 1.0, iFrameKill: 0.9, motionProp: 0.7, colorBleed: 1.0, moshMaskThreshold: 0.0,  compressionGlitch: 1.0 } },
    { name: "SOFT BLEED",  values: { amount: 0.5, iFrameKill: 0.4, motionProp: 0.3, colorBleed: 0.8, moshMaskThreshold: 0.15, compressionGlitch: 0.0 } },
  ],
  10: [
    { name: "STANDARD", values: { amount: 0.5, segments: 6.0,  rotation: 0.0,  flowAmount: 0.5 } },
    { name: "MANDALA",  values: { amount: 0.7, segments: 12.0, rotation: 0.1,  flowAmount: 0.7 } },
    { name: "PRISM",    values: { amount: 0.9, segments: 3.0,  rotation: -0.3, flowAmount: 1.0 } },
  ],
  13: [
    { name: "STANDARD", values: { amount: 0.5, decay: 0.5, displaceAmount: 0.3, hueRot: 0.0 } },
    { name: "TRAILS",   values: { amount: 0.8, decay: 0.9, displaceAmount: 0.1, hueRot: 0.0 } },
    { name: "SPIRAL",   values: { amount: 0.9, decay: 0.7, displaceAmount: 1.0, hueRot: 0.3 } },
  ],
};

// Numeric defaults, indexed by param id, for a single mode.
function defaultsForMode(id: ModeId): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of MODE_SCHEMAS[id]) out[p.id] = p.default;
  return out;
}
function defaultsForAllModes(): Record<ModeId, Record<string, number>> {
  const out = {} as Record<ModeId, Record<string, number>>;
  for (const m of MODES) out[m.id] = defaultsForMode(m.id);
  return out;
}
// Pack a mode's params into a Float32Array(8) for the uModeParams uniform.
function packParams(id: ModeId, values: Record<string, number>): Float32Array {
  const out = new Float32Array(8);
  for (const p of MODE_SCHEMAS[id]) {
    if (p.slot >= 0 && p.slot < 8) out[p.slot] = values[p.id] ?? p.default;
  }
  return out;
}

// localStorage key for the per-mode rack values (Phase 2 persistence wiring).
const RACK_KEY = "GPS:rack:v1";

// -- WebGL shaders ---------------------------------------
// v1.3.41: VERT_SRC + FRAG_SRC moved to src/shaders/scene.{vert,frag}.
// Imported at the top of this file as raw strings (webpack asset/source).
// Permanently retires the backtick-in-shader-comment build-break footgun.

// ── Custom Spectra logo (header chip) ──────────────────────
// Uses the canonical app icon so the header brand matches the splash and
// the Capacitor mobile app icon. `chromaShift` retained for back-compat
// (unused; the splash now applies its own RGB-split treatment directly).
function SpectraLogo({ size = 32, chromaShift = 2 }: { size?: number; chromaShift?: number }) {
  void chromaShift;
  const radius = Math.max(6, Math.round(size * 0.22));
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SPECTRA_APP_ICON}
      alt="Spectra"
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        objectFit: "cover",
        boxShadow: "0 0 14px rgba(180,35,255,0.45)",
      }}
    />
  );
}

// ── Boot / load screen ───────────────────────────────────────
// Designed around the SPECTRA app icon: the icon sits centered, framed by
// concentric chromatic rings whose conic gradient sweeps to indicate load.
// The icon itself does a chromatic-aberration "settle" — RGB channels
// converge to perfect alignment as progress hits 100.
function BootScreen({ progress, done, onSkip }: { progress: number; done: boolean; onSkip: () => void }) {
  const chroma = (1 - progress / 100) * 9; // px split per channel
  const status = progress < 22 ? "SYS.INIT" : progress < 52 ? "SHADER.COMPILE" : progress < 84 ? "GL.PIPELINE" : "VISION.READY";
  const sweepDeg = (progress / 100) * 360;
  const ringScale = 0.92 + (progress / 100) * 0.10;
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{
        background: "radial-gradient(circle at 50% 50%, #1820FF 0%, #000CFB 45%, #000470 100%)",
        opacity: done ? 0 : 1,
        pointerEvents: done ? "none" : "all",
        transition: "opacity 0.7s ease",
      }}
    >
      <style>{`
        @keyframes bootSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes bootSpinR { from{transform:rotate(0deg)} to{transform:rotate(-360deg)} }
        @keyframes bootBlink { 0%,80%,100%{opacity:.18} 90%{opacity:.6} }
        @keyframes bootPulse { 0%,100%{opacity:.35} 50%{opacity:.85} }
        @keyframes bootFadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes bootIconBreathe { 0%,100%{filter:drop-shadow(0 0 24px rgba(211,75,255,.45))} 50%{filter:drop-shadow(0 0 38px rgba(255,160,255,.7))} }
      `}</style>

      {/* Subtle scanlines texture */}
      <div style={{
        position:"absolute", inset:0, pointerEvents:"none",
        backgroundImage:"repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(176,20,240,.02) 3px,rgba(176,20,240,.02) 4px)",
      }}/>

      {/* Corner TL */}
      <div style={{position:"absolute",top:20,left:20,fontFamily:"var(--font-space-mono,'Space Mono','Courier New',monospace)",fontSize:9,letterSpacing:"2px",color:"rgba(231,174,255,.35)",lineHeight:1.9,animation:"bootBlink 3.5s ease infinite"}}>
        SPECTRA OS · BUILD {process.env.NEXT_PUBLIC_BUILD_SHA || "dev"}<br/>GL_ES 1.0 · WEBGL<br/>PROC: REALTIME
      </div>
      {/* Corner TR */}
      <div style={{position:"absolute",top:20,right:20,fontFamily:"var(--font-space-mono,'Space Mono','Courier New',monospace)",fontSize:9,letterSpacing:"2px",color:"rgba(231,174,255,.35)",lineHeight:1.9,textAlign:"right",animation:"bootBlink 3.5s ease infinite 1.4s"}}>
        PIPELINE: ACTIVE<br/>FX: MULTI-LAYER<br/>AUDIO: REACTIVE
      </div>
      {/* Corner BL */}
      <div style={{position:"absolute",bottom:20,left:20,fontFamily:"var(--font-space-mono,'Space Mono','Courier New',monospace)",fontSize:9,letterSpacing:"2px",color:"rgba(231,174,255,.24)"}}>
        BOOT/{progress.toFixed(0).padStart(3,"0")}
      </div>
      {/* Corner BR */}
      <div style={{position:"absolute",bottom:20,right:20,fontFamily:"var(--font-space-mono,'Space Mono','Courier New',monospace)",fontSize:9,letterSpacing:"2px",color:"rgba(231,174,255,.24)",textAlign:"right"}}>
        {new Date().getFullYear()} LOVEBEING
      </div>

      {/* Icon stage — concentric rings + the actual app icon */}
      <div style={{
        position:"relative", width:260, height:260, marginBottom:36,
        display:"flex", alignItems:"center", justifyContent:"center",
        animation:"bootFadeIn .9s ease both",
        transform:`scale(${ringScale})`, transition:"transform .25s ease",
      }}>
        {/* Outer chromatic sweep ring (progress indicator) */}
        <div style={{
          position:"absolute", inset:0, borderRadius:"50%",
          padding:2,
          background:`conic-gradient(from -90deg,
            rgba(255,30,200,.95) 0deg,
            rgba(120,90,255,.95) ${sweepDeg * 0.33}deg,
            rgba(40,220,255,.95) ${sweepDeg * 0.66}deg,
            rgba(255,255,255,.95) ${sweepDeg}deg,
            rgba(255,30,200,.05) ${sweepDeg + 0.5}deg,
            rgba(255,30,200,.05) 360deg)`,
          WebkitMask:"radial-gradient(circle, transparent 60%, #000 60%, #000 100%)",
          mask:"radial-gradient(circle, transparent 60%, #000 60%, #000 100%)",
          filter:"drop-shadow(0 0 18px rgba(211,75,255,.55))",
        }}/>
        {/* Slow rotating outer rim (always-on motion) */}
        <div style={{
          position:"absolute", inset:-8, borderRadius:"50%",
          border:"1px dashed rgba(231,174,255,.18)",
          animation:"bootSpin 18s linear infinite",
        }}/>
        {/* Counter-rotating inner ring */}
        <div style={{
          position:"absolute", inset:14, borderRadius:"50%",
          border:"1px solid rgba(120,40,200,.35)",
          animation:"bootSpinR 11s linear infinite",
        }}/>
        {/* Tick marks (12 around) */}
        {Array.from({length:12}).map((_,i)=>(
          <div key={i} style={{
            position:"absolute", left:"50%", top:"50%", width:2, height:6,
            background:"rgba(231,174,255,.45)",
            transform:`translate(-50%,-50%) rotate(${i*30}deg) translateY(-118px)`,
            opacity: i*30 <= sweepDeg ? 0.85 : 0.18,
            transition:"opacity .25s ease",
          }}/>
        ))}

        {/* The SPECTRA app icon, with chromatic-aberration that settles to 0 */}
        <div style={{
          position:"relative", width:160, height:160,
          animation:"bootIconBreathe 2.6s ease-in-out infinite",
        }}>
          {/* Red channel offset */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SPECTRA_APP_ICON} alt="" aria-hidden width={160} height={160} style={{
            position:"absolute", inset:0, width:160, height:160, borderRadius:36,
            mixBlendMode:"screen", opacity:0.85,
            filter:"drop-shadow(0 0 0 transparent)",
            transform:`translate(${chroma}px,0)`,
            // Tint to red via hue-rotate trick on a lightly desaturated copy.
          }}/>
          {/* Blue channel offset */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SPECTRA_APP_ICON} alt="" aria-hidden width={160} height={160} style={{
            position:"absolute", inset:0, width:160, height:160, borderRadius:36,
            mixBlendMode:"screen", opacity:0.85,
            transform:`translate(${-chroma}px,0)`,
          }}/>
          {/* Crisp center icon */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SPECTRA_APP_ICON} alt="SPECTRA" width={160} height={160} style={{
            position:"absolute", inset:0, width:160, height:160, borderRadius:36,
            opacity: 0.6 + (progress/100)*0.4,
          }}/>
        </div>
      </div>

      {/* Wordmark — appears as load nears completion */}
      {/* v1.2.66 — rebrand artifact fix: was "SPECTRA". The app is now
          Glitch Pixel Studio (GPS); the splash wordmark should match.
          Smaller font + tighter spacing because GPS is short. */}
      <div style={{
        fontFamily:"var(--font-space-mono,'Space Mono','Courier New',monospace)", fontSize:32, letterSpacing:"22px",
        color:"#F0E6FF", textTransform:"uppercase", marginBottom:10,
        textShadow:"0 0 24px rgba(211,75,255,.55)",
        animation:"bootFadeIn .8s ease .15s both",
        paddingLeft:22, // optical compensation for letter-spacing on last char
      }}>
        GPS
      </div>

      {/* Tagline */}
      <div style={{
        fontFamily:"var(--font-space-mono,'Space Mono','Courier New',monospace)", fontSize:9, letterSpacing:"5px",
        color:"rgba(231,174,255,.5)", marginBottom:18, textTransform:"uppercase",
        animation:"bootFadeIn .8s ease .3s both",
      }}>
        computational vision engine
      </div>

      {/* Status label */}
      <div style={{
        fontFamily:"var(--font-space-mono,'Space Mono','Courier New',monospace)", fontSize:10, letterSpacing:"4px",
        color:"rgba(231,174,255,.64)", animation:"bootPulse 1.5s ease infinite",
      }}>
        {status}
      </div>

      {/* Visible linear progress bar — confirms the loader is alive */}
      <div style={{
        marginTop: 22, width: 220, height: 6,
        background: "rgba(231,174,255,0.12)",
        borderRadius: 3, overflow: "hidden",
        boxShadow: "inset 0 0 6px rgba(0,0,0,0.6)",
      }}>
        <div style={{
          width: `${Math.min(100, Math.max(0, progress))}%`,
          height: "100%",
          background: "linear-gradient(90deg, rgba(255,30,200,0.95), rgba(120,90,255,0.95), rgba(40,220,255,0.95))",
          boxShadow: "0 0 8px rgba(211,75,255,0.7)",
          transition: "width 0.12s linear",
        }}/>
      </div>
      <div style={{
        marginTop: 8, fontFamily:"var(--font-space-mono,'Space Mono','Courier New',monospace)", fontSize: 10,
        letterSpacing: "3px", color: "rgba(231,174,255,0.7)",
      }}>
        {Math.floor(progress).toString().padStart(3,"0")} / 100
      </div>

      {/* Tap-to-skip — appears after a short delay so users aren't stuck */}
      {progress >= 25 && (
        <button
          onClick={onSkip}
          style={{
            marginTop: 18,
            background: "transparent",
            border: "1px solid rgba(231,174,255,0.45)",
            color: "rgba(231,174,255,0.85)",
            fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
            fontSize: 10, letterSpacing: "3px",
            padding: "6px 14px", borderRadius: 4,
            cursor: "pointer",
          }}
        >TAP TO ENTER ▶</button>
      )}
    </div>
  );
}



// (v1.3.57 — DrawPoint / DrawStroke types removed; draw mode deleted.)
interface SpectraPreset {
  name: string;
  mode: ModeId;
  gain: number;
  brightness: number;
  contrast: number;
  saturation: number;
  hueShift: number;
  scanlines: number;
  zoom: number;
  speed: number;
  sortAmt: number;
  scanTear: number;
  blockGlitch: number;
  datamosh: number;
  moshHard?: boolean;
  chrash: number;
  liquid: number;
  feedback: number;
  contour: number;
  ascii: number;
  venetian: number;
  sortKey: number;
  sortLow: number;
  sortHigh: number;
  sortMode?: number; // 0 LINE, 1 SPIRAL, 2 BLOCK, 3 SLICE, 4 HILBERT (older presets predate this field)
  sortSegment: number;
  sortRandom: number;
  sortWobble: number;
  moshIFrame: number;
  moshMotion: number;
  moshBleed: number;
  moshMap: number;
  moshDistort: number;
  kaleido?: number;
  disrupt?: number;
  disruptCount?: number;
  disruptSize?: number;
  disruptContrary?: number;
  tile?: number;
  invertSym?: number;
  droste?: number;
  spiral?: number;
  yantra?: number;
  mandala?: number;
  rosette?: number;
  starfold?: number;
  hexfold?: number;
  // Phase 1B (rack port): optional per-mode parameter snapshots. Older saved
  // presets predate the rack and will simply omit this field.
  paramsByMode?: Record<number, Record<string, number>>;
}

type ExportProfile = "native" | "vertical" | "square" | "widescreen";
type SessionStateV1 = {
  mode: ModeId;
  gain: number;
  brightness: number;
  contrast: number;
  saturation: number;
  hueShift: number;
  scanlines: number;
  zoom: number;
  speed: number;
  sortAmt: number;
  scanTear: number;
  blockGlitch: number;
  datamosh: number;
  moshHard: boolean;
  chrash: number;
  liquid: number;
  feedback: number;
  contour: number;
  ascii: number;
  venetian: number;
  sortKey: number;
  sortLow: number;
  sortHigh: number;
  sortMode?: number;
  sortSegment: number;
  sortRandom: number;
  sortWobble: number;
  moshIFrame: number;
  moshMotion: number;
  moshBleed: number;
  moshMap: number;
  moshDistort: number;
  kaleido?: number;
  disrupt?: number;
  disruptCount?: number;
  disruptSize?: number;
  disruptContrary?: number;
  tile?: number;
  invertSym?: number;
  droste?: number;
  spiral?: number;
  yantra?: number;
  mandala?: number;
  rosette?: number;
  starfold?: number;
  hexfold?: number;
  exportFormat: "gif" | "video";
  exportQuality: "standard" | "high" | "ultra";
  exportProfile: ExportProfile;
  openSections: string[];
  // Phase 1B (rack port): optional rack snapshot for session restore.
  paramsByMode?: Record<number, Record<string, number>>;
};

const PRESETS_KEY = "spectra-presets-v1";
const QUICK_SLOTS_KEY = "spectra-quick-slots-v1";
const SESSION_KEY = "spectra-session-v1";
const WALKTHROUGH_SEEN_KEY = "gps.walkthroughSeen.v1";
// vj-io preferences (v1.4.1)
const AUDIO_IN_PREF_KEY = "gps.vj.audioIn.v1";
const VJ_OUT_AUTO_KEY = "gps.vj.outAuto.v1";
const AUDIO_REACT_KEY = "gps.vj.audioReact.v1";
// v1.5.0 — the rack is five tabs instead of two collapsible sections + a
// nine-rack accordion.
type RackTab = "source" | "fx" | "look" | "vj" | "export";
const RACK_TABS: ReadonlyArray<{ id: RackTab; label: string; pip: string }> = [
  { id: "source", label: "SOURCE", pip: "#4B9EFF" },
  { id: "fx",     label: "FX",     pip: "#E03D3D" },
  { id: "look",   label: "LOOK",   pip: "#C765FF" },
  { id: "vj",     label: "VJ",     pip: "#52C97A" },
  { id: "export", label: "EXPORT", pip: "#E8A020" },
];
const TAB_FIRST_PANEL: Record<RackTab, string> = {
  source: "INPUT", fx: "PIXEL SORT", look: "COLOR", vj: "VJ", export: "EXPORT",
};
const RACK_TAB_KEY = "gps.rackTab.v1";
// v1.5.5 — AUDIO RACK. Port of Terminal Velocity's KINETIC rack
// (tv-vj-rack.js: PUNCH / CHROMA / SHATTER / ECHO / STROBE / MOSAIC) onto GPS's
// own GPU uniforms, plus SORT / MOSH / HUE. Each effect has a fixed source
// (the TV defaults) and a gain; the result is ADDED on top of the user's
// knobs every frame, scaled by REACT. Manual knobs are the floor, audio adds.
type AudioRackId = "punch" | "strobe" | "chroma" | "shatter" | "sort" | "mosh" | "echo" | "tear" | "hue";
const AUDIO_RACK: ReadonlyArray<{ id: AudioRackId; label: string; src: string; gain: number; on: boolean; hint: string }> = [
  { id: "punch",   label: "PUNCH",   src: "BASS-D", gain: 0.9,  on: true,  hint: "Zoom thump on every kick (TV PUNCH · BASS-D)" },
  { id: "strobe",  label: "STROBE",  src: "BEAT",   gain: 1.0,  on: true,  hint: "Brightness flash on the beat (TV STROBE · BEAT)" },
  { id: "chroma",  label: "CHROMA",  src: "TREB",   gain: 0.75, on: true,  hint: "RGB split that opens with treble (TV CHROMA · TREB)" },
  { id: "shatter", label: "SHATTER", src: "MID-D",  gain: 0.85, on: true,  hint: "Block-glitch shards on mid transients (TV SHATTER · MID-D)" },
  { id: "sort",    label: "SORT",    src: "BASS",   gain: 0.7,  on: true,  hint: "Pixel sort rides the bass" },
  { id: "mosh",    label: "MOSH",    src: "BASS-D", gain: 0.8,  on: true,  hint: "Datamosh bursts on kicks (transient, never accumulates)" },
  { id: "echo",    label: "ECHO",    src: "LEVEL",  gain: 0.55, on: false, hint: "Feedback trails with level (TV ECHO · LEVEL)" },
  { id: "tear",    label: "TEAR",    src: "TREB-D", gain: 0.8,  on: false, hint: "Scanline tear on hi-hat transients" },
  { id: "hue",     label: "HUE",     src: "FLOW",   gain: 0.6,  on: false, hint: "Slow hue drift with the 3 s flow envelope" },
];
const AUDIO_RACK_KEY = "gps.vj.audioRack.v1";
function loadAudioInPref(): AudioInputPref {
  try {
    const v = localStorage.getItem(AUDIO_IN_PREF_KEY);
    if (v === "builtin") return "builtin";
    if (v && v.startsWith("id:")) return { deviceId: v.slice(3) };
  } catch { /* SSR / storage blocked */ }
  return "auto";
}
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.lovebeing.glitchpixelstudio";
const PRIVACY_URL = "https://glitchpixelstudio.app/privacy";
const TERMS_URL = "https://glitchpixelstudio.app/terms";



// ── WebGL helpers ────────────────────────────────────────────

function makeThrottledSetter<T>(setter: (value: T) => void, ms = 32) {
  return throttle((value: T) => setter(value), ms);
}

function isWorkerSupportedGenStyle(style: string) {
  // v1.3.79 — the worker now runs the FULL drawPixelGenerator (same source as
  // the main thread, see src/utils/pixelGenerator.ts) on an OffscreenCanvas,
  // so every registered style produces visually identical output off-thread.
  void style;
  return true;
}

// ══════════════════════════════════════════════════════════════
//  SPECTRA INTRO  — pixels storm in from offscreen and resolve
//  into the actual SPECTRA app icon, then crossfade to a clean
//  logo render before fading away.
// ══════════════════════════════════════════════════════════════
function SpectraIntro({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<"forming" | "resolved" | "out" | "gone">("forming");
  const [iconReady, setIconReady] = useState(false);

  // Phase timing:
  //   0    – 1600ms  forming   (pixels fly in & ease into icon shape)
  //   1600 – 2600ms  resolved  (clean icon shows, wordmark fades in)
  //   2600 – 3300ms  out       (whole overlay fades to transparent)
  //   3300+          gone      (unmounts)
  // CRITICAL: keep onDone in a ref so phase timers don't reset every time
  // the parent re-renders (the boot ticker re-renders ~12×/sec, which used
  // to clear+restart these setTimeouts on every tick → intro never finished).
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  useEffect(() => {
    const t1 = setTimeout(() => setPhase("resolved"), 1600);
    const t2 = setTimeout(() => setPhase("out"), 2600);
    const t3 = setTimeout(() => { setPhase("gone"); onDoneRef.current(); }, 3300);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      cv.width  = Math.floor(window.innerWidth  * dpr);
      cv.height = Math.floor(window.innerHeight * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let cancelled = false;

    // Load the real app icon and sample it into a grid of cells.
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = SPECTRA_APP_ICON;

    img.onload = () => {
      if (cancelled) return;
      setIconReady(true);

      // Sample the icon into a fixed-resolution offscreen canvas.
      const SAMPLE = 192;
      const off = document.createElement("canvas");
      off.width = SAMPLE; off.height = SAMPLE;
      const octx = off.getContext("2d")!;
      octx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
      const data = octx.getImageData(0, 0, SAMPLE, SAMPLE).data;

      // Layout the icon centered on screen.
      const W = window.innerWidth, H = window.innerHeight;
      const iconLogical = Math.min(W, H) * 0.42;
      const ox = (W - iconLogical) / 2;
      const oy = (H - iconLogical) / 2;
      const CELL = Math.max(4, Math.round(iconLogical / 64));
      const grid = Math.floor(iconLogical / CELL);

      type Cell = {
        tx: number; ty: number;          // target px (logical)
        sx: number; sy: number;          // start px (logical, offscreen)
        r: number; g: number; b: number; // sampled color
        delay: number;                   // ms before this cell starts
      };
      const cells: Cell[] = [];

      for (let gy = 0; gy < grid; gy++) {
        for (let gx = 0; gx < grid; gx++) {
          const u = (gx + 0.5) / grid;
          const v = (gy + 0.5) / grid;
          const sxi = Math.min(SAMPLE - 1, Math.floor(u * SAMPLE));
          const syi = Math.min(SAMPLE - 1, Math.floor(v * SAMPLE));
          const idx = (syi * SAMPLE + sxi) * 4;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
          if (a < 24) continue;
          // Skip near-black background pixels so we don't draw a square outline.
          if (r + g + b < 18) continue;

          // Random offscreen start position, biased to outside the viewport.
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.max(W, H) * (0.7 + Math.random() * 0.6);
          const cxScreen = W / 2;
          const cyScreen = H / 2;
          cells.push({
            tx: ox + gx * CELL,
            ty: oy + gy * CELL,
            sx: cxScreen + Math.cos(angle) * dist,
            sy: cyScreen + Math.sin(angle) * dist,
            r, g, b,
            delay: Math.random() * 700,
          });
        }
      }

      // Pre-render a clean copy of the icon for the resolved/crossfade pass.
      const iconCanvas = document.createElement("canvas");
      iconCanvas.width = Math.round(iconLogical * dpr);
      iconCanvas.height = Math.round(iconLogical * dpr);
      const ictx = iconCanvas.getContext("2d")!;
      ictx.imageSmoothingEnabled = true;
      ictx.imageSmoothingQuality = "high";
      ictx.drawImage(img, 0, 0, iconCanvas.width, iconCanvas.height);

      const startedAt = performance.now();
      const FORM_DUR = 1600; // ms — keep in sync with phase timer above

      const tick = () => {
        const now = performance.now();
        const t = now - startedAt;
        ctx.clearRect(0, 0, cv.width, cv.height);

        // Global progress for the resolve crossfade (0 -> 1 by FORM_DUR).
        const resolveK = Math.max(0, Math.min(1, (t - (FORM_DUR - 350)) / 350));

        // 1) Pixel storm: each cell flies from start -> target with cubic ease.
        if (resolveK < 1) {
          for (const c of cells) {
            const age = t - c.delay;
            if (age < 0) continue;
            const k = Math.max(0, Math.min(1, age / 900));
            const eased = 1 - Math.pow(1 - k, 3);
            const x = c.sx + (c.tx - c.sx) * eased;
            const y = c.sy + (c.ty - c.sy) * eased;
            const sz = CELL * (0.55 + 0.45 * eased);
            const alpha = (1 - resolveK) * (0.4 + 0.6 * eased);
            ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${alpha.toFixed(3)})`;
            ctx.shadowColor = `rgba(${c.r},${c.g},${c.b},${(0.5 * eased * (1 - resolveK)).toFixed(3)})`;
            ctx.shadowBlur = 10 * eased * dpr * (1 - resolveK);
            ctx.fillRect(
              (x + (CELL - sz) / 2) * dpr,
              (y + (CELL - sz) / 2) * dpr,
              sz * dpr,
              sz * dpr,
            );
          }
          ctx.shadowBlur = 0;
        }

        // 2) Crossfade in the clean icon as cells settle.
        if (resolveK > 0) {
          ctx.globalAlpha = resolveK;
          ctx.drawImage(iconCanvas, ox * dpr, oy * dpr, iconLogical * dpr, iconLogical * dpr);
          ctx.globalAlpha = 1;
        }

        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    img.onerror = () => {
      // Fallback: show a magenta gradient circle so we never get stuck on black.
      setIconReady(true);
      const W = window.innerWidth, H = window.innerHeight;
      const r = Math.min(W, H) * 0.18;
      const grad = ctx.createRadialGradient(W * dpr / 2, H * dpr / 2, 0, W * dpr / 2, H * dpr / 2, r * dpr);
      grad.addColorStop(0, "#e7aeff");
      grad.addColorStop(1, "rgba(176,20,240,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, cv.width, cv.height);
    };

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  if (phase === "gone") return null;
  const opacity = phase === "out" ? 0 : 1;
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "#000CFB",
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity,
        transition: "opacity 700ms ease-out",
        pointerEvents: phase === "out" ? "none" : "auto",
      }}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }}/>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  BUG REPORT MODAL
// ══════════════════════════════════════════════════════════════
function BugReportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  if (!open) return null;

  const submit = () => {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const url = typeof window !== "undefined" ? window.location.href : "";
    const subj = encodeURIComponent(`[SPECTRA bug] ${subject || "(no subject)"}`);
    const fullBody = `${body}\n\n----\nURL: ${url}\nUA:  ${ua}\nDate: ${new Date().toISOString()}`;
    const mailto = `mailto:1800bobrossdotcom@gmail.com?subject=${subj}&body=${encodeURIComponent(fullBody)}`;
    window.location.href = mailto;
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.85)",
        backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(520px, 100%)",
          background: "linear-gradient(180deg,#1a0028 0%,#0a0014 100%)",
          border: "1px solid rgba(176,20,240,0.55)",
          borderRadius: 12,
          boxShadow: "0 0 40px rgba(176,20,240,0.35), inset 0 1px 0 rgba(255,255,255,0.06)",
          padding: 20,
          color: "#fff",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 12, letterSpacing: "3px", color: "rgba(231,174,255,0.95)" }}>REPORT A BUG</div>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "1px solid rgba(255,255,255,0.2)",
              color: "#fff", borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontSize: 14,
            }}
            aria-label="Close"
          >×</button>
        </div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", marginBottom: 10, letterSpacing: "1px" }}>
          Sends an email to <span style={{ color: "rgba(231,174,255,0.95)" }}>1800bobrossdotcom@gmail.com</span> with what you describe plus your browser info.
        </div>
        <input
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="Short summary…"
          style={{
            width: "100%", marginBottom: 8,
            padding: "10px 12px", borderRadius: 6,
            background: "#000", color: "#fff",
            border: "1px solid rgba(176,20,240,0.4)",
            fontFamily: "inherit", fontSize: 12, outline: "none",
          }}
        />
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="What happened? What were you doing? What did you expect?"
          rows={7}
          style={{
            width: "100%", marginBottom: 12,
            padding: "10px 12px", borderRadius: 6,
            background: "#000", color: "#fff",
            border: "1px solid rgba(176,20,240,0.4)",
            fontFamily: "inherit", fontSize: 12, outline: "none", resize: "vertical",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 14px", borderRadius: 6, cursor: "pointer", fontSize: 11, letterSpacing: "1.5px",
              background: "transparent", color: "rgba(255,255,255,0.7)",
              border: "1px solid rgba(255,255,255,0.2)", fontFamily: "inherit",
            }}
          >CANCEL</button>
          <button
            onClick={submit}
            style={{
              padding: "8px 14px", borderRadius: 6, cursor: "pointer", fontSize: 11, letterSpacing: "1.5px",
              background: "linear-gradient(180deg,#3A0852,#1A0224)",
              color: "#fff",
              border: "1px solid rgba(231,174,255,0.7)",
              boxShadow: "0 0 14px rgba(176,20,240,0.4)",
              fontFamily: "inherit",
            }}
          >SEND →</button>
        </div>
      </div>
    </div>
  );
}

function WalkthroughModal({
  open,
  onClose,
  onRateApp,
  onOpenPrivacy,
  onOpenTerms,
  onCaptureScreenshot,
}: {
  open: boolean;
  onClose: () => void;
  onRateApp: () => void;
  onOpenPrivacy: () => void;
  onOpenTerms: () => void;
  onCaptureScreenshot: () => void;
}) {
  const [step, setStep] = useState(0);
  type WalkthroughStep = {
    title: string;
    text: string;
    actionLabel?: string;
    onAction?: () => void;
  };
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);
  if (!open) return null;

  const steps: WalkthroughStep[] = [
    {
      title: "WELCOME TO GPS",
      text: "Glitch Pixel Studio is live-camera FX first. Start camera, then stack PXL + MOSH for the fastest signature look.",
    },
    {
      title: "CORE FLOW",
      text: "1) CAM/FLIP for source. 2) Pick mode. 3) Tune AMOUNT + BREAK. 4) Snap or Rec. Double-tap knobs to reset quickly.",
    },
    {
      title: "PLAY STORE SHOTS",
      text: "Capture screenshots for listing coverage: home camera, Pixel Sort rack, Datamosh rack, Face FX mode, and export controls.",
      actionLabel: "SNAP SCREENSHOT",
      onAction: onCaptureScreenshot,
    },
    {
      title: "LEGAL + RATING",
      text: "Open privacy policy and terms, then leave a Play Store rating so new users trust the listing and discover updates faster.",
    },
  ];

  const current = steps[step];
  const isLast = step >= steps.length - 1;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 10002,
        background: "rgba(0,0,0,0.82)",
        backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
        fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(620px, 100%)",
          background: "linear-gradient(180deg,#170824 0%,#080214 100%)",
          border: "1px solid rgba(255,210,140,0.45)",
          borderRadius: 10,
          color: "rgba(231,210,255,0.95)",
          boxShadow: "0 0 24px rgba(176,20,240,0.45), inset 0 0 12px rgba(0,0,0,0.7)",
          padding: 18,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 12, letterSpacing: "2px", color: "rgba(255,210,140,0.95)", textShadow: "0 0 8px rgba(232,160,32,0.55)" }}>
            NEW USER WALKTHROUGH · STEP {step + 1}/{steps.length}
          </div>
          <button
            onClick={onClose}
            style={{
              fontFamily: "inherit", fontSize: 10,
              background: "transparent", border: "1px solid rgba(231,174,255,0.4)",
              color: "rgba(231,174,255,0.85)", padding: "4px 10px", borderRadius: 4,
              cursor: "pointer", letterSpacing: "1.5px",
            }}
          >SKIP ✕</button>
        </div>

        <div style={{
          height: 6,
          borderRadius: 999,
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
          marginBottom: 14,
        }}>
          <div style={{
            width: `${((step + 1) / steps.length) * 100}%`,
            height: "100%",
            background: "linear-gradient(90deg, #B014F0 0%, #E8A020 100%)",
            transition: "width 220ms ease",
          }}/>
        </div>

        <div style={{ fontSize: 14, letterSpacing: "2.4px", color: "rgba(255,210,140,0.98)", marginBottom: 10 }}>
          {current.title}
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.7, color: "rgba(243,238,255,0.9)", marginBottom: 14 }}>
          {current.text}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {current.onAction && current.actionLabel && (
            <button
              onClick={current.onAction}
              style={{
                padding: "8px 12px", borderRadius: 6, cursor: "pointer",
                fontSize: 10, letterSpacing: "1.2px",
                background: "linear-gradient(180deg,#3A0852,#1A0224)",
                color: "#fff", border: "1px solid rgba(231,174,255,0.7)",
                fontFamily: "inherit",
              }}
            >{current.actionLabel}</button>
          )}
          {step === steps.length - 1 && (
            <>
              <button
                onClick={onRateApp}
                style={{
                  padding: "8px 12px", borderRadius: 6, cursor: "pointer",
                  fontSize: 10, letterSpacing: "1.2px",
                  background: "linear-gradient(180deg,#402004,#241102)",
                  color: "rgba(255,235,205,0.98)", border: "1px solid rgba(255,210,140,0.7)",
                  fontFamily: "inherit",
                }}
              >★ RATE APP</button>
              <button
                onClick={onOpenPrivacy}
                style={{
                  padding: "8px 12px", borderRadius: 6, cursor: "pointer",
                  fontSize: 10, letterSpacing: "1.2px",
                  background: "transparent", color: "rgba(231,174,255,0.9)",
                  border: "1px solid rgba(231,174,255,0.5)", fontFamily: "inherit",
                }}
              >PRIVACY</button>
              <button
                onClick={onOpenTerms}
                style={{
                  padding: "8px 12px", borderRadius: 6, cursor: "pointer",
                  fontSize: 10, letterSpacing: "1.2px",
                  background: "transparent", color: "rgba(231,174,255,0.9)",
                  border: "1px solid rgba(231,174,255,0.5)", fontFamily: "inherit",
                }}
              >TERMS</button>
            </>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            style={{
              padding: "8px 12px", borderRadius: 6, cursor: step === 0 ? "default" : "pointer",
              fontSize: 10, letterSpacing: "1.2px", fontFamily: "inherit",
              background: "transparent", color: "rgba(255,255,255,0.75)",
              border: "1px solid rgba(255,255,255,0.25)", opacity: step === 0 ? 0.45 : 1,
            }}
          >← BACK</button>
          <button
            onClick={() => {
              if (isLast) onClose();
              else setStep((s) => Math.min(steps.length - 1, s + 1));
            }}
            style={{
              padding: "8px 14px", borderRadius: 6, cursor: "pointer",
              fontSize: 10, letterSpacing: "1.2px", fontFamily: "inherit",
              background: "linear-gradient(180deg,#3A0852,#1A0224)",
              color: "#fff", border: "1px solid rgba(231,174,255,0.7)",
            }}
          >{isLast ? "DONE ✓" : "NEXT →"}</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  saveBlobToDevice — cross-platform save
//  Web: triggers <a download>. Capacitor (Android/iOS): writes the
//  blob to the cache directory and pops the native share sheet so the
//  user can route it to Photos / Files / a chat app. Without this the
//  on-device download anchor is silently ignored on the WebView.
// ══════════════════════════════════════════════════════════════
//  ENTITLEMENT MODEL — paid one-time vs. studio subscription.
//
//  There is NO free tier. The app requires a $3.99 one-time purchase
//  ("paid") OR a $6.90/mo subscription ("studio") to be unlocked.
//
//  GRACE PERIOD: every install gets 3 minutes of CUMULATIVE usage time
//  (counted only while the app is foregrounded) before the lock screen
//  appears. The remaining grace ms is persisted to localStorage so closing
//  and re-opening the app does not reset it.
//
//  Until billing is wired (next release), entitlement can be unlocked
//  manually with the dev codes:
//    "4200" → paid (lifetime)
//    "6900" → studio (subscription)
//    "0000" → reset to locked
//  Tap the version label 5 times on the lock screen to reveal the input.
// ══════════════════════════════════════════════════════════════
export type Entitlement = "paid" | "studio" | null;

export const APP_VERSION = "1.2.66";

// v1.2.51 — extended to 30 minutes for paid-tier QA / debugging passes.
const GRACE_TOTAL_MS = 30 * 60 * 1000; // 30 minutes (testing)
const ENT_KEY = "gps.entitlement";
// v1.2.51 — bumped key so devices that were capped at the old 3-minute
// total (or already burned through it) get a fresh 30-minute seed on
// first launch of this build instead of inheriting a near-zero balance.
const GRACE_KEY = "gps.graceRemainingMs.v2";
const GRACE_INSTALL_KEY = "gps.graceInstallTs.v2";

function loadEntitlement(): Entitlement {
  try {
    const v = localStorage.getItem(ENT_KEY);
    if (v === "paid" || v === "studio") return v;
  } catch { /* ignore */ }
  return null;
}
function saveEntitlement(ent: Entitlement) {
  try {
    if (ent === null) localStorage.removeItem(ENT_KEY);
    else localStorage.setItem(ENT_KEY, ent);
  } catch { /* ignore */ }
}
function loadGraceRemaining(): number {
  try {
    const raw = localStorage.getItem(GRACE_KEY);
    if (raw === null) {
      // First launch — seed full grace and stamp install time.
      localStorage.setItem(GRACE_KEY, String(GRACE_TOTAL_MS));
      localStorage.setItem(GRACE_INSTALL_KEY, String(Date.now()));
      return GRACE_TOTAL_MS;
    }
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, GRACE_TOTAL_MS);
  } catch { return GRACE_TOTAL_MS; }
}
function saveGraceRemaining(ms: number) {
  try { localStorage.setItem(GRACE_KEY, String(Math.max(0, ms | 0))); } catch { /* ignore */ }
}

export const TIER_FEATURES = {
  paid: [
    "All 14 visual modes (NIGHT, THERMAL, EDGE, MELT, MIRROR …)",
    "PXL · MOSH · BOTH layer modes + full PIXEL SORT rack",
    "RUPTURE · H-SYNC RGBNDR rack",
    "FX SETTINGS: full DISRUPT / KALEIDO controls",
    "Generator (incommensurate-flow synth source)",
    "DRAW mode — paint where FX appear",
    "FACE FX — face detection, FACE-ONLY / BG-ONLY, face-reactive MELT",
    "Audio reactivity (mic → bass / treble / beat)",
    "Presets: save · load · export · quick-slots",
    "Unlimited recording length, photo + GIF + video export",
    "No watermark · saves to Documents/Spectra/",
    "Lifetime updates to the core app",
  ],
  studio: [
    "Everything in PAID, plus rolling bonus panels:",
    "AUDIO REACT XL — per-knob LFO/envelope routing",
    "SHADER LAB — paste custom GLSL passes",
    "CLOUD PRESETS — sync + public gallery",
    "AI STYLE — on-device style transfer",
    "MULTI-CAM — overlay two camera feeds",
    "MIDI IN — bind hardware controllers to knobs",
    "TIMELINE — keyframe automation lane",
    "EXPORT XL — 4K · ProRes · alpha exports",
  ],
} as const;
// ══════════════════════════════════════════════════════════════
async function saveBlobToDevice(blob: Blob, filename: string): Promise<void> {
  const isNative = (() => {
    try { return Capacitor.isNativePlatform?.() === true; } catch { return false; }
  })();

  if (!isNative) {
    // Browser path — anchor click.
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch {}
      URL.revokeObjectURL(url);
    }, 1000);
    return;
  }

  // Capacitor path — base64 → cache file → Share sheet.
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result || "");
      // result is "data:<mime>;base64,<payload>"
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });

  const written = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  });
  void written;

  // ── PRIMARY: MediaStore via @capacitor-community/media. This is the
  // ONLY way on Android 11+ scoped storage to get a file into the real
  // gallery (Photos / Google Photos / Files) without legacy
  // WRITE_EXTERNAL_STORAGE. We hand it the cache file URI and the
  // plugin uses MediaStore.Images / MediaStore.Video to insert it
  // into the user's camera roll under the GlitchPixelStudio album.
  const isVideo = /\.(mp4|webm|mov)$/i.test(filename);
  const isGif = /\.gif$/i.test(filename);
  const cacheUri = written?.uri ?? "";
  const baseName = filename.replace(/\.[^.]+$/, "");
  let savedTo: string | null = null;
  if (cacheUri && !isGif) {
    try {
      const resp = isVideo
        ? await Media.saveVideo({ path: cacheUri, albumIdentifier: "GlitchPixelStudio", fileName: baseName })
        : await Media.savePhoto({ path: cacheUri, albumIdentifier: "GlitchPixelStudio", fileName: baseName });
      savedTo = resp?.filePath ?? `Gallery / GlitchPixelStudio / ${filename}`;
    } catch (mediaErr) {
      // Album probably doesn't exist yet — create it then retry once.
      try {
        await Media.createAlbum({ name: "GlitchPixelStudio" });
        const resp2 = isVideo
          ? await Media.saveVideo({ path: cacheUri, albumIdentifier: "GlitchPixelStudio", fileName: baseName })
          : await Media.savePhoto({ path: cacheUri, albumIdentifier: "GlitchPixelStudio", fileName: baseName });
        savedTo = resp2?.filePath ?? `Gallery / GlitchPixelStudio / ${filename}`;
      } catch (mediaErr2) {
        void mediaErr; void mediaErr2;
      }
    }
  }

  // Animated GIFs must not go through savePhoto(). On many Android
  // stacks it decodes/re-encodes as a still image, dropping animation.
  // Keep raw bytes and let the user save/share the real .gif file.
  if (!savedTo && isGif) {
    const gifDocPath = `GlitchPixelStudio/GIF/${filename}`;
    try {
      await Filesystem.writeFile({
        path: gifDocPath,
        data: base64,
        directory: Directory.Documents,
        recursive: true,
      });
      savedTo = `Documents/${gifDocPath}`;
      try {
        await Share.share({
          title: "GPS GIF Export",
          text: filename,
          url: cacheUri || `Documents/${gifDocPath}`,
          dialogTitle: "Save / share animated GIF",
        });
      } catch {
        // user cancelled share sheet; file is still saved.
      }
    } catch {
      // fall through to generic fallback paths below
    }
  }

  // ── FALLBACK: legacy Filesystem writes to DCIM/Movies/Pictures/
  // Documents. Only relevant on devices/old API levels where the
  // MediaStore plugin failed (e.g. permission denied, very old build).
  if (!savedTo) {
    const galleryFolder = isVideo
      ? `Movies/GlitchPixelStudio/${filename}`
      : `DCIM/GlitchPixelStudio/${filename}`;
    try {
      await Filesystem.writeFile({
        path: galleryFolder,
        data: base64,
        directory: Directory.ExternalStorage,
        recursive: true,
      });
      savedTo = galleryFolder;
    } catch (err) {
      void err;
      try {
        await Filesystem.writeFile({
          path: `Pictures/GlitchPixelStudio/${filename}`,
          data: base64,
          directory: Directory.ExternalStorage,
          recursive: true,
        });
        savedTo = `Pictures/GlitchPixelStudio/${filename}`;
      } catch (err2) {
        void err2;
        try {
          await Filesystem.writeFile({
            path: `GlitchPixelStudio/${filename}`,
            data: base64,
            directory: Directory.Documents,
            recursive: true,
          });
          savedTo = `Documents/GlitchPixelStudio/${filename}`;
        } catch (err3) { void err3; }
      }
    }
  }
  // Fire a transient browser-style notification via console + window
  // event the UI can pick up to show a toast. Toast handler is in the
  // main component.
  try {
    window.dispatchEvent(new CustomEvent("gps-saved", {
      detail: { filename, path: savedTo ?? "phone storage" },
    }));
  } catch { /* noop */ }
}

// ══════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════
export default function SpectraAfter() {
    // ── Mask for touch-interactive FX
    const maskCanvasRef = useRef<HTMLCanvasElement>(null);
    // ── Face FX person-segmentation mask (R-channel WebGL texture).
    const faceMaskCanvasRef = useRef<HTMLCanvasElement|null>(null);

    // ── Audio-reactive FX
    const audioLevelRef = useRef(0);
    // Frequency-domain reactivity (bass / treble) and beat impulse.
    const audioBassRef   = useRef(0);
    const audioTrebleRef = useRef(0);
    const audioBeatRef   = useRef(0); // rising-edge bass impulse, decays each frame
    const audioBassAvgRef = useRef(0); // long-term bass average for beat detection
    // v1.5.4 — Terminal Velocity feature analyser (bands / flux / beat / hits
    // with auto-gain). When present it replaces the legacy RMS+FFT block.
    const audioFeaturesRef = useRef<AudioFeatureAnalyser | null>(null);
    const audioSilentSinceRef = useRef(0);   // ms timestamp when the live input went quiet (0 = not quiet)
    const audioSyntheticRef = useRef(false); // true while AUTO-VJ runs on the synthetic LFO drive
    const audioFreqArrayRef: React.MutableRefObject<Uint8Array | null> = useRef<Uint8Array | null>(null);
    const audioStreamRef = useRef<MediaStream|null>(null);
    const audioAnalyserRef = useRef<AnalyserNode|null>(null);
    const audioDataArrayRef: React.MutableRefObject<Uint8Array | null> = useRef<Uint8Array | null>(null);
    const [audioActive, setAudioActive] = useState(false);
    // vj-io (v1.4.1): plug-and-play audio input + display output.
    const audioInPrefRef = useRef<AudioInputPref>("auto");
    const [audioInPref, setAudioInPrefState] = useState<AudioInputPref>("auto");
    useEffect(() => { const p = loadAudioInPref(); audioInPrefRef.current = p; setAudioInPrefState(p); }, []);
    const [audioInputs, setAudioInputs] = useState<AudioInputDevice[]>([]);
    const [audioInInfo, setAudioInInfo] = useState<AudioInputInfo | null>(null);
    const audioInMgrRef = useRef<AudioInputManager | null>(null);
    const setAudioInPref = useCallback((p: AudioInputPref) => {
      audioInPrefRef.current = p;
      setAudioInPrefState(p);
      try { localStorage.setItem(AUDIO_IN_PREF_KEY, p === "auto" ? "auto" : p === "builtin" ? "builtin" : `id:${p.deviceId}`); } catch { /* ignore */ }
      void audioInMgrRef.current?.setPref(p);
    }, []);
    const [vjOutAuto, setVjOutAuto] = useState<boolean>(true);
    useEffect(() => { try { if (localStorage.getItem(VJ_OUT_AUTO_KEY) === "0") setVjOutAuto(false); } catch { /* ignore */ } }, []);
    // AUDIO REACT power: listens to the selected input whenever ON — no longer
    // tied to AUTO-VJ (which only adds autonomous preset cycling on top).
    const [audioReactOn, setAudioReactOnState] = useState<boolean>(true);
    useEffect(() => { try { if (localStorage.getItem(AUDIO_REACT_KEY) === "0") setAudioReactOnState(false); } catch { /* ignore */ } }, []);
    const setAudioReactOn = useCallback((on: boolean) => {
      setAudioReactOnState(on);
      try { localStorage.setItem(AUDIO_REACT_KEY, on ? "1" : "0"); } catch { /* ignore */ }
    }, []);
    // Meter bars are written straight to the DOM (no React state) so the
    // 6 Hz update never re-renders the whole shell.
    const meterRefs = useRef<Array<HTMLDivElement | null>>([null, null, null]);
    const audioDiagRef = useRef<HTMLDivElement | null>(null);
    // AUDIO RACK on/off per effect (persisted after mount).
    const [audioRackOn, setAudioRackOnState] = useState<Record<AudioRackId, boolean>>(() => Object.fromEntries(AUDIO_RACK.map(e => [e.id, e.on])) as Record<AudioRackId, boolean>);
    const audioRackOnRef = useRef(audioRackOn);
    useEffect(() => { audioRackOnRef.current = audioRackOn; }, [audioRackOn]);
    useEffect(() => {
      try { const raw = localStorage.getItem(AUDIO_RACK_KEY); if (raw) { const v = JSON.parse(raw) as Partial<Record<AudioRackId, boolean>>; setAudioRackOnState(prev => ({ ...prev, ...v })); } } catch { /* ignore */ }
    }, []);
    const toggleAudioRack = useCallback((id: AudioRackId) => {
      setAudioRackOnState(prev => { const next = { ...prev, [id]: !prev[id] }; try { localStorage.setItem(AUDIO_RACK_KEY, JSON.stringify(next)); } catch { /* ignore */ } return next; });
    }, []);
    // Per-frame rack output, and a fallback delta tracker for the legacy / synthetic drive.
    const audioRackOutRef = useRef({ punch: 0, strobe: 0, chroma: 0, shatter: 0, sort: 0, mosh: 0, echo: 0, tear: 0, hue: 0 });
    const audioPrevBandsRef = useRef({ bass: 0, mid: 0, treb: 0 });
    // The WebView can only service one permission prompt at a time: opening the
    // mic while the camera is still being granted makes Capacitor deny the mic.
    // Arm the audio input once the camera is live, or 4 s after mount if the
    // camera is off (upload / generator sessions).
    const [audioArmed, setAudioArmed] = useState(false);
    const [vjRowFlash, setVjRowFlash] = useState(false);
    const [vjOutDisplay, setVjOutDisplay] = useState<DisplayState | null>(null);
  // ── Boot state
  const [bootProgress, setBootProgress] = useState(0);
  const [bootDone, setBootDone] = useState(false);
  // v1.2.83 — JS-driven landscape detection. Earlier attempts to
  // reflow via CSS media queries had inconsistent results across the
  // various WebView builds Capacitor ships, so we observe the
  // viewport directly and apply layout via inline className/style.
  const [isLandscape, setIsLandscape] = useState(false);
  useEffect(() => {
    const update = () => {
      if (typeof window === "undefined") return;
      setIsLandscape(window.innerWidth > window.innerHeight && window.innerHeight < 600);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  // ── First-load intro + bug report modal
  const [introVisible, setIntroVisible] = useState(true);
  // v1.3.27 — latch separating "intro animation finished" from "safe to
  // hide intro". We hold the overlay up until the camera is actually live
  // (when the user wants one) so we never flash a gen-only fullscreen frame
  // before the FX pipeline has a real camera frame + segmenter mask to draw.
  const [introWantsClose, setIntroWantsClose] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  // ── Processing overlay (GIF/video encode + save). null = hidden.
  const [processingStatus, setProcessingStatus] = useState<{ label: string; pct?: number } | null>(null);
  // ── Saved-to-phone toast. Listens to the "gps-saved" CustomEvent
  // dispatched from saveBlobToDevice and shows a transient banner so
  // the user knows the file landed on their phone (no Share sheet).
  const [savedToast, setSavedToast] = useState<{ filename: string; path: string } | null>(null);
  useEffect(() => {
    try {
      const seen = localStorage.getItem(WALKTHROUGH_SEEN_KEY) === "1";
      if (!seen) setWalkthroughOpen(true);
    } catch {
      setWalkthroughOpen(true);
    }
  }, []);
  const closeWalkthrough = useCallback(() => {
    setWalkthroughOpen(false);
    try { localStorage.setItem(WALKTHROUGH_SEEN_KEY, "1"); } catch { /* ignore */ }
  }, []);
  const openExternalLink = useCallback((url: string) => {
    if (typeof window === "undefined") return;
    const isNative = (() => {
      try { return Capacitor.isNativePlatform?.() === true; } catch { return false; }
    })();
    if (isNative && url === PLAY_STORE_URL) {
      window.location.href = "market://details?id=com.lovebeing.glitchpixelstudio";
      return;
    }
    if (url.startsWith("/")) {
      window.location.href = url;
      return;
    }
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (!w) window.location.href = url;
  }, []);
  // ── Accordion state for the glass-mode panel: only one SynthPanel
  // open at a time, default all collapsed so the bottom 1/4 of the
  // screen can show the full panel list as title strips.
  // v1.2.81 — default to opening the PIXEL GENERATOR panel so users
  // immediately see/feel the procedural texture controls instead of
  // landing on a quiet pixel-sort screen and wondering if anything works.
  const [openPanelTitle, setOpenPanelTitle] = useState<string | null>(null);
  // v1.5.0 — rack tabs. Switching a tab opens that tab's first rack.
  const [activeTab, setActiveTabState] = useState<RackTab>("fx");
  useEffect(() => {
    // Hydration-safe: the static HTML is rendered with defaults, saved prefs land after mount.
    try { const v = localStorage.getItem(RACK_TAB_KEY); if (v && RACK_TABS.some(t => t.id === v)) setActiveTabState(v as RackTab); } catch { /* ignore */ }
  }, []);
  const setActiveTab = useCallback((t: RackTab) => {
    setActiveTabState(t);
    setOpenPanelTitle(TAB_FIRST_PANEL[t]);
    requestAnimationFrame(() => { if (panelRef.current) panelRef.current.scrollTop = 0; });
    try { localStorage.setItem(RACK_TAB_KEY, t); } catch { /* ignore */ }
  }, []);
  const [rawFxOpen, setRawFxOpen] = useState(false);
  const accordionCtx = useMemo(
    () => ({ openTitle: openPanelTitle, setOpenTitle: setOpenPanelTitle }),
    [openPanelTitle]
  );
  useEffect(() => {
    const onSaved = (e: Event) => {
      const ce = e as CustomEvent<{ filename: string; path: string }>;
      setSavedToast(ce.detail);
      window.setTimeout(() => setSavedToast(null), 3200);
    };
    window.addEventListener("gps-saved", onSaved as EventListener);
    return () => window.removeEventListener("gps-saved", onSaved as EventListener);
  }, []);

  // ── Source
  const [cameraActive, setCameraActive] = useState(false);
  // v1.2.46: boot facing the user — combined with FACE FX = BG and a
  // little SORT amount, the app shows its mask + glitch effect on the
  // viewer's first frame so the value prop is immediately visible.
  const [cameraFacing, setCameraFacing] = useState<"environment"|"user">("user");
  const [sourceError, setSourceError] = useState<string|null>(null);
  const [shaderError, setShaderError] = useState<string|null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream|null>(null);
  const startCameraInFlightRef = useRef(false);
  // v1.2.74 — explicit user intent for the camera being on. Set true at
  // the top of startCamera(), set false in stopCamera(). Replaces the old
  // sourceMode === "camera" intent check which broke GEN+CAM.
  const cameraIntentRef = useRef(false);

  // ── Upload source (image / gif / short video) — feeds the same texture path
  // (v1.3.57 — "paint" source mode removed; draw/paint surface deleted.)
  type SourceMode = "camera" | "upload" | "generator";
  const [sourceMode, setSourceMode] = useState<SourceMode>("camera");
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [uploadKind, setUploadKind] = useState<"image" | "video" | null>(null);
  const sourceModeRef = useRef<SourceMode>("camera");
  const uploadImgRef = useRef<HTMLImageElement | null>(null);
  const uploadVideoRef = useRef<HTMLVideoElement | null>(null);
  const uploadObjectUrlRef = useRef<string | null>(null);
  const sourceFileInputRef = useRef<HTMLInputElement>(null);
  // v1.3.78 — PIXEL GEN II removed (perf: was causing frame-time spikes).

  // ── Pixel generator (procedural texture source) — feeds shader → pxl/mosh
  const GEN_STYLES = [
    "BAYER", "HALFT", "MOSAIC", "VORON", "GRID",
    "STRIP", "CHECK", "PLASMA", "WAVES", "RINGS",
    "DOTS", "ASCII", "BRICK", "HEX", "ISO",
    "RGBSP", "NOISE", "WORM", "SHARDS", "STAIR",
    "CIRCS", "CROSS", "WEAVE", "DIAMOND", "GLITCH",
    "TRUCH", "BAY8", "STACK", "FLOWL", "RIBON", "ORBIT",
    "PLIFE", "DLAUN", "BOIDS", "REACT", "LSYST",
  ] as const;
  type GenStyle = typeof GEN_STYLES[number];

  // ── Family / variant matrix — mirrors STYLE_SPECS inside drawPixelGenerator.
  // Lets the FAMILY/VARIANT knobs in the rack drive genStyle without exposing
  // a 36-button preset grid. Empty slots fall back to slot 0 of that family.
  const FAMILY_NAMES = [
    "AUTOMATA","REACT-DIFF","FLOW-WAVE","DITHER","FRACTAL",
    "PIXSORT","FLOWFLD","VORONOI","TRUCHET","GLITCH",
  ] as const;
  const STYLE_BY_FV: ReadonlyArray<ReadonlyArray<GenStyle>> = [
    ["PLIFE",  "WAVES", "CHECK",  "LSYST"],
    ["REACT",  "MOSAIC","PLASMA", "REACT"],
    ["RIBON",  "ORBIT", "STAIR",  "STACK"],
    ["BAYER",  "BAY8",  "BRICK",  "STRIP"],
    ["RINGS",  "CIRCS", "SHARDS", "CROSS"],
    ["WEAVE",  "WEAVE", "FLOWL",  "RGBSP"],
    ["BOIDS",  "WORM",  "NOISE",  "DIAMOND"],
    ["VORON",  "DOTS",  "HALFT",  "HEX"],
    ["TRUCH",  "GRID",  "ISO",    "TRUCH"],
    ["GLITCH", "GLITCH","ASCII",  "GLITCH"],
  ];
  const FV_BY_STYLE: Record<string, [number, number]> = {
    PLIFE:[0,0], WAVES:[0,1], CHECK:[0,2], LSYST:[0,3],
    REACT:[1,0], MOSAIC:[1,1], PLASMA:[1,2],
    RIBON:[2,0], ORBIT:[2,1], STAIR:[2,2], STACK:[2,3],
    BAYER:[3,0], BAY8:[3,1], BRICK:[3,2], STRIP:[3,3],
    RINGS:[4,0], CIRCS:[4,1], SHARDS:[4,2], CROSS:[4,3],
    WEAVE:[5,1], FLOWL:[5,2], RGBSP:[5,3],
    BOIDS:[6,0], WORM:[6,1], NOISE:[6,2], DIAMOND:[6,3],
    VORON:[7,0], DOTS:[7,1], HALFT:[7,2], HEX:[7,3],
    TRUCH:[8,0], GRID:[8,1], ISO:[8,2],
    GLITCH:[9,0], ASCII:[9,2],
  };

  // Color palettes for the generator. MONO is pure grayscale (true monochrome).
  // CUSTOM hands control back to the HUE/SPREAD/SAT knobs.
  const GEN_PALETTES = {
    MONO:    { hue: 0.00, spread: 0.00, sat: 0.00, cycle: false }, // grayscale
    WARM:    { hue: 0.05, spread: 0.12, sat: 0.88, cycle: true  },
    COOL:    { hue: 0.55, spread: 0.12, sat: 0.88, cycle: true  },
    PINK:    { hue: 0.92, spread: 0.10, sat: 0.95, cycle: true  },
    ACID:    { hue: 0.30, spread: 0.18, sat: 1.00, cycle: true  },
    RAINBOW: { hue: 0.00, spread: 1.00, sat: 0.95, cycle: true  },
    CUSTOM:  { hue: -1,   spread: -1,   sat: -1,   cycle: false }, // sentinel: use knobs
  } as const;
  type GenPalette = keyof typeof GEN_PALETTES;
  const GEN_PALETTE_KEYS = ["MONO","WARM","COOL","PINK","ACID","RAINBOW","CUSTOM"] as const;
  const genPaletteRef = useRef<GenPalette>("MONO");
  const genAutoCycleRef = useRef(false);
  const genHueCycleRef = useRef(0); // 0..1 slow drift counter
  // Heavily smoothed motion shadows used by the generator so evolution is
  // continuous and never resets/snaps frame-to-frame. Raw motion refs stay
  // untouched for other consumers.
  const genDriveSmoothRef = useRef(0);
  const genTiltXSmoothRef = useRef(0);
  const genTiltYSmoothRef = useRef(0);
  const genPushSmoothRef  = useRef(0);
  // Persistent organic offsets — slow LFOs that keep the pattern wandering
  // even when the device is perfectly still.
  const genFlowXRef = useRef(0);
  const genFlowYRef = useRef(0);
  const [genState, genDispatch] = useReducer(generatorReducer, INITIAL_GENERATOR_STATE);
  const genStyle = genState.style as GenStyle;
  const genResolution = genState.resolution;
  const genDensity = genState.density;
  const genScale = genState.scale;
  const genSpeed = genState.speed;
  const genHue = genState.hue;
  const genHueSpread = genState.hueSpread;
  const genSat = genState.sat;
  const genContrastG = genState.contrast;
  // v1.3.44 — generator MIX: alpha-blends the generator output OVER the
  // active source feed (camera or upload) BEFORE all FX run, so the
  // generator pixel-integrates with the camera and the rest of the FX
  // chain (sort/mosh/glitch/warps) operates on the blended pixel signal
  // instead of treating the generator as an island. 0 = generator
  // contributes nothing in CAM/UPLOAD mode (legacy behaviour); 1 = full
  // hard-light pre-blend. Default 0 keeps the existing UX byte-identical
  // until the user dials it in.
  const genMix = genState.mix;
  const genWarp = genState.warp;
  const genJitter = genState.jitter;
  const genSeed = genState.seed;
  const genInvert = genState.invert;
  // Per-layer datamosh blend movement (edits the selected layer; broadcasts when MASTER).
  const genMoshX = genState.moshX;
  const genMoshY = genState.moshY;
  const genScatter = genState.scatter;
  const genScatterMode = genState.scatterMode;
  const genGlyphMode = genState.glyphMode;
  const genPalette = genState.palette as GenPalette;
  const genAutoCycle = genState.autoCycle;
  const genWorkerBusyRef = useRef(false);
  const genWorkerPrimedRef = useRef(false);
  const paintWorkerFrame = useCallback((result: { data: Uint8ClampedArray; width: number; height: number }) => {
    const gc = genCanvasRef.current;
    if (!gc || gc.width !== result.width || gc.height !== result.height) return;
    const ctx = gc.getContext("2d");
    if (!ctx) return;
    const imageData = new ImageData(result.width, result.height);
    imageData.data.set(result.data);
    ctx.putImageData(imageData, 0, 0);
  }, []);
  const { generate: generatePixelFrame } = usePixelGenWorker((result) => {
    paintWorkerFrame(result);
    genWorkerBusyRef.current = false;
    genWorkerPrimedRef.current = true;
  });
  // v1.3.80 — per-layer worker pool for the multi-layer fuse path.
  // Up to 4 active layers, each pipelined through its own dedicated worker so
  // the layers race in parallel on separate threads. Layer N's canvas always
  // holds the last completed frame, so the synchronous fuse step downstream
  // just reads ImageData from it the same way the main-thread version did.
  const { generate: generateLayerFrame } = usePixelGenWorkerPool(4);
  const layerWorkerBusyRef = useRef<boolean[]>([false, false, false, false]);
  const layerWorkerPrimedRef = useRef<boolean[]>([false, false, false, false]);
  const setGenStyle = useCallback((value: GenStyle) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { style: value } }), []);
  const setGenResolution = useCallback((value: number) => genDispatch({ type: "SET_RESOLUTION", payload: value }), []);
  const setGenDensity = useCallback((value: number) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { density: value } }), []);
  const setGenScale = useCallback((value: number) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { scale: value } }), []);
  const setGenSpeed = useCallback((value: number) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { speed: value } }), []);
  const setGenHue = useCallback((value: number) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { hue: value } }), []);
  const setGenHueSpread = useCallback((value: number) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { hueSpread: value } }), []);
  const setGenSat = useCallback((value: number) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { sat: value } }), []);
  const setGenContrastG = useCallback((value: number) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { contrast: value } }), []);
  const setGenMix = useCallback((value: number) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { mix: value } }), []);
  const setGenWarp = useCallback((value: number) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { warp: value } }), []);
  const setGenJitter = useCallback((value: number) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { jitter: value } }), []);
  const setGenSeed = useCallback((value: number) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { seed: value } }), []);
  const setGenInvert = useCallback((value: boolean) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { invert: value } }), []);
  const setGenMoshX = useCallback((value: number) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { moshX: value } }), []);
  const setGenMoshY = useCallback((value: number) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { moshY: value } }), []);
  const setGenScatter = useCallback((value: number) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { scatter: value } }), []);
  const setGenScatterMode = useCallback((value: number) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { scatterMode: value } }), []);
  const setGenGlyphMode = useCallback((value: number) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { glyphMode: value } }), []);
  const setGenPalette = useCallback((value: GenPalette) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { palette: value } }), []);
  const setGenAutoCycle = useCallback((value: boolean) => genDispatch({ type: "UPDATE_MULTIPLE", payload: { autoCycle: value } }), []);

  const setGenStyleThrottled = useMemo(() => makeThrottledSetter(setGenStyle, 32), [setGenStyle]);
  const setGenResolutionThrottled = useMemo(() => makeThrottledSetter(setGenResolution, 32), [setGenResolution]);
  const setGenDensityThrottled = useMemo(() => makeThrottledSetter(setGenDensity, 32), [setGenDensity]);
  const setGenScaleThrottled = useMemo(() => makeThrottledSetter(setGenScale, 32), [setGenScale]);
  const setGenSpeedThrottled = useMemo(() => makeThrottledSetter(setGenSpeed, 32), [setGenSpeed]);
  const setGenHueThrottled = useMemo(() => makeThrottledSetter(setGenHue, 32), [setGenHue]);
  const setGenHueSpreadThrottled = useMemo(() => makeThrottledSetter(setGenHueSpread, 32), [setGenHueSpread]);
  const setGenSatThrottled = useMemo(() => makeThrottledSetter(setGenSat, 32), [setGenSat]);
  const setGenContrastThrottled = useMemo(() => makeThrottledSetter(setGenContrastG, 32), [setGenContrastG]);
  const setGenMixThrottled = useMemo(() => makeThrottledSetter(setGenMix, 32), [setGenMix]);
  const setGenWarpThrottled = useMemo(() => makeThrottledSetter(setGenWarp, 32), [setGenWarp]);
  const setGenJitterThrottled = useMemo(() => makeThrottledSetter(setGenJitter, 32), [setGenJitter]);
  const setGenSeedThrottled = useMemo(() => makeThrottledSetter(setGenSeed, 32), [setGenSeed]);
  // ── AUTOMATE (generator only): drifts the gen knobs over time toward
  //    fresh random targets, like an LFO on every dial.
  const [automateOn, setAutomateOn] = useState(false);
  const [automateRate, setAutomateRate] = useState(0.45);     // 0..1 (slow..fast)
  const [automateStyles, setAutomateStyles] = useState(false); // also rotate gen STYLE
  const [automateBlend, setAutomateBlend] = useState(false);   // also rotate pixel BLEND
  // ── LOW POWER: user-facing toggle. Pre-v1.3.42 this skipped every
  //    other RAF tick (binary halving). v1.3.42 folds it into the
  //    unified governor as a hard ceiling on fxQuality (≤0.5), which
  //    in turn drops renderScale to ~0.78 via the continuous mapping.
  //    Net thermal/battery savings are comparable to the old skip but
  //    without the visible stutter.
  const [lowPowerOn, setLowPowerOn] = useState(false);
  const lowPowerRef = useRef(false);
  useEffect(() => { lowPowerRef.current = lowPowerOn; }, [lowPowerOn]);
  // v1.3.43 — 4 MACRO KNOBS (INTENSITY / MOTION / COLOR / BREAK).
  // Default 1.0 = pass-through (existing v1.3.42 behavior). Range [0, 1.5]:
  // 0 kills the family, 1 = user values as-set, 1.5 = +50% boost (clamped
  // shader-side by the existing universal mask). These are MULTIPLIERS
  // applied at uniform-bind time only; per-knob state is never mutated,
  // so the existing fine-grained sliders keep their feel and the macros
  // act as a fast "global mix" pre-amp. Each macro sweeps a coherent
  // family of uniforms in lockstep:
  //   INTENSITY -> structured FX amount  (sortMix, datamosh, glyph,
  //                 react/voro, all 10 radial warps, liquid, ...)
  //   MOTION    -> temporal animation    (sortWobble, moshMotion,
  //                 moshBleed, moshIFrame)
  //   COLOR     -> palette aggressiveness (sat/contrast/brightness lerp
  //                 from neutral 1.0 toward user value, hueShift scale)
  //   BREAK     -> chaos / corruption    (chrash, feedback, blockGlitch,
  //                 moshDistort, scanTear, sortRandom, disrupt, RGB
  //                 drift, rupture, hsync, moshMap)
  const [intensityMacro, setIntensityMacro] = useState(1.0);
  const [motionMacro,    setMotionMacro]    = useState(1.0);
  const [colorMacro,     setColorMacro]     = useState(1.0);
  const [breakMacro,     setBreakMacro]     = useState(1.0);
  const intensityMacroRef = useRef(1.0);
  const motionMacroRef    = useRef(1.0);
  const colorMacroRef     = useRef(1.0);
  const breakMacroRef     = useRef(1.0);
  useEffect(() => { intensityMacroRef.current = intensityMacro; }, [intensityMacro]);
  useEffect(() => { motionMacroRef.current    = motionMacro;    }, [motionMacro]);
  useEffect(() => { colorMacroRef.current     = colorMacro;     }, [colorMacro]);
  useEffect(() => { breakMacroRef.current     = breakMacro;     }, [breakMacro]);
  // v1.2.55 — BATTERY-AWARE auto low-power. Independent of the manual
  // LOW POWER toggle so we don't overwrite the user's preference. Both
  // flags now feed the same fxQuality clamp inside the governor.
  const batteryLowRef = useRef(false);
  // v1.3.40 — UNIFIED FX QUALITY GOVERNOR. Replaces the v1.3.36 binary
  // thermal flip + binary skip-frame mechanism with a continuous control
  // loop. The governor compares the rolling frametime EWMA against a
  // target budget (17 ms ≈ 58 fps with a 1-frame compositor margin) and
  // each frame nudges fxQualityRef up or down by a small step. The ref
  // is uploaded to the shader as `uFxQuality` and multiplied into the
  // universal `mask` once, so every FX gate / mix is smoothly scaled in
  // lockstep — instead of the entire app pulsing at half rate (skip
  // frames) the user sees compounding FX gracefully dim under load and
  // smoothly restore as headroom returns. The CPU pixel-sort tick and
  // segmenter cadence also read this scalar, so under sustained load
  // the most expensive non-shader work is naturally throttled too.
  // Bounded [0.30, 1.00]: 0.30 keeps a visible scene even on a hot SoC,
  // 1.00 = "off" (no degradation). bootFrameRef gates the governor so
  // WebView cold-start jank (~300 frames @ 60 = first 5 s) can't drag
  // quality down before the device is actually warm.
  const fxQualityRef = useRef(1.0);
  const bootFrameRef = useRef(0);
  // v1.3.42 — ADAPTIVE RENDER RESOLUTION. Continuous linear map of
  // fxQuality∈[0.30,1.00] → renderScale∈[0.55,1.00], rounded to the
  // nearest 0.05 so resize() (which re-allocates the GL canvas + FBO
  // + camera/mask textures) only fires when the bucket actually
  // changes. Replaced the v1.3.40 discrete ladder {1.00,0.85,0.70,0.55}
  // + 180/300-frame streak counters with one expression.
  // v1.2.55 — UNIFORM SHADOW CACHE. ~60 uniform writes happen every
  // render. Most are slider/ref values that don't change frame-to-frame.
  // We diff against this Map keyed by WebGLUniformLocation and skip the
  // gl.uniform* call when the value is unchanged. For float vectors we
  // pack components into a delimited string for a cheap equality check.

  // v1.2.57 — Phase 4 GFX. Track per-texture sized state so we can use
  // texSubImage2D for the steady-state per-frame uploads (camera + mask)
  // instead of texImage2D, which avoids a driver-side reallocation +
  // texture-completeness check on every frame. We re-seed with
  // texImage2D only when the source dimensions change (rare).
  // v1.3.30 — same trick for the FACE-FX mask texture (gated on segmenter
  // mask geometry, which only changes when MediaPipe rebuilds its model).
  // v1.2.57 — alternate audio analyser updates so the FFT + RMS loop
  // runs at ~30 Hz instead of 60 Hz. Audio energy doesn't change
  // meaningfully faster than that and the cached gate is what the
  // shader sees. Frees CPU on the render thread.
  const audioFrameToggleRef = useRef(0);

  // v1.2.55 — BATTERY-AWARE FRAMERATE CAP. When the device is below 20%
  // and not actively charging, flip batteryLowRef on so the render loop's
  // skip-frame check halves the framerate. Listens for both level and
  // charging changes so plugging in instantly restores full speed. The
  // BatteryManager API is unavailable in some Capacitor WebView versions
  // and on iOS Safari — we silently skip when getBattery isn't a function.
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    type BatteryManager = {
      level: number;
      charging: boolean;
      addEventListener: (ev: string, cb: () => void) => void;
      removeEventListener: (ev: string, cb: () => void) => void;
    };
    const navAny = navigator as unknown as { getBattery?: () => Promise<BatteryManager> };
    if (typeof navAny.getBattery !== "function") return;
    let bm: BatteryManager | null = null;
    let cancelled = false;
    const update = () => {
      if (!bm) return;
      batteryLowRef.current = bm.level < 0.2 && !bm.charging;
    };
    navAny.getBattery!().then(b => {
      if (cancelled) return;
      bm = b;
      update();
      bm.addEventListener("levelchange", update);
      bm.addEventListener("chargingchange", update);
    }).catch(() => { /* unsupported, no-op */ });
    return () => {
      cancelled = true;
      if (bm) {
        bm.removeEventListener("levelchange", update);
        bm.removeEventListener("chargingchange", update);
      }
      batteryLowRef.current = false;
    };
  }, []);

  // ── NEON MODE: glass / transparent panels + tilt parallax.
  //    Off by default — opt-in display tweak. Auto-disables tilt parallax
  //    while recording or in LOW POWER to keep captures and battery clean.
  // Glass mode is the default — full-screen FX with translucent panel overlay.
  // Glass/neon mode is now permanent — the toggle button was removed in
  // v1.2.45 since glass-bottom-boat is the only intended look. Keep the
  // boolean as a const so existing className/effect branches continue to
  // work without rippling changes through the file.
  const neonMode = true;

  // v1.5.0 — single UI skin (NEON glass). The MOOG / 808 chassis skins and
  // their CSS were removed to cut the styling surface in three.
  const tiltRootRef = useRef<HTMLDivElement>(null);
  // ── FACE FX cycle: universal mask that gates ALL FX inside or
  //    outside an AI-segmented person. Uses MediaPipe Tasks Vision
  //    (selfie segmenter) for true per-pixel rotoscoping. Falls back
  //    to a centered selfie-cam oval if the model can't load (e.g. no
  //    network on first run before assets are cached).
  //    OFF  → no face-driven masking
  //    FACE → only the person/face area receives FX, background stays clean
  //    BG   → only the background receives FX, person stays clean
  type FaceFxMode = "OFF" | "FACE" | "BG";
  // v1.2.83: default to FACE so FX wrap the SUBJECT (foreground person)
  // — the user wanted to see procedural FX painting THEIR body, not the
  // wall behind them. Background segmentation hid the effect.
  // v1.3.47 — segmenter OFF at boot for lightest cold-start (no MediaPipe
  // load, no segmenter loop). User can enable FACE/BG from the GEN OVERLAY
  // tiles when they want the person-over-source composite.
  const [faceFxMode, setFaceFxMode] = useState<FaceFxMode>("OFF");
  // v1.2.53 — ref mirror so the camera-acquire path can re-check the
  // user's current intent after each await without re-binding the closure.
  const faceFxModeRef = useRef<FaceFxMode>("OFF");
  useEffect(() => { faceFxModeRef.current = faceFxMode; }, [faceFxMode]);
  const [faceFxToast, setFaceFxToast] = useState<string | null>(null);
  // v1.3.7 — explicit re-arm counter. Lets GEN OVERLAY tiles force a
  // fresh segmenter init even when faceFxMode is already at the target
  // value (which would otherwise short-circuit React's useState dedupe).
  const [faceFxKick, setFaceFxKick] = useState(0);
  // v1.3.17 — user-controllable mask EXPAND knob (0..1). Drives the
  // ring-dilation radius applied to the segmenter mask each tick. The
  // segmenter often under-cuts shoulders/hair; this knob lets the user
  // dial in how aggressively the matte spills outward to fully cover
  // the subject. 0 = no dilation (raw matte), 0.5 ≈ ~3 px (default,
  // matches the prior v1.3.16 hard-coded behaviour), 1.0 = ~7 px max.
  // v1.3.19 — default 0.0 now maps to ~5 px dilation (the new floor),
  // which already covers the face. Slider only goes UP from there; the
  // useless under-default radii were dropped.
  const [maskExpand, setMaskExpand] = useState(0.0);
  const maskExpandRef = useRef(0.0);
  useEffect(() => { maskExpandRef.current = maskExpand; }, [maskExpand]);
  const faceFxRef = useRef<{ active: boolean; invert: boolean; texValid: boolean; cx: number; cy: number; r: number; }>({
    active: false, invert: false, texValid: false, cx: 0.5, cy: 0.42, r: 0.28,
  });
  const cycleFaceFx = useCallback(() => {
    setFaceFxMode(m => {
      const next: FaceFxMode = m === "OFF" ? "FACE" : m === "FACE" ? "BG" : "OFF";
      setFaceFxToast(
        next === "OFF" ? "FACE FX · OFF"
        : next === "FACE" ? "FACE FX · PERSON-ONLY (AI roto)"
        : "FACE FX · BG-ONLY (AI roto)"
      );
      window.setTimeout(() => setFaceFxToast(null), 2200);
      return next;
    });
  }, []);
  // ── TIER info modal toggle (read-only feature matrix).
  const [tierInfoOpen, setTierInfoOpen] = useState(false);

  // ── Entitlement + grace period.
  // entitlement: null = locked, "paid" = lifetime, "studio" = subscriber.
  // graceRemaining: ms of free usage left (counts down only while app open).
  // locked: derived — true when no entitlement AND no grace remaining.
  const [entitlement, setEntitlement] = useState<Entitlement>(() =>
    (typeof window !== "undefined" ? loadEntitlement() : null));
  const [graceRemaining, setGraceRemaining] = useState<number>(() =>
    (typeof window !== "undefined" ? loadGraceRemaining() : GRACE_TOTAL_MS));
  const [unlockInputVisible, setUnlockInputVisible] = useState(false);
  const [unlockCode, setUnlockCode] = useState("");
  const versionTapsRef = useRef(0);
  const versionTapTimerRef = useRef<number | null>(null);
  const locked = entitlement === null && graceRemaining <= 0;

  // v1.3.52 — grace-period tick removed along with the lock screen.
  // entitlement / graceRemaining state remain only to keep the PLANS panel
  // status line typesafe; nothing in the app blocks on them anymore.

  // ── NEON MODE tilt parallax: read DeviceOrientation and write CSS vars.
  // Heavily smoothed so panels glide instead of jitter. Auto-disabled when
  // recording or in low-power. Permission prompt is iOS-only; on Android the
  // listener attaches directly.
  useEffect(() => {
    if (!neonMode) {
      // Reset CSS vars when neon mode is off so panels sit flat.
      const r = tiltRootRef.current;
      if (r) { r.style.setProperty("--tilt-x", "0deg"); r.style.setProperty("--tilt-y", "0deg"); r.style.setProperty("--tilt-tx", "0px"); r.style.setProperty("--tilt-ty", "0px"); }
      return;
    }
    let smoothG = 0; // gamma (left/right tilt, -90..90)
    let smoothB = 0; // beta  (front/back tilt, -180..180)
    let raf = 0;
    let lastG = 0, lastB = 0;
    const onOrient = (e: DeviceOrientationEvent) => {
      const g = typeof e.gamma === "number" ? e.gamma : 0;
      const b = typeof e.beta === "number" ? e.beta : 0;
      // Clamp beta to ±45 for sane parallax.
      lastG = Math.max(-45, Math.min(45, g));
      lastB = Math.max(-45, Math.min(45, b - 30)); // subtract resting hold angle
    };
    const loop = () => {
      // Pause parallax while recording or in low power — the FX should
      // stay clean and the device shouldn't waste cycles.
      const paused = lowPowerRef.current || (typeof document !== "undefined" && (document as Document & { fullscreenElement?: Element | null }).fullscreenElement != null);
      const targetG = paused ? 0 : lastG;
      const targetB = paused ? 0 : lastB;
      // Smooth: ~0.08 per frame ≈ 12-frame ramp.
      smoothG += (targetG - smoothG) * 0.08;
      smoothB += (targetB - smoothB) * 0.08;
      const r = tiltRootRef.current;
      if (r) {
        // Cap visual rotation to ~2°, translation to ~6px.
        const rotY = (smoothG / 45) * 2; // degrees
        const rotX = -(smoothB / 45) * 2;
        const tx = -(smoothG / 45) * 6;  // px (opposite direction = parallax)
        const ty = (smoothB / 45) * 6;
        r.style.setProperty("--tilt-x", `${rotX.toFixed(2)}deg`);
        r.style.setProperty("--tilt-y", `${rotY.toFixed(2)}deg`);
        r.style.setProperty("--tilt-tx", `${tx.toFixed(2)}px`);
        r.style.setProperty("--tilt-ty", `${ty.toFixed(2)}px`);
      }
      raf = window.requestAnimationFrame(loop);
    };
    // iOS 13+ requires explicit permission. On Android the call returns
    // undefined and the listener attaches normally.
    type DOEvtCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted"|"denied"> };
    const doe = (typeof DeviceOrientationEvent !== "undefined" ? DeviceOrientationEvent : null) as DOEvtCtor | null;
    const attach = () => {
      window.addEventListener("deviceorientation", onOrient, { passive: true });
      raf = window.requestAnimationFrame(loop);
    };
    if (doe && typeof doe.requestPermission === "function") {
      doe.requestPermission().then(s => { if (s === "granted") attach(); }).catch(() => { /* denied */ });
    } else {
      attach();
    }
    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [neonMode]);

  // ── FACE FX segmentation loop (MediaPipe Tasks Vision · Selfie
  //    Segmenter). Runs at ~10 Hz and uploads a single-channel mask
  //    canvas to the WebGL face texture. The shader then samples this
  //    texture as the universal FX mask. Centered-oval fallback kicks
  //    in if the model fails to load.
  useEffect(() => {
    if (faceFxMode === "OFF") {
      faceFxRef.current.active = false;
      faceFxRef.current.texValid = false;
      return;
    }
    faceFxRef.current.active = true;
    // v1.2.47: BG label means "FX paints background, person stays clean".
    // Empirically the SelfieSegmenter category mask we get from
    // MediaPipe Tasks Vision (LITE asset) yields fm=1 inside the
    // PERSON, so to paint the BACKGROUND we want shader to compute
    // (1 - fm). The shader does that when uFaceInvert == 1, so BG
    // → invert = true. (v1.2.46 had this same line but also flipped
    // the JS polarity, double-inverting back to wrong; now reverted.)
    faceFxRef.current.invert = faceFxMode === "BG";

    let cancelled = false;
    let rafId: number | null = null;
    let lastTickAt = 0;
    // v1.3.35 — monotonic timestamp for segmentForVideo. MediaPipe's VIDEO
    // running mode silently drops frames whose timestamp is <= the previous
    // one. Using performance.now() can produce duplicates under main-thread
    // pressure (heavy GIF capture / encode), which on Android WebView showed
    // as the mask freezing the moment recording started. A monotonic counter
    // (advanced by a fixed step per tick) guarantees strict increase regardless
    // of wall-clock jitter.
    let segTs = 0;
    type SegmentationMask = {
      getAsUint8Array?: () => Uint8Array;
      getAsFloat32Array?: () => Float32Array;
      width: number; height: number;
      close?: () => void;
    };
    type Segmenter = {
      segmentForVideo: (src: HTMLVideoElement, ts: number, cb: (r: { categoryMask?: SegmentationMask; confidenceMasks?: SegmentationMask[] }) => void) => void;
      close?: () => void;
    };
    let segmenter: Segmenter | null = null;

    // Lazy mask canvas + a 2D ctx for upload-to-WebGL.
    // v1.3.30 — bumped 256x144 -> 320x180. The shader-side dilation runs
    // in OUTPUT-pixel units (uFaceMaskRadius), so a denser source mask
    // gives the segmenter ~56% more silhouette samples per frame for
    // negligible upload cost (~225 KB vs 147 KB / tick at 320x180 RGBA).
    if (!faceMaskCanvasRef.current) {
      const c = document.createElement("canvas");
      c.width = 320; c.height = 180; // 16:9 lo-res — denser silhouette than v1.3.29
      faceMaskCanvasRef.current = c;
    }
    const maskCanvas = faceMaskCanvasRef.current;
    const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true })!;

    // v1.2.56 — Phase 3 segmenter perf. Hoist per-tick allocations:
    // the previous code allocated a new Uint8ClampedArray (~147 KB at
    // 256x144x4) plus a fresh <canvas> + ImageData every ~100 ms,
    // generating ~1.5 MB/s of GC pressure on the segmenter loop.
    // We now reuse one ImageData (which owns its rgba buffer) plus
    // one persistent scratch canvas. Both are rebuilt only when the
    // segmenter's mask geometry changes (rare).
    let scratchImg: ImageData | null = null;
    const scratchCanvas = document.createElement("canvas");
    const scratchCtx = scratchCanvas.getContext("2d")!;
    let scratchW = 0, scratchH = 0;

    // v1.2.56 — Phase 3 ADAPTIVE SEGMENTER CADENCE. Read the render
    // loop's rolling frametime EWMA: when the GPU is loafing (<14 ms,
    // >70 fps) we step up to ~20 Hz for crisp roto edges; when the
    // device is straining (>22 ms, <45 fps) we drop to ~10 Hz so the
    // segmenter stops competing with the shader for the GPU. Default
    // remains ~15 Hz. v1.2.75 — doubled cadence across all bands so
    // the figure mask keeps up with fast dance moves (was 6/10/12 Hz).
    const _segCadenceMs = () => {
      const f = schedulerRef.current?.frameTimeMs ?? 16.7;
      // v1.3.40 — also factor the global FX quality scalar. Under
      // sustained heat the governor drives fxQualityRef well below 1.0;
      // we lengthen segmenter cadence proportionally so the WASM call
      // stops fighting the shader for the GPU.  At Q=0.30 cadence is
      // ~3.3× the headroom-case interval (15 Hz → ~4.5 Hz).
      const q = Math.max(0.3, fxQualityRef.current || 1.0);
      const baseMs = f > 22 ? 100 : (f < 14 ? 50 : 67);
      return Math.round(baseMs / q);
    };

    const initAndRun = async () => {
      // v1.3.7 — RETRYING segmenter init. Previously a single try/catch
      // permanently set segmenter=null on first-boot failures (mediapipe
      // wasm not yet cached, race with Capacitor file:// resolution),
      // which left the tick() loop stuck in the "no segmenter" fallback
      // branch FOREVER. The user's fix path (cycle face FX off→on) only
      // worked because the cleanup tore down + recalled this whole
      // function. We now retry init up to 5 times with backoff so
      // GEN/SUBJECT and GEN/BG resolve on cold boot without manual cycling.
      let attempt = 0;
      while (!cancelled && attempt < 5) {
        try {
          const mp = await import("@mediapipe/tasks-vision");
          if (cancelled) return;
          const fileset = await mp.FilesetResolver.forVisionTasks("/mediapipe");
          if (cancelled) return;
          segmenter = await mp.ImageSegmenter.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: "/mediapipe/selfie_segmenter.tflite", delegate: "GPU" },
            runningMode: "VIDEO",
            // v1.3.30 — switch to CONFIDENCE masks (smooth Float32 0..1)
            // for the silhouette. The category mask was hard binary which,
            // combined with the v1.3.28 0.008 feather, made the edge look
            // "chunky / not matching" on faces and hair. The smooth
            // gradient gives MediaPipe's actual soft alpha through to the
            // shader so the silhouette tracks subjects more faithfully.
            outputCategoryMask: false,
            outputConfidenceMasks: true,
          }) as unknown as Segmenter;
          break; // success
        } catch (err) {
          attempt++;
          try { console.warn(`[GPS] FaceFx: segmenter init attempt ${attempt}/5 failed`, err); } catch { /* noop */ }
          segmenter = null;
          if (attempt < 5) {
            await new Promise<void>((r) => { window.setTimeout(r, 500 * attempt); });
          }
        }
      }

      const tick = () => {
        if (cancelled) return;
        // v1.3.35 — rAF-driven cadence with internal time-bucket gating.
        // Replaces the previous setTimeout chain, which on Android WebView
        // was throttled to ~1 Hz under recording load (heavy GIF
        // capture + getImageData + encode), making the silhouette appear
        // to freeze the moment record was pressed. rAF survives main-thread
        // pressure far better and is paced by the compositor.
        const now = performance.now();
        const cadence = segmenter ? _segCadenceMs() : 250;
        if (now - lastTickAt >= cadence) {
          lastTickAt = now;
          const v = videoRef.current;
          if (segmenter && v && v.videoWidth > 0 && v.readyState >= 2) {
          try {
            // Strictly monotonic timestamp — see segTs declaration above.
            segTs += 33;
            segmenter.segmentForVideo(v, segTs, (result) => {
              // v1.3.30 — prefer confidenceMasks (smooth f32 alpha); fall back
              // to categoryMask if the runtime ignored the option (older WASM).
              const cat: SegmentationMask | undefined = (result.confidenceMasks?.[0] ?? result.categoryMask);
              if (!cat) return;
              // v1.2.47: MediaPipe Tasks Vision SelfieSegmenter category
              // mask outputs category 0 = background, non-zero = person.
              // Keep person = 255 so the shader's `fm` reads 1 INSIDE
              // the person, and the BG/FACE mapping is handled by the
              // single `uFaceInvert` flag set above. (v1.2.46 flipped
              // this and double-inverted; reverted here.)
              const u8: Uint8Array | null = cat.getAsUint8Array ? cat.getAsUint8Array() : null;
              const f32: Float32Array | null = !u8 && cat.getAsFloat32Array ? cat.getAsFloat32Array() : null;
              const mw = cat.width, mh = cat.height;
              if (!u8 && !f32) { try { cat.close?.(); } catch { /* noop */ } return; }
              // v1.2.56 — reuse scratch ImageData + canvas across ticks.
              // We back the rgba buffer with the ImageData itself so there's
              // exactly one allocation owned per mask geometry. ImageData
              // dimensions are immutable, so when the segmenter switches
              // mask size we just rebuild it (rare event).
              if (!scratchImg || scratchW !== mw || scratchH !== mh) {
                scratchImg = new ImageData(mw, mh);
                scratchCanvas.width = mw;
                scratchCanvas.height = mh;
                scratchW = mw; scratchH = mh;
              }
              const rgba = scratchImg.data;
              if (u8) {
                for (let i = 0, j = 0; i < u8.length; i++, j += 4) {
                  const m = u8[i] > 0 ? 255 : 0;
                  // v1.2.51 — alpha = mask too, so faceMaskCanvas is
                  // also usable as an alpha matte for 2D-canvas
                  // compositing (source-in / destination-in) when we
                  // cut the camera-person out for the gen/upload
                  // composite path. Shader still reads .r so behavior
                  // there is unchanged.
                  rgba[j] = m; rgba[j+1] = m; rgba[j+2] = m; rgba[j+3] = m;
                }
              } else if (f32) {
                for (let i = 0, j = 0; i < f32.length; i++, j += 4) {
                  const m = Math.round(Math.min(1, Math.max(0, f32[i])) * 255);
                  rgba[j] = m; rgba[j+1] = m; rgba[j+2] = m; rgba[j+3] = m;
                }
              }
              try { cat.close?.(); } catch { /* noop */ }
              // v1.3.23 — REAL per-pixel dilation. Earlier versions
              // (blur+contrast in v1.3.21, scale-from-center in
              // v1.3.22) did not actually grow the mask in image
              // space.
              // v1.3.29 — FARADAY-STYLE PIPELINE. The CPU separable max-filter
              // (R=11..22 on a 256x144 buffer, ~10-20 ms/tick of JS) and the
              // destination-out 0.82 + blur(1.5px) temporal smear (deliberate
              // ~70 ms perceptual mask lag from v1.2.70) have BOTH been removed.
              // Reasons (see faraday-app/src/lib/mask-shader.ts):
              //   1. CPU dilation blocked the segmenter callback so the next
              //      tick missed its slot — we lost frames at fast subject
              //      motion. Faraday does dilation on the GPU as part of the
              //      fragment shader (see uFaceMaskRadius in the shader) at
              //      zero JS cost. We now do the same.
              //   2. The temporal smear was glued onto the mask to bridge the
              //      gap between segmenter ticks, but it perceptually lagged
              //      the silhouette behind the body. Faraday shows the latest
              //      mask as-is, instantly snapping to the subject every tick.
              // Pipeline now: paint scratch -> clear maskCanvas -> drawImage.
              // Net result: zero JS cost, no missed segmenter frames, mask
              // tracks the subject at the full 15-20 Hz cadence with no smear.
              scratchCtx.putImageData(scratchImg, 0, 0);
              const _dW = maskCanvas.width, _dH = maskCanvas.height;
              maskCtx.globalCompositeOperation = "source-over";
              maskCtx.clearRect(0, 0, _dW, _dH);
              maskCtx.drawImage(scratchCanvas, 0, 0, _dW, _dH);
              // Upload to the engine's face texture (no FLIP_Y, in-place fast path).
              const engF = engineRef.current;
              if (engF) {
                engF.setFaceMask(maskCanvas);
                faceFxRef.current.texValid = true;
              }
            });
          } catch (err) {
            try { console.warn("[GPS] FaceFx: segmentForVideo failed", err); } catch { /* noop */ }
          }
        } else {
          // No segmenter / no video yet — drift to centered oval.
          faceFxRef.current.texValid = false;
          faceFxRef.current.cx += (0.5  - faceFxRef.current.cx) * 0.1;
          faceFxRef.current.cy += (0.42 - faceFxRef.current.cy) * 0.1;
          faceFxRef.current.r  += (0.28 - faceFxRef.current.r ) * 0.1;
        }
        }
        rafId = window.requestAnimationFrame(tick);
      };
      tick();
    };
    initAndRun();
    return () => {
      cancelled = true;
      if (rafId != null) window.cancelAnimationFrame(rafId);
      try { segmenter?.close?.(); } catch { /* noop */ }
    };
  }, [faceFxMode, faceFxKick]);

  // Apply unlock code (dev path; replaced by Play Billing in next release).
  const applyUnlockCode = useCallback((code: string) => {
    const trimmed = code.trim();
    if (trimmed === "4200") { saveEntitlement("paid"); setEntitlement("paid"); setUnlockInputVisible(false); setUnlockCode(""); return; }
    if (trimmed === "6900") { saveEntitlement("studio"); setEntitlement("studio"); setUnlockInputVisible(false); setUnlockCode(""); return; }
    if (trimmed === "0000") { saveEntitlement(null); setEntitlement(null); setUnlockCode(""); return; }
    // Wrong code — clear input but stay open.
    setUnlockCode("");
  }, []);
  const onVersionTap = useCallback(() => {
    versionTapsRef.current += 1;
    if (versionTapTimerRef.current !== null) window.clearTimeout(versionTapTimerRef.current);
    versionTapTimerRef.current = window.setTimeout(() => { versionTapsRef.current = 0; }, 1500);
    if (versionTapsRef.current >= 5) {
      versionTapsRef.current = 0;
      setUnlockInputVisible(true);
    }
  }, []);

  const genStyleRef = useRef<GenStyle>("BAYER");
  const genResolutionRef = useRef(48);
  const genDensityRef = useRef(0.55);
  const genScaleRef = useRef(1.0);
  const genSpeedRef = useRef(0.6);
  const genHueRef = useRef(0.78);
  const genHueSpreadRef = useRef(0.35);
  const genSatRef = useRef(0.85);
  const genContrastGRef = useRef(0.7);
  const genMixRef = useRef(0.0); // v1.3.44
  const genWarpRef = useRef(0.25);
  const genJitterRef = useRef(0.15);
  const genSeedRef = useRef(7);
  const genInvertRef = useRef(false);
  const genMoshXRef = useRef(0);
  const genMoshYRef = useRef(0);
  const genScatterRef = useRef(0);
  const genScatterModeRef = useRef(0);
  const genGlyphModeRef = useRef(0);
  // Transient per-layer scatter pulses (decay each frame, layered on top
  // of the sustained `scatter` knob). Index 0..3 = layer; pulses fired by
  // the SHIFT/BURST/SHRED/FREEZE buttons (or all 4 if MASTER selected).
  const scatterPulsesRef = useRef<{amt:number; mode:number}[]>(
    [{amt:0,mode:0},{amt:0,mode:0},{amt:0,mode:0},{amt:0,mode:0}]
  );
  // ── Multi-layer pixel generators (1..4 styles fused into a SINGLE pixel
  // image, not stacked overlays). Each layer has its OWN full parameter
  // set so the layer-tab UI can edit them independently. The MASTER tab
  // broadcasts every edit to all 4 layers at once.
  // v1.2.66 — extended blend mode set. The first 8 (AVG..MUL) are the
  // legacy custom per-pixel blends used by the multi-layer fuse path
  // (with inter-layer pixel-displacement coupling). The new entries
  // (NORMAL..LUMI) are Canvas2D globalCompositeOperation blends applied
  // in the single-layer path or as a final flatten step in multi-layer.
  // Matches the standard Photoshop / After Effects blend mode menu so
  // the generator panel exposes the full painter's vocabulary.
  type GenBlend =
    | "AVG" | "MAX" | "MIN" | "XOR" | "ADD" | "SUB" | "DIFF" | "MUL"
    | "NORMAL" | "DARKEN" | "MULTIPLY" | "COLORBURN"
    | "LIGHTEN" | "SCREEN" | "COLORDODGE"
    | "OVERLAY" | "SOFTLIGHT" | "HARDLIGHT"
    | "DIFFERENCE" | "EXCLUSION"
    | "HUE" | "SATURATION" | "COLOR" | "LUMI";
  const GEN_BLEND_KEYS = [
    "AVG","MAX","MIN","XOR","ADD","SUB","DIFF","MUL",
    "NORMAL","DARKEN","MULTIPLY","COLORBURN",
    "LIGHTEN","SCREEN","COLORDODGE",
    "OVERLAY","SOFTLIGHT","HARDLIGHT",
    "DIFFERENCE","EXCLUSION",
    "HUE","SATURATION","COLOR","LUMI",
  ] as const;
  // Map blend key → Canvas2D globalCompositeOperation. Used by the
  // single-layer blend path and the multi-layer flatten step.
  const GEN_BLEND_OP: Record<string, GlobalCompositeOperation> = {
    MAX: "lighten", MIN: "darken", XOR: "xor",
    ADD: "lighter", SUB: "difference", DIFF: "difference", MUL: "multiply",
    NORMAL: "source-over",
    DARKEN: "darken", MULTIPLY: "multiply", COLORBURN: "color-burn",
    LIGHTEN: "lighten", SCREEN: "screen", COLORDODGE: "color-dodge",
    OVERLAY: "overlay", SOFTLIGHT: "soft-light", HARDLIGHT: "hard-light",
    DIFFERENCE: "difference", EXCLUSION: "exclusion",
    HUE: "hue", SATURATION: "saturation", COLOR: "color", LUMI: "luminosity",
  };
  type GenLayer = {
    style: GenStyle; enabled: boolean;
    density: number; scale: number; speed: number;
    hue: number; hueSpread: number; sat: number;
    contrast: number; warp: number; jitter: number;
    seed: number; invert: boolean;
    // Per-layer datamosh blend movement controls.
    moshX: number;     // -1..1 sustained X-axis displacement bias
    moshY: number;     // -1..1 sustained Y-axis displacement bias
    scatter: number;   // 0..1  sustained scatter intensity (knob)
    scatterMode: number; // 0 SHIFT | 1 BURST | 2 SHRED | 3 FREEZE
    glyphMode: number;   // v1.3.25 — typographic finisher 0..5
  };
  const makeLayerDefaults = (style: GenStyle, seed: number): GenLayer => ({
    style, enabled: false,
    density: 0.55, scale: 1.0, speed: 0.6,
    hue: 0.78, hueSpread: 0.35, sat: 0.85,
    contrast: 0.7, warp: 0.25, jitter: 0.15,
    seed, invert: false,
    moshX: 0, moshY: 0, scatter: 0, scatterMode: 0,
    glyphMode: 0,
  });
  // v1.3.47 — all four generator layers disabled at boot. Generator is no
  // longer rendering on cold launch; user enables a layer or dials MIX > 0.
  const [genLayers, setGenLayers] = useState<GenLayer[]>([
    { ...makeLayerDefaults("BAYER", 7),  enabled: false },
    { ...makeLayerDefaults("PLIFE", 23), enabled: false },
    { ...makeLayerDefaults("RINGS", 41), enabled: false },
    { ...makeLayerDefaults("WAVES", 89), enabled: false },
  ]);
  // selectedLayer: 0..3 = layer index, 4 = MASTER (broadcasts to all)
  const [selectedLayer, setSelectedLayer] = useState<number>(0);
  // v1.5.0 — one generator layer. Layers 2-4 stay in state for preset
  // round-trips but are never enabled; layer 1 is live whenever the
  // generator is the source or MIX > 0.
  useEffect(() => {
    setSelectedLayer(0);
    setGenLayers(prev => prev.map((l, i) => (i === 0 || !l.enabled) ? l : { ...l, enabled: false }));
  }, []);
  const selectedLayerRef = useRef(selectedLayer);
  useEffect(() => { selectedLayerRef.current = selectedLayer; }, [selectedLayer]);
  const [genBlend, setGenBlend] = useState<GenBlend>("AVG");
  const genLayersRef = useRef<GenLayer[]>(genLayers);
  const genBlendRef  = useRef<GenBlend>("AVG");
  const genLayerCanvasesRef = useRef<HTMLCanvasElement[]>([]);
  const genCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const genCompositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // v1.3.47 — per-pixel hash mosaic for GEN MIX over CAM. mask is a fixed
  // Uint8Array of [0..255] thresholds, generated once per resize. Pixels with
  // mask[i] < MIX*255 take the gen value; the rest stay cam. No alpha blend.
  const genHashMaskRef = useRef<Uint8Array | null>(null);
  const genHashScratchRef = useRef<HTMLCanvasElement | null>(null);
  // v1.2.51 — person-on-source composite canvases. faceComposeCanvasRef
  // is the final RGBA frame uploaded to WebGL (gen/upload as background +
  // camera-person on top); faceComposePersonRef is a scratch canvas used
  // to mask the camera frame down to the person silhouette before stamping.
  const faceComposeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const faceComposePersonRef = useRef<HTMLCanvasElement | null>(null);
  const genTimeRef = useRef(0);
  const motionSampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const motionPrevLumaRef = useRef<Uint8ClampedArray | null>(null);
  // v1.3.78 — reusable scratch luma buffer for camera motion detector
  // (was allocating ~2 KB every sample = ~46 KB/sec GC pressure on phone).
  const motionLumaBufRef = useRef<Uint8ClampedArray | null>(null);
  const motionEnergyRef = useRef(0);
  const motionFrameRef = useRef(0);
  const accelEnergyRef = useRef(0);
  const accelTiltXRef = useRef(0);
  const accelTiltYRef = useRef(0);
  const accelPushRef = useRef(0);

  // ── Mode / controls
  // v1.2.65 — auto-launch default: PIXEL SORT (mode 7) so the boot lands
  // straight into glitch with the camera + FACE FX = BG silhouette already
  // armed. Combined with sortMix default of 0.65 below this is instant
  // proof-of-work the moment the app opens.
  const [mode, setMode] = useState<ModeId>(7);
  const [gain, setGain] = useState(0.5);
  const [comboLayers, setComboLayers] = useState<{mode:ModeId;gain:number}[]>([{mode:7,gain:1},{mode:9,gain:1}]);
  const [comboMode, setComboMode] = useState(true);

  // ── Per-mode rack params (Phase 1B). Persisted under RACK_KEY.
  const [paramsByMode, setParamsByMode] = useState<Record<ModeId, Record<string, number>>>(() => defaultsForAllModes());

  // ── Post-process settings
  const [brightness, setBrightness] = useState(1.0);
  const [contrast, setContrast] = useState(1.0);
  const [saturation, setSaturation] = useState(1.0);
  const [hueShift, setHueShift] = useState(0.0);
  const [scanlines, setScanlines] = useState(0.0);
  const [zoom, setZoom] = useState(0.0);
  const [speed, setSpeed] = useState(1.0);


  // ── Glitch FX settings (multi-layer)
  // v1.3.13 — sortAmt defaults to 0 (was 0.5). The 0.5 default
  // armed the shader pixel-sort path on cold boot regardless of
  // sortMix, so users saw "pixel sorting on" the moment the app
  // opened. ALL FX knobs now ship at 0; only user input arms.
  const [sortAmt, setSortAmt] = useState(0.0);
  const [scanTear, setScanTear] = useState(0.0);
  const [blockGlitch, setBlockGlitch] = useState(0.0);
  const [datamosh, setDatamosh] = useState(0.0);
  const [moshHard, setMoshHard] = useState(false);
  const [chrash, setChrash] = useState(0.0);
  const [liquid, setLiquid] = useState(0.0);
  // v1.2.58 — Asendorf / Gysin homage rack (v1.2.59: streak/hilbert removed)
  const [glyph, setGlyph] = useState(0.0);
  // v1.2.85 — sortMix defaults to 0 so first paint is pure GEN+CAM
  // (procedural generator pattern composited with camera segmentation),
  // not pixel-sort distortion. The auto-bump useEffect at ~6636 still
  // raises sortMix back to 0.65 the moment the user toggles into PXL.
  const [sortMix, setSortMix] = useState(0.0);
  const [reactD, setReactD] = useState(0.0);
  const [voroSort, setVoroSort] = useState(0.0);
  // v1.3.61 — NOVEL CS FX (9 artist families). Each knob 0..1 directly drives
  // a brand-new shader primitive (DCT, Mondrian BSP, wavelet HF swap, Gabor,
  // 2D vertical sort, bit-CA, NES nametable, magnetic dipole, SAD motion).
  const [menkmanFX,   setMenkmanFX]   = useState(0.0);
  const [molnarFX,    setMolnarFX]    = useState(0.0);
  const [ucnvFX,      setUcnvFX]      = useState(0.0);
  const [gysinFX,     setGysinFX]     = useState(0.0);
  const [asendorfFX,  setAsendorfFX]  = useState(0.0);
  const [jodiFX,      setJodiFX]      = useState(0.0);
  const [arcangelFX,  setArcangelFX]  = useState(0.0);
  const [paikFX,      setPaikFX]      = useState(0.0);
  const [fentonFX,    setFentonFX]    = useState(0.0);
  // v1.3.64 — family selectors per ARTIST FX (0/1/2 = three sub-variants)
  const [menkmanFam,  setMenkmanFam]  = useState(0);
  const [molnarFam,   setMolnarFam]   = useState(0);
  const [ucnvFam,     setUcnvFam]     = useState(0);
  const [gysinFam,    setGysinFam]    = useState(0);
  const [asendorfFam, setAsendorfFam] = useState(0);
  const [jodiFam,     setJodiFam]     = useState(0);
  const [arcangelFam, setArcangelFam] = useState(0);
  const [paikFam,     setPaikFam]     = useState(0);
  const [fentonFam,   setFentonFam]   = useState(0);
  // v1.3.64 — when true, ARTIST knobs map to family index (0–1–2)
  // instead of intensity. Toggle button on the panel switches the meaning.
  // v1.3.70 — toggle removed; AMT and FAM now have separate knobs.
  // State kept (no setter destructured) only because legacy preset blobs
  // may carry the field; it has no UI surface anymore.
  const [artistFamilyMode] = useState(false);
  void artistFamilyMode;
  // v1.3.64 — ARTIST FX touch-bend strength + live touch position. The
  // live x/y is fed into the existing uTouch uniform; uArtistTouch scales
  // how hard each FX bends toward the finger.
  const [artistTouchStr, setArtistTouchStr] = useState(0.7);
  const [feedback, setFeedback] = useState(0.0);
  const [contour, setContour] = useState(0.0);
  const [ascii, setAscii] = useState(0.0);
  const [venetian, setVenetian] = useState(0.0);
  const [kaleido, setKaleido] = useState(0.0);
  // v1.2.60 — 9 sister UV warps that combo with KALEIDO. Each is an independent
  // mask-gated UV warp; chained sequentially after KALEIDO so any combination
  // produces a unique radial pattern. Defaults to 0 (off).
  const [tile, setTile] = useState(0.0);
  const [invertSym, setInvertSym] = useState(0.0);
  const [droste, setDroste] = useState(0.0);
  const [spiral, setSpiral] = useState(0.0);
  const [yantra, setYantra] = useState(0.0);
  const [mandala, setMandala] = useState(0.0);
  const [rosette, setRosette] = useState(0.0);
  const [starfold, setStarfold] = useState(0.0);
  const [hexfold, setHexfold] = useState(0.0);
  const [disrupt, setDisrupt] = useState(0.0);
  const [disruptCount, setDisruptCount] = useState(0.4);
  const [disruptSize, setDisruptSize] = useState(0.4);
  const [disruptContrary, setDisruptContrary] = useState(1.0);
  // v1.2.74 — 0 BLOB, 1 RING, 2 HEX, 3 CROSS, 4 STRIPE, 5 SPIRAL
  const [disruptShape, setDisruptShape] = useState(0);
  const [sortKey, setSortKey] = useState(0);
  // v1.3.47 — all PIXEL SORT knobs null at boot (HIGH=1.0 = full passthrough
  // band so the moment user dials AMOUNT up the sort sees the full luma range).
  const [sortLow, setSortLow] = useState(0.0);
  const [sortHigh, setSortHigh] = useState(1.0);
  const [sortMode, setSortMode] = useState(0); // 0 LINE, 1 SPIRAL, 2 BLOCK, 3 SLICE, 4 HILBERT
  const [sortSegment, setSortSegment] = useState(0.0);
  const [sortRandom, setSortRandom] = useState(0.0);
  const [sortWobble, setSortWobble] = useState(0.0);
  // satyarth/Akascape pixelsort-style extensions
  const [sortInterval, setSortInterval] = useState(0); // 0 BAND,1 BRIGHT,2 DARK,3 RAND,4 WAVE,5 EDGE,6 NONE
  const [sortAngle, setSortAngle] = useState(0);       // 0 HORZ,1 VERT,2 DIAG↗,3 DIAG↘
  // RGBNDR (ohss/RGBNDR-inspired analog VGA channel-bender)
  const [rgbR, setRgbR] = useState(0);
  const [rgbG, setRgbG] = useState(0);
  const [rgbB, setRgbB] = useState(0);
  const [rgbBars, setRgbBars] = useState(0);
  const [rgbSwap, setRgbSwap] = useState(0); // 0 RGB,1 GBR,2 BRG,3 BGR,4 RBG,5 GRB
  // RUPTURE/HSYNC — _rupture_-style composite-signal destruction. RUPTURE
  // is a single combo knob driving dropout + chroma crash + sync burst;
  // HSYNC is a per-row tear-and-shift slip emulation.
  const [rupture, setRupture] = useState(0);
  const [hsync, setHsync] = useState(0);
  // v1.3.47 — all DATAMOSH knobs null at boot. moshBleed + moshDistort are
  // no longer user-facing knobs; they're driven by the new FAMILY selector
  // (SOFT/HARD/SLICE/SMEAR/CHAOS/GLITCH). State kept for preset round-trip.
  const [moshIFrame, setMoshIFrame] = useState(0.0);
  const [moshMotion, setMoshMotion] = useState(0.0);
  const [moshBleed, setMoshBleed] = useState(0.0);
  const [moshMap, setMoshMap] = useState(0.0);
  const [moshDistort, setMoshDistort] = useState(0.0);
  const [moshFamily, setMoshFamily] = useState(0); // 0 SOFT,1 HARD,2 SLICE,3 SMEAR,4 CHAOS,5 GLITCH

  // v1.3.57 — GLITCH PALETTE (FX Panel 2). Each preset boosts a small uniform set in the
  // render loop while ANY strokes are painted, so the painted region picks
  // up that preset's character on top of whatever the user has dialed in.
  // Preset 8 (PIXEL) spawns animated cells via the existing pxSpawnAt path.
  // v1.3.56 — preset grid remapped to match Luca Grillo's "Glitch!" Android
  // app gallery (GLITCH / RUBIK / DATAMOSH / HACKER / SORT / BURN / WARP /
  // GHOST / DRIP). Boosts are tuned much harder than v1.3.55 so each cell
  // produces a fully-finished aesthetic at any pressure rather than a subtle
  // delta. The previous PIXEL slot was dropped — v1.3.55 made the single-
  // pixel pen the only paint mode, so every palette cell now drives FX.
  type UniformBoostKey =
    | "uDatamosh"
    | "uMoshIFrame" | "uMoshBleed" | "uMoshMotion" | "uMoshDistort"
    | "uSortAmt" | "uSortWobble" | "uSortRandom"
    | "uChrash" | "uLiquid" | "uKaleido" | "uSpiral"
    | "uAscii" | "uVenetian" | "uScanTear"
    | "uHSync" | "uFeedback" | "uRgbBars" | "uContour"
    | "uBlockGlitch" | "uVoroSort" | "uRupture"
    | "uRgbSwap" | "uGlyph" | "uMandala" | "uYantra"
    | "uTile" | "uHexfold" | "uStarfold"
    | "uDroste" | "uReact";
  type BoostMap = Partial<Record<UniformBoostKey, number>>;
  type PresetState = { chaos: number };
  type GlitchPreset = {
    name: string;
    color: string;
    /** Short mathematical signature shown under the button. */
    signature: string;
    /** Per-frame generator — returns time-varying uniform boosts. */
    modulate: (t: number, s: PresetState) => BoostMap;
  };
  // v1.3.58 — DYNAMIC GENERATIVE PRESETS. Each cell is no longer a static
  // bag of boost values; it is a per-frame closure that emits time-varying
  // uniform deltas computed from the mathematical / algorithmic signature
  // of the artist it pays homage to. Nothing here is a stylistic mimic —
  // each modulator implements the actual computer-science primitive that
  // defined that artist's practice:
  //
  //   MENKMAN  — DCT band drift: 8x8 quantization viewed as a continuously
  //              breathing 3-band crossfade (smoothstep between quant tiers
  //              instead of hard floor steps) → bleed/distort/contour.
  //   MOLNÁR   — algorithmic grid + Box-Muller Gaussian perturbation +
  //              golden-ratio sub-harmonic rotation ("Interruptions" 1968).
  //   UCNV     — datamosh advection: continuous motion-vector flow modeled
  //              as a 2-band sine drift (0.27 Hz carrier × 0.083 Hz LFO)
  //              with smoothstep-shaped i-frame envelope.
  //   GYSIN    — Dream Machine SLOWED to flicker-fusion threshold (0.8 Hz
  //              alpha drift × 0.13 Hz phi-braid carrier); continuous cut.
  //   ASENDORF — ASDFPixelSort luminance-window sweep (triangle ramp) +
  //              golden-ratio / 1-phi sub-frequencies on wobble/random,
  //              plus liquid carrier for fluid sort migration.
  //   JODI     — logistic map r=3.95 LOW-PASSED via exponential smoothing
  //              (α=0.08) so the chaos register reads as a drift not a
  //              strobe; outputs are continuous lerps, no beat gating.
  //   ARCANGEL — Super Mario Clouds scroll: smooth dual-phase triangle
  //              (0.20 Hz) + counter-phase + slow liquid carrier.
  //              No hsync wrap discontinuity.
  //   PAIK     — Lissajous figure (3:5 frequency ratio, π/4 phase offset);
  //              fx,fy and their product drive feedback/liquid/mosh flow.
  //   FENTON   — Astrocade raster advection: harmonic LFO bank (0.17 /
  //              0.41 / 0.79 Hz) summed into a continuous flow field;
  //              no Bernoulli on/off, no slab toggles.
  //
  const TAU = Math.PI * 2;
  const PHI = 1.6180339887;
  // Cheap hash: deterministic, no Math.random. Used by MOLNÁR only.
  const _h = (n: number): number => {
    const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  // Smoothstep utility for fluid envelopes.
  const _ss = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const GLITCH_PRESETS: readonly GlitchPreset[] = [
    {
      name: "MENKMAN", color: "#FF6FB1",
      signature: "DCT band drift",
      modulate: (t) => {
        // Three quant tiers crossfaded by a slow triangle — band identity
        // is continuous, not stepped, so the picture migrates between
        // compression regimes instead of jumping.
        const ramp = (t * 0.18) % 1;                     // 0..1 every ~5.5s
        const tier = ramp * 3;                            // 0..3
        const a = _ss(0.0, 1.0, tier);                    // tier 0 → 1
        const b = _ss(1.0, 2.0, tier);                    // tier 1 → 2
        const c = _ss(2.0, 3.0, tier);                    // tier 2 → 3
        const breath = 0.5 + 0.5 * Math.sin(t * 0.6 * TAU);
        return {
          uDatamosh:    0.40 + a * 0.30 + breath * 0.15,  // open mosh gate
          uMoshBleed:   0.30 + a * 0.40 + breath * 0.15,
          uMoshDistort: 0.20 + b * 0.45,
          uContour:     0.35 + c * 0.30,
          uTile:        0.18 + a * 0.22 + c * 0.10,
        };
      },
    },
    {
      name: "MOLNÁR", color: "#5BE9FF",
      signature: "grid · Box-Muller σ",
      modulate: (t) => {
        // Box-Muller pair from deterministic hash, but the index advances
        // CONTINUOUSLY via fractional interpolation between integer buckets
        // → Gaussian noise becomes a smoothly flowing field, not a stepper.
        const tf = t * 0.7;
        const i0 = Math.floor(tf), i1 = i0 + 1, f = tf - i0;
        const u1a = Math.max(1e-3, _h(i0)),       u1b = Math.max(1e-3, _h(i1));
        const u2a = _h(i0 + 17),                  u2b = _h(i1 + 17);
        const u1 = u1a + (u1b - u1a) * _ss(0, 1, f);
        const u2 = u2a + (u2b - u2a) * _ss(0, 1, f);
        const g  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2);
        const gauss = Math.min(1, Math.abs(g) * 0.35);
        const slow  = 0.5 + 0.5 * Math.sin(t * 0.05 * TAU);
        const phiSub = 0.5 + 0.5 * Math.sin(t * 0.5 / PHI);
        return {
          uContour:    0.85 + 0.10 * phiSub,             // breathing skeleton
          uTile:       0.38 + slow * 0.30,
          uVoroSort:   0.30 + gauss * 0.55,
          uSortAmt:    0.45 + gauss * 0.30,              // open sort gate
          uSortRandom: 0.18 + gauss * 0.40,
        };
      },
    },
    {
      name: "UCNV", color: "#A270FF",
      signature: "mosh advection · 2-band drift",
      modulate: (t) => {
        // Continuous motion-vector flow: a fast carrier inside a slow LFO
        // envelope. No frame-kill events — datamosh as a fluid, not bursts.
        const carrier = 0.5 + 0.5 * Math.sin(t * 0.27 * TAU);
        const lfo     = 0.5 + 0.5 * Math.sin(t * 0.083 * TAU + 1.1);
        const cross   = 0.5 + 0.5 * Math.sin(t * 0.13 * TAU + 2.3);
        const env     = _ss(0.15, 0.85, carrier);         // soft envelope
        return {
          uDatamosh:    0.55 + env * 0.45,                // open mosh gate
          uMoshIFrame:  0.35 + env   * 0.45,
          uMoshBleed:   0.40 + lfo   * 0.40,
          uMoshMotion:  0.45 + cross * 0.45,
          uMoshDistort: 0.25 + (carrier * lfo) * 0.55,
        };
      },
    },
    {
      name: "GYSIN", color: "#7AFF6E",
      signature: "α drift · φ braid",
      modulate: (t) => {
        // Dream Machine slowed below flicker-fusion: 0.8 Hz alpha drift
        // braided with 0.13 Hz phi-carrier. Cut-up is a CONTINUOUS lerp,
        // not a binary swap, so the rhythm feels like breath.
        const alpha = 0.5 + 0.5 * Math.sin(t * 0.8  * TAU);
        const braid = 0.5 + 0.5 * Math.sin(t * 0.13 * TAU + Math.PI / PHI);
        const cut   = 0.5 + 0.5 * Math.sin(t * 0.22 * TAU);
        return {
          uGlyph:     0.40 + alpha * 0.45,
          uContour:   0.30 + braid * 0.35,
          uDatamosh:  0.35 + cut   * 0.30,                // open mosh gate
          uMoshBleed: 0.25 + cut   * 0.35,
          uVoroSort:  0.20 + alpha * braid * 0.45,
        };
      },
    },
    {
      name: "ASENDORF", color: "#FFA040",
      signature: "lum sweep · φ wobble · liquid",
      modulate: (t) => {
        // Triangle sweep of sort amount + golden-ratio sub-frequencies on
        // wobble/random; a slow liquid carrier under it all so the sort
        // boundary MIGRATES rather than ticking.
        const tri    = 1 - Math.abs(((t * 0.10) % 2) - 1);    // 0..1..0
        const liq    = 0.5 + 0.5 * Math.sin(t * 0.06 * TAU);
        return {
          uSortAmt:    0.55 + tri * 0.40,
          uSortWobble: 0.35 + 0.40 * Math.sin(t * PHI * 0.5),
          uSortRandom: 0.28 + 0.30 * Math.cos(t * (1 / PHI) * 0.5),
          uLiquid:     0.20 + liq * 0.35,
        };
      },
    },
    {
      name: "JODI", color: "#FF2E2E",
      signature: "logistic drift r=3.95",
      modulate: (t, s) => {
        // Stateful logistic-map iteration, then EXPONENTIALLY SMOOTHED so
        // the chaos reads as a slow drift instead of a strobe. Outputs are
        // continuous lerps of the smoothed chaos — no beat clock.
        s.chaos = 3.95 * s.chaos * (1 - s.chaos);
        if (s.chaos < 1e-4 || s.chaos > 1 - 1e-4) {
          s.chaos = 0.4 + 0.2 * Math.sin(t);                 // re-seed
        }
        // Re-purpose chaos as the TARGET of a 1-pole low-pass:
        // y[n] = y[n-1] + α (x[n] - y[n-1]); we keep y in the same field.
        // (chaos itself stores the smoothed value across frames.)
        const c = s.chaos;
        const carrier = 0.5 + 0.5 * Math.sin(t * 0.19 * TAU);
        return {
          uSortRandom: 0.25 + c * 0.55,
          uRupture:    0.20 + (1 - c) * 0.50,
          uGlyph:      0.30 + carrier * 0.40,
          uContour:    0.25 + c * carrier * 0.55,
        };
      },
    },
    {
      name: "ARCANGEL", color: "#FFE36B",
      signature: "smooth scroll · feedback drift",
      modulate: (t) => {
        // Mario Clouds parallax as a smooth triangle (NOT a sawtooth) —
        // the picture drifts both ways without the wrap discontinuity.
        const tri  = 1 - Math.abs(((t * 0.20) % 2) - 1);
        const tri2 = 1 - Math.abs((((t + 2.5) * 0.20) % 2) - 1);
        const carrier = 0.5 + 0.5 * Math.sin(t * 0.40 * TAU);
        return {
          uDroste:   0.30 + tri     * 0.50,
          uFeedback: 0.30 + tri2    * 0.45,
          uLiquid:   0.20 + carrier * 0.30,
          uTile:     0.18 + (tri * tri2) * 0.30,
        };
      },
    },
    {
      name: "PAIK", color: "#B0F4FF",
      signature: "Lissajous 3:5 · feedback",
      modulate: (t) => {
        // Lissajous (3:5, π/4 offset) drives feedback/liquid; product of
        // orthogonals drives mosh flow. All continuous, no chrash bursts.
        const fx = 0.5 + 0.5 * Math.sin(t * 0.3 * TAU);
        const fy = 0.5 + 0.5 * Math.sin(t * 0.5 * TAU + Math.PI / 4);
        return {
          uFeedback:   0.45 + fx * 0.45,
          uLiquid:     0.30 + fy * 0.40,
          uDatamosh:   0.40 + fx * fy * 0.45,             // open mosh gate
          uMoshBleed:  0.25 + (1 - fx) * 0.35,
          uMoshMotion: 0.30 + fx * fy * 0.50,
        };
      },
    },
    {
      name: "FENTON", color: "#FF4D6E",
      signature: "raster advection · LFO bank",
      modulate: (t) => {
        // Three incommensurate LFOs summed into a continuous flow field —
        // never repeats, never strobes. Replaces the v1.3.58 Bernoulli
        // bit-flip with the actual Astrocade raster-drift homage.
        const a = 0.5 + 0.5 * Math.sin(t * 0.17 * TAU);
        const b = 0.5 + 0.5 * Math.sin(t * 0.41 * TAU + 1.7);
        const c = 0.5 + 0.5 * Math.sin(t * 0.79 * TAU + 3.1);
        return {
          uSortAmt:    0.40 + a * 0.40,
          uDatamosh:   0.45 + b * 0.35,                   // open mosh gate
          uMoshMotion: 0.35 + b * 0.45,
          uMoshBleed:  0.30 + c * 0.40,
          uVoroSort:   0.25 + (a + b) * 0.22,
        };
      },
    },
  ];
  const [glitchPreset, setGlitchPreset] = useState(0);
  const glitchPresetRef = useRef(0);
  useEffect(() => { glitchPresetRef.current = glitchPreset; }, [glitchPreset]);
  // v1.3.58 — chaos register for stateful modulators (JODI logistic map).
  const presetStateRef = useRef<PresetState>({ chaos: 0.42 });
  // v1.3.57 — FX Panel 2 ON/OFF toggle. When true, the selected GLITCH_PRESETS
  // entry's `boosts` are added on top of every shader uniform globally
  // (PB() helper in the render loop). When false, presets are dormant.
  const [glitchPresetEnabled, setGlitchPresetEnabled] = useState(false);
  const glitchPresetEnabledRef = useRef(false);
  useEffect(() => { glitchPresetEnabledRef.current = glitchPresetEnabled; }, [glitchPresetEnabled]);

  // ── Export
  const [recording, setRecording] = useState(false);
  // v1.3.65 — capture-mode toggle. PHOTO = shutter button takes still,
  // VIDEO = shutter button starts/stops MediaRecorder. Replaces the old
  // "tap = photo · hold = record" gesture with two explicit controls so
  // the on-screen button can also visibly glow during recording.
  // (v1.3.66: canvas overlay now has TWO permanent buttons — PHOTO right,
  //  REC left — so this state only survives for the export panel preset.)
  const [captureMode, setCaptureMode] = useState<"photo" | "video">("photo");

  // ── v1.3.66 Auto-VJ (visualizer) mode ────────────────────────────
  // The old 🔊/🔈 mic toggle is replaced by an autonomous VJ engine that
  // (a) drives the existing uAudio/uABass/uATreb/uABeat shader uniforms
  //     from synthetic LFOs so all audio-react paths animate without a mic,
  // (b) periodically re-rolls a subset of FX values + family variants for
  //     a continuously-shifting auto-VJ feel suitable for phone / DJ /
  //     projector ambient use.
  const [vjMode, setVjMode] = useState(false);
  const vjModeRef = useRef(false);
  useEffect(() => { vjModeRef.current = vjMode; }, [vjMode]);
  // v1.3.68 — beat-matched cycling.
  // Render loop watches audioBeatRef rising-edge over BEAT_THRESH and
  // increments vjBeatCountRef. Every BEATS_PER_CYCLE beats it sets
  // vjPendingCycleRef = true, which the Auto-VJ effect polls on a short
  // interval and consumes by firing a fresh cycle. Falls back to a hard
  // CYCLE_TIMEOUT_MS so silent passages still evolve.
  const vjBeatCountRef = useRef(0);
  const vjLastBeatHighRef = useRef(false);
  const vjLastCycleAtRef = useRef(0);
  const vjPendingCycleRef = useRef(false);
  const vjBeatPulseRef = useRef(0); // last detected beat strength (0..1) for FX kicks
  // Hardcoded musical defaults — most house/techno/pop sits 100-130 bpm,
  // so 4 beats ≈ 1.8-2.4s per cycle which reads well visually.
  const VJ_BEATS_PER_CYCLE = 4;
  const VJ_BEAT_THRESH = 0.55;
  const VJ_BEAT_REFRACTORY_MS = 220;
  const VJ_CYCLE_TIMEOUT_MS = 4500;

  // ── v1.3.68 Local-track loader for real audio reactivity ───────
  // User picks an audio file from device. We pipe it through a single
  // <audio> element → MediaElementAudioSourceNode → the existing
  // audioAnalyserRef so AUTO-VJ's beat detector sees the real waveform.
  // Also routed to actx.destination so it actually plays out loud.
  const trackFileInputRef = useRef<HTMLInputElement | null>(null);
  const trackAudioElRef = useRef<HTMLAudioElement | null>(null);
  const trackCtxRef = useRef<AudioContext | null>(null);
  const trackSrcNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const trackAnalyserRef = useRef<AnalyserNode | null>(null);
  const trackObjectUrlRef = useRef<string | null>(null);
  const [trackName, setTrackName] = useState<string | null>(null);
  const [trackPlaying, setTrackPlaying] = useState(false);

  const stopTrack = useCallback(() => {
    try { trackAudioElRef.current?.pause(); } catch { /* ignore */ }
    try { audioAnalyserRef.current = null; } catch { /* ignore */ }
    try { audioDataArrayRef.current = null; } catch { /* ignore */ }
    try { trackSrcNodeRef.current?.disconnect(); } catch { /* ignore */ }
    try { trackAnalyserRef.current?.disconnect(); } catch { /* ignore */ }
    try { audioFeaturesRef.current = null; } catch { /* ignore */ }
    try { trackCtxRef.current?.close(); } catch { /* ignore */ }
    if (trackObjectUrlRef.current) {
      try { URL.revokeObjectURL(trackObjectUrlRef.current); } catch { /* ignore */ }
      trackObjectUrlRef.current = null;
    }
    trackSrcNodeRef.current = null;
    trackAnalyserRef.current = null;
    trackCtxRef.current = null;
    if (trackAudioElRef.current) {
      try { trackAudioElRef.current.src = ""; } catch { /* ignore */ }
    }
    setTrackPlaying(false);
    setTrackName(null);
  }, []);

  const handleTrackFile = useCallback(async (file: File) => {
    try {
      // Tear down any prior track first.
      stopTrack();
      const url = URL.createObjectURL(file);
      trackObjectUrlRef.current = url;
      let el = trackAudioElRef.current;
      if (!el) {
        el = document.createElement("audio");
        el.crossOrigin = "anonymous";
        el.loop = true;
        el.preload = "auto";
        trackAudioElRef.current = el;
      }
      el.src = url;
      const Ctor = (window.AudioContext
        || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      const actx = new Ctor();
      try { await actx.resume(); } catch { /* ignore */ }
      const src = actx.createMediaElementSource(el);
      // v1.5.4 — Terminal Velocity analysis tap; the audible path is a
      // separate branch straight to the speakers.
      const feats = createAudioFeatures(actx, src);
      const analyser = feats.analyser;
      src.connect(actx.destination);
      trackCtxRef.current = actx;
      trackSrcNodeRef.current = src;
      trackAnalyserRef.current = analyser;
      audioFeaturesRef.current = feats;
      audioAnalyserRef.current = analyser;
      audioDataArrayRef.current = new Uint8Array(analyser.fftSize);
      setTrackName(file.name.replace(/\.[^.]+$/, "").slice(0, 28));
      try { await el.play(); setTrackPlaying(true); } catch { setTrackPlaying(false); }
    } catch {
      stopTrack();
    }
  }, [stopTrack]);

  const toggleTrackPlayback = useCallback(async () => {
    const el = trackAudioElRef.current;
    if (!el || !el.src) {
      trackFileInputRef.current?.click();
      return;
    }
    if (el.paused) {
      try { await trackCtxRef.current?.resume(); } catch { /* ignore */ }
      try { await el.play(); setTrackPlaying(true); } catch { /* ignore */ }
    } else {
      try { el.pause(); } catch { /* ignore */ }
      setTrackPlaying(false);
    }
  }, []);

  // ── v1.3.66 SFX engine ───────────────────────────────────────────
  // Tiny synth-only sound effect bank (no assets). Lazy-creates a single
  // shared AudioContext on first call. Sounds are short percussive blips
  // so they never compete with whatever audio the user is monitoring.
  const sfxCtxRef = useRef<AudioContext | null>(null);
  const sfxLastRef = useRef(0);
  const playSfx = useCallback((kind: "shutter" | "recStart" | "recStop" | "click" | "toggle" | "open" | "close") => {
    try {
      // Throttle to avoid overlap on rapid taps.
      const now = performance.now();
      if (now - sfxLastRef.current < 18) return;
      sfxLastRef.current = now;
      let ctx = sfxCtxRef.current;
      if (!ctx) {
        const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
        ctx = new Ctor();
        sfxCtxRef.current = ctx;
      }
      if (ctx.state === "suspended") { ctx.resume().catch(() => {}); }
      const t0 = ctx.currentTime;
      const beep = (freq: number, dur: number, vol: number, type: OscillatorType = "sine", glide?: number) => {
        const osc = ctx!.createOscillator();
        const g = ctx!.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (glide != null) osc.frequency.exponentialRampToValueAtTime(Math.max(40, glide), t0 + dur);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g); g.connect(ctx!.destination);
        osc.start(t0); osc.stop(t0 + dur + 0.02);
      };
      const noise = (dur: number, vol: number, hpf?: number) => {
        const buf = ctx!.createBuffer(1, Math.floor(ctx!.sampleRate * dur), ctx!.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
        const src = ctx!.createBufferSource(); src.buffer = buf;
        const g = ctx!.createGain();
        g.gain.setValueAtTime(vol, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        if (hpf) {
          const f = ctx!.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hpf;
          src.connect(f); f.connect(g);
        } else { src.connect(g); }
        g.connect(ctx!.destination);
        src.start(t0); src.stop(t0 + dur + 0.02);
      };
      switch (kind) {
        case "shutter":  noise(0.05, 0.18, 1800); beep(2400, 0.04, 0.10, "square", 1200); break;
        case "recStart": beep(620, 0.10, 0.14, "sine", 880); beep(880, 0.08, 0.10, "sine"); break;
        case "recStop":  beep(880, 0.08, 0.12, "sine", 440); beep(440, 0.10, 0.10, "sine"); break;
        case "click":    beep(1800, 0.022, 0.06, "square"); break;
        case "toggle":   beep(1400, 0.05, 0.09, "triangle", 1900); break;
        case "open":     beep(700, 0.06, 0.08, "triangle", 1500); break;
        case "close":    beep(1500, 0.06, 0.08, "triangle", 700); break;
      }
    } catch { /* ignore */ }
  }, []);
  const playSfxRef = useRef(playSfx);
  useEffect(() => { playSfxRef.current = playSfx; }, [playSfx]);
  // (v1.3.57 — entire DRAW / PAINT / pxCanvas / drawCrash infrastructure
  // removed. The artist-pioneer GLITCH_PRESETS palette is now exposed
  // globally via FX Panel 2 ("GLITCH PALETTE · ARTIST FX") instead of
  // being driven by pointer strokes. PB() in the render loop gates on
  // glitchPresetEnabledRef.current.)
  // _DRAW_BLOCK_END_v1_3_57_

  // v1.2.76 — UI HIDE / IMMERSIVE toggle. When true, top bar + controls
  // v1.2.76 — UI HIDE / IMMERSIVE toggle. When true, top bar + controls
  // pane collapse and the canvas fills the screen. Also calls Capacitor
  // StatusBar.hide() and the standard Fullscreen API so the device
  // chrome (status bar + nav bar) actually goes away on Android, not
  // just the in-app chrome. The float-over-canvas eye button restores.
  const [uiHidden, setUiHidden] = useState(false);
  const [fps, setFps] = useState(0);
  const [exportFormat, setExportFormat] = useState<"gif" | "video">("gif");
  // v1.3.31 — render-loop GIF capture needs to read the current export
  // format from inside a useCallback that's pinned with no React deps.
  const exportFormatRef = useRef<"gif" | "video">("gif");
  useEffect(() => { exportFormatRef.current = exportFormat; }, [exportFormat]);
  const [exportQuality, setExportQuality] = useState<"standard" | "high" | "ultra">("high");
  const [exportProfile, setExportProfile] = useState<ExportProfile>("native");
  // User-selectable canonical recording rate. Applied to both GIF and video
  // so the encoded output's frame timing matches what the recorder pulls.
  // GIF format spec stores delay in 1/100 sec, browsers minimum-clamp to
  // 2cs (= 50fps), so a "60fps GIF" actually plays at 50fps regardless.
  // We expose 60 anyway for video; the GIF path clamps to 50 internally.
  const [recordFps, setRecordFps] = useState<24 | 30 | 60>(30);
  const recordFpsRef = useRef(recordFps);
  useEffect(() => { recordFpsRef.current = recordFps; }, [recordFps]);
  // Max recording duration. Default 30s — long enough for a meaningful
  // generative loop, short enough to keep GIF file sizes manageable.
  // User can dial up to 60s in the EXPORT panel.
  const [recordMaxSec, setRecordMaxSec] = useState<5 | 15 | 30 | 60>(30);
  const recordMaxSecRef = useRef(recordMaxSec);
  useEffect(() => { recordMaxSecRef.current = recordMaxSec; }, [recordMaxSec]);
  // Whether to auto-trim GIFs to the nearest perfect loop point. When off,
  // the recording is exported full-length with no end-trim.
  const [perfectLoop, setPerfectLoop] = useState(true);
  const perfectLoopRef = useRef(true);
  useEffect(() => { perfectLoopRef.current = perfectLoop; }, [perfectLoop]);
  // Audio-react drive: how much the analyser RMS modulates the per-layer
  // mosh + scatter knobs in real time. 0 = audio button purely visual via
  // shader uAudio; 1 = full-range mosh swing on every beat.
  const [audioReactAmt, setAudioReactAmt] = useState(0.75);
  const audioReactAmtRef = useRef(0.75);
  useEffect(() => { try { const v = parseFloat(localStorage.getItem("gps.vj.reactAmt.v1") ?? ""); if (Number.isFinite(v)) setAudioReactAmt(Math.min(1, Math.max(0, v))); } catch { /* ignore */ } }, []);
  useEffect(() => { try { localStorage.setItem("gps.vj.reactAmt.v1", String(audioReactAmt)); } catch { /* ignore */ } }, [audioReactAmt]);
  useEffect(() => { audioReactAmtRef.current = audioReactAmt; }, [audioReactAmt]);
  // Cross-feed: feed the camera signal into generators (and vice versa)
  // so the generator can pixel-sort/mosh the camera, and the camera can
  // be moshed by what the generator is doing.
  const [crossFeed, setCrossFeed] = useState(false);
  const crossFeedRef = useRef(false);
  useEffect(() => { crossFeedRef.current = crossFeed; }, [crossFeed]);
  const [recordingHint, setRecordingHint] = useState<string | null>(null);
  // v1.2.71 — HANDS-FREE record: floating top-of-screen button so a solo
  // dancer can always reach it without scrolling. Tapping starts a 3-2-1
  // count-IN overlay (so they can step into frame), then auto-records for
  // a fixed 60 s, with the last 3 s shown as a 3-2-1 count-OUT overlay so
  // they know to hold the pose. handsFreeCountdown encodes both phases:
  //   { phase: "in",  n: 3|2|1 } — pre-record countdown
  //   { phase: "rec", n: <secs remaining> } — live recording (mid-shoot)
  //   { phase: "out", n: 3|2|1 } — final 3 s of recording (count-out)
  //   null = idle.
  type HandsFreeState = { phase: "in" | "rec" | "out"; n: number } | null;
  const HANDS_FREE_SEC = 60;
  const [handsFreeCountdown, setHandsFreeCountdown] = useState<HandsFreeState>(null);
  const handsFreeTimerRef = useRef<number | null>(null);
  const [abSnapshot, setAbSnapshot] = useState<SpectraPreset | null>(null);
  const [cameraRequesting, setCameraRequesting] = useState(false);

  // ── WebGL refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const schedulerRef = useRef<Scheduler | null>(null);
  // Phase 2b: ping-pong FBOs for multi-layer combo composite
  // v1.3.81 — half-float FBO targets when the device supports them.
  // Holds gl.HALF_FLOAT_OES (0x8D61) if OES_texture_half_float +
  // EXT_color_buffer_half_float + OES_texture_half_float_linear are all
  // available, otherwise null and we stay on UNSIGNED_BYTE / RGBA8. Higher
  // precision intermediates kill the banding visible on FEEDBACK / REACT-D /
  // VOROSORT and are usually bandwidth-faster than RGBA8 on Mali / Adreno.
  const timeRef = useRef(0);
  const touchRef = useRef({ x: 0.5, y: 0.5, active: false });

  // GIF recording
  const gifFrames = useRef<Uint8ClampedArray[]>([]);
  const gifSizeRef = useRef<{ w: number; h: number } | null>(null);
  const gifFpsRef = useRef(10);
  const gifDelayCsRef = useRef(10);
  const gifDitherRef = useRef(2.0);
  const gifStartTime = useRef(0);
  const gifInterval = useRef<ReturnType<typeof setInterval>|null>(null);
  const gifTimeoutRef = useRef<number | null>(null);
  // v1.3.31 — render-loop-driven GIF capture. setTimeout-based capture
  // raced with the rAF render loop, sampling the GL canvas at random
  // phases of its draw cycle. Per-frame delays let us encode the ACTUAL
  // wall-clock cadence of rendered frames so playback matches the live
  // preview even when the render rate dips below the user-chosen fps.
  const gifPeriodMsRef = useRef(40);          // bucket size in ms (1000/userFps, clamped >=20 for 50Hz GIF playback ceiling)
  const gifBucketRef = useRef(0);             // index of the next bucket eligible for capture
  const gifDelaysRef = useRef<number[]>([]);  // per-frame delays in centiseconds, parallel to gifFrames
  const captureFrameRef = useRef<((delayCs: number) => void) | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<BlobPart[]>([]);
  const videoComposeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoComposeRafRef = useRef<number>(0);
  const recordingRef = useRef(false);
  const recordingHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Hard upper bound. The user-selectable recordMaxSec lives in
  // recordMaxSecRef; this constant is the absolute ceiling enforced
  // everywhere so a stuck recorder never balloons memory.
  const MAX_RECORD_MS = 60_000;

  // Gesture detection (v1.3.65 — kept declared but unused; the
  // tap-vs-hold combo on the PHOTO button was replaced by an explicit
  // MODE toggle + glowing SHUTTER button on the canvas overlay.)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const holdFiredRef = useRef(false);
  void holdTimerRef; void holdFiredRef;
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const [flashVisible, setFlashVisible] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [pullArmed, setPullArmed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const pullStartYRef = useRef<number|null>(null);

  // v1.5.4 — the 2.5D slot-machine wheel (tilt / shrink / fade racks by their
  // distance from the panel centre) is retired. With every rack on a tab
  // expanded it shrank most controls to slivers (a 3 px-tall button) and made
  // taps miss. Racks are flat, full-size and scroll normally.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    el.querySelectorAll<HTMLElement>(".sp-rack").forEach((r) => {
      r.style.transform = ""; r.style.opacity = ""; r.style.transformOrigin = ""; r.style.willChange = "";
    });
  }, []);
  const [presetName, setPresetName] = useState("");
  const [presets, setPresets] = useState<SpectraPreset[]>([]);
  const [quickSlots, setQuickSlots] = useState<Array<string | null>>(() => Array.from({ length: 8 }, () => null));
  // Stable refs for gesture callbacks (set after functions are declared)
  const startRecordingRef = useRef<() => void>(() => {});
  const stopRecordingRef = useRef<() => void>(() => {});
  const captureStillRef = useRef<() => void>(() => {});
  const getExportMaxDim = useCallback((quality: "standard" | "high" | "ultra") => {
    if (quality === "standard") return 960;
    if (quality === "ultra") return 1600;
    return 1280;
  }, []);

  const getGifProfile = useCallback((quality: "standard" | "high" | "ultra") => {
    if (quality === "standard") return { maxDim: 640, fps: 8, dither: 1.4 };
    if (quality === "ultra") return { maxDim: 1400, fps: 14, dither: 2.6 };
    return { maxDim: 960, fps: 10, dither: 2.0 };
  }, []);

  const getProfileAspect = useCallback((profile: ExportProfile, srcW: number, srcH: number) => {
    if (profile === "vertical") return 9 / 16;
    if (profile === "square") return 1;
    if (profile === "widescreen") return 16 / 9;
    return Math.max(0.0001, srcW / Math.max(1, srcH));
  }, []);

  const getExportDimensions = useCallback((srcW: number, srcH: number, profile: ExportProfile, maxDim: number) => {
    const aspect = getProfileAspect(profile, srcW, srcH);
    const landscape = aspect >= 1;
    let w = 0;
    let h = 0;
    if (landscape) {
      w = maxDim;
      h = Math.max(2, Math.round(w / aspect));
    } else {
      h = maxDim;
      w = Math.max(2, Math.round(h * aspect));
    }
    return { w, h };
  }, [getProfileAspect]);

  const drawCover = useCallback((ctx: CanvasRenderingContext2D, src: CanvasImageSource, srcW: number, srcH: number, dstW: number, dstH: number) => {
    const srcAspect = srcW / Math.max(1, srcH);
    const dstAspect = dstW / Math.max(1, dstH);
    let sx = 0, sy = 0, sw = srcW, sh = srcH;
    if (srcAspect > dstAspect) {
      sw = srcH * dstAspect;
      sx = (srcW - sw) * 0.5;
    } else {
      sh = srcW / dstAspect;
      sy = (srcH - sh) * 0.5;
    }
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, dstW, dstH);
  }, []);

  // Compose ONE export frame to match what the user sees on screen:
  //   1) WebGL output (cover-fit)
  //   2) DOM scanlines overlay (subtle magenta repeating-linear-gradient)
  //   3) Draw layer with `hard-light` blend (matches mixBlendMode in JSX)
  //   4) Inset 1px magenta border (matches the 10px-inset border in JSX)
  // This eliminates the previous "export looks different from preview" gap
  // where the draw strokes were composited as plain `source-over` and the
  // overlay framing was missing entirely.
  const composeFrame = useCallback((ctx: CanvasRenderingContext2D, dstW: number, dstH: number) => {
    const src = canvasRef.current;
    if (!src) return;
    // 1) main WebGL output
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    drawCover(ctx, src, src.width, src.height, dstW, dstH);
    // 2) scanlines overlay (matches CSS at line ~6483)
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(176,20,240,0.018)";
    const lineStep = Math.max(2, Math.round(dstH / 540) + 2);
    for (let y = 0; y < dstH; y += lineStep) {
      ctx.fillRect(0, y, dstW, 1);
    }
    // 3) (v1.3.57 — draw overlay layer removed)
    // 4) inset border (matches the 10px-inset 1px magenta border)
    const inset = Math.max(4, Math.round(Math.min(dstW, dstH) * 0.012));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(176,20,240,0.26)";
    ctx.lineWidth = 1;
    ctx.strokeRect(inset + 0.5, inset + 0.5, dstW - inset * 2 - 1, dstH - inset * 2 - 1);
  }, [drawCover]);

  const getRecordingHintText = useCallback((format: "gif" | "video", quality: "standard" | "high" | "ultra", profile: ExportProfile) => {
    const profileLabel = profile === "native" ? "NATIVE" : profile === "vertical" ? "9:16" : profile === "square" ? "1:1" : "16:9";
    if (format === "gif") {
      const p = getGifProfile(quality);
      return `GIF ${quality.toUpperCase()} • ${profileLabel} • ${p.maxDim} • ${p.fps}FPS`;
    }
    const maxDim = getExportMaxDim(quality);
    return `VIDEO ${quality.toUpperCase()} • ${profileLabel} • ${maxDim}`;
  }, [getExportMaxDim, getGifProfile]);

  // ── Boot animation ────────────────────────────────────────
  // v1.3.26 — drastically shortened. Boot used to run ~1s of progress
  // bar before flipping bootDone, which gated initGL + startCamera. The
  // intro overlay covers the screen for 3.3s, so we want bootDone to
  // fire ASAP under the overlay so camera + segmenter init happens
  // during the intro, not after — no dead pause before fx.
  useEffect(() => {
    let p = 0;
    const iv = setInterval(() => {
      p += Math.random() * 35 + 25;
      if (p >= 100) { p = 100; clearInterval(iv); setTimeout(() => setBootDone(true), 60); }
      setBootProgress(Math.min(100, p));
    }, 30);
    // Watchdog: force-complete after 1.2s no matter what so the splash
    // can never hang indefinitely on a stalled state update.
    const watchdog = window.setTimeout(() => {
      clearInterval(iv);
      setBootProgress(100);
      setBootDone(true);
      try { console.warn("[GPS] boot watchdog fired — force-completing splash"); } catch { /* noop */ }
    }, 1200);
    return () => { clearInterval(iv); window.clearTimeout(watchdog); };
  }, []);

  // v1.3.27 — Hold the intro overlay until the camera is actually live
  // (when one is wanted). Without this, the intro fades at its scripted
  // 3.3s and reveals a gen-only fullscreen frame for ~500-2000 ms while
  // the camera + segmenter are still warming up. We only hide the intro
  // once both: (a) the intro animation has signalled it wants to close,
  // and (b) either no camera is wanted, or the camera is live. Hard cap
  // at 3.5s after the intro signals to avoid a stuck overlay if the
  // camera permission dialog is dismissed/denied.
  useEffect(() => {
    if (!introWantsClose) return;
    const wantsCam = sourceMode === "camera" || faceFxMode !== "OFF";
    if (!wantsCam || cameraActive) {
      setIntroVisible(false);
      return;
    }
    const t = window.setTimeout(() => setIntroVisible(false), 3500);
    return () => window.clearTimeout(t);
  }, [introWantsClose, sourceMode, faceFxMode, cameraActive]);

  // Surface JS exceptions / unhandled promise rejections to a small
  // on-screen overlay so silent crashes don't leave users staring at a
  // blank or stuck loading screen.
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  useEffect(() => {
    const onErr = (e: ErrorEvent) => {
      const msg = (e?.error && (e.error.stack || e.error.message)) || e.message || "unknown error";
      setRuntimeError(String(msg).slice(0, 800));
    };
    const onRej = (e: PromiseRejectionEvent) => {
      const r = e?.reason;
      const msg = (r && (r.stack || r.message)) || String(r) || "unhandled rejection";
      setRuntimeError(String(msg).slice(0, 800));
    };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  // ── WebGL init ───────────────────────────────────────────
  const initGL = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const created = createEngine(canvas, {
      shaders: { vert: VERT_SRC, frag: FRAG_SRC },
      feedbackSource: GPS_FEEDBACK_SOURCE,
    });
    if (!created.ok) {
      console.error("[GPS] engine:", created.error);
      setShaderError(created.error);
      return false;
    }
    const eng = created.engine;
    engineRef.current = eng;
    console.log("[GPS] engine", eng.caps, { halfFloat: eng.halfFloatFeedback, gpuSort: eng.gpuSortActive });

    // v1.2.58 — TEXTURE6: Gysin glyph atlas, generated once at boot from
    // a brightness ramp drawn into a 256x256 2D canvas (4x4 grid, 64px
    // per glyph). The atlas is grayscale; the shader uses .r as alpha.
    const ATLAS = 256, CELL = 64;
    const ramp = [" ", ".", ",", ":", ";", "+", "=", "o", "x", "%", "$", "#", "@", "W", "M", "\u00d1"];
    const ac = document.createElement("canvas");
    ac.width = ATLAS; ac.height = ATLAS;
    const actx = ac.getContext("2d");
    if (actx) {
      actx.fillStyle = "#000";
      actx.fillRect(0, 0, ATLAS, ATLAS);
      actx.fillStyle = "#fff";
      actx.font = `${Math.floor(CELL * 0.85)}px ui-monospace, Menlo, Consolas, monospace`;
      actx.textAlign = "center";
      actx.textBaseline = "middle";
      for (let i = 0; i < 16; i++) {
        const cx = (i % 4) * CELL + CELL / 2;
        const cy = Math.floor(i / 4) * CELL + CELL / 2;
        actx.fillText(ramp[i], cx, cy);
      }
      eng.setGlyphAtlas(ac);
    }
    return true;
  }, []);

  // ── Resize handler ────────────────────────────────────────
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const eng = engineRef.current;
    if (!canvas || !eng) return;
    // The engine clamps DPR to 2 and multiplies by the scheduler's scale
    // (pinned at 1.0 since v1.3.49). CSS size is unchanged — only the
    // backing store changes. Camera textures are source-sized inside the
    // engine, so no re-seed is needed after a resize.
    const rect = canvas.getBoundingClientRect();
    eng.resize({
      cssWidth: rect.width,
      cssHeight: rect.height,
      dpr: window.devicePixelRatio || 1,
      scale: schedulerRef.current?.renderScale ?? 1,
    });
  }, []);

  // ── Render loop ───────────────────────────────────────────
  const modeRef = useRef(mode);
  const gainRef = useRef(gain);
  const comboLayersRef = useRef(comboLayers);
  const paramsByModeRef = useRef(paramsByMode);
  const brightnessRef = useRef(brightness);
  const contrastRef = useRef(contrast);
  const saturationRef = useRef(saturation);
  const hueShiftRef = useRef(hueShift);
  const scanlinesRef = useRef(scanlines);
  const zoomRef = useRef(zoom);
  const speedRef = useRef(speed);
  const cameraActiveRef = useRef(false);
  const cameraFacingRef = useRef<"environment"|"user">("environment");
  const sortAmtRef = useRef(sortAmt);
  const scanTearRef = useRef(scanTear);
  const blockGlitchRef = useRef(blockGlitch);
  const datamoshRef = useRef(datamosh);
  const moshHardRef = useRef(moshHard);
  const chrashRef = useRef(chrash);
  const liquidRef = useRef(liquid);
  const glyphRef = useRef(glyph);
  const sortMixRef = useRef(sortMix);
  const reactDRef = useRef(reactD);
  const voroSortRef = useRef(voroSort);
  // v1.3.61 — NOVEL CS FX refs (read inside RAF render loop)
  const menkmanFXRef  = useRef(menkmanFX);
  const molnarFXRef   = useRef(molnarFX);
  const ucnvFXRef     = useRef(ucnvFX);
  const gysinFXRef    = useRef(gysinFX);
  const asendorfFXRef = useRef(asendorfFX);
  const jodiFXRef     = useRef(jodiFX);
  const arcangelFXRef = useRef(arcangelFX);
  const paikFXRef     = useRef(paikFX);
  const fentonFXRef   = useRef(fentonFX);
  // v1.3.64 — family + artist-touch refs (read in RAF render loop)
  const menkmanFamRef  = useRef(menkmanFam);
  const molnarFamRef   = useRef(molnarFam);
  const ucnvFamRef     = useRef(ucnvFam);
  const gysinFamRef    = useRef(gysinFam);
  const asendorfFamRef = useRef(asendorfFam);
  const jodiFamRef     = useRef(jodiFam);
  const arcangelFamRef = useRef(arcangelFam);
  const paikFamRef     = useRef(paikFam);
  const fentonFamRef   = useRef(fentonFam);
  const artistTouchStrRef = useRef(artistTouchStr);
  // v1.2.58 — CPU pixel-sort scratch + Gysin glyph atlas
  const cpuSortDownCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cpuSortOutCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cpuSortTickRef = useRef(0);
  const feedbackRef = useRef(feedback);
  const contourRef = useRef(contour);
  const asciiRef = useRef(ascii);
  const venetianRef = useRef(venetian);
  const kaleidoRef = useRef(kaleido);
  const tileRef = useRef(tile);
  const invertSymRef = useRef(invertSym);
  const drosteRef = useRef(droste);
  const spiralRef = useRef(spiral);
  const yantraRef = useRef(yantra);
  const mandalaRef = useRef(mandala);
  const rosetteRef = useRef(rosette);
  const starfoldRef = useRef(starfold);
  const hexfoldRef = useRef(hexfold);
  const disruptRef = useRef(disrupt);
  const disruptCountRef = useRef(disruptCount);
  const disruptSizeRef = useRef(disruptSize);
  const disruptContraryRef = useRef(disruptContrary);
  const disruptShapeRef = useRef(disruptShape);
  const sortKeyRef = useRef(sortKey);
  const sortLowRef = useRef(sortLow);
  const sortHighRef = useRef(sortHigh);
  const sortModeRef = useRef(sortMode);
  const sortSegmentRef = useRef(sortSegment);
  const sortRandomRef = useRef(sortRandom);
  const sortWobbleRef = useRef(sortWobble);
  const sortIntervalRef = useRef(sortInterval);
  const sortAngleRef = useRef(sortAngle);
  const rgbRRef = useRef(rgbR);
  const rgbGRef = useRef(rgbG);
  const rgbBRef = useRef(rgbB);
  const rgbBarsRef = useRef(rgbBars);
  const rgbSwapRef = useRef(rgbSwap);
  const ruptureRef = useRef(rupture);
  const hsyncRef = useRef(hsync);
  const moshIFrameRef = useRef(moshIFrame);
  const moshMotionRef = useRef(moshMotion);
  const moshBleedRef = useRef(moshBleed);
  const moshMapRef = useRef(moshMap);
  const moshDistortRef = useRef(moshDistort);
  useEffect(()=>{ modeRef.current=mode; },[mode]);
  useEffect(()=>{ gainRef.current=gain; },[gain]);
  useEffect(()=>{ comboLayersRef.current=comboLayers; },[comboLayers]);
  const comboModeRef = useRef(comboMode);
  useEffect(()=>{ comboModeRef.current=comboMode; },[comboMode]);
  useEffect(()=>{ paramsByModeRef.current=paramsByMode; },[paramsByMode]);
  useEffect(()=>{ brightnessRef.current=brightness; },[brightness]);
  useEffect(()=>{ contrastRef.current=contrast; },[contrast]);
  useEffect(()=>{ saturationRef.current=saturation; },[saturation]);
  useEffect(()=>{ hueShiftRef.current=hueShift; },[hueShift]);
  useEffect(()=>{ scanlinesRef.current=scanlines; },[scanlines]);
  useEffect(()=>{ zoomRef.current=zoom; },[zoom]);
  useEffect(()=>{ speedRef.current=speed; },[speed]);
  useEffect(()=>{ cameraActiveRef.current=cameraActive; },[cameraActive]);
  useEffect(()=>{ cameraFacingRef.current=cameraFacing; },[cameraFacing]);
  useEffect(()=>{ sourceModeRef.current=sourceMode; },[sourceMode]);
  useEffect(()=>{ genStyleRef.current=genStyle; },[genStyle]);
  useEffect(()=>{ genPaletteRef.current=genPalette; },[genPalette]);
  // v1.2.69 — UNIVERSAL PALETTE: the COLOR rack palette buttons used to
  // only affect generator output (palKey was only read inside the
  // sourceMode === "generator" branch). User reported "universal palette
  // is not working" because in CAMERA / UPLOAD mode tapping WARM / COOL /
  // PINK / ACID / RAINBOW did nothing visible. Map each named palette to
  // a hueShift + saturation pair so the master COLOR palette tints EVERY
  // source uniformly. MONO desaturates. CUSTOM is a no-op so the user's
  // own HUE/SAT knob values stay intact. One-shot per palette change.
  useEffect(() => {
    type PalRecipe = { hueShift: number; saturation: number };
    const recipe: Partial<Record<GenPalette, PalRecipe>> = {
      MONO:    { hueShift:  0.00, saturation: 0.0 },
      WARM:    { hueShift:  0.06, saturation: 1.35 },
      COOL:    { hueShift: -0.18, saturation: 1.35 },
      PINK:    { hueShift:  0.32, saturation: 1.55 },
      ACID:    { hueShift:  0.22, saturation: 1.75 },
      RAINBOW: { hueShift:  0.00, saturation: 1.85 },
    };
    const r = recipe[genPalette];
    if (!r) return; // CUSTOM: leave user's HUE / SAT knobs alone
    setHueShift(r.hueShift);
    setSaturation(r.saturation);
  }, [genPalette]);
  useEffect(()=>{ genAutoCycleRef.current=genAutoCycle; },[genAutoCycle]);
  useEffect(()=>{ genResolutionRef.current=genResolution; },[genResolution]);
  useEffect(()=>{ genDensityRef.current=genDensity; },[genDensity]);
  useEffect(()=>{ genScaleRef.current=genScale; },[genScale]);
  useEffect(()=>{ genSpeedRef.current=genSpeed; },[genSpeed]);
  useEffect(()=>{ genHueRef.current=genHue; },[genHue]);
  useEffect(()=>{ genHueSpreadRef.current=genHueSpread; },[genHueSpread]);
  useEffect(()=>{ genSatRef.current=genSat; },[genSat]);
  useEffect(()=>{ genContrastGRef.current=genContrastG; },[genContrastG]);
  useEffect(()=>{ genMixRef.current=genMix; },[genMix]); // v1.3.44
  useEffect(()=>{ genWarpRef.current=genWarp; },[genWarp]);
  useEffect(()=>{ genJitterRef.current=genJitter; },[genJitter]);
  useEffect(()=>{ genSeedRef.current=genSeed; },[genSeed]);
  useEffect(()=>{ genInvertRef.current=genInvert; },[genInvert]);
  useEffect(()=>{ genMoshXRef.current=genMoshX; },[genMoshX]);
  useEffect(()=>{ genMoshYRef.current=genMoshY; },[genMoshY]);
  useEffect(()=>{ genScatterRef.current=genScatter; },[genScatter]);
  useEffect(()=>{ genScatterModeRef.current=genScatterMode; },[genScatterMode]);
  useEffect(()=>{ genGlyphModeRef.current=genGlyphMode; },[genGlyphMode]);
  useEffect(()=>{ genLayersRef.current=genLayers; },[genLayers]);

  // ── Layer ↔ edit-buffer sync ──────────────────────────────────────
  // When the selected layer changes, hydrate the global edit-buffer state
  // (genStyle, genDensity, ...) from that layer so the knobs/style grid
  // display its values. When the user then changes any knob, the edit
  // pushes back into that layer (or broadcasts to ALL layers if MASTER).
  //
  // v1.3.3 — REMOVED the hydration gate (timing-based counter). Bug: when
  // hydration set values that already matched the edit-buffer (e.g. layer
  // L1 scale=1.0, default scale=1.0 → no state change → writeback never
  // fires → counter stays >0 → next real edit gets swallowed). SCALE was
  // most affected because L1 default == global default.
  //
  // The new approach: writeback effect does a value-equality check
  // against the current layer. If no field differs, it no-ops. This
  // breaks the ping-pong without any timing dependency.
  useEffect(() => {
    const idx = selectedLayer;
    if (idx >= 0 && idx <= 3) {
      // CRITICAL: read FRESH layer values from the ref. Closing over
      // `genLayers` (the dep-less render snapshot) caused the classic
      // ping-pong bug: edits made on MASTER would broadcast, then tapping
      // a layer tab restored stale pre-broadcast values, which writeback
      // then patched back into the layer.
      const L = genLayersRef.current[idx];
      if (!L) return;
      setGenStyle(L.style);
      setGenDensity(L.density);
      setGenScale(L.scale);
      setGenSpeed(L.speed);
      setGenHue(L.hue);
      setGenHueSpread(L.hueSpread);
      setGenSat(L.sat);
      setGenContrastG(L.contrast);
      setGenWarp(L.warp);
      setGenJitter(L.jitter);
      setGenSeed(L.seed);
      setGenInvert(L.invert);
      setGenMoshX(L.moshX);
      setGenMoshY(L.moshY);
      setGenScatter(L.scatter);
      setGenScatterMode(L.scatterMode);
      setGenGlyphMode(L.glyphMode ?? 0);
    }
    // MASTER (idx === 4): keep edit-buffer as-is; edits broadcast to all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayer]);

  // Writeback effect: any global edit-buffer change → patch into layer(s).
  // Value-equality short-circuit prevents hydration from bouncing back as
  // a write (replaces the old timing-counter gate).
  useEffect(() => {
    const idx = selectedLayerRef.current;
    if (idx >= 0 && idx <= 3) {
      const L = genLayersRef.current[idx];
      if (L
        && L.style === genStyle && L.density === genDensity && L.scale === genScale
        && L.speed === genSpeed && L.hue === genHue && L.hueSpread === genHueSpread
        && L.sat === genSat && L.contrast === genContrastG && L.warp === genWarp
        && L.jitter === genJitter && L.seed === genSeed && L.invert === genInvert
        && L.moshX === genMoshX && L.moshY === genMoshY
        && L.scatter === genScatter && L.scatterMode === genScatterMode
        && L.glyphMode === genGlyphMode) {
        return; // no diff — likely the hydration bounce. Skip.
      }
    }
    setGenLayers(prev => {
      const patch = (L: GenLayer): GenLayer => ({
        ...L,
        style: genStyle, density: genDensity, scale: genScale,
        speed: genSpeed, hue: genHue, hueSpread: genHueSpread, sat: genSat,
        contrast: genContrastG, warp: genWarp, jitter: genJitter,
        seed: genSeed, invert: genInvert,
        moshX: genMoshX, moshY: genMoshY,
        scatter: genScatter, scatterMode: genScatterMode,
        glyphMode: genGlyphMode,
      });
      if (idx === 4) return prev.map(patch);
      if (idx >= 0 && idx <= 3) return prev.map((L, i) => i === idx ? patch(L) : L);
      return prev;
    });
  }, [genStyle, genDensity, genScale, genSpeed, genHue, genHueSpread,
      genSat, genContrastG, genWarp, genJitter, genSeed, genInvert,
      genMoshX, genMoshY, genScatter, genScatterMode, genGlyphMode]);
  useEffect(()=>{ genBlendRef.current=genBlend; },[genBlend]);
  useEffect(()=>{ sortAmtRef.current=sortAmt; },[sortAmt]);
  useEffect(()=>{ scanTearRef.current=scanTear; },[scanTear]);
  useEffect(()=>{ blockGlitchRef.current=blockGlitch; },[blockGlitch]);
  useEffect(()=>{ datamoshRef.current=datamosh; },[datamosh]);
  useEffect(()=>{ moshHardRef.current=moshHard; },[moshHard]);
  useEffect(()=>{ chrashRef.current=chrash; },[chrash]);
  useEffect(()=>{ liquidRef.current=liquid; },[liquid]);
  useEffect(()=>{ glyphRef.current=glyph; },[glyph]);
  useEffect(()=>{ sortMixRef.current=sortMix; },[sortMix]);
  useEffect(()=>{ reactDRef.current=reactD; },[reactD]);
  useEffect(()=>{ voroSortRef.current=voroSort; },[voroSort]);
  // v1.3.61 — NOVEL CS FX ref sync
  useEffect(()=>{ menkmanFXRef.current  = menkmanFX;  },[menkmanFX]);
  useEffect(()=>{ molnarFXRef.current   = molnarFX;   },[molnarFX]);
  useEffect(()=>{ ucnvFXRef.current     = ucnvFX;     },[ucnvFX]);
  useEffect(()=>{ gysinFXRef.current    = gysinFX;    },[gysinFX]);
  useEffect(()=>{ asendorfFXRef.current = asendorfFX; },[asendorfFX]);
  useEffect(()=>{ jodiFXRef.current     = jodiFX;     },[jodiFX]);
  useEffect(()=>{ arcangelFXRef.current = arcangelFX; },[arcangelFX]);
  useEffect(()=>{ paikFXRef.current     = paikFX;     },[paikFX]);
  useEffect(()=>{ fentonFXRef.current   = fentonFX;   },[fentonFX]);
  useEffect(()=>{ menkmanFamRef.current  = menkmanFam;  },[menkmanFam]);
  useEffect(()=>{ molnarFamRef.current   = molnarFam;   },[molnarFam]);
  useEffect(()=>{ ucnvFamRef.current     = ucnvFam;     },[ucnvFam]);
  useEffect(()=>{ gysinFamRef.current    = gysinFam;    },[gysinFam]);
  useEffect(()=>{ asendorfFamRef.current = asendorfFam; },[asendorfFam]);
  useEffect(()=>{ jodiFamRef.current     = jodiFam;     },[jodiFam]);
  useEffect(()=>{ arcangelFamRef.current = arcangelFam; },[arcangelFam]);
  useEffect(()=>{ paikFamRef.current     = paikFam;     },[paikFam]);
  useEffect(()=>{ fentonFamRef.current   = fentonFam;   },[fentonFam]);
  useEffect(()=>{ artistTouchStrRef.current = artistTouchStr; },[artistTouchStr]);
  useEffect(()=>{ feedbackRef.current=feedback; },[feedback]);
  useEffect(()=>{ contourRef.current=contour; },[contour]);
  useEffect(()=>{ asciiRef.current=ascii; },[ascii]);
  useEffect(()=>{ venetianRef.current=venetian; },[venetian]);
  useEffect(()=>{ kaleidoRef.current=kaleido; },[kaleido]);
  useEffect(()=>{ tileRef.current=tile; },[tile]);
  useEffect(()=>{ invertSymRef.current=invertSym; },[invertSym]);
  useEffect(()=>{ drosteRef.current=droste; },[droste]);
  useEffect(()=>{ spiralRef.current=spiral; },[spiral]);
  useEffect(()=>{ yantraRef.current=yantra; },[yantra]);
  useEffect(()=>{ mandalaRef.current=mandala; },[mandala]);
  useEffect(()=>{ rosetteRef.current=rosette; },[rosette]);
  useEffect(()=>{ starfoldRef.current=starfold; },[starfold]);
  useEffect(()=>{ hexfoldRef.current=hexfold; },[hexfold]);
  useEffect(()=>{ disruptRef.current=disrupt; },[disrupt]);
  useEffect(()=>{ disruptCountRef.current=disruptCount; },[disruptCount]);
  useEffect(()=>{ disruptSizeRef.current=disruptSize; },[disruptSize]);
  useEffect(()=>{ disruptContraryRef.current=disruptContrary; },[disruptContrary]);
  useEffect(()=>{ disruptShapeRef.current=disruptShape; },[disruptShape]);
  useEffect(()=>{ sortKeyRef.current=sortKey; },[sortKey]);
  useEffect(()=>{ sortLowRef.current=sortLow; },[sortLow]);
  useEffect(()=>{ sortHighRef.current=sortHigh; },[sortHigh]);
  useEffect(()=>{ sortModeRef.current=sortMode; },[sortMode]);
  useEffect(()=>{ sortSegmentRef.current=sortSegment; },[sortSegment]);
  useEffect(()=>{ sortRandomRef.current=sortRandom; },[sortRandom]);
  useEffect(()=>{ sortWobbleRef.current=sortWobble; },[sortWobble]);
  useEffect(()=>{ sortIntervalRef.current=sortInterval; },[sortInterval]);
  useEffect(()=>{ sortAngleRef.current=sortAngle; },[sortAngle]);
  useEffect(()=>{ rgbRRef.current=rgbR; },[rgbR]);
  useEffect(()=>{ rgbGRef.current=rgbG; },[rgbG]);
  useEffect(()=>{ rgbBRef.current=rgbB; },[rgbB]);
  useEffect(()=>{ rgbBarsRef.current=rgbBars; },[rgbBars]);
  useEffect(()=>{ rgbSwapRef.current=rgbSwap; },[rgbSwap]);
  useEffect(()=>{ ruptureRef.current=rupture; },[rupture]);
  useEffect(()=>{ hsyncRef.current=hsync; },[hsync]);
  // Auto-bump REALSORT (sortMix) + AMOUNT (sortAmt) ONCE when the user
  // first enters PIXEL SORT mode in this session, so the rack knobs
  // produce a visible result without having to crank the master from
  // zero first. v1.2.66 — bug fix: previously this useEffect listened
  // to [mode, sortMix] and re-fired every time the user dragged REALSORT
  // below 0.05, snapping it back to 0.65 — which felt like the app was
  // "restarting" itself. Now we use a one-shot ref so once the user has
  // touched the rack we leave their values alone, including 0. Also
  // bump AMOUNT to 0.5 so the LOW/HIGH/SEGMENT/NOISE/WOBBLE/MODE/
  // INTERVAL/ANGLE knobs (all gated on uSortAmt) actually do something
  // out of the box — previously REALSORT got bumped but AMOUNT stayed
  // at 0 so all the sub-knobs looked dead.
  // v1.2.85 — start "done" so the auto-bump does NOT fire on cold boot
  // (we want sortMix to stay at 0 so first paint shows pure GEN+CAM, not
  // the sort distortion). User toggling away from PXL and back will reset
  // this ref via the cleanup branch below.
  // v1.3.12 — DISABLED. User explicitly requested all settings stay
  // null until they touch them. The auto-bump was setting REALSORT to
  // 0.65 and AMOUNT to 0.5 the first time the user opened the PIXEL
  // SORT rack, which made it look like pixel-sort was "on by default"
  // and contaminated every downstream FX visual. Now: every knob ships
  // at exactly its useState default (0.0) and only moves when the user
  // moves it.
  const pxlEntryDoneRef = useRef(true);
  useEffect(() => {
    if (mode !== 7) { pxlEntryDoneRef.current = false; return; }
    if (pxlEntryDoneRef.current) return;
    pxlEntryDoneRef.current = true;
    // (no-op — auto-bump removed v1.3.12)
  }, [mode]);
  // \u2500\u2500 AUTOMATE: drift generator knobs on an LFO interval. Generator-only.
  useEffect(() => {
    if (!automateOn) return;
    if (sourceMode !== "generator") return;
    const periodMs = Math.max(120, 1400 - automateRate * 1250);
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const r = () => Math.random();
      // Gentle nudge: blend current toward random target by 18% each tick.
      const lerp = (cur: number, tgt: number) => cur + (tgt - cur) * 0.18;
      setGenDensity(lerp(genDensityRef.current, 0.15 + r() * 0.8));
      setGenScale(lerp(genScaleRef.current, 0.4  + r() * 2.6));
      setGenSpeed(lerp(genSpeedRef.current, 0.2  + r() * 1.6));
      setGenHue((genHueRef.current + 0.05 + r() * 0.08) % 1);
      setGenHueSpread(lerp(genHueSpreadRef.current, 0.1 + r() * 0.7));
      setGenSat(lerp(genSatRef.current, 0.45 + r() * 0.55));
      setGenContrastG(lerp(genContrastGRef.current, 0.3 + r() * 0.65));
      setGenWarp(lerp(genWarpRef.current, r() * 0.85));
      setGenJitter(lerp(genJitterRef.current, r() * 0.7));
      // Occasional flips, on a slower cadence than the knob drift.
      if (automateStyles && r() < 0.18) {
        const styles = GEN_STYLES as readonly string[];
        setGenStyle(styles[Math.floor(r() * styles.length)] as GenStyle);
      }
      if (automateBlend && r() < 0.12) {
        setGenBlend(GEN_BLEND_KEYS[Math.floor(r() * GEN_BLEND_KEYS.length)]);
      }
    };
    tick();
    const id = window.setInterval(tick, periodMs);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [automateOn, automateRate, automateStyles, automateBlend, sourceMode]);
  useEffect(()=>{ moshIFrameRef.current=moshIFrame; },[moshIFrame]);
  useEffect(()=>{ moshMotionRef.current=moshMotion; },[moshMotion]);
  useEffect(()=>{ moshBleedRef.current=moshBleed; },[moshBleed]);
  useEffect(()=>{ moshMapRef.current=moshMap; },[moshMap]);
  useEffect(()=>{ moshDistortRef.current=moshDistort; },[moshDistort]);

  // ── Collapsible panel sections ────────────────────────────
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set<string>(["modes", "user"]));
  const toggleSection = (key: string) => setOpenSections(prev => {
    const s = new Set(prev); if (s.has(key)) s.delete(key); else s.add(key); return s;
  });

  const render = useCallback(() => {
    // v1.2.54: Pause the entire shader pipeline when the tab/app is hidden.
    // The Capacitor WebView fires `visibilitychange` -> hidden when the app
    // backgrounds, so this saves significant battery + heat without needing
    // an explicit @capacitor/app dependency. We do NOT re-arm the rAF here;
    // a `visibilitychange` listener attached in the lifecycle useEffect
    // restarts the loop when the app foregrounds again.
    const recordingActive = recordingRef.current;
    // v1.3.42 — manual LOW POWER + battery-low no longer skip frames.
    // Both flags are folded into the FX-quality governor below as a
    // hard ceiling on fxQuality, which routes through the universal
    // shader mask AND the continuous renderScale mapping. Net effect
    // ≈ same thermal/battery savings as the old skip-every-other-frame
    // but without the visible app-wide stutter that pulsed the FX state.
    // Upload mask canvas to the engine's mask texture (texSubImage2D fast
    // path inside the engine; re-seeded only when the canvas is resized).
    const engM = engineRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (engM && maskCanvas && maskCanvas.width > 0 && maskCanvas.height > 0) {
      if (!engM.setMask(maskCanvas, maskCanvas.width, maskCanvas.height)) {
        console.warn("[mask upload] disabled after error");
        touchRef.current.active = false;
      }
    }

    // --- Audio analyser: update audioLevelRef ---
    // v1.2.57 — Run the FFT + RMS pass every other frame (~30 Hz at
    // 60 fps render). Audio energy doesn't change meaningfully faster
    // than that and the cached refs are what the shader sees, so the
    // visual reactivity is identical while CPU drops measurably.
    // v1.5.4 — Terminal Velocity feature analyser, every frame (256 bins).
    // Falls back to the legacy RMS + FFT block if only a bare analyser exists,
    // and to the synthetic LFO drive while AUTO-VJ is on and the input is
    // silent (suspended context, muted mic, quiet room) so AUTO-VJ always moves.
    const _nowMs = performance.now();
    const _feat = audioFeaturesRef.current;
    let _realLevel = -1;
    if (_feat) {
      const f = _feat.sample();
      audioLevelRef.current  = f.level;
      audioBassRef.current   = f.bass;
      audioTrebleRef.current = f.treble;
      // Beat impulse: TV beat (bass over slow average) OR a bass hit; decays like before.
      const beatTarget = Math.max(f.beat, f.bassHit * 0.85);
      if (beatTarget > audioBeatRef.current) audioBeatRef.current = beatTarget;
      else audioBeatRef.current *= 0.90;
      _realLevel = f.level;
    } else if (audioAnalyserRef.current && audioDataArrayRef.current) {
      audioFrameToggleRef.current ^= 1;
      if (audioFrameToggleRef.current === 0) {
        // @ts-expect-error: TypeScript type mismatch, runtime is correct
        audioAnalyserRef.current.getByteTimeDomainData(audioDataArrayRef.current);
        let sum = 0;
        for (let i = 0; i < audioDataArrayRef.current.length; i++) {
          const v = (audioDataArrayRef.current[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / audioDataArrayRef.current.length);
        audioLevelRef.current = audioLevelRef.current * 0.85 + Math.min(1, rms * 2.5) * 0.15;
        const an = audioAnalyserRef.current;
        const bins = an.frequencyBinCount;
        let freq = audioFreqArrayRef.current;
        if (!freq || freq.length !== bins) { freq = new Uint8Array(bins); audioFreqArrayRef.current = freq; }
        // @ts-expect-error: TypeScript type mismatch, runtime is correct
        an.getByteFrequencyData(freq);
        const bassEnd = Math.max(2, Math.floor(bins * 0.06));
        const trebStart = Math.floor(bins * 0.45);
        let bSum = 0, tSum = 0;
        for (let i = 0; i < bassEnd; i++) bSum += freq[i];
        for (let i = trebStart; i < bins; i++) tSum += freq[i];
        const bassNorm = (bSum / (bassEnd * 255)) || 0;
        const trebNorm = (tSum / ((bins - trebStart) * 255)) || 0;
        audioBassRef.current   = audioBassRef.current   * 0.78 + bassNorm * 0.22;
        audioTrebleRef.current = audioTrebleRef.current * 0.78 + trebNorm * 0.22;
        audioBassAvgRef.current = audioBassAvgRef.current * 0.97 + audioBassRef.current * 0.03;
        const beatGap = audioBassRef.current - audioBassAvgRef.current * 1.35;
        const beatTarget = beatGap > 0 ? Math.min(1, beatGap * 4) : 0;
        if (beatTarget > audioBeatRef.current) audioBeatRef.current = beatTarget;
        else audioBeatRef.current *= 0.90;
      }
      _realLevel = audioLevelRef.current;
    }
    // Silence tracking on the live input.
    if (_realLevel >= 0) {
      if (_realLevel > 0.015) audioSilentSinceRef.current = 0;
      else if (!audioSilentSinceRef.current) audioSilentSinceRef.current = _nowMs;
    }
    const _noInput = _realLevel < 0;
    const _silent = _noInput || (audioSilentSinceRef.current > 0 && _nowMs - audioSilentSinceRef.current > 1500);
    audioSyntheticRef.current = vjModeRef.current && _silent;
    if (audioSyntheticRef.current) {
      // Synthetic LFO drive (v1.3.66/68) so every uAudio/uABass/uATreb/uABeat
      // consumer and the beat-cycle counter keep animating without a signal.
      const _t = _nowMs * 0.001;
      const lvl  = 0.55 + 0.42 * Math.sin(_t * 0.93) * Math.cos(_t * 0.31) + 0.18 * Math.sin(_t * 4.7);
      const bass = 0.55 + 0.50 * Math.sin(_t * 1.71) + 0.20 * Math.sin(_t * 5.3 + 0.7);
      const treb = 0.50 + 0.50 * Math.sin(_t * 2.93 + 1.3) + 0.22 * Math.sin(_t * 7.1);
      audioLevelRef.current  = audioLevelRef.current  * 0.55 + Math.min(1, Math.abs(lvl))  * 0.45;
      audioBassRef.current   = audioBassRef.current   * 0.55 + Math.min(1, Math.abs(bass)) * 0.45;
      audioTrebleRef.current = audioTrebleRef.current * 0.55 + Math.min(1, Math.abs(treb)) * 0.45;
      const beatPhase = (_t * 1.07) % 1;
      const beatTarget = beatPhase < 0.05 ? 1.0 : 0.0;
      if (beatTarget > audioBeatRef.current) audioBeatRef.current = beatTarget;
      else audioBeatRef.current *= 0.88;
    } else if (_noInput) {
      // No input and no AUTO-VJ: decay to ambient.
      audioLevelRef.current  *= 0.92;
      audioBassRef.current   *= 0.92;
      audioTrebleRef.current *= 0.92;
      audioBeatRef.current   *= 0.88;
    }

    // ── v1.3.68 Auto-VJ beat-matched cycle trigger ───────────────
    // Rising-edge detection on audioBeatRef. Every BEATS_PER_CYCLE
    // beats (or after CYCLE_TIMEOUT_MS of silence) request a cycle.
    if (vjModeRef.current) {
      const nowMs = performance.now();
      const beatNow = audioBeatRef.current >= VJ_BEAT_THRESH;
      const sinceLastCycle = nowMs - vjLastCycleAtRef.current;
      if (beatNow && !vjLastBeatHighRef.current && sinceLastCycle > VJ_BEAT_REFRACTORY_MS) {
        vjBeatCountRef.current += 1;
        vjBeatPulseRef.current = audioBeatRef.current;
        if (vjBeatCountRef.current >= VJ_BEATS_PER_CYCLE) {
          vjBeatCountRef.current = 0;
          vjPendingCycleRef.current = true;
          vjLastCycleAtRef.current = nowMs;
        }
      }
      vjLastBeatHighRef.current = beatNow;
      // Watchdog: if no beat-driven cycle has fired in a while, force one
      // so silent passages / quiet ambient still evolves.
      if (sinceLastCycle > VJ_CYCLE_TIMEOUT_MS) {
        vjPendingCycleRef.current = true;
        vjLastCycleAtRef.current = nowMs;
        vjBeatCountRef.current = 0;
      }
    }

    const eng = engineRef.current;
    if (!eng) return;
    timeRef.current += 0.016 * speedRef.current;

    const video = videoRef.current;
    const srcMode = sourceModeRef.current;

    // Lightweight camera motion detector (frame-difference on a tiny luma buffer)
    // to drive generator evolution from real movement in view.
    if (cameraActiveRef.current && video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      motionFrameRef.current++;
      if ((motionFrameRef.current % (recordingActive ? 6 : 3)) === 0) {
        let mc = motionSampleCanvasRef.current;
        if (!mc) { mc = document.createElement("canvas"); motionSampleCanvasRef.current = mc; }
        const MW = 64;
        const MH = 36;
        if (mc.width !== MW || mc.height !== MH) { mc.width = MW; mc.height = MH; }
        const mctx = mc.getContext("2d", { willReadFrequently: true });
        if (mctx) {
          mctx.drawImage(video, 0, 0, MW, MH);
          const px = mctx.getImageData(0, 0, MW, MH).data;
          const N = MW * MH;
          let luma = motionLumaBufRef.current;
          if (!luma || luma.length !== N) {
            luma = new Uint8ClampedArray(N);
            motionLumaBufRef.current = luma;
          }
          for (let i = 0, p = 0; i < N; i++, p += 4) {
            luma[i] = (px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114) | 0;
          }
          const prev = motionPrevLumaRef.current;
          if (prev) {
            let sum = 0;
            for (let i = 0; i < N; i += 2) sum += Math.abs(luma[i] - prev[i]);
            const norm = Math.min(1, sum / ((N / 2) * 28));
            motionEnergyRef.current = motionEnergyRef.current * 0.84 + norm * 0.16;
          }
          // Swap buffers (double-buffered) so next frame's "prev" is what we just computed.
          motionPrevLumaRef.current = luma;
          motionLumaBufRef.current = prev ?? new Uint8ClampedArray(N);
        }
      }
    } else {
      motionEnergyRef.current *= 0.92;
    }

    let texSource: TexImageSource | null = null;
    let srcW = 0;
    let srcH = 0;
    if (srcMode === "upload") {
      const upV = uploadVideoRef.current;
      const upI = uploadImgRef.current;
      if (upV && upV.readyState >= 2 && upV.videoWidth > 0) {
        texSource = upV; srcW = upV.videoWidth; srcH = upV.videoHeight;
      } else if (upI && upI.complete && upI.naturalWidth > 0) {
        texSource = upI; srcW = upI.naturalWidth; srcH = upI.naturalHeight;
      }
      // (v1.3.57 — draw-stroke bake-into-source path removed.)
      // (v1.3.78 — PIXEL GEN II LIVE override removed.)
    } else if (srcMode === "generator" || (srcMode === "camera" && genMixRef.current > 0.001)) {
      // v1.3.44 — also enter this branch when the user is on the camera
      // source AND has dialed MIX above zero, so the generator evolves
      // (it would otherwise sit frozen / empty), and at the end of this
      // branch we override texSource with a simple cam+gen blend.
      // Lazily allocate generator canvas at output resolution.
      const targetW = canvasRef.current?.width || 720;
      const targetH = canvasRef.current?.height || 720;
      let gc = genCanvasRef.current;
      if (!gc) { gc = document.createElement("canvas"); genCanvasRef.current = gc; }
      if (gc.width !== targetW || gc.height !== targetH) {
        gc.width = targetW; gc.height = targetH;
      }
      // Generator is reactive in flat-source mode: accelerometer + camera-frame
      // motion gently MODULATE evolution (additive only, heavily low-passed).
      // Color comes from the active palette; CUSTOM falls back to HUE/SPREAD/SAT
      // knobs. Auto-cycle slowly drifts the base hue when the palette permits.
      const accelE = accelEnergyRef.current;
      const camE   = motionEnergyRef.current;
      const pushRaw  = accelPushRef.current;
      const tiltXraw = accelTiltXRef.current;
      const tiltYraw = accelTiltYRef.current;
      // Audio reactivity — RMS, bass and beat fold into the same drive bus.
      const audioLvl  = audioLevelRef.current;
      const audioBass = audioBassRef.current;
      const audioTreb = audioTrebleRef.current;
      const audioBeat = audioBeatRef.current;
      // Combined "is anything happening on the mic right now?" signal —
      // used as a global multiplier so the generator is OBVIOUSLY alive
      // when the user enables the mic. Without this, the per-param
      // audio terms below are too small to be visible against ambient
      // tilt/cam motion.
      const audioAny = Math.min(1, Math.max(audioLvl * 1.4, audioBass * 1.6, audioTreb * 1.3, audioBeat));
      const driveRaw = Math.min(1,
        accelE * 0.85
        + camE * 0.55
        + audioLvl * 1.10
        + audioBass * 0.85
        + audioBeat * 0.40
      );

      // Heavy one-pole low-pass — slow lerp toward target so values never
      // snap. Tilt is smoothed AGGRESSIVELY (k=0.025) so accelerometer
      // micro-jitter doesn't translate into a perceptible loopy wobble in
      // the generator field. Push smooths fast-up / slow-down so taps
      // feel like soft pulses.
      // Audio drives this bus — use a faster attack when the new target
      // is louder so beats actually punch through, but keep the slow
      // decay so the field doesn't strobe.
      const driveK = driveRaw > genDriveSmoothRef.current ? 0.18 : 0.04;
      genDriveSmoothRef.current += (driveRaw - genDriveSmoothRef.current) * driveK;
      genTiltXSmoothRef.current += (tiltXraw - genTiltXSmoothRef.current) * 0.025;
      genTiltYSmoothRef.current += (tiltYraw - genTiltYSmoothRef.current) * 0.025;
      // Push channel = physical impulse + audio beat (additive, fast-up/slow-down).
      const pushTarget = Math.min(1, pushRaw + audioBeat * 1.20);
      const pushK = pushTarget > genPushSmoothRef.current ? 0.30 : 0.04;
      genPushSmoothRef.current += (pushTarget - genPushSmoothRef.current) * pushK;
      const drive = genDriveSmoothRef.current;
      const tiltX = genTiltXSmoothRef.current;
      const tiltY = genTiltYSmoothRef.current;
      const push  = genPushSmoothRef.current;

      // Organic ambient flow — sum of THREE incommensurate sines per
      // axis (irrational frequency ratios) so the curve never closes a
      // loop within any practical session length. Amplitudes sum to ~0.18
      // so the field is always perceptibly drifting even with zero tilt,
      // but the motion stays fluid (no high-frequency wobble) and
      // evolves — successive seconds never repeat the previous second.
      genFlowXRef.current += 0.0011;
      genFlowYRef.current += 0.00083;
      const fxA = genFlowXRef.current;
      const fyA = genFlowYRef.current;
      const flowX = Math.sin(fxA)              * 0.090
                  + Math.sin(fxA * 1.6180 + 1.7) * 0.055
                  + Math.sin(fxA * 0.4142 + 4.1) * 0.040;
      const flowY = Math.cos(fyA)              * 0.090
                  + Math.cos(fyA * 1.4142 + 2.3) * 0.055
                  + Math.cos(fyA * 0.6180 + 5.2) * 0.040;

      // Time only ever moves forward, monotonically at a constant
      // wall-clock rate (≈60fps step). Per-layer speed scaling happens
      // INSIDE drawPixelGenerator via p.speed — doing it here too would
      // square the slider (move 0.6 → 0.36, move 2 → 4). Motion adds a
      // bounded boost on top so beats and tilt still kick the cadence.
      const baseStep = 0.016;
      const motionStep = baseStep * drive * 0.45;
      // Audio explicitly speeds up the evolution clock — bass moves the
      // field faster, treble adds a small jitter step so high-frequency
      // content (hi-hats, claps) shows up as crisper detail churn.
      const audioStep  = baseStep * (audioBass * 1.20 + audioLvl * 0.45 + audioTreb * 0.25 + audioBeat * 0.65);
      const ambientDrift = 0.0011 + ((genSeedRef.current % 101) / 101) * 0.0019;
      genTimeRef.current += baseStep + motionStep + audioStep + ambientDrift;

      const palKey = genPaletteRef.current;
      const pal = GEN_PALETTES[palKey];
      // Slow auto cycle (~ one full hue revolution every ~28s when active).
      // Only meaningful for non-CUSTOM palettes — in CUSTOM the per-layer
      // hue knob is the source of truth, so don't burn cycles drifting a
      // value that nothing reads.
      if (genAutoCycleRef.current && pal.cycle && palKey !== "CUSTOM") {
        genHueCycleRef.current = (genHueCycleRef.current + 0.0006) % 1;
      }
      let palHue: number;
      let palSpread: number;
      let palSat: number;
      if (palKey === "CUSTOM") {
        palHue = genHueRef.current;
        palSpread = genHueSpreadRef.current;
        palSat = genSatRef.current;
      } else {
        palHue = (pal.hue + genHueCycleRef.current) % 1;
        palSpread = pal.spread;
        palSat = pal.sat;
      }

      // Build the list of active layers (full per-layer param objects).
      // Always at least one — fall back to the legacy global edit-buffer.
      // We keep the ORIGINAL layer index alongside each entry so the
      // per-layer scatter pulse buffer can be looked up correctly.
      const layerDefs = genLayersRef.current;
      const activeIndexed: { L: GenLayer; idx: number }[] = layerDefs
        .map((L, idx) => ({ L, idx }))
        .filter(x => x.L.enabled);
      if (activeIndexed.length === 0) {
        activeIndexed.push({ idx: 0, L: {
          style: genStyleRef.current, enabled: true,
          density: genDensityRef.current, scale: genScaleRef.current,
          speed: genSpeedRef.current, hue: genHueRef.current,
          hueSpread: genHueSpreadRef.current, sat: genSatRef.current,
          contrast: genContrastGRef.current, warp: genWarpRef.current,
          jitter: genJitterRef.current, seed: genSeedRef.current,
          invert: genInvertRef.current,
          moshX: genMoshXRef.current, moshY: genMoshYRef.current,
          scatter: genScatterRef.current, scatterMode: genScatterModeRef.current,
          glyphMode: genGlyphModeRef.current,
        }});
      }

      // Decay every layer's transient scatter pulse this frame (~400ms half-life).
      const pulses = scatterPulsesRef.current;
      for (let i = 0; i < pulses.length; i++) {
        if (pulses[i].amt > 0.0008) pulses[i].amt *= 0.93;
        else pulses[i].amt = 0;
      }

      const baseEnv = {
        resolution: genResolutionRef.current,
        time: genTimeRef.current,
        // Audio nudges the motion field too — bass pushes laterally,
        // treble adds a small wiggle so the pattern visibly breathes
        // with the mic input.
        motionX: tiltX * 0.7 + flowX + audioBass * 0.18 - audioTreb * 0.10,
        motionY: tiltY * 0.7 + flowY + audioBeat * 0.22,
        depthPush: Math.min(1, push * 0.6 + audioBeat * 0.55 + audioAny * 0.20),
      };
      // Map a layer's own params into a full GenParams record, plus the
      // shared environment + motion-driven boosts (jitter, warp, density).
      // The per-layer mosh axes + scatter knob are passed straight through
      // so each layer's pixel-blend movement stays specific to itself.
      const paramsForLayer = (L: GenLayer, idx: number) => {
        const pulse = (idx >= 0 && idx < 4) ? pulses[idx].amt : 0;
        const pulseMode = (idx >= 0 && idx < 4) ? pulses[idx].mode : L.scatterMode;
        // Knob mode wins when sustained scatter is non-trivial; otherwise
        // a momentary pulse picks its own mode (set when the button fired).
        const useMode = (L.scatter > 0.02) ? L.scatterMode : pulseMode;
        return {
          ...baseEnv,
          style: L.style,
          density: Math.min(1, L.density + drive * 0.06 + audioBass * 0.10),
          scale: L.scale,
          // Per-layer speed * global gen speed — multiplied ONCE here, not
          // again in the time accumulator (see baseStep comment above).
          speed: L.speed * Math.max(0.001, genSpeedRef.current),
          // Palette routing: in CUSTOM, per-layer hue/spread/sat win.
          // For any named palette, the palette overrides per-layer values
          // — otherwise the palette dropdown looks broken (knob still
          // shows L.hue but global palette claims to be different).
          hue: palKey === "CUSTOM" ? L.hue : palHue,
          hueSpread: palKey === "CUSTOM" ? L.hueSpread : palSpread,
          sat: palKey === "CUSTOM" ? L.sat : palSat,
          contrast: L.contrast,
          warp: Math.min(1, L.warp + drive * 0.10),
          jitter: Math.min(1, L.jitter + push * 0.10 + audioTreb * 0.18),
          seed: L.seed,
          invert: L.invert,
          moshX: L.moshX,
          moshY: L.moshY,
          scatter: L.scatter,
          scatterMode: useMode,
          scatterPulse: pulse,
          glyphMode: L.glyphMode ?? 0,
        };
      };

      if (activeIndexed.length === 1) {
        const e0 = activeIndexed[0];
        const blendMode = genBlendRef.current;
        const gctx2 = gc.getContext("2d");
        const workerEligible = isWorkerSupportedGenStyle(e0.L.style);
        if (workerEligible && blendMode === "AVG" && gctx2) {
          const params = paramsForLayer(e0.L, e0.idx);
          if (!genWorkerPrimedRef.current) {
            drawPixelGenerator(gc, params);
            genWorkerPrimedRef.current = true;
          }
          if (!genWorkerBusyRef.current) {
            genWorkerBusyRef.current = true;
            void generatePixelFrame(params, gc.width, gc.height).catch(() => {
              genWorkerBusyRef.current = false;
            });
          }
        } else if (blendMode === "AVG" || !gctx2) {
          drawPixelGenerator(gc, paramsForLayer(e0.L, e0.idx));
        } else {
          // Single-layer blend: composite the new frame against the
          // previous frame using a canvas blend op so the BLEND buttons
          // (MAX/MIN/XOR/ADD/SUB/DIFF/MUL) actually do something visible
          // even with one generator layer.
          type FbHost = HTMLCanvasElement & { _gscFbCv?: HTMLCanvasElement };
          const host = gc as FbHost;
          let fb = host._gscFbCv;
          if (!fb || fb.width !== gc.width || fb.height !== gc.height) {
            fb = document.createElement("canvas");
            fb.width = gc.width; fb.height = gc.height;
            host._gscFbCv = fb;
          }
          const fbCtx = fb.getContext("2d");
          if (fbCtx) fbCtx.drawImage(gc, 0, 0); // capture previous frame
          drawPixelGenerator(gc, paramsForLayer(e0.L, e0.idx));
          // v1.2.66 — use the extended GEN_BLEND_OP map (16+ Photoshop
          // style blend modes via Canvas2D globalCompositeOperation).
          const op = GEN_BLEND_OP[blendMode] ?? "source-over";
          const prevAlpha = gctx2.globalAlpha;
          gctx2.globalCompositeOperation = op;
          // v1.2.65 — full alpha so BLEND ops fully transform the source
          // instead of ghost-blending. Per the "no opacity layers, hit
          // source" mandate.
          gctx2.globalAlpha = 1.0;
          gctx2.drawImage(fb, 0, 0);
          gctx2.globalAlpha = prevAlpha;
          gctx2.globalCompositeOperation = "source-over";
        }
      } else {
        // Multi-layer: render each style to its own SMALL offscreen canvas
        // (1/3 of gc), then FUSE per-pixel and upscale to gc. Per-pixel
        // coupling at full resolution is too slow on phones; the texture
        // is already pixel-scaled so the resolution loss is invisible.
        const fuseDiv = recordingActive ? 4 : 3;
        const fuseW = Math.max(64, Math.min(360, Math.round(gc.width  / fuseDiv)));
        const fuseH = Math.max(64, Math.min(360, Math.round(gc.height / fuseDiv)));
        const layerCanvases = genLayerCanvasesRef.current;
        const lwBusy = layerWorkerBusyRef.current;
        const lwPrimed = layerWorkerPrimedRef.current;
        for (let i = 0; i < activeIndexed.length; i++) {
          let lc = layerCanvases[i];
          if (!lc) { lc = document.createElement("canvas"); layerCanvases[i] = lc; }
          const resized = lc.width !== fuseW || lc.height !== fuseH;
          if (resized) {
            lc.width = fuseW; lc.height = fuseH;
            // After resize the worker's previous frame is wrong dimensions;
            // force a re-prime so the synchronous fuse below sees fresh pixels.
            lwPrimed[i] = false;
          }
          const e = activeIndexed[i];
          const params = paramsForLayer(e.L, e.idx);
          // v1.3.80 — pipeline per-layer raster through its own worker.
          // First-frame (or post-resize) prime stays synchronous so the
          // fuse step never reads an uninitialised canvas. Steady state
          // is fully off-main-thread.
          if (i < 4) {
            if (!lwPrimed[i]) {
              drawPixelGenerator(lc, params);
              lwPrimed[i] = true;
            }
            if (!lwBusy[i]) {
              lwBusy[i] = true;
              const slotIdx = i;
              const targetCanvas = lc;
              const tW = fuseW, tH = fuseH;
              void generateLayerFrame(slotIdx, params, tW, tH).then((res) => {
                lwBusy[slotIdx] = false;
                if (!res.width || !res.height) return;
                if (targetCanvas.width !== res.width || targetCanvas.height !== res.height) return;
                const lctx = targetCanvas.getContext("2d");
                if (!lctx) return;
                const imageData = new ImageData(res.width, res.height);
                imageData.data.set(res.data);
                lctx.putImageData(imageData, 0, 0);
              }).catch(() => { lwBusy[slotIdx] = false; });
            }
          } else {
            // Defensive fallback for the (currently impossible) >4 layer case.
            drawPixelGenerator(lc, params);
          }
        }
        // Trim cache so unused canvases are released for GC.
        if (layerCanvases.length > activeIndexed.length) {
          layerCanvases.length = activeIndexed.length;
        }
        const gctx = gc.getContext("2d");
        if (gctx) {
          // Read pixels from each layer at the FUSE (small) resolution.
          const W2 = fuseW, H2 = fuseH;
          const layerImages: ImageData[] = [];
          for (let i = 0; i < layerCanvases.length; i++) {
            const lctx = layerCanvases[i].getContext("2d");
            if (!lctx) continue;
            layerImages.push(lctx.getImageData(0, 0, W2, H2));
          }
          if (layerImages.length > 0) {
            const out = gctx.createImageData(W2, H2);
            const od = out.data;
            const N = layerImages.length;
            const blendModeRaw = genBlendRef.current;
            // v1.2.66 — multi-layer per-pixel fuse only knows the
            // legacy 8 blend modes (they include inter-layer pixel
            // displacement coupling). For the new Photoshop-style
            // modes (NORMAL/DARKEN/MULTIPLY/COLORBURN/etc.) we route
            // the per-pixel fuse through AVG (so coupling still
            // happens) and then apply the chosen Canvas blend as a
            // post flatten step further down. This keeps motion alive
            // for the new modes while still showing the painter blend.
            const LEGACY_FUSE = new Set(["AVG","MAX","MIN","XOR","ADD","SUB","DIFF","MUL"]);
            const blendMode = LEGACY_FUSE.has(blendModeRaw) ? blendModeRaw : "AVG";
            // Precompute references for tight inner loop.
            const datas: Uint8ClampedArray[] = layerImages.map(im => im.data);

            // ── Inter-layer coupling ──────────────────────────────────
            // Each layer's pixels get displaced by the *gradient* of the
            // NEXT layer's luminance — so brighter regions in layer (i+1)
            // push layer i's pixels away from them, and vice versa. The
            // result is pixels that visibly bounce/flow off each other
            // rather than sitting at the same coordinate. A small feedback
            // buffer also retains a fraction of the previous fused frame
            // so motion has true momentum across frames.
            const lum: Uint8Array[] = new Array(N);
            for (let i = 0; i < N; i++) {
              const d = datas[i];
              const L = new Uint8Array(W2 * H2);
              for (let q = 0, j = 0; q < d.length; q += 4, j++) {
                // Rec.601 luma, fast int.
                L[j] = (d[q] * 77 + d[q+1] * 150 + d[q+2] * 29) >> 8;
              }
              lum[i] = L;
            }
            // Coupling strength scales with how many layers are active.
            const COUP = Math.min(8, 2 + N * 1.5);

            // Persistent feedback buffer (previous fused frame).
            const fb = (gc as HTMLCanvasElement & { _gscFb?: Uint8Array })._gscFb;
            const FB = (fb && fb.length === od.length) ? fb : new Uint8Array(od.length);
            (gc as HTMLCanvasElement & { _gscFb?: Uint8Array })._gscFb = FB;
            const FB_MIX = 0.18; // 0..1 fraction of previous frame retained

            for (let y = 0; y < H2; y++) {
              const rowOff = y * W2;
              for (let x = 0; x < W2; x++) {
                const idx = rowOff + x;
                let r = 0, g = 0, b = 0;

                // Per-layer displaced sample indices.
                // dx_i, dy_i derived from gradient of lum[(i+1)%N] at (x,y).
                // sobel-ish 3-tap: Lx = L[x+1] - L[x-1], Ly = L[y+1] - L[y-1].
                // Then sample layer i at (x - Lx*coup, y - Ly*coup) so bright
                // areas in the partner layer REPEL this layer (push pixels
                // outward) — visible "bounce off" behaviour.
                if (blendMode === "AVG") {
                  for (let i = 0; i < N; i++) {
                    const partner = lum[(i + 1) % N];
                    const xm = x > 0 ? x - 1 : x;
                    const xp = x < W2 - 1 ? x + 1 : x;
                    const ym = y > 0 ? y - 1 : y;
                    const yp = y < H2 - 1 ? y + 1 : y;
                    const Lx = (partner[rowOff + xp] - partner[rowOff + xm]) / 255;
                    const Ly = (partner[yp * W2 + x] - partner[ym * W2 + x]) / 255;
                    let sx = x - (Lx * COUP) | 0;
                    let sy = y - (Ly * COUP) | 0;
                    if (sx < 0) sx = 0; else if (sx >= W2) sx = W2 - 1;
                    if (sy < 0) sy = 0; else if (sy >= H2) sy = H2 - 1;
                    const sp = (sy * W2 + sx) << 2;
                    const d = datas[i];
                    r += d[sp]; g += d[sp+1]; b += d[sp+2];
                  }
                  r = (r / N) | 0; g = (g / N) | 0; b = (b / N) | 0;
                } else if (blendMode === "MAX") {
                  for (let i = 0; i < N; i++) {
                    const partner = lum[(i + 1) % N];
                    const xm = x > 0 ? x - 1 : x, xp = x < W2 - 1 ? x + 1 : x;
                    const ym = y > 0 ? y - 1 : y, yp = y < H2 - 1 ? y + 1 : y;
                    const Lx = (partner[rowOff + xp] - partner[rowOff + xm]) / 255;
                    const Ly = (partner[yp * W2 + x] - partner[ym * W2 + x]) / 255;
                    let sx = x - (Lx * COUP) | 0, sy = y - (Ly * COUP) | 0;
                    if (sx < 0) sx = 0; else if (sx >= W2) sx = W2 - 1;
                    if (sy < 0) sy = 0; else if (sy >= H2) sy = H2 - 1;
                    const sp = (sy * W2 + sx) << 2;
                    const d = datas[i];
                    if (d[sp]   > r) r = d[sp];
                    if (d[sp+1] > g) g = d[sp+1];
                    if (d[sp+2] > b) b = d[sp+2];
                  }
                } else if (blendMode === "MIN") {
                  r = 255; g = 255; b = 255;
                  for (let i = 0; i < N; i++) {
                    const partner = lum[(i + 1) % N];
                    const xm = x > 0 ? x - 1 : x, xp = x < W2 - 1 ? x + 1 : x;
                    const ym = y > 0 ? y - 1 : y, yp = y < H2 - 1 ? y + 1 : y;
                    const Lx = (partner[rowOff + xp] - partner[rowOff + xm]) / 255;
                    const Ly = (partner[yp * W2 + x] - partner[ym * W2 + x]) / 255;
                    let sx = x - (Lx * COUP) | 0, sy = y - (Ly * COUP) | 0;
                    if (sx < 0) sx = 0; else if (sx >= W2) sx = W2 - 1;
                    if (sy < 0) sy = 0; else if (sy >= H2) sy = H2 - 1;
                    const sp = (sy * W2 + sx) << 2;
                    const d = datas[i];
                    if (d[sp]   < r) r = d[sp];
                    if (d[sp+1] < g) g = d[sp+1];
                    if (d[sp+2] < b) b = d[sp+2];
                  }
                } else if (blendMode === "XOR") {
                  // XOR uses raw (no displacement) to keep the bit-pattern crisp.
                  const p = idx << 2;
                  r = datas[0][p];   g = datas[0][p+1]; b = datas[0][p+2];
                  for (let i = 1; i < N; i++) {
                    const d = datas[i];
                    r ^= d[p]; g ^= d[p+1]; b ^= d[p+2];
                  }
                } else if (blendMode === "ADD") {
                  for (let i = 0; i < N; i++) {
                    const partner = lum[(i + 1) % N];
                    const xm = x > 0 ? x - 1 : x, xp = x < W2 - 1 ? x + 1 : x;
                    const ym = y > 0 ? y - 1 : y, yp = y < H2 - 1 ? y + 1 : y;
                    const Lx = (partner[rowOff + xp] - partner[rowOff + xm]) / 255;
                    const Ly = (partner[yp * W2 + x] - partner[ym * W2 + x]) / 255;
                    let sx = x - (Lx * COUP) | 0, sy = y - (Ly * COUP) | 0;
                    if (sx < 0) sx = 0; else if (sx >= W2) sx = W2 - 1;
                    if (sy < 0) sy = 0; else if (sy >= H2) sy = H2 - 1;
                    const sp = (sy * W2 + sx) << 2;
                    const d = datas[i];
                    r += d[sp]; g += d[sp+1]; b += d[sp+2];
                  }
                  if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
                } else if (blendMode === "SUB") {
                  const p0 = idx << 2;
                  r = datas[0][p0]; g = datas[0][p0+1]; b = datas[0][p0+2];
                  for (let i = 1; i < N; i++) {
                    const partner = lum[(i + 1) % N];
                    const xm = x > 0 ? x - 1 : x, xp = x < W2 - 1 ? x + 1 : x;
                    const ym = y > 0 ? y - 1 : y, yp = y < H2 - 1 ? y + 1 : y;
                    const Lx = (partner[rowOff + xp] - partner[rowOff + xm]) / 255;
                    const Ly = (partner[yp * W2 + x] - partner[ym * W2 + x]) / 255;
                    let sx = x - (Lx * COUP) | 0, sy = y - (Ly * COUP) | 0;
                    if (sx < 0) sx = 0; else if (sx >= W2) sx = W2 - 1;
                    if (sy < 0) sy = 0; else if (sy >= H2) sy = H2 - 1;
                    const sp = (sy * W2 + sx) << 2;
                    const d = datas[i];
                    r -= d[sp]; g -= d[sp+1]; b -= d[sp+2];
                  }
                  if (r < 0) r = 0; if (g < 0) g = 0; if (b < 0) b = 0;
                } else if (blendMode === "DIFF") {
                  const p0 = idx << 2;
                  r = datas[0][p0]; g = datas[0][p0+1]; b = datas[0][p0+2];
                  for (let i = 1; i < N; i++) {
                    const partner = lum[(i + 1) % N];
                    const xm = x > 0 ? x - 1 : x, xp = x < W2 - 1 ? x + 1 : x;
                    const ym = y > 0 ? y - 1 : y, yp = y < H2 - 1 ? y + 1 : y;
                    const Lx = (partner[rowOff + xp] - partner[rowOff + xm]) / 255;
                    const Ly = (partner[yp * W2 + x] - partner[ym * W2 + x]) / 255;
                    let sx = x - (Lx * COUP) | 0, sy = y - (Ly * COUP) | 0;
                    if (sx < 0) sx = 0; else if (sx >= W2) sx = W2 - 1;
                    if (sy < 0) sy = 0; else if (sy >= H2) sy = H2 - 1;
                    const sp = (sy * W2 + sx) << 2;
                    const d = datas[i];
                    const dr = r - d[sp];   r = dr < 0 ? -dr : dr;
                    const dg = g - d[sp+1]; g = dg < 0 ? -dg : dg;
                    const db = b - d[sp+2]; b = db < 0 ? -db : db;
                  }
                } else { // MUL
                  const p0 = idx << 2;
                  r = datas[0][p0]; g = datas[0][p0+1]; b = datas[0][p0+2];
                  for (let i = 1; i < N; i++) {
                    const partner = lum[(i + 1) % N];
                    const xm = x > 0 ? x - 1 : x, xp = x < W2 - 1 ? x + 1 : x;
                    const ym = y > 0 ? y - 1 : y, yp = y < H2 - 1 ? y + 1 : y;
                    const Lx = (partner[rowOff + xp] - partner[rowOff + xm]) / 255;
                    const Ly = (partner[yp * W2 + x] - partner[ym * W2 + x]) / 255;
                    let sx = x - (Lx * COUP) | 0, sy = y - (Ly * COUP) | 0;
                    if (sx < 0) sx = 0; else if (sx >= W2) sx = W2 - 1;
                    if (sy < 0) sy = 0; else if (sy >= H2) sy = H2 - 1;
                    const sp = (sy * W2 + sx) << 2;
                    const d = datas[i];
                    r = (r * d[sp])   / 255;
                    g = (g * d[sp+1]) / 255;
                    b = (b * d[sp+2]) / 255;
                  }
                  r |= 0; g |= 0; b |= 0;
                }

                // Feedback: blend in fraction of previous fused frame for
                // momentum so trails actually flow instead of restarting.
                const op = idx << 2;
                r = (r * (1 - FB_MIX) + FB[op]   * FB_MIX) | 0;
                g = (g * (1 - FB_MIX) + FB[op+1] * FB_MIX) | 0;
                b = (b * (1 - FB_MIX) + FB[op+2] * FB_MIX) | 0;
                od[op] = r; od[op+1] = g; od[op+2] = b; od[op+3] = 255;
                FB[op] = r; FB[op+1] = g; FB[op+2] = b; FB[op+3] = 255;
              }
            }
            // Push fused pixels through a small intermediate canvas, then
            // upscale (nearest-neighbour) into gc so we keep the chunky
            // pixel look at full output res.
            const gcExt = gc as HTMLCanvasElement & { _gscFuse?: HTMLCanvasElement };
            let fuseCanvas = gcExt._gscFuse;
            if (!fuseCanvas) { fuseCanvas = document.createElement("canvas"); gcExt._gscFuse = fuseCanvas; }
            if (fuseCanvas.width !== W2 || fuseCanvas.height !== H2) {
              fuseCanvas.width = W2; fuseCanvas.height = H2;
            }
            const fctx = fuseCanvas.getContext("2d");
            if (fctx) {
              fctx.putImageData(out, 0, 0);
              (gctx as CanvasRenderingContext2D & { imageSmoothingEnabled: boolean }).imageSmoothingEnabled = false;
              // v1.2.66 — for the new Photoshop-style blend modes
              // (NORMAL/DARKEN/MULTIPLY/COLORBURN/etc.) we apply the
              // chosen Canvas2D blend as a post-flatten between the
              // previously rendered gc frame and the new fused frame.
              // Legacy modes (AVG/MAX/MIN/etc.) keep the original
              // simple clear+draw path so coupling drives the look.
              if (!LEGACY_FUSE.has(blendModeRaw)) {
                const gcExt2 = gc as HTMLCanvasElement & { _gscFlatPrev?: HTMLCanvasElement };
                let prevC = gcExt2._gscFlatPrev;
                if (!prevC || prevC.width !== gc.width || prevC.height !== gc.height) {
                  prevC = document.createElement("canvas");
                  prevC.width = gc.width; prevC.height = gc.height;
                  gcExt2._gscFlatPrev = prevC;
                }
                const pCtx = prevC.getContext("2d");
                if (pCtx) {
                  pCtx.globalCompositeOperation = "source-over";
                  pCtx.globalAlpha = 1;
                  pCtx.drawImage(gc, 0, 0);
                }
                gctx.clearRect(0, 0, gc.width, gc.height);
                gctx.globalCompositeOperation = "source-over";
                gctx.globalAlpha = 1;
                gctx.drawImage(fuseCanvas, 0, 0, gc.width, gc.height);
                const op = GEN_BLEND_OP[blendModeRaw] ?? "source-over";
                gctx.globalCompositeOperation = op;
                gctx.globalAlpha = 1;
                gctx.drawImage(prevC, 0, 0);
                gctx.globalCompositeOperation = "source-over";
              } else {
                gctx.clearRect(0, 0, gc.width, gc.height);
                gctx.drawImage(fuseCanvas, 0, 0, gc.width, gc.height);
              }
            }
          }
        }
      }

      // Layer modes were removed — both PXL (pixel-sort) and MOSH (datamosh)
      // are always armed and live. The per-effect AMOUNT/INTENS knobs gate
      // whether they actually contribute (zero == bypass). The triple-armed
      // camera-drive composite (generator displaces + overlays the camera)
      // only kicks in when the user has actually dialed in BOTH effects —
      // otherwise the camera passes through clean (no rainbow/invert ghost).
      const armedLayers = comboLayersRef.current;
      void armedLayers;
      // v1.2.64 — PXL is armed when REALSORT (master) is up. AMOUNT alone
      // no longer arms the rack since it now multiplies through sortMix.
      const pxlArmed = (sortMixRef.current ?? 0) > 0.02;
      const moshArmed = (datamoshRef.current ?? 0) > 0.02;
      const tripleArmedCameraDrive = pxlArmed && moshArmed;

      // Generator mode keeps camera alive and composites both when camera frames exist.
      // Skip the heavy displacement + generator-overlay pass entirely when the
      // user hasn't dialed in any blend FX — otherwise the default BLEND view
      // shows a permanent rainbow + inverted ghost over the camera.
      // v1.3.10 — ALSO skip this branch whenever face FX is armed. The
      // displacement+blend pass produces a gen-dominant composite that
      // blew right past GEN▸FG / GEN▸BG intent (user's BG kept reading
      // as gen even with FACE selected). When face FX is on, the
      // person-aware branch below owns the source layering and the
      // shader's per-pixel mask handles where FX paint.
      const faceFxArmed = faceFxRef.current.active;
      const blendEngaged = (pxlArmed || moshArmed) && !faceFxArmed;
      if (cameraActiveRef.current && video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 && blendEngaged) {
        let cc = genCompositeCanvasRef.current;
        if (!cc) { cc = document.createElement("canvas"); genCompositeCanvasRef.current = cc; }
        if (cc.width !== targetW || cc.height !== targetH) {
          cc.width = targetW; cc.height = targetH;
        }
        const cctx = cc.getContext("2d");
        if (cctx) {
          cctx.globalCompositeOperation = "source-over";
          cctx.globalAlpha = 1;
          cctx.clearRect(0, 0, cc.width, cc.height);
          cctx.drawImage(video, 0, 0, cc.width, cc.height);
          // ── Generator-as-displacement-map ──────────────────────────
          // Sample the generator at low res, treat its colour channels as
          // (dx, dy) offsets, and re-sample the camera at the displaced
          // coordinate. The result is camera pixels that VISIBLY MOVE
          // wherever the generator pattern is bright/coloured. After this
          // pass we still apply the chosen blend on top so the generator
          // is visible AND drives motion.
          {
            const sampleDiv = recordingActive ? 6 : 4;
            const dW = Math.min(360, Math.max(96, (cc.width  / sampleDiv) | 0));
            const dH = Math.min(360, Math.max(96, (cc.height / sampleDiv) | 0));
            const ccExt = cc as HTMLCanvasElement & {
              _dispGen?: HTMLCanvasElement;
              _dispVid?: HTMLCanvasElement;
              _dispOut?: HTMLCanvasElement;
            };
            if (!ccExt._dispGen) ccExt._dispGen = document.createElement("canvas");
            if (!ccExt._dispVid) ccExt._dispVid = document.createElement("canvas");
            if (!ccExt._dispOut) ccExt._dispOut = document.createElement("canvas");
            const dG = ccExt._dispGen!, dV = ccExt._dispVid!, dO = ccExt._dispOut!;
            if (dG.width !== dW || dG.height !== dH) { dG.width = dW; dG.height = dH; }
            if (dV.width !== dW || dV.height !== dH) { dV.width = dW; dV.height = dH; }
            if (dO.width !== dW || dO.height !== dH) { dO.width = dW; dO.height = dH; }
            const gCtx = dG.getContext("2d", { willReadFrequently: true });
            const vCtx = dV.getContext("2d", { willReadFrequently: true });
            const oCtx = dO.getContext("2d");
            if (gCtx && vCtx && oCtx) {
              gCtx.drawImage(gc, 0, 0, dW, dH);
              vCtx.drawImage(video, 0, 0, dW, dH);
              const gImg = gCtx.getImageData(0, 0, dW, dH);
              const vImg = vCtx.getImageData(0, 0, dW, dH);
              const out = oCtx.createImageData(dW, dH);
              const gD = gImg.data, vD = vImg.data, oD = out.data;
              // Displacement strength: scaled to canvas + responsive to gen luma.
              const amp = Math.min(dW, dH) * (tripleArmedCameraDrive ? (recordingActive ? 0.11 : 0.16) : (recordingActive ? 0.07 : 0.10));
              for (let y = 0; y < dH; y++) {
                for (let x = 0; x < dW; x++) {
                  const i = (y * dW + x) << 2;
                  // Use red channel for X-offset, green for Y-offset.
                  const dx = ((gD[i]   / 255) - 0.5) * 2 * amp;
                  const dy = ((gD[i+1] / 255) - 0.5) * 2 * amp;
                  let sx = (x + dx) | 0;
                  let sy = (y + dy) | 0;
                  if (sx < 0) sx = 0; else if (sx >= dW) sx = dW - 1;
                  if (sy < 0) sy = 0; else if (sy >= dH) sy = dH - 1;
                  const j = (sy * dW + sx) << 2;
                  oD[i  ] = vD[j];
                  oD[i+1] = vD[j+1];
                  oD[i+2] = vD[j+2];
                  oD[i+3] = 255;
                }
              }
              oCtx.putImageData(out, 0, 0);
              cctx.clearRect(0, 0, cc.width, cc.height);
              (cctx as CanvasRenderingContext2D & { imageSmoothingEnabled: boolean }).imageSmoothingEnabled = true;
              cctx.drawImage(dO, 0, 0, cc.width, cc.height);
            }
          }
          if (tripleArmedCameraDrive) {
            // Triple-armed mode: keep motion anchored to camera while generator drives texture.
            cctx.globalCompositeOperation = "soft-light";
            cctx.globalAlpha = 0.64;
            cctx.drawImage(gc, 0, 0, cc.width, cc.height);
            cctx.globalCompositeOperation = "overlay";
            cctx.globalAlpha = 0.36;
            cctx.drawImage(gc, 0, 0, cc.width, cc.height);
            cctx.globalCompositeOperation = "source-over";
            cctx.globalAlpha = 0.24;
            cctx.drawImage(video, 0, 0, cc.width, cc.height);
          } else {
            cctx.globalCompositeOperation = "hard-light";
            cctx.globalAlpha = recordingActive ? 0.78 : 0.92;
            cctx.drawImage(gc, 0, 0, cc.width, cc.height);
          }
          cctx.globalCompositeOperation = "source-over";
          cctx.globalAlpha = 1;
          texSource = cc; srcW = cc.width; srcH = cc.height;
        } else {
          texSource = gc; srcW = gc.width; srcH = gc.height;
        }
      } else if (cameraActiveRef.current && video && video.readyState >= 2 && video.videoWidth > 0) {
        // v1.2.80 — GEN+CAM with NO FX armed.
        //  • If the face segmenter is ready (faceFx active + texValid),
        //    set texSource = pure generator. The PERSON-OVER-SOURCE
        //    composite block below will then stamp the camera person on
        //    top, giving us "BG = generator FX, FG = real subject".
        //  • If the segmenter isn't ready yet (cold boot, no model),
        //    fall back to the always-on 55/45 + screen composite so the
        //    user still sees BOTH layers and never gets a black screen.
        if (faceFxRef.current.active && faceFxRef.current.texValid) {
          // v1.2.86 — when FACE mode is armed (invert=false), the
          // intent is "person covered in generator pattern", so we
          // hand the composite block below the camera frame as the
          // base and let it stamp the GENERATOR clipped to the
          // person mask on top. When BG mode is armed (invert=true),
          // we keep the original "generator background + clean
          // person on top" path.
          if (faceFxRef.current.invert) {
            texSource = gc; srcW = gc.width; srcH = gc.height;
          } else {
            texSource = video; srcW = video.videoWidth; srcH = video.videoHeight;
          }
        } else if (faceFxRef.current.active) {
          // v1.3.9 — FX armed but segmenter mask not ready yet (cold
          // boot, model still loading, or init failed). Honor the user's
          // routing intent immediately so the BG matches the picked tile
          // even before the person stamp arrives:
          //   GEN▸FG (invert=false) → cam bg right away, gen will stamp
          //                            on person once seg comes online.
          //   GEN▸BG (invert=true)  → gen bg right away, clean person
          //                            will stamp once seg comes online.
          // The previous 55/45 gen-over-video blend made GEN▸FG look
          // permanently "gen bg" because the generator at 55% +
          // screen-blended 45% drowned out the camera underneath.
          if (faceFxRef.current.invert) {
            texSource = gc; srcW = gc.width; srcH = gc.height;
          } else {
            texSource = video; srcW = video.videoWidth; srcH = video.videoHeight;
          }
        } else {
          // v1.3.12 — face FX OFF on GEN+CAM. Previously this branch
          // composited a 55%-source-over + 45%-screen blend of gen
          // over video, which (a) read visually as pixel-sort/glitch
          // even with all knobs at 0 and (b) had no real intent now
          // that the GEN OVERLAY tiles explicitly route via face FX.
          // With face FX OFF the user picked the OFF or GEN tile, so
          // just show pure generator. No surprise blends.
          texSource = gc; srcW = gc.width; srcH = gc.height;
        }
      } else {
        texSource = gc; srcW = gc.width; srcH = gc.height;
      }

      // v1.3.44/45 — GEN MIX override. When srcMode is CAMERA but we
      // entered this branch because MIX > 0, ignore the routing
      // decisions above (they assumed srcMode === "generator") and
      // emit a single, predictable blend: live camera as the base,
      // generator drawn on top at MIX opacity (plain source-over).
      // v1.3.45 — switched from hard-light to source-over so MIX is a
      // straight, predictable cross-fade: 0 = pure cam, 1 = pure gen,
      // 0.5 = 50/50. Hard-light hid the generator on mid-gray pixels;
      // source-over guarantees a visible blend regardless of content.
      // The shader's downstream FX then operate on the mixed pixel
      // signal — generator stops being an island.
      if (srcMode === "camera") {
        if (cameraActiveRef.current && video && video.readyState >= 2 && video.videoWidth > 0) {
          let cc = genCompositeCanvasRef.current;
          if (!cc) { cc = document.createElement("canvas"); genCompositeCanvasRef.current = cc; }
          const cw = video.videoWidth, ch = video.videoHeight;
          if (cc.width !== cw || cc.height !== ch) {
            cc.width = cw; cc.height = ch;
            // Resize invalidates the cached hash mask.
            genHashMaskRef.current = null;
          }
          const cctx = cc.getContext("2d");
          if (cctx) {
            const mix = Math.max(0, Math.min(1, genMixRef.current));
            cctx.globalCompositeOperation = "source-over";
            cctx.globalAlpha = 1;
            cctx.clearRect(0, 0, cw, ch);
            if (mix <= 0.001) {
              cctx.drawImage(video, 0, 0, cw, ch);
            } else {
              // v1.3.50 — HALF-RES UINT32 MOSAIC (CS perf solve).
              // The v1.3.47 mosaic ran a per-pixel hash swap on the FULL
              // cam resolution (~1920×1080 on phone) with two ImageData
              // round-trips per frame. Each round-trip forces a GPU↔CPU
              // sync; the JS swap loop did 3 byte writes per replaced
              // pixel. Combined cost on phone ≈ 10–20 ms / frame in mix
              // mode, dwarfing the FX shader pass.
              //
              // The mosaic is already pure random hash dither — there is
              // no high-frequency cam detail to preserve INSIDE the dot
              // pattern. So we run the mosaic at HALF resolution and
              // upscale the result with nearest-neighbor `drawImage`.
              // Visible result: dots become 2×2 blocks instead of 1×1.
              // To the eye that reads as the same noise field, but:
              //   • npx → npx / 4   (4× less ImageData traffic)
              //   • inner loop → 1 Uint32 write instead of 3 byte writes
              //     (≈ 3× faster body)
              // Net mix-mode CPU cost ≈ 1–2 ms / frame. The downstream
              // fragment shader still sees a full-resolution `cc` texture
              // because the upscale fills it back in.
              const hw = Math.max(1, cw >> 1);
              const hh = Math.max(1, ch >> 1);
              const npxH = hw * hh;
              let mask = genHashMaskRef.current;
              if (!mask || mask.length !== npxH) {
                mask = new Uint8Array(npxH);
                for (let i = 0; i < npxH; i++) mask[i] = (Math.random() * 256) | 0;
                genHashMaskRef.current = mask;
              }
              let scratch = genHashScratchRef.current;
              if (!scratch) { scratch = document.createElement("canvas"); genHashScratchRef.current = scratch; }
              if (scratch.width !== hw || scratch.height !== hh) { scratch.width = hw; scratch.height = hh; }
              const sctx = scratch.getContext("2d");
              if (sctx) {
                sctx.imageSmoothingEnabled = true;
                sctx.globalCompositeOperation = "source-over";
                sctx.globalAlpha = 1;
                sctx.clearRect(0, 0, hw, hh);
                sctx.drawImage(video, 0, 0, hw, hh);
                const camData = sctx.getImageData(0, 0, hw, hh);
                sctx.clearRect(0, 0, hw, hh);
                sctx.drawImage(gc, 0, 0, hw, hh);
                const genData = sctx.getImageData(0, 0, hw, hh);
                const cd32 = new Uint32Array(camData.data.buffer);
                const gd32 = new Uint32Array(genData.data.buffer);
                const thresh = (mix * 256) | 0;
                for (let i = 0; i < npxH; i++) {
                  if (mask[i] < thresh) cd32[i] = gd32[i];
                }
                sctx.putImageData(camData, 0, 0);
                cctx.imageSmoothingEnabled = false;
                cctx.drawImage(scratch, 0, 0, cw, ch);
              } else {
                cctx.drawImage(video, 0, 0, cw, ch);
              }
            }
            texSource = cc; srcW = cw; srcH = ch;
          } else {
            texSource = video; srcW = cw; srcH = ch;
          }
        } else {
          texSource = gc; srcW = gc.width; srcH = gc.height;
        }
      }
    } else if (cameraActiveRef.current && video && video.readyState >= 2) {
      texSource = video; srcW = video.videoWidth; srcH = video.videoHeight;
    }

    // v1.2.51 — PERSON-OVER-SOURCE COMPOSITE.
    // When the user is on a non-camera source (generator / upload) AND face
    // FX is engaged, the camera + segmenter run continuously underneath. We
    // cut the person out of the camera frame and stamp them on top of the
    // current texSource so the user appears INSIDE the procedural / uploaded
    // background. The FG (FACE) vs BG knob continues to control which side
    // the FX rack paints on, via the existing uFaceInvert plumbing in the
    // shader — here we only handle the source layering. If the segmenter
    // mask isn't ready yet (texValid=false) we skip the composite this
    // frame and fall back to the un-composited source.
    // v1.3.11 — REMOVED the v1.2.98 "transitional" hard-light(0.55)
    // video+gen blend that ran whenever face FX was armed but the
    // segmenter mask wasn't ready yet. That block was overwriting the
    // v1.3.9 routing decision (texSource=video for FACE / texSource=gc
    // for BG) with a 50/50 blend, producing the "bg is still
    // generative" look the user reported on cold boot AND making
    // GEN▸BG read backwards (video bg + gen overlay everywhere). The
    // v1.3.9 branch above already picks the correct un-composited
    // source per intent, so the user sees the right BG immediately
    // while waiting for the seg mask to arrive (then the person stamp
    // below kicks in once texValid flips true).

    if (
      texSource &&
      srcMode !== "camera" &&
      faceFxRef.current.active &&
      faceFxRef.current.texValid &&
      cameraActiveRef.current &&
      video && video.readyState >= 2 && video.videoWidth > 0
    ) {
      const maskCanvas = faceMaskCanvasRef.current;
      if (maskCanvas) {
        const W = srcW | 0;
        const H = srcH | 0;
        if (W > 0 && H > 0) {
          // Scratch: video-clipped-to-person.
          let person = faceComposePersonRef.current;
          if (!person) { person = document.createElement("canvas"); faceComposePersonRef.current = person; }
          if (person.width !== W || person.height !== H) { person.width = W; person.height = H; }
          const pctx = person.getContext("2d");
          // Output: source + person on top.
          let out = faceComposeCanvasRef.current;
          if (!out) { out = document.createElement("canvas"); faceComposeCanvasRef.current = out; }
          if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
          const octx = out.getContext("2d");
          if (pctx && octx) {
            // v1.2.86 — branch on FACE vs BG.
            //   BG (invert=true): scratch = video clipped to person,
            //     stamped over generator background. (clean person)
            //   FACE (invert=false): scratch = generator clipped to
            //     person, stamped over the live camera frame so the
            //     subject appears wearing the procedural pattern
            //     while their surroundings stay real.
            const stampSource: CanvasImageSource = faceFxRef.current.invert
              ? (video as CanvasImageSource)
              : (genCanvasRef.current as CanvasImageSource);
            // 1. Fill scratch with the chosen layer.
            pctx.globalCompositeOperation = "source-over";
            pctx.globalAlpha = 1;
            pctx.clearRect(0, 0, W, H);
            pctx.drawImage(stampSource, 0, 0, W, H);
            // 2. Knock out non-person pixels by intersecting with the mask
            //    alpha (mask alpha was set to mask value in v1.2.51).
            pctx.globalCompositeOperation = "destination-in";
            pctx.drawImage(maskCanvas, 0, 0, W, H);
            pctx.globalCompositeOperation = "source-over";
            // 3. Compose: source first, person on top.
            octx.globalCompositeOperation = "source-over";
            octx.globalAlpha = 1;
            octx.clearRect(0, 0, W, H);
            octx.drawImage(texSource as CanvasImageSource, 0, 0, W, H);
            octx.drawImage(person, 0, 0, W, H);
            texSource = out;
          }
        }
      }
    }

    const hasVideo = !!texSource;
    const canvas = canvasRef.current!;
    // Camera upload (texImage2D seed on first frame / size change, then
    // texSubImage2D) happens inside the engine.
    eng.setSource(hasVideo ? texSource : null, srcW, srcH);

    // v1.2.58 — CPU PIXEL SORT tick (real Asendorf 2010 algorithm).
    // Throttled to ~20 Hz on a 256x144 downscale (~37k pixels). Uses a
    // packed Uint32 view of the ImageData for typed-array .sort() which
    // is numeric — sorts each above-threshold run in place by 32-bit RGBA
    // value (the Asendorf 'absolute rgb' key). The sorted canvas is
    // uploaded to TEXTURE5 / uSortTex; the shader's uSortMix block blends.
    if (!eng.gpuSortActive && sortMixRef.current > 0.001 && hasVideo && texSource) {
      // v1.3.40 — quality-aware stride. Default tick mod 3 (every 3rd
      // frame); under FX-governor pressure stretch to mod 5 or mod 8 so
      // the JS sort + readback doesn't compete with the shader for
      // main-thread time when frametime is already overrun.
      const _qS = fxQualityRef.current;
      const stride = recordingActive
        ? (_qS > 0.80 ? 6 : _qS > 0.50 ? 10 : 14)
        : (_qS > 0.80 ? 3 : _qS > 0.50 ? 5 : 8);
      cpuSortTickRef.current = (cpuSortTickRef.current + 1) % stride;
      if (cpuSortTickRef.current === 0) {
        try {
          const SW = 256, SH = 144;
          let dc = cpuSortDownCanvasRef.current;
          let oc = cpuSortOutCanvasRef.current;
          if (!dc) { dc = document.createElement("canvas"); dc.width = SW; dc.height = SH; cpuSortDownCanvasRef.current = dc; }
          if (!oc) { oc = document.createElement("canvas"); oc.width = SW; oc.height = SH; cpuSortOutCanvasRef.current = oc; }
          const dctx = dc.getContext("2d", { willReadFrequently: true });
          const octx = oc.getContext("2d");
          if (dctx && octx) {
            dctx.drawImage(texSource as CanvasImageSource, 0, 0, SW, SH);
            const img = dctx.getImageData(0, 0, SW, SH);
            const px32 = new Uint32Array(img.data.buffer);
            // v1.2.61 — sort key is LUMA packed into the high byte so the
            // numeric .sort() reorders the run by brightness (classic
            // Asendorf look), not by raw blue-dominant RGBA32. We build a
            // parallel Uint32 (luma<<24 | runIndex) key array, sort it,
            // then scatter the original pixels into a scratch in key order.
            // Threshold maps the slider so higher uSortMix = lower threshold
            // = more pixels caught in runs (more visible sort). Range 60..200.
            const thr = Math.max(20, Math.min(220, Math.floor(200 - sortMixRef.current * 140)));
            // Hoisted scratch buffers — reused across every run in every
            // row of the frame to avoid per-run GC churn.
            const keysAll = new Uint32Array(SW);
            const scratch = new Uint32Array(SW);
            for (let y = 0; y < SH; y++) {
              const rowOff = y * SW;
              let x = 0;
              while (x < SW) {
                // skip below-threshold
                while (x < SW) {
                  const p = px32[rowOff + x];
                  const r = p & 0xff, g = (p >>> 8) & 0xff, b = (p >>> 16) & 0xff;
                  const L = (r * 76 + g * 150 + b * 29) >>> 8;
                  if (L > thr) break;
                  x++;
                }
                const start = x;
                // walk above-threshold
                while (x < SW) {
                  const p = px32[rowOff + x];
                  const r = p & 0xff, g = (p >>> 8) & 0xff, b = (p >>> 16) & 0xff;
                  const L = (r * 76 + g * 150 + b * 29) >>> 8;
                  if (L < thr) break;
                  x++;
                }
                const len = x - start;
                if (len > 1) {
                  // Build (luma<<24 | localIndex) keys into a sub-view of
                  // the hoisted buffers, sort numerically, scatter pixels
                  // in luma order back into px32. Local index in the low
                  // 24 bits ensures unique keys (stable enough order).
                  const keys = keysAll.subarray(0, len);
                  for (let i = 0; i < len; i++) {
                    const p = px32[rowOff + start + i];
                    const r = p & 0xff, g = (p >>> 8) & 0xff, b = (p >>> 16) & 0xff;
                    const L = (r * 76 + g * 150 + b * 29) >>> 8;
                    keys[i] = (L << 24) | i;
                  }
                  keys.sort();
                  for (let i = 0; i < len; i++) scratch[i] = px32[rowOff + start + (keys[i] & 0xffffff)];
                  for (let i = 0; i < len; i++) px32[rowOff + start + i] = scratch[i];
                }
              }
            }
            octx.putImageData(img, 0, 0);
            eng.setSortTexture(oc); // uploaded without FLIP_Y, matching the camera texture
          }
        } catch { /* CPU sort tick is best-effort; ignore failures */ }
      }
    }

    eng.render({
      sortMix: sortMixRef.current,
      uniforms: (u, w) => {
        const { setF1, setF2, setI1, setFv } = w;

    setF1(u.uTime, timeRef.current);
    setF2(u.uResolution, canvas.width, canvas.height);
    setF2(u.uVideoSize, hasVideo ? srcW : canvas.width, hasVideo ? srcH : canvas.height);
    setF1(u.uMirror, cameraActiveRef.current && cameraFacingRef.current === "user" ? 1.0 : 0.0);
    setF2(u.uTouch, touchRef.current.x, touchRef.current.y);
    setF1(u.uTouchActive, touchRef.current.active ? 1.0 : 0.0);
    setF1(u.uAudio, audioLevelRef.current || 0.0);
    // v1.2.74 — band-split audio uniforms so the shader can react to
    // BASS / TREB / BEAT independently (datamosh kicks on beat, sort
    // pulses on bass, chrash sparks on treble).
    setF1(u.uABass, audioBassRef.current || 0.0);
    setF1(u.uATreb, audioTrebleRef.current || 0.0);
    setF1(u.uABeat, audioBeatRef.current || 0.0);
    // v1.3.43 — macro multipliers, resolved once per frame.
    // mI/mM/mC/mB pass through user-set per-knob values when all 4 dials
    // sit at 1.0 (the defaults), so behavior is byte-identical to v1.3.42
    // until the user touches a macro. COLOR uses a lerp from neutral 1.0
    // toward the user value because brightness/contrast/saturation are
    // multiplicative neutrals at 1.0 (NOT 0). Everything else is a flat
    // multiplier because those knobs are additive neutrals at 0.
    const _mI = intensityMacroRef.current;
    const _mM = motionMacroRef.current;
    const _mC = colorMacroRef.current;
    const _mB = breakMacroRef.current;
    // v1.3.54 \u2014 GLITCH PALETTE preset boost. Active only when DRAW is on,
    // there are painted strokes (so the mask gates the boost spatially via
    // uMask), and the selected preset has uniform deltas. Pixel preset has
    // (v1.3.57 — preset gate is now a single ON/OFF switch on FX Panel 2.
    // No more touch coupling; when enabled, full boost applies globally.)
    const _pbActive = glitchPresetEnabledRef.current;
    const _preset = _pbActive ? GLITCH_PRESETS[glitchPresetRef.current] : null;
    const _pb: BoostMap | undefined = _preset
      ? _preset.modulate(timeRef.current, presetStateRef.current)
      : undefined;
    const PB = (k: UniformBoostKey): number => ((_pb && _pb[k]) || 0) * (_pbActive ? 1 : 0);
    setF1(u.uBrightness, 1 + (brightnessRef.current - 1) * _mC + audioRackOutRef.current.strobe);
    setF1(u.uContrast,   1 + (contrastRef.current   - 1) * _mC);
    setF1(u.uSaturation, 1 + (saturationRef.current - 1) * _mC);
    setF1(u.uHueShift,   hueShiftRef.current * _mC + audioRackOutRef.current.hue);
    setF1(u.uScanlines, scanlinesRef.current * _mB);
    setF1(u.uZoom, zoomRef.current + audioRackOutRef.current.punch);
    // v1.2.53 — universal audio reactivity for the two camera-source FX
    // racks (PIXEL SORT + DATAMOSH). Generator already has a deep audio
    // routing built into its evolution loop above; this brings the FX
    // racks up to parity so the mic mod actually does something across
    // ALL three feature areas the user expects ("sort, mosh, generator").
    // We add a punch term so even a knob set to 0 produces a glimmer on
    // a loud beat (instant demo of audio-react), then a multiplicative
    // gain on top of the user's knob value so what they dialed in pulses.
    const _aBass  = audioBassRef.current;
    const _aBeat  = audioBeatRef.current;
    const _aLvl   = audioLevelRef.current;
    // v1.5.0 — REACT knob scales how hard the input drives the racks (0 = uniforms only, no auto sort/mosh lift).
    const _aGate  = Math.min(1.0, _aBass * 1.4 + _aBeat * 0.9 + _aLvl * 0.5) * audioReactAmtRef.current;
    // v1.5.5 — AUDIO RACK (Terminal Velocity KINETIC rack on GPS uniforms).
    // intensity = gain × source × REACT (TV: intensityFor = i + gain·audioFor(src)).
    {
      const F = audioFeaturesRef.current?.features;
      const pb = audioPrevBandsRef.current;
      const bass = F ? F.bass : _aBass, mid = F ? F.mid : _aLvl, treb = F ? F.treble : audioTrebleRef.current;
      const beat = F ? Math.max(F.beat, F.bassHit * 0.85) : _aBeat;
      const bassD = F ? F.bassDelta : Math.max(0, bass - pb.bass);
      const midD  = F ? F.midDelta  : Math.max(0, mid - pb.mid);
      const trebD = F ? F.trebDelta : Math.max(0, treb - pb.treb);
      const flow  = F ? F.flow : _aLvl;
      pb.bass = bass; pb.mid = mid; pb.treb = treb;
      const srcV = (src: string) => src === "BASS" ? bass : src === "MID" ? mid : src === "TREB" ? treb : src === "LEVEL" ? _aLvl
        : src === "BASS-D" ? Math.min(1, bassD * 2.4) : src === "MID-D" ? Math.min(1, midD * 2.4) : src === "TREB-D" ? Math.min(1, trebD * 2.4)
        : src === "BEAT" ? beat : src === "FLOW" ? flow : 0;
      const on = audioRackOnRef.current;
      const rk = audioReactAmtRef.current * 1.6; // REACT 0.6 ≈ TV's 1.0
      const I = (e: typeof AUDIO_RACK[number]) => on[e.id] ? Math.min(1, e.gain * srcV(e.src) * rk) : 0;
      const o = audioRackOutRef.current;
      for (const e of AUDIO_RACK) {
        const v = I(e);
        switch (e.id) {
          case "punch":   o.punch   = v * 0.55; break;   // uZoom units (0..2)
          case "strobe":  o.strobe  = v > 0.6 ? 0.9 : v * 0.75; break; // brightness lift
          case "chroma":  o.chroma  = v * 0.22; break;   // ±uRgbR / uRgbB
          case "shatter": o.shatter = v * 0.9;  break;   // uBlockGlitch
          case "sort":    o.sort    = v * 0.55; break;   // uSortAmt
          case "mosh":    o.mosh    = v * 1.6;  break;   // uDatamosh (0..5.5 scale)
          case "echo":    o.echo    = v * 0.6;  break;   // uFeedback
          case "tear":    o.tear    = v * 0.8;  break;   // uScanTear
          case "hue":     o.hue     = v * 0.35; break;   // uHueShift
        }
      }
    }
    const AR = audioRackOutRef.current;
    const _sortBase = sortAmtRef.current;
    // v1.5.3 — the beat glimmer only rides on a dialed-in sort (or AUTO-VJ), so
    // HARD RESET / RESET ALL really do return a still picture.
    const _glimmer = (_sortBase > 0.001 || vjModeRef.current) ? _aBeat * audioReactAmtRef.current * 0.22 : 0;
    const _sortAudio = Math.min(1.0, _sortBase * (1 + _aGate * 0.7) + _glimmer + AR.sort);
    // v1.2.68 — DECOUPLE the shader sort knobs from REALSORT. Previously
    // every shader knob (AMOUNT/LOW/HIGH/SEGMENT/NOISE/WOBBLE/TEAR/MODE/
    // INTERVAL/ANGLE) was multiplied by sortMix, so when REALSORT was at
    // 0 the sub-knobs felt completely dead — turning AMOUNT did literally
    // nothing. Now REALSORT only controls the CPU Asendorf cross-fade
    // (uSortMix); AMOUNT directly drives the shader sort uniform so each
    // sub-knob produces a visible, independent change.
    setF1(u.uSortAmt, _sortAudio * _mI + PB("uSortAmt"));
    setF1(u.uScanTear, scanTearRef.current * _mB + PB("uScanTear") + AR.tear);
    setF1(u.uBlockGlitch, blockGlitchRef.current * _mB + PB("uBlockGlitch") + AR.shatter);
    // Datamosh INTENS slider is 0..2. v1.3.37 — the MOSH HARD toggle is
    // gone; hardness now derives smoothly from slider position so cranking
    // the knob naturally enters the old HARD territory. Below the
    // midpoint behaves like SOFT (mult ~1.6, no baseline); above midpoint
    // smoothstep ramps mult → 2.5 and adds the 0.25 baseline. Top of
    // slider matches the previous HARD ceiling (~5.25) exactly.
    const dmBase = Math.max(0, datamoshRef.current);
    const _dmH = Math.max(0, Math.min(1, (dmBase - 0.5) / 1.0));
    const hardness = _dmH * _dmH * (3 - 2 * _dmH); // smoothstep(0.5, 1.5, dmBase)
    let dmMapped = dmBase * (1.6 + 0.9 * hardness) + 0.25 * hardness;
    // v1.2.53 — audio modulation of the datamosh rack. Pulses the
    // mapped intensity on bass/beat so the rack visibly reacts to a
    // mic stream even when the slider is partway down. Capped at the
    // HARD ceiling so we don't push past what the shader was tuned for.
    // v1.5.0 — mosh reacts multiplicatively only. The old "+ gate*0.22" floor
    // meant any steady bass moshed a still image into noise through the
    // rendered feedback loop even with INTENS at 0. Sort keeps its glimmer
    // floor (it reads the source, so it never accumulates).
    dmMapped = Math.min(5.5, dmMapped * (1 + _aGate * 0.9) + AR.mosh);
    setF1(u.uDatamosh, dmMapped * _mI + PB("uDatamosh"));
    setF1(u.uChrash, chrashRef.current * _mB + PB("uChrash"));
    setF1(u.uLiquid, liquidRef.current * _mI + PB("uLiquid"));
    // v1.2.58 — Asendorf / Gysin homage rack uniform writes (v1.2.59: streak/hilbert removed)
    setF1(u.uGlyph, glyphRef.current * _mI + PB("uGlyph"));
    setF1(u.uSortMix, sortMixRef.current * _mI);
    setF1(u.uReact, reactDRef.current * _mI + PB("uReact"));
    setF1(u.uVoroSort, voroSortRef.current * _mI + PB("uVoroSort"));
    // v1.3.61 — NOVEL CS FX uniform writes. Each knob directly drives its
    // novel shader primitive — no PB() macro overlay (these are NEW knobs,
    // not part of the v1.3.60 modulator palette).
    setF1(u.uMenkmanFX,  menkmanFXRef.current  * _mI);
    setF1(u.uMolnarFX,   molnarFXRef.current   * _mI);
    setF1(u.uUcnvFX,     ucnvFXRef.current     * _mI);
    setF1(u.uGysinFX,    gysinFXRef.current    * _mI);
    setF1(u.uAsendorfFX, asendorfFXRef.current * _mI);
    setF1(u.uJodiFX,     jodiFXRef.current     * _mI);
    setF1(u.uArcangelFX, arcangelFXRef.current * _mI);
    setF1(u.uPaikFX,     paikFXRef.current     * _mI);
    setF1(u.uFentonFX,   fentonFXRef.current   * _mI);
    // v1.3.64 — family + touch-bend
    setF1(u.uMenkmanFam,  menkmanFamRef.current);
    setF1(u.uMolnarFam,   molnarFamRef.current);
    setF1(u.uUcnvFam,     ucnvFamRef.current);
    setF1(u.uGysinFam,    gysinFamRef.current);
    setF1(u.uAsendorfFam, asendorfFamRef.current);
    setF1(u.uJodiFam,     jodiFamRef.current);
    setF1(u.uArcangelFam, arcangelFamRef.current);
    setF1(u.uPaikFam,     paikFamRef.current);
    setF1(u.uFentonFam,   fentonFamRef.current);
    setF1(u.uArtistTouch, artistTouchStrRef.current);
    setF1(u.uFeedback, Math.min(1, feedbackRef.current * _mB + PB("uFeedback") + AR.echo));
    setF1(u.uContour, contourRef.current * _mI + PB("uContour"));
    setF1(u.uAscii, asciiRef.current * _mI + PB("uAscii"));
    setF1(u.uVenetian, venetianRef.current * _mI + PB("uVenetian"));
    setF1(u.uKaleido, kaleidoRef.current * _mI + PB("uKaleido"));
    setF1(u.uTile, tileRef.current * _mI + PB("uTile"));
    setF1(u.uInvert, invertSymRef.current * _mI);
    setF1(u.uDroste, drosteRef.current * _mI + PB("uDroste"));
    setF1(u.uSpiral, spiralRef.current * _mI + PB("uSpiral"));
    setF1(u.uYantra, yantraRef.current * _mI + PB("uYantra"));
    setF1(u.uMandala, mandalaRef.current * _mI + PB("uMandala"));
    setF1(u.uRosette, rosetteRef.current * _mI);
    setF1(u.uStarfold, starfoldRef.current * _mI + PB("uStarfold"));
    setF1(u.uHexfold, hexfoldRef.current * _mI + PB("uHexfold"));
    setF1(u.uDisrupt, disruptRef.current * _mB);
    setF1(u.uDisruptCount, disruptCountRef.current);
    setF1(u.uDisruptSize, disruptSizeRef.current);
    setF1(u.uDisruptContrary, disruptContraryRef.current);
    setF1(u.uDisruptShape, disruptShapeRef.current);
    setF1(u.uSortKey, sortKeyRef.current);
    setF1(u.uSortLow, sortLowRef.current);
    setF1(u.uSortHigh, sortHighRef.current);
    setF1(u.uSortMode, sortModeRef.current);
    setF1(u.uSortSegment, sortSegmentRef.current);
    setF1(u.uSortRandom, sortRandomRef.current * _mB + PB("uSortRandom"));
    setF1(u.uSortWobble, sortWobbleRef.current * _mM + PB("uSortWobble"));
    setF1(u.uSortInterval, sortIntervalRef.current);
    setF1(u.uSortAngle, sortAngleRef.current);
    setF1(u.uRgbR, rgbRRef.current * _mB + AR.chroma);
    setF1(u.uRgbG, rgbGRef.current * _mB);
    setF1(u.uRgbB, rgbBRef.current * _mB - AR.chroma);
    setF1(u.uRgbBars, rgbBarsRef.current * _mB + PB("uRgbBars"));
    setF1(u.uRgbSwap, rgbSwapRef.current * _mB + PB("uRgbSwap"));
    setF1(u.uRupture, ruptureRef.current * _mB + PB("uRupture"));
    setF1(u.uHSync, hsyncRef.current * _mB + PB("uHSync"));
    setF1(u.uMoshIFrame, moshIFrameRef.current * _mM + PB("uMoshIFrame"));
    setF1(u.uMoshMotion, moshMotionRef.current * _mM + PB("uMoshMotion"));
    setF1(u.uMoshBleed, moshBleedRef.current * _mM + PB("uMoshBleed"));
    setF1(u.uMoshMap, moshMapRef.current * _mB);
    setF1(u.uMoshDistort, moshDistortRef.current * _mB + PB("uMoshDistort"));
    // Face FX universal mask uniforms (driven by faceFxMode + segmentation loop).
    setF1(u.uFaceActive, faceFxRef.current.active ? 1.0 : 0.0);
    setF1(u.uFaceTexValid, faceFxRef.current.texValid ? 1.0 : 0.0);
    setF2(u.uFaceCenter, faceFxRef.current.cx, faceFxRef.current.cy);
    setF1(u.uFaceRadius, faceFxRef.current.r);
    setF1(u.uFaceInvert, faceFxRef.current.invert ? 1.0 : 0.0);
    // v1.3.28 — minimal feather; user wants a near-hard mask edge
    setF1(u.uFaceFeather, 0.008);
    // v1.3.29 — faraday-style GPU dilation. MASK EXPAND slider 0..1 → 2.5..38.5 px outer ring.
    // Replaces the (now removed) CPU separable max-filter on the 256x144 mask buffer:
    //   (a) zero JS cost, so segmenter callback returns instantly and never blocks the
    //       next tick → no missed frames at 15-20 Hz cadence.
    //   (b) dilation in shader == dilation in image space at the screen's true resolution,
    //       so the silhouette covers the whole subject without aliasing-driven gaps.
    setF1(u.uFaceMaskRadius, 2.5 + Math.max(0, Math.min(1, maskExpandRef.current)) * 36.0);
    // v1.3.40 — single uniform that smoothly dims every FX under load.
    // Multiplied into the shader's universal `mask` so all gates and
    // mix() calls scale in lockstep.
    setF1(u.uFxQuality, fxQualityRef.current);

    // Phase 2a: per-mode rack params (slot 0=AMOUNT, 1=MIX, 2..7 mode-specific)
    {
      const modeId = modeRef.current as ModeId;
      const packed = packParams(modeId, paramsByModeRef.current[modeId] ?? defaultsForMode(modeId));
      if (u.uModeParams) setFv(u.uModeParams, packed);
    }

    setI1(u.uCamera, 0);
    setI1(u.uPrevFrame, 1);
    setI1(u.uMask, 2);

    // Phase 2b: real multi-layer composite via ping-pong FBOs.
    // When combo mode is on with armed layers, render each layer's mode/params
    // in sequence: layer 0 reads camera, subsequent layers read the previous
    // layer's output. The last layer renders directly to the canvas.
    const layers = comboLayersRef.current;
    // Drive each layer's gain from its corresponding knob ref so the rack
    // is silent (no displacement, no recolor) until the user dials in a value.
    // Without this, defaults of gain=1 push MOSH to full intensity over the
    // camera and produce the unwanted rainbow / inverted ghost on boot.
    const liveLayers = layers.map((L) => {
      let g = L.gain;
      if (L.mode === 7)      g = sortAmtRef.current  ?? 0;
      else if (L.mode === 9) g = datamoshRef.current ?? 0;
      return { mode: L.mode, gain: g };
    });
    const anyArmed = liveLayers.some((L) => (L.gain ?? 0) > 0.02);
    // FX SETTINGS picker (modeRef) is the GLOBAL override. Whenever the user
    // selects a non-NORMAL visual mode (NIGHT/THERMAL/EDGE/CMYK/etc.) it must
    // win over the PXL+MOSH combo rack so the chosen look is what's on screen.
    const fxOverride = (modeRef.current ?? 0) !== 0;
    const useCombo = comboModeRef.current && liveLayers.length > 0 && anyArmed && !fxOverride;
    // Combo = one unified pass in mode 0: the shader's pre-mode signal stage
    // already routes every rack uniform into the same color.
    const modeId = (useCombo ? 0 : modeRef.current) as ModeId;
    setI1(u.uMode, modeId);
    setF1(u.uGain, gainRef.current);
    if (u.uModeParams) setFv(u.uModeParams, packParams(modeId, paramsByModeRef.current[modeId] ?? defaultsForMode(modeId)));
      },
    });

    // Copy rendered framebuffer to previous frame texture for temporal feedback effects
    // v1.2.57 / v1.2.59 — Skip the full-canvas copy when no FX actually
    // samples uPrevFrame this frame. Only uDatamosh / uChrash now read
    // the previous-frame texture. When both are below their shader-side
    // thresholds the copy is wasted fillrate.

    // FPS
    const now = performance.now();

    // v1.3.70 — restore GIF capture bucket scheduler.
    // Capture only when we cross the next timing bucket so we avoid a
    // per-rAF readback while still preserving wall-clock playback timing.
    if (recordingRef.current && exportFormatRef.current === "gif") {
      const periodMs = Math.max(20, gifPeriodMsRef.current || 40);
      const elapsedMs = Math.max(0, now - gifStartTime.current);
      const bucketNow = Math.floor(elapsedMs / periodMs);
      if (bucketNow > gifBucketRef.current) {
        const crossed = bucketNow - gifBucketRef.current;
        const delayCs = Math.max(2, Math.round((crossed * periodMs) / 10));
        captureFrameRef.current?.(delayCs);
        gifBucketRef.current = bucketNow;
      }
    }

    // v1.3.51 — GIF rAF capture branch REMOVED. The per-frame
    // `getImageData` round-trip during recording forced a GPU↔CPU sync
    // every frame and was the dominant recording-mode cost. Video
    // export uses MediaRecorder against the compose canvas which keeps
    // the pipeline on the GPU.
    // v1.3.42 — UNIFIED ADAPTIVE GOVERNOR (collapsed). One closed-loop
    // controller drives every perf knob in the app. Three stages, one
    // EWMA input:
    //
    //   1. fxQualityRef: continuous proportional control in [0.30, 1.00]
    //      nudged each frame by (target - measured) / target. Multiplied
    //      into the universal shader mask via uFxQuality so EVERY FX
    //      gate / blend softens analogously when frametime overruns
    //      budget, and smoothly recovers when headroom returns. No skip
    //      frames, no binary thermal flip, no visible pulsing.
    //      Manual LOW POWER + battery-low fold in here as a 0.5 ceiling.
    //
    //   2. renderScaleRef: continuous linear mapping Q→[0.55, 1.00],
    //      rounded to the nearest 0.05 so resize() (which reallocates
    //      the GL canvas + FBOs + camera/mask textures) only fires
    //      when the bucket changes. Replaces the v1.3.40 discrete
    //      ladder + streak counters.
    //
    //   3. bootFrameRef: cold-start grace. For the first ~300 frames
    //      (~5 s @ 60 fps) the governor is pinned at 1.0 and renderScale
    //      can't leave 1.0. Fixes the v1.3.38 black-screen-after-10s
    //      class: WebView startup jank pushed the old binary slow-streak
    //      counter past its 60-frame trigger before the device was
    //      actually warm, firing resize() from inside render() into
    //      undersized camera textures. Cold-start grace makes that
    //      whole class of bug impossible by design.
    // v1.3.49 — GOVERNOR REMOVED. The unified adaptive governor
    // (v1.3.40/v1.3.42) was multiplying fxQualityRef into the universal
    // shader mask and continuously rescaling the GL canvas. Under heavy
    // FX it drove fxQuality below the smoothstep threshold inside the
    // pixel-sort block (sortBlend = mask * smoothstep(0, 0.05, uSortAmt))
    // → sort silently disappeared while renderScale resize() flashed the
    // canvas. User: "the screen is flashing and then the pixel sorting
    // goes away, remove the heatsinks that are doing that". fxQuality
    // and renderScale are now pinned to 1.0 forever; only the EWMA is
    // still tracked so the FPS readout works.
    bootFrameRef.current = Math.min(100000, bootFrameRef.current + 1);
    fxQualityRef.current = 1.0;
  }, []);
  // ── v1.3.66 — Mic capture removed.
  // The previous getUserMedia / AudioContext / analyser pipeline was
  // never reliable across Android WebView builds. The audio-react
  // shader uniforms are now driven by the Auto-VJ synthetic LFO bank
  // (see render loop, search "vjModeRef"). The audioActive boolean is
  // retained only as a no-op shim so any external references keep
  // compiling; the user-facing top-bar button now toggles vjMode.
  useEffect(() => {
    if (!audioActive) return;
    return () => { /* nothing to tear down */ };
  }, [audioActive]);

  // ── v1.3.68 Auto-VJ engine ──────────────────────────────
  // While vjMode is on:
  //   1. Try to capture mic so the existing real-audio analyser path in
  //      the render loop drives uAudio/uABass/uATreb/uABeat from actual
  //      music in the room. On denial / failure, fall back to the
  //      synthetic LFO bank in the render loop's no-analyser branch.
  //   2. Watch vjPendingCycleRef (set by the render loop on every Nth
  //      detected beat or on the watchdog timeout) and consume it by
  //      firing a cycle — this makes structural FX changes land ON the
  //      beat instead of on a fixed 7-second wall-clock interval.
  useEffect(() => {
    if (!vjMode) return;
    const r = () => Math.random();
    const tinyRoll = (max = 0.5) => (r() < 0.5 ? r() * max : 0);
    const fam = (n = 3) => Math.floor(r() * n);
    const cycleArtist = () => {
      // Pick one artist FX at a time and nudge it.
      const set: Array<[(v: number) => void, (v: number) => void]> = [
        [setMenkmanFX, setMenkmanFam],
        [setMolnarFX,  setMolnarFam],
        [setUcnvFX,    setUcnvFam],
        [setGysinFX,   setGysinFam],
        [setAsendorfFX,setAsendorfFam],
        [setJodiFX,    setJodiFam],
        [setArcangelFX,setArcangelFam],
        [setPaikFX,    setPaikFam],
        [setFentonFX,  setFentonFam],
      ];
      const i = Math.floor(r() * set.length);
      set[i][0](Math.min(1, 0.30 + r() * 0.55));
      set[i][1](fam());
    };
    const cycleGlitch = () => {
      const choices: Array<() => void> = [
        () => setSortAmt(0.3 + r() * 0.5),
        () => setDatamosh(0.3 + r() * 0.5),
        () => setRgbR((r() - 0.5) * 0.5),
        () => setRgbG((r() - 0.5) * 0.5),
        () => setRgbB((r() - 0.5) * 0.5),
        () => setRgbBars(tinyRoll(0.4)),
        () => setLiquid(tinyRoll(0.5)),
        () => setVoroSort(tinyRoll(0.5)),
        () => setRupture(tinyRoll(0.5)),
        () => setHsync(tinyRoll(0.5)),
        () => setKaleido(tinyRoll(0.4)),
        () => setSpiral(tinyRoll(0.4)),
        () => setMoshFamily(fam(4)),
        // v1.3.70 — broaden the glitch pool with the rest of the rack
        // so AUTO-VJ touches the full FX surface, not just artist + sort.
        () => setScanTear(tinyRoll(0.55)),
        () => setBlockGlitch(tinyRoll(0.55)),
        () => setChrash(tinyRoll(0.4)),
        () => setGlyph(tinyRoll(0.4)),
        () => setAscii(tinyRoll(0.35)),
        () => setMoshIFrame(r() * 0.7),
        () => setMoshMotion(r() * 0.7),
        () => setMoshBleed(r() * 0.6),
        () => setMoshDistort(tinyRoll(0.5)),
        () => setReactD(0.4 + r() * 0.5),
      ];
      choices[Math.floor(r() * choices.length)]();
    };
    // v1.3.69 — Structural morphs: swap whole genre of look (less often
    // than per-FX nudges so the picture has time to read).
    const cycleStructure = () => {
      const choices: Array<() => void> = [
        () => setMode(r() < 0.5 ? 7 : 9),
        () => setGenStyle(GEN_STYLES[Math.floor(r() * GEN_STYLES.length)] as GenStyle),
        () => setGenScatterMode(Math.floor(r() * 4)),
        () => setGenGlyphMode(Math.floor(r() * 6)),
        () => setComboMode(r() < 0.5),
        () => setGenInvert(r() < 0.35),
      ];
      choices[Math.floor(r() * choices.length)]();
    };
    // v1.3.69 — Distortion bank cycler.
    const cycleDistortion = () => {
      const choices: Array<() => void> = [
        () => setKaleido(tinyRoll(0.45)),
        () => setMandala(tinyRoll(0.4)),
        () => setYantra(tinyRoll(0.4)),
        () => setRosette(tinyRoll(0.4)),
        () => setStarfold(tinyRoll(0.4)),
        () => setHexfold(tinyRoll(0.4)),
        () => setDroste(tinyRoll(0.35)),
        () => setSpiral(tinyRoll(0.4)),
        () => setTile(tinyRoll(0.4)),
        () => setContour(tinyRoll(0.45)),
        () => setVenetian(tinyRoll(0.35)),
        () => setInvertSym(tinyRoll(0.35)),
        () => setFeedback(tinyRoll(0.5)),
        () => setDisrupt(tinyRoll(0.5)),
      ];
      choices[Math.floor(r() * choices.length)]();
    };
    // v1.3.69 — Color / motion / post nudges.
    const cyclePost = () => {
      const choices: Array<() => void> = [
        () => setScanlines(tinyRoll(0.55)),
        () => setHueShift((r() - 0.5) * 0.6),
        () => setZoom((r() - 0.5) * 0.4),
        () => setSpeed(0.4 + r() * 1.4),
        () => setBrightness(0.85 + r() * 0.4),
        () => setContrast(0.85 + r() * 0.4),
        () => setSaturation(0.7 + r() * 0.6),
        () => setGenWarp(r() * 0.7),
        () => setGenJitter(r() * 0.5),
        () => setGenMoshX((r() - 0.5) * 1.0),
        () => setGenMoshY((r() - 0.5) * 1.0),
        () => setGenScatter(r() * 0.6),
      ];
      choices[Math.floor(r() * choices.length)]();
    };
    const runCycle = () => {
      // v1.3.70 — sweep WIDER per cycle. Previous versions touched ~2-3
      // knobs per beat trigger which read as "artist-only morph" because
      // cycleArtist always fired and others picked a single item from
      // their pool. Now each helper fires multiple picks so a beat
      // visibly nudges across rack/post/distortion/structure together.
      // Pick 2 different artists per cycle.
      cycleArtist();
      cycleArtist();
      // Glitch: 1-3 picks per cycle.
      cycleGlitch();
      if (r() < 0.85) cycleGlitch();
      if (r() < 0.55) cycleGlitch();
      // Post (color / motion / scanlines / generator motion): 2 picks.
      cyclePost();
      if (r() < 0.75) cyclePost();
      // Distortion: 1-2 picks.
      cycleDistortion();
      if (r() < 0.55) cycleDistortion();
      // Structure (mode / genStyle / combo) — bumped to ~1 in 2 so the
      // visual identity actually shifts noticeably between bars.
      if (r() < 0.50) cycleStructure();
      // Occasionally fade an FX back toward zero so values don't peg max.
      if (r() < 0.35) {
        const fades = [
          setSortAmt, setDatamosh, setLiquid, setVoroSort, setRupture, setHsync,
          setKaleido, setMandala, setYantra, setRosette, setStarfold, setHexfold,
          setDroste, setSpiral, setTile, setContour, setVenetian, setFeedback,
          setDisrupt, setScanlines, setGenWarp, setGenJitter, setGenScatter,
        ];
        fades[Math.floor(r() * fades.length)](0);
        // 50% chance to fade a SECOND knob so the picture breathes.
        if (r() < 0.5) fades[Math.floor(r() * fades.length)](0);
      }
    };
    // Fire one immediate cycle so the user sees movement instantly.
    runCycle();
    // Reset beat-tracking state so cycles count from "now".
    vjBeatCountRef.current = 0;
    vjLastBeatHighRef.current = false;
    vjLastCycleAtRef.current = performance.now();
    vjPendingCycleRef.current = false;
    // Poll the pending-cycle flag set by the render loop's beat detector.
    // 80 ms is fast enough to feel "on-beat" without thrashing React state.
    const pollId = window.setInterval(() => {
      if (vjPendingCycleRef.current) {
        vjPendingCycleRef.current = false;
        runCycle();
      }
    }, 80);

    return () => { window.clearInterval(pollId); };
  }, [vjMode]);

  // ── Plug-and-play audio input (vj-io, v1.4.2) ──
  // Runs whenever AUDIO REACT is on (default). Opens the preferred input RAW
  // (no AEC / AGC / NS, stereo, 48 kHz) and follows hot-plug: a USB audio
  // interface or a DJ mixer / controller that exposes USB audio takes over
  // the analyser the moment it appears; the phone mic comes back when it is
  // unplugged. A loaded track (LOAD TRACK) keeps priority over the live input.
  useEffect(() => {
    if (audioArmed) return;
    if (cameraActive) { const t = window.setTimeout(() => setAudioArmed(true), 600); return () => window.clearTimeout(t); }
    const t = window.setTimeout(() => setAudioArmed(true), 4000);
    return () => window.clearTimeout(t);
  }, [cameraActive, audioArmed]);
  useEffect(() => {
    if (!audioReactOn || !audioArmed) return;
    if (trackAnalyserRef.current) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    let cancelled = false;
    let retries = 0;
    let retryTimer: number | null = null;
    const mgr = createAudioInputManager({
      pref: audioInPrefRef.current,
      onDevices: (list) => { if (!cancelled) setAudioInputs(list); },
      onChange: (session, reason) => {
        if (cancelled) return;
        if (!session) { setAudioInInfo(null); setAudioActive(false); return; }
        // Hand the analyser to the render loop's existing real-audio branch.
        audioAnalyserRef.current = session.analyser;
        audioDataArrayRef.current = new Uint8Array(session.analyser.fftSize);
        audioFeaturesRef.current = session.features;
        audioStreamRef.current = session.stream;
        setAudioInInfo(session.info);
        setAudioActive(true);
        try { console.log("[GPS] audio-in", reason, session.info.label, session.info.sampleRate, "Hz", session.info.channelCount, "ch", session.context.state); } catch { /* noop */ }
        if (reason === "hotplug" || reason === "pref") {
          setFaceFxToast(`AUDIO IN → ${session.info.label.toUpperCase()}`);
          window.setTimeout(() => setFaceFxToast(null), 2200);
        }
      },
      onError: (e) => {
        if (cancelled) return;
        const name = (e as { name?: string })?.name || String(e);
        try { console.warn("[GPS] audio-in error:", name, retries); } catch { /* noop */ }
        // A denial right after boot is usually the permission prompt still being
        // busy with the camera. Retry a few times before telling the user.
        if (retries < 4) {
          retries += 1;
          retryTimer = window.setTimeout(() => { retryTimer = null; if (!cancelled) void mgr.refresh(); }, 2500);
          return;
        }
        if (mgr.session) return;
        setFaceFxToast(`AUDIO IN · ${name === "NotAllowedError" ? "MIC BLOCKED — check app permissions" : name.toUpperCase()}`);
        window.setTimeout(() => setFaceFxToast(null), 3200);
      },
    });
    audioInMgrRef.current = mgr;
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      if (audioInMgrRef.current === mgr) audioInMgrRef.current = null;
      mgr.dispose();
      if (!trackAnalyserRef.current) {
        try { audioAnalyserRef.current = null; } catch { /* ignore */ }
        try { audioDataArrayRef.current = null; } catch { /* ignore */ }
        try { audioFeaturesRef.current = null; } catch { /* ignore */ }
      }
      try { audioStreamRef.current = null; } catch { /* ignore */ }
      setAudioInInfo(null);
      setAudioActive(false);
    };
  }, [audioReactOn, audioArmed]);

  // Live meter for the VJ · Audio In row — direct DOM writes, no re-render.
  const vjPanelOpen = activeTab === "vj";
  useEffect(() => {
    if (!vjPanelOpen) return;
    const id = window.setInterval(() => {
      const vals = [audioLevelRef.current, audioBassRef.current, audioBeatRef.current];
      meterRefs.current.forEach((el, i) => { if (el) el.style.width = `${Math.round(Math.min(1, Math.max(0, vals[i])) * 100)}%`; });
      const diag = audioDiagRef.current;
      if (diag) {
        const sess = audioInMgrRef.current?.session;
        const f = audioFeaturesRef.current?.features;
        const drive = audioSyntheticRef.current ? "SYNTH LFO" : f ? "LIVE" : sess ? "LIVE (legacy)" : "NO INPUT";
        diag.textContent = `${drive} · ctx ${sess?.context.state ?? "—"} · gain ×${f ? f.gain.toFixed(1) : "—"} · flux ${f ? f.flux.toFixed(2) : "—"}`;
      }
    }, 120);
    return () => window.clearInterval(id);
  }, [vjPanelOpen]);

  // ♪ in the top bar: quick link to the VJ · Audio In row (and switches
  // AUDIO REACT on if it was off).
  const openVjAudioPanel = useCallback(() => {
    if (!audioReactOn) setAudioReactOn(true);
    setActiveTab("vj");
    setVjRowFlash(true);
    window.setTimeout(() => {
      document.getElementById("gps-vj-audio-in")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    window.setTimeout(() => setVjRowFlash(false), 1800);
  }, [audioReactOn, setAudioReactOn, setActiveTab]);

  // ── Plug-and-play display output (vj-io, v1.4.1) ──
  // Android mirrors the screen to whatever is on the USB-C port (HDMI /
  // DisplayPort adapter, capture stick) or cast target. When one appears and
  // VJ OUT is on AUTO: drop the chrome so the mirrored picture is canvas-only
  // and keep the screen awake. Put everything back when it goes away.
  const vjOutAutoRef = useRef(vjOutAuto);
  useEffect(() => {
    vjOutAutoRef.current = vjOutAuto;
    try { localStorage.setItem(VJ_OUT_AUTO_KEY, vjOutAuto ? "1" : "0"); } catch { /* ignore */ }
  }, [vjOutAuto]);
  useEffect(() => {
    let wasExternal = false;
    const out = createDisplayOutput({
      onChange: (state) => {
        const external = state.externalCount > 0;
        setVjOutDisplay(external ? state : null);
        if (external === wasExternal) return;
        wasExternal = external;
        if (!vjOutAutoRef.current) return;
        setUiHidden(external);
        void out.setKeepAwake(external);
        if (Capacitor.isNativePlatform()) {
          import("@capacitor/status-bar").then(({ StatusBar }) => {
            if (external) { StatusBar.hide().catch(() => {}); StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {}); }
            else { StatusBar.show().catch(() => {}); StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {}); }
          }).catch(() => {});
        }
        const size = state.width ? ` · ${state.width}×${state.height}` : "";
        setFaceFxToast(external ? `VJ OUT → ${(state.name ?? "EXTERNAL DISPLAY").toUpperCase()}${size}` : "VJ OUT · DISPLAY DISCONNECTED");
        window.setTimeout(() => setFaceFxToast(null), 2600);
      },
    });
    return () => { void out.setKeepAwake(false); out.dispose(); };
  }, []);

  // ── (v1.3.57 — entire DRAW overlay rendering + paint pixel stamping +
  // pointer handler block removed.) ─────────────────────────────────

  // ── Camera ────────────────────────────────────────────────
  // Request camera permissions on mobile (Capacitor)
  // v1.3.2 — STOPPED probing Capacitor.Plugins.Permissions before calling
  // getUserMedia. The probe was returning a stale "denied" state on some
  // devices (the Permissions plugin contract changed in Capacitor 7 and
  // the v1.2.98 "prompt → request" path could lock users out once they
  // tapped Deny on any prior build). Native WebView's getUserMedia
  // already raises its own runtime camera prompt, so just let it through
  // and surface real errors via the catch in startCamera.
  const requestCameraPermission = useCallback(async (): Promise<boolean> => {
    return true;
  }, []);

  const getCameraStream = useCallback(async (facing: "environment" | "user") => {
    const attempts: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: facing }, audio: false },
      { video: true, audio: false },
    ];
    let lastErr: unknown = null;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
        const name = (err as Error).name;
        if (name === "NotAllowedError" || name === "SecurityError" || name === "NotReadableError") {
          throw err;
        }
      }
    }
    throw lastErr ?? new Error("Unable to access camera stream.");
  }, []);

  const releaseCameraBinding = useCallback(async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => {
        try { t.stop(); } catch {}
      });
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      try { video.pause(); } catch {}
      try { video.srcObject = null; } catch {}
      try { video.removeAttribute("src"); video.load(); } catch {}
    }
    await new Promise(resolve => setTimeout(resolve, 90));
  }, []);

  const startCamera = useCallback(async (forceRestart = false, facingOverride?: "environment" | "user") => {
    if (startCameraInFlightRef.current) return;
    startCameraInFlightRef.current = true;
    // v1.2.74 — explicit intent latch. The old intent re-check looked at
    // sourceMode === "camera", which BROKE GEN+CAM (which keeps sourceMode
    // = "generator" but turns the camera on) — startCamera bailed out
    // immediately and the camera never opened. We now set an intent flag
    // here and only honour cancellation if stopCamera() clears it.
    cameraIntentRef.current = true;
    setCameraRequesting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraActive(false);
        setSourceError("Camera API unavailable in this browser/context.");
        return;
      }
      const permGranted = await requestCameraPermission();
      if (!permGranted) {
        setCameraActive(false);
        setSourceError("Camera permission denied — allow in device settings.");
        return;
      }
      const facing = facingOverride ?? cameraFacing;
      if (!forceRestart && streamRef.current?.active && videoRef.current?.srcObject) {
        setCameraActive(true);
        setSourceError(null);
        return;
      }
      await releaseCameraBinding();
      // v1.2.53 — intent re-check. While we were awaiting permission /
      // releasing the previous binding, the user may have toggled OFF
      // both source=camera AND face FX. If so, bail out instead of
      // acquiring a stream nobody asked for (this was the source of the
      // \"camera won't come back\" stuck state when toggling fast — a
      // late-arriving stream would set cameraActive=true but no render
      // path was actually consuming it).
      if (!cameraIntentRef.current) {
        return;
      }
      const stream = await Promise.race([
        getCameraStream(facing),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(Object.assign(new Error("Camera start timed out — tap retry to try again."), { name: "TimeoutError" })), 12000)
        ),
      ]);
      // v1.2.53 — second intent check after stream resolves. If user
      // toggled away while getUserMedia was pending, stop the stream we
      // just got so we don't hold the device hostage.
      if (!cameraIntentRef.current) {
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      video.playsInline = true;
      video.muted = true;
      await video.play();
      engineRef.current?.resetSource();
      setCameraActive(true);
      setSourceError(null);
    } catch (err) {
      const msg = (err as Error).name;
      if (msg === "NotReadableError") {
        try {
          await releaseCameraBinding();
          const retryFacing = facingOverride ?? cameraFacing;
          const retryStream = await getCameraStream(retryFacing);
          streamRef.current = retryStream;
          const video = videoRef.current!;
          video.srcObject = retryStream;
          video.playsInline = true;
          video.muted = true;
          await video.play();
          engineRef.current?.resetSource();
          setCameraActive(true);
          setSourceError(null);
          return;
        } catch {}
      }
      setCameraActive(false);
      if (msg === "NotAllowedError" || msg === "SecurityError") setSourceError("Camera permission denied — allow in browser settings, then press retry.");
        else if (msg === "TimeoutError") setSourceError((err as Error).message);
      else if (msg === "NotReadableError") setSourceError("Camera is in use by another app/tab. Close it and press retry.");
      else if (msg === "NotFoundError") setSourceError("No camera found.");
      else setSourceError("Camera error — " + (err as Error).message);
    } finally {
      startCameraInFlightRef.current = false;
      setCameraRequesting(false);
    }
  }, [cameraFacing, getCameraStream, releaseCameraBinding, requestCameraPermission]);

  const stopCamera = useCallback(() => {
    cameraIntentRef.current = false;
    void releaseCameraBinding();
    setCameraActive(false);
  }, [releaseCameraBinding]);

  const flipCamera = useCallback(async () => {
    const next = cameraFacing === "environment" ? "user" : "environment";
    setCameraFacing(next);
    if (cameraActive) {
      await startCamera(true, next);
    }
  }, [cameraFacing, cameraActive, startCamera]);

  const hardResetCamera = useCallback(async () => {
    setSourceError(null);
    await releaseCameraBinding();
    const fallbackFacing = cameraFacing === "environment" ? "user" : "environment";
    await startCamera(true, fallbackFacing);
  }, [cameraFacing, releaseCameraBinding, startCamera]);

  // ── Upload source ─────────────────────────────────────────
  const clearUploadSource = useCallback(() => {
    if (uploadVideoRef.current) {
      try { uploadVideoRef.current.pause(); } catch {}
      uploadVideoRef.current.removeAttribute("src");
      try { uploadVideoRef.current.load(); } catch {}
      uploadVideoRef.current = null;
    }
    if (uploadImgRef.current) {
      uploadImgRef.current.src = "";
      uploadImgRef.current = null;
    }
    if (uploadObjectUrlRef.current) {
      try { URL.revokeObjectURL(uploadObjectUrlRef.current); } catch {}
      uploadObjectUrlRef.current = null;
    }
    setUploadName(null);
    setUploadKind(null);
  }, []);

  const handleUploadFile = useCallback((file: File) => {
    if (!file) return;
    setSourceError(null);
    clearUploadSource();
    const url = URL.createObjectURL(file);
    uploadObjectUrlRef.current = url;
    const isVideo = file.type.startsWith("video/");
    if (isVideo) {
      const v = document.createElement("video");
      v.src = url;
      v.loop = true;
      v.muted = true;
      v.playsInline = true;
      v.crossOrigin = "anonymous";
      v.addEventListener("loadeddata", () => { engineRef.current?.resetSource(); });
      v.play().catch(() => { /* user gesture not required since muted */ });
      uploadVideoRef.current = v;
      setUploadKind("video");
    } else {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = url;
      img.addEventListener("load", () => { engineRef.current?.resetSource(); });
      uploadImgRef.current = img;
      setUploadKind("image");
    }
    setUploadName(file.name);
    setSourceMode("upload");
    // Free the camera while we render an upload (prevents permission churn).
    if (cameraActiveRef.current) {
      void releaseCameraBinding();
      setCameraActive(false);
    }
  }, [clearUploadSource, releaseCameraBinding]);

  useEffect(() => {
    return () => { clearUploadSource(); };
  }, [clearUploadSource]);

  const resetSettings = useCallback(async () => {
    // Return to default single-pass "normal view" and clear FX triggers.
    setComboMode(true);
    setComboLayers([{mode:7,gain:1},{mode:9,gain:1}]);
    setMode(0);
    setGain(0.5);

    // ── Post-process knobs back to identity
    setBrightness(1.0);
    setContrast(1.0);
    setSaturation(1.0);
    setHueShift(0.0);
    setScanlines(0.0);
    setZoom(0.0);
    setSpeed(1.0);

    setSortAmt(0.0);
    setScanTear(0.0);
    setBlockGlitch(0.0);
    setDatamosh(0.0);
    setMoshHard(false);
    setChrash(0.0);
    setLiquid(0.0);
    setFeedback(0.0);
    setContour(0.0);
    setAscii(0.0);
    setVenetian(0.0);
    setKaleido(0.0);
    setDisrupt(0.0);
    setDisruptCount(0.4);
    setDisruptSize(0.4);
    setDisruptContrary(1.0);
    setTile(0.0);
    setInvertSym(0.0);
    setDroste(0.0);
    setSpiral(0.0);
    setYantra(0.0);
    setMandala(0.0);
    setRosette(0.0);
    setStarfold(0.0);
    setHexfold(0.0);
    setSortKey(0);
    setSortLow(0.35);
    setSortHigh(0.92);
    setSortMode(0);
    setSortSegment(0.35);
    setSortRandom(0.18);
    setSortWobble(0.12);
    setMoshIFrame(0.7);
    setMoshMotion(0.55);
    setMoshBleed(0.45);
    setMoshMap(0.0);
    setMoshDistort(0.5);

    // ── AUTOMATE off; rate to default
    setAutomateOn(false);
    setAutomateRate(0.45);
    setAutomateStyles(false);
    setAutomateBlend(false);

    // ── Generator knobs back to defaults
    setGenStyle("BAYER");
    setGenResolution(48);
    setGenDensity(0.55);
    setGenScale(1.0);
    setGenSpeed(0.6);
    setGenHue(0.78);
    setGenHueSpread(0.35);
    setGenSat(0.85);
    setGenContrastG(0.7);
    setGenWarp(0.25);
    setGenJitter(0.15);
    setGenSeed(7);
    setGenInvert(false);
    setGenMoshX(0);
    setGenMoshY(0);
    setGenScatter(0);
    setGenScatterMode(0);
    setGenBlend("AVG");
    setGenPalette("MONO");
    setGenAutoCycle(false);

    // ── Audio off (mic) so the camera goes back to fully passive
    setAudioActive(false);
    // ── Low-power off so reset = vanilla performance baseline
    setLowPowerOn(false);
    // ── v1.3.43: macros back to 1.0 (pass-through)
    setIntensityMacro(1.0);
    setMotionMacro(1.0);
    setColorMacro(1.0);
    setBreakMacro(1.0);

    setParamsByMode(defaultsForAllModes());
    setSourceMode("camera");
    // v1.2.46: reset matches the new boot state — user-facing.
    setCameraFacing("user");
    setSourceError(null);
    clearUploadSource();
    touchRef.current.active = false;
    // v1.5.4 — RAW CAMERA. The old reset left sort / mosh sub-knobs at demo
    // values and never touched the homage knobs, RGB shift, artist primitives,
    // glitch palette, generator mix, macros or AUTO-VJ. Everything to neutral:
    setSortLow(0.0); setSortHigh(1.0); setSortSegment(0.0); setSortRandom(0.0); setSortWobble(0.0);
    setSortInterval(0); setSortAngle(0);
    setMoshIFrame(0.0); setMoshMotion(0.0); setMoshBleed(0.0); setMoshMap(0.0); setMoshDistort(0.0); setMoshFamily(0);
    setGlyph(0); setSortMix(0); setReactD(0); setVoroSort(0);
    setRgbR(0); setRgbG(0); setRgbB(0); setRgbBars(0); setRupture(0); setHsync(0);
    setMenkmanFX(0); setMolnarFX(0); setUcnvFX(0); setGysinFX(0); setAsendorfFX(0);
    setJodiFX(0); setArcangelFX(0); setPaikFX(0); setFentonFX(0);
    setMenkmanFam(0); setMolnarFam(0); setUcnvFam(0); setGysinFam(0); setAsendorfFam(0);
    setJodiFam(0); setArcangelFam(0); setPaikFam(0); setFentonFam(0);
    setGlitchPresetEnabled(false);
    setVjMode(false);
    setGenMix(0); setGenScatter(0);
    setIntensityMacro(1.0); setMotionMacro(1.0); setColorMacro(1.0); setBreakMacro(1.0);
    setFaceFxMode("OFF");
    setFaceFxToast("RESET → RAW CAMERA");
    window.setTimeout(() => setFaceFxToast(null), 1800);
  }, [clearUploadSource, startCamera]);

  // ── GIF export ────────────────────────────────────────────
  // Find the back-half frame whose downsampled luma is closest to the
  // first frame, and return frames[0..bestIdx]. We compare on a fixed
  // 32×32 luma grid sampled by stride, so cost is O(N · 1024) — trivial
  // even for 200+ frames. Using SAD (sum of absolute differences) on luma
  // is robust against minor color drift and far cheaper than full-RGB
  // comparison. The first 50% of the recording is excluded from the
  // search so we never trim too aggressively (loops shorter than half
  // the recording usually look samey).

  // Snap a requested fps to the closest cadence GIF can actually play
  // back. GIF frame delays are stored in centiseconds (1cs = 10ms), so
  // valid playback rates are 100/Nfor integer N>=2 (i.e. 50, 33.3, 25,
  // 20, ...). If the encoded delay does not match the capture cadence,
  // the GIF visibly speeds up or slows down vs the live preview.
  const snapGifFps = (requested: number): { fps: number; delayCs: number } => {
    const delayCs = Math.max(2, Math.round(100 / requested));
    return { fps: 100 / delayCs, delayCs };
  };

  const captureFrame = useCallback((delayCs: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !engineRef.current) return;
    const w = canvas.width, h = canvas.height;
    const maxDim = getGifProfile(exportQuality).maxDim;
    const { w: gw, h: gh } = getExportDimensions(w, h, exportProfile, maxDim);
    gifSizeRef.current = { w: gw, h: gh };
    const tmp = document.createElement("canvas");
    tmp.width = gw; tmp.height = gh;
    const ctx = tmp.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    composeFrame(ctx, gw, gh);
    gifFrames.current.push(ctx.getImageData(0, 0, gw, gh).data.slice() as unknown as Uint8ClampedArray);
    // Per-frame delay (centiseconds). render() computes this from the
    // number of bucket boundaries crossed since the last capture, so a
    // missed bucket (slow render frame) produces a proportionally longer
    // encoded delay -> playback motion stays true to wall-clock instead
    // of the GIF speeding up to compensate for dropped frames.
    gifDelaysRef.current.push(Math.max(2, delayCs | 0));
    const elapsed = performance.now() - gifStartTime.current;
    const recordCapMs = Math.min(MAX_RECORD_MS, recordMaxSecRef.current * 1000);
    if (elapsed >= recordCapMs && recordingRef.current) stopRecordingRef.current();
  }, [composeFrame, exportProfile, exportQuality, getExportDimensions, getGifProfile]);
  // Pin a ref to the latest captureFrame so render() (which is wrapped
  // in useCallback with [] deps) can call it without a stale closure.
  useEffect(() => { captureFrameRef.current = captureFrame; }, [captureFrame]);

  const startVideoRecording = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // v1.3.69 — initialize the elapsed-time anchor BEFORE drawLoop starts.
    // Without this, gifStartTime stayed at its useRef(0) initial value and
    // the first frame's `elapsed = now - 0` was orders of magnitude greater
    // than the recording cap, so the recorder fired stop() immediately and
    // REC produced empty / 0-byte files.
    gifStartTime.current = performance.now();
    const w = canvas.width;
    const h = canvas.height;
    const maxDim = getExportMaxDim(exportQuality);
    const { w: vw, h: vh } = getExportDimensions(w, h, exportProfile, maxDim);

    const out = document.createElement("canvas");
    out.width = vw;
    out.height = vh;
    videoComposeCanvasRef.current = out;
    const ctx = out.getContext("2d");
    if (!ctx) return;

    // Throttle the compose draw to the requested record FPS instead of
    // running every rAF. The previous code did a `imageSmoothingQuality:
    // "high"` upscale + WebGL→CPU readback on every browser frame, which
    // tanked the live preview to ~4fps on integrated GPUs.
    const fpsAtStart = recordFpsRef.current;
    const targetMs = 1000 / fpsAtStart;
    // Manual-mode capture stream: passing 0 disables the browser's own
    // periodic sampling. We then call `videoTrack.requestFrame()` exactly
    // once after each composeFrame() draw, guaranteeing 1:1 correspondence
    // between rendered frames and recorded frames — no doubling, no drops.
    const stream = out.captureStream(0);
    const videoTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    let frameIndex = 0;
    const startTs = performance.now();
    const drawLoop = () => {
      const src = canvasRef.current;
      if (!src) return;
      const now = performance.now();
      const elapsed = now - gifStartTime.current;
      const recordCapMs = Math.min(MAX_RECORD_MS, recordMaxSecRef.current * 1000);
      if (elapsed >= recordCapMs) {
        stopRecordingRef.current();
        return;
      }
      // Self-correcting scheduler: emit frame N when its scheduled time
      // (startTs + N*targetMs) has arrived. Catches up if the page was
      // briefly throttled (background tab, GC pause) without drifting.
      const sinceStart = now - startTs;
      const wantFrame = Math.floor(sinceStart / targetMs);
      if (wantFrame >= frameIndex) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "medium";
        composeFrame(ctx, vw, vh);
        try { videoTrack?.requestFrame?.(); } catch { /* not all browsers */ }
        frameIndex = wantFrame + 1;
      }
      videoComposeRafRef.current = requestAnimationFrame(drawLoop);
    };
    // Mix in microphone audio if the user has it active. Without this the
    // exported video was always silent even when the live preview was
    // reacting to sound — making music videos impossible to render.
    const aStream = audioStreamRef.current;
    if (aStream) {
      try {
        for (const t of aStream.getAudioTracks()) stream.addTrack(t);
      } catch { /* ignore — stream still records video */ }
    }
    // Prefer MP4/H.264 when the WebView supports it (Android 13+ and
    // most modern Chromium builds do). Falls back to WebM/VP9/VP8 for
    // older devices. Saving as `.mp4` makes the file directly usable in
    // iOS Photos, social-media uploads, and most editors — .webm is
    // rejected by a lot of consumer pipelines.
    const mime = MediaRecorder.isTypeSupported("video/mp4;codecs=h264,aac")
      ? "video/mp4;codecs=h264,aac"
      : MediaRecorder.isTypeSupported("video/mp4;codecs=avc1,mp4a.40.2")
        ? "video/mp4;codecs=avc1,mp4a.40.2"
        : MediaRecorder.isTypeSupported("video/mp4")
          ? "video/mp4"
          : MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
            ? "video/webm;codecs=vp9,opus"
            : MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
              ? "video/webm;codecs=vp9"
              : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
                ? "video/webm;codecs=vp8,opus"
                : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
                  ? "video/webm;codecs=vp8"
                  : "video/webm";

    const rec = new MediaRecorder(stream, { mimeType: mime });
    videoChunksRef.current = [];
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) videoChunksRef.current.push(ev.data);
    };
    rec.onstop = () => {
      cancelAnimationFrame(videoComposeRafRef.current);
      stream.getTracks().forEach(t => t.stop());
      videoComposeCanvasRef.current = null;
      const blob = new Blob(videoChunksRef.current, { type: rec.mimeType || "video/webm" });
      if (blob.size === 0) { setProcessingStatus(null); return; }
      // Derive extension from the actual mime so MP4 files end in .mp4
      // and WebM fallbacks end in .webm — keeps the system file picker /
      // gallery happy.
      const isMp4 = (rec.mimeType || "").toLowerCase().includes("mp4");
      const ext = isMp4 ? "mp4" : "webm";
      const filename = `gps-${(MODES.find(m => m.id === mode)?.short ?? "PXL").toLowerCase()}-${Date.now()}.${ext}`;
      setProcessingStatus({ label: "Saving video…" });
      saveBlobToDevice(blob, filename).finally(() => setProcessingStatus(null));
    };

    videoComposeRafRef.current = requestAnimationFrame(drawLoop);
    rec.start(200);
    videoRecorderRef.current = rec;
  }, [composeFrame, exportProfile, exportQuality, getExportDimensions, getExportMaxDim, mode]);

  const startRecording = useCallback(() => {
    if (recordingRef.current) return;
    recordingRef.current = true;
    setRecording(true);
    setRecordingHint(getRecordingHintText(exportFormat, exportQuality, exportProfile));
    if (recordingHintTimerRef.current) clearTimeout(recordingHintTimerRef.current);
    recordingHintTimerRef.current = setTimeout(() => setRecordingHint(null), 2000);
    if (exportFormat === "video") {
      startVideoRecording();
      return;
    }

    // GIF path: reset buffers and schedule capture from render() buckets.
    gifFrames.current = [];
    gifDelaysRef.current = [];
    gifSizeRef.current = null;
    const snapped = snapGifFps(recordFpsRef.current);
    gifFpsRef.current = snapped.fps;
    gifDelayCsRef.current = snapped.delayCs;
    gifPeriodMsRef.current = snapped.delayCs * 10;
    gifBucketRef.current = 0;
    gifStartTime.current = performance.now();

    // Capture a first frame immediately so short takes still encode.
    captureFrameRef.current?.(snapped.delayCs);
  }, [exportFormat, exportProfile, exportQuality, getRecordingHintText, startVideoRecording]);

  const stopRecording = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    if (gifInterval.current) {
      clearInterval(gifInterval.current);
      gifInterval.current = null;
    }
    if (gifTimeoutRef.current) {
      clearTimeout(gifTimeoutRef.current);
      gifTimeoutRef.current = null;
    }
    setRecording(false);
    setRecordingHint(null);
    if (recordingHintTimerRef.current) {
      clearTimeout(recordingHintTimerRef.current);
      recordingHintTimerRef.current = null;
    }
    if (exportFormat === "video") {
      const rec = videoRecorderRef.current;
      videoRecorderRef.current = null;
      if (rec && rec.state !== "inactive") rec.stop();
      return;
    }
    const frames = gifFrames.current.slice();
    const delays = gifDelaysRef.current.slice();
    gifFrames.current = [];
    gifDelaysRef.current = [];
    if (frames.length < 2) return;
    setProcessingStatus({ label: `Encoding GIF (${frames.length} frames)…` });
    const size = gifSizeRef.current;
    if (!size) { setProcessingStatus(null); return; }
    const { w: gw, h: gh } = size;
    // Encode off the main thread (gps-engine/gif): frame buffers are
    // transferred to a Worker, which applies the perfect-loop trim (delays
    // trimmed in parallel — v1.3.31 per-frame cadence) and encodes. Inline
    // fallback if Workers are unavailable; identical output either way.
    gifFrames.current = [];
    encodeGifAsync({ gw, gh, frames, delayCs: delays, dither: gifDitherRef.current, perfectLoop: perfectLoopRef.current })
      .then((data) => {
        const blob = new Blob([data as unknown as BlobPart], { type: "image/gif" });
        const filename = `gps-${(MODES.find(m => m.id === mode)?.short ?? "PXL").toLowerCase()}-${Date.now()}.gif`;
        setProcessingStatus({ label: "Saving GIF…" });
        return saveBlobToDevice(blob, filename);
      })
      .catch((e) => { console.warn("[GPS] GIF export failed", e); })
      .finally(() => setProcessingStatus(null));
  }, [exportFormat, mode]);

  useEffect(() => {
    return () => {
      if (recordingHintTimerRef.current) clearTimeout(recordingHintTimerRef.current);
    };
  }, []);

  // v1.2.71 — hands-free record: 3-2-1 count-IN, auto-record for a fixed
  // 60 s with a per-second mid-shoot timer, last 3 s shown as a 3-2-1
  // count-OUT, then auto-stop. Tap again at any phase to cancel/stop.
  const startHandsFree = useCallback(() => {
    if (handsFreeTimerRef.current != null) {
      window.clearTimeout(handsFreeTimerRef.current);
      handsFreeTimerRef.current = null;
    }
    if (recordingRef.current) {
      stopRecordingRef.current();
      setHandsFreeCountdown(null);
      return;
    }
    if (handsFreeCountdown != null) {
      setHandsFreeCountdown(null);
      return;
    }
    // Force a 60 s take regardless of the EXPORT panel selection — dancers
    // need the runway and 60 s is the studio-tier ceiling already.
    setRecordMaxSec(60);
    recordMaxSecRef.current = 60;
    let n = 3;
    setHandsFreeCountdown({ phase: "in", n });
    const tickIn = () => {
      n -= 1;
      if (n <= 0) {
        startRecordingRef.current();
        let remaining = HANDS_FREE_SEC;
        setHandsFreeCountdown({ phase: "rec", n: remaining });
        const tickRec = () => {
          remaining -= 1;
          if (remaining <= 0) {
            stopRecordingRef.current();
            setHandsFreeCountdown(null);
            handsFreeTimerRef.current = null;
            return;
          }
          const phase: "rec" | "out" = remaining <= 3 ? "out" : "rec";
          setHandsFreeCountdown({ phase, n: remaining });
          handsFreeTimerRef.current = window.setTimeout(tickRec, 1000);
        };
        handsFreeTimerRef.current = window.setTimeout(tickRec, 1000);
      } else {
        setHandsFreeCountdown({ phase: "in", n });
        handsFreeTimerRef.current = window.setTimeout(tickIn, 1000);
      }
    };
    handsFreeTimerRef.current = window.setTimeout(tickIn, 1000);
  }, [handsFreeCountdown]);

  const captureStill = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Source resolution: prefer the highest available true source.
    // - video: native videoWidth/videoHeight
    // - upload (video / image): natural dimensions
    // - generator: the generator canvas (rendered at output resolution)
    // Fall back to the live WebGL canvas backing store.
    const vid = videoRef.current;
    const upV = uploadVideoRef.current;
    const upI = uploadImgRef.current;
    const gen = genCanvasRef.current;
    const mode = sourceModeRef.current;
    let nativeW = canvas.width;
    let nativeH = canvas.height;
    if (mode === "camera" && vid && vid.videoWidth > 0) {
      nativeW = vid.videoWidth; nativeH = vid.videoHeight;
    } else if (mode === "upload" && upV && upV.videoWidth > 0) {
      nativeW = upV.videoWidth; nativeH = upV.videoHeight;
    } else if (mode === "upload" && upI && upI.naturalWidth > 0) {
      nativeW = upI.naturalWidth; nativeH = upI.naturalHeight;
    } else if (mode === "generator" && gen) {
      nativeW = gen.width; nativeH = gen.height;
    }

    // Apply EXPORT settings: quality (max dim) + profile (aspect).
    const maxDim = getExportMaxDim(exportQuality);
    const { w: outW, h: outH } = getExportDimensions(nativeW, nativeH, exportProfile, maxDim);

    const tmp = document.createElement("canvas");
    tmp.width = outW; tmp.height = outH;
    const ctx = tmp.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Composite the live shader output + overlays + draw layer (with the
    // same hard-light blend as the on-screen <canvas>) so the captured
    // still matches the preview pixel-for-pixel.
    composeFrame(ctx, outW, outH);

    // Flash feedback
    setFlashVisible(true);
    setTimeout(() => setFlashVisible(false), 150);

    const useJpeg = exportQuality === "standard";
    tmp.toBlob(blob => {
      if (!blob) return;
      const ext = useJpeg ? "jpg" : "png";
      const filename = `gps-${outW}x${outH}-${Date.now()}.${ext}`;
      setProcessingStatus({ label: "Saving photo…" });
      saveBlobToDevice(blob, filename).finally(() => setProcessingStatus(null));
    }, useJpeg ? "image/jpeg" : "image/png", useJpeg ? 0.92 : undefined);
  }, [composeFrame, exportProfile, exportQuality, getExportDimensions, getExportMaxDim]);

  // Assign gesture callback refs after functions are declared
  startRecordingRef.current = startRecording;
  stopRecordingRef.current = stopRecording;
  captureStillRef.current = captureStill;

  const buildPreset = useCallback((name: string): SpectraPreset => ({
    name,
    mode,
    gain,
    brightness,
    contrast,
    saturation,
    hueShift,
    scanlines,
    zoom,
    speed,
    sortAmt,
    scanTear,
    blockGlitch,
    datamosh,
    moshHard,
    chrash,
    liquid,
    feedback,
    contour,
    ascii,
    venetian,
    kaleido,
    disrupt,
    disruptCount,
    disruptSize,
    disruptContrary,
    tile,
    invertSym,
    droste,
    spiral,
    yantra,
    mandala,
    rosette,
    starfold,
    hexfold,
    sortKey,
    sortLow,
    sortHigh,
    sortMode,
    sortSegment,
    sortRandom,
    sortWobble,
    moshIFrame,
    moshMotion,
    moshBleed,
    moshMap,
    moshDistort,
    paramsByMode,
  }), [mode, gain, brightness, contrast, saturation, hueShift, scanlines, zoom, speed, sortAmt, scanTear, blockGlitch, datamosh, moshHard, chrash, liquid, feedback, contour, ascii, venetian, sortKey, sortLow, sortHigh, sortMode, sortSegment, sortRandom, sortWobble, moshIFrame, moshMotion, moshBleed, moshMap, moshDistort, paramsByMode, kaleido, disrupt, disruptCount, disruptSize, disruptContrary, tile, invertSym, droste, spiral, yantra, mandala, rosette, starfold, hexfold]);

  const applyPreset = useCallback((p: SpectraPreset) => {
    setMode(p.mode);
    setGain(p.gain);
    setBrightness(p.brightness);
    setContrast(p.contrast);
    setSaturation(p.saturation);
    setHueShift(p.hueShift);
    setScanlines(p.scanlines);
    setZoom(p.zoom);
    setSpeed(p.speed);
    setSortAmt(p.sortAmt);
    setScanTear(p.scanTear);
    setBlockGlitch(p.blockGlitch);
    setDatamosh(p.datamosh);
    setMoshHard(!!p.moshHard);
    setChrash(p.chrash);
    setLiquid(p.liquid);
    setFeedback(p.feedback);
    setContour(p.contour);
    setAscii(p.ascii);
    setVenetian(p.venetian);
    setKaleido(p.kaleido ?? 0.0);
    setDisrupt(p.disrupt ?? 0.0);
    setDisruptCount(p.disruptCount ?? 0.4);
    setDisruptSize(p.disruptSize ?? 0.4);
    setDisruptContrary(p.disruptContrary ?? 1.0);
    setTile(p.tile ?? 0.0);
    setInvertSym(p.invertSym ?? 0.0);
    setDroste(p.droste ?? 0.0);
    setSpiral(p.spiral ?? 0.0);
    setYantra(p.yantra ?? 0.0);
    setMandala(p.mandala ?? 0.0);
    setRosette(p.rosette ?? 0.0);
    setStarfold(p.starfold ?? 0.0);
    setHexfold(p.hexfold ?? 0.0);
    setSortKey(p.sortKey ?? 0);
    setSortLow(p.sortLow ?? 0.35);
    setSortHigh(p.sortHigh ?? 0.92);
    setSortMode(p.sortMode ?? 0);
    setSortSegment(p.sortSegment ?? 0.35);
    setSortRandom(p.sortRandom ?? 0.18);
    setSortWobble(p.sortWobble ?? 0.12);
    setMoshIFrame(p.moshIFrame ?? 0.7);
    setMoshMotion(p.moshMotion ?? 0.55);
    setMoshBleed(p.moshBleed ?? 0.45);
    setMoshMap(p.moshMap ?? 0.0);
    setMoshDistort(p.moshDistort ?? 0.5);
    if (p.paramsByMode && typeof p.paramsByMode === "object") {
      const merged = defaultsForAllModes();
      for (const m of MODES) {
        const stored = p.paramsByMode[m.id];
        if (stored && typeof stored === "object") {
          merged[m.id] = { ...merged[m.id], ...stored };
        }
      }
      setParamsByMode(merged);
    }
    setComboMode(true);
    setComboLayers([{mode:7,gain:1},{mode:9,gain:1}]);
  }, []);

  const savePreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) return;
    setPresets(prev => {
      const next = [...prev.filter(p => p.name.toLowerCase() !== name.toLowerCase()), buildPreset(name)];
      localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
      return next;
    });
    setPresetName("");
  }, [presetName, buildPreset]);

  const deletePreset = useCallback((name: string) => {
    setPresets(prev => {
      const next = prev.filter(p => p.name !== name);
      localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
      return next;
    });
    setQuickSlots(prev => {
      const next = prev.map(v => v === name ? null : v);
      localStorage.setItem(QUICK_SLOTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const assignQuickSlot = useCallback((slotIndex: number, name: string) => {
    setQuickSlots(prev => {
      const next = [...prev];
      next[slotIndex] = name;
      localStorage.setItem(QUICK_SLOTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const autoAssignQuickSlot = useCallback((name: string) => {
    setQuickSlots(prev => {
      const next = [...prev];
      const existing = next.findIndex(v => v === name);
      if (existing >= 0) {
        localStorage.setItem(QUICK_SLOTS_KEY, JSON.stringify(next));
        return next;
      }
      const empty = next.findIndex(v => !v);
      next[empty >= 0 ? empty : 0] = name;
      localStorage.setItem(QUICK_SLOTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const filteredPresets = presets;

  const captureAB = useCallback(() => {
    setAbSnapshot(buildPreset("__ab__"));
  }, [buildPreset]);

  const applyAB = useCallback(() => {
    if (abSnapshot) applyPreset(abSnapshot);
  }, [abSnapshot, applyPreset]);
  void assignQuickSlot; void captureAB; void applyAB;

  const saveProject = useCallback(() => {
    const project = {
      version: "spectra-v1" as const,
      mode, gain, brightness, contrast, saturation, hueShift, scanlines, zoom, speed,
      sortAmt, scanTear, blockGlitch, datamosh, moshHard, chrash, liquid,
      feedback, contour, ascii, venetian,
      kaleido, disrupt, disruptCount, disruptSize, disruptContrary,
      tile, invertSym, droste, spiral, yantra, mandala, rosette, starfold, hexfold,
      sortKey, sortLow, sortHigh, sortMode, sortSegment, sortRandom, sortWobble,
      moshIFrame, moshMotion, moshBleed, moshMap, moshDistort,
      exportFormat, exportQuality, exportProfile,
      openSections: Array.from(openSections),
      paramsByMode,
      presets,
      quickSlots,
    };
    const json = JSON.stringify(project, null, 2);
    const filename = `gps-${Date.now()}.gps`;
    const isNative = (() => {
      try { return Capacitor.isNativePlatform?.() === true; } catch { return false; }
    })();
    if (isNative) {
      // v1.2.92 — native: write to Documents/GlitchPixelStudio/projects/
      // and pop the share sheet so the user can copy/email/move it.
      (async () => {
        try {
          const path = `GlitchPixelStudio/projects/${filename}`;
          const written = await Filesystem.writeFile({
            path,
            data: json,
            directory: Directory.Documents,
            recursive: true,
            encoding: Encoding.UTF8,
          });
          try {
            await Share.share({
              title: "GPS Project",
              text: filename,
              url: written.uri,
              dialogTitle: "Save / share GPS project",
            });
          } catch { /* user cancelled share — file is still written */ }
          try {
            window.dispatchEvent(new CustomEvent("gps-saved", {
              detail: { filename, path: `Documents/${path}` },
            }));
          } catch {}
        } catch (err) {
          void err;
          try {
            window.dispatchEvent(new CustomEvent("gps-saved", {
              detail: { filename, path: "save failed" },
            }));
          } catch {}
        }
      })();
      return;
    }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [mode, gain, brightness, contrast, saturation, hueShift, scanlines, zoom, speed,
      sortAmt, scanTear, blockGlitch, datamosh, moshHard, chrash, liquid,
      feedback, contour, ascii, venetian, sortKey, sortLow, sortHigh,
      sortMode, sortSegment, sortRandom, sortWobble, moshIFrame, moshMotion,
      moshBleed, moshMap, moshDistort, exportFormat, exportQuality,
      exportProfile, openSections, paramsByMode, presets, quickSlots]);

  const loadProject = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p: any = JSON.parse(ev.target?.result as string);
        if (!p || p.version !== "spectra-v1") return;
        applyPreset({
          name: "__load__",
          mode: (p.mode ?? 0) as ModeId,
          gain: p.gain ?? 0.5,
          brightness: p.brightness ?? 1.0,
          contrast: p.contrast ?? 1.0,
          saturation: p.saturation ?? 1.0,
          hueShift: p.hueShift ?? 0.0,
          scanlines: p.scanlines ?? 0.0,
          zoom: p.zoom ?? 0.0,
          speed: p.speed ?? 1.0,
          sortAmt: p.sortAmt ?? 0.0,
          scanTear: p.scanTear ?? 0.0,
          blockGlitch: p.blockGlitch ?? 0.0,
          datamosh: p.datamosh ?? 0.0,
          moshHard: !!p.moshHard,
          chrash: p.chrash ?? 0.0,
          liquid: p.liquid ?? 0.0,
          feedback: p.feedback ?? 0.0,
          contour: p.contour ?? 0.0,
          ascii: p.ascii ?? 0.0,
          venetian: p.venetian ?? 0.0,
          kaleido: p.kaleido ?? 0.0,
          disrupt: p.disrupt ?? 0.0,
          disruptCount: p.disruptCount ?? 0.4,
          disruptSize: p.disruptSize ?? 0.4,
          disruptContrary: p.disruptContrary ?? 1.0,
          tile: p.tile ?? 0.0,
          invertSym: p.invertSym ?? 0.0,
          droste: p.droste ?? 0.0,
          spiral: p.spiral ?? 0.0,
          yantra: p.yantra ?? 0.0,
          mandala: p.mandala ?? 0.0,
          rosette: p.rosette ?? 0.0,
          starfold: p.starfold ?? 0.0,
          hexfold: p.hexfold ?? 0.0,
          sortKey: p.sortKey ?? 0,
          sortLow: p.sortLow ?? 0.35,
          sortHigh: p.sortHigh ?? 0.92,
          sortMode: p.sortMode ?? 0,
          sortSegment: p.sortSegment ?? 0.35,
          sortRandom: p.sortRandom ?? 0.18,
          sortWobble: p.sortWobble ?? 0.12,
          moshIFrame: p.moshIFrame ?? 0.7,
          moshMotion: p.moshMotion ?? 0.55,
          moshBleed: p.moshBleed ?? 0.45,
          moshMap: p.moshMap ?? 0.0,
          moshDistort: p.moshDistort ?? 0.5,
          paramsByMode: (p.paramsByMode && typeof p.paramsByMode === "object") ? p.paramsByMode : undefined,
        });
        setExportFormat(p.exportFormat === "gif" || p.exportFormat === "video" ? p.exportFormat : exportFormat);
        setExportQuality(p.exportQuality ?? "high");
        setExportProfile(p.exportProfile ?? "native");
        if (Array.isArray(p.openSections)) setOpenSections(new Set<string>(p.openSections as string[]));
        if (Array.isArray(p.presets)) {
          setPresets(p.presets as SpectraPreset[]);
          localStorage.setItem(PRESETS_KEY, JSON.stringify(p.presets));
        }
        if (Array.isArray(p.quickSlots)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const qs: Array<string | null> = Array.from({ length: 8 }, (_: any, i: number) =>
            typeof p.quickSlots[i] === "string" ? p.quickSlots[i] as string : null
          );
          setQuickSlots(qs);
          localStorage.setItem(QUICK_SLOTS_KEY, JSON.stringify(qs));
        }
      } catch {}
    };
    reader.readAsText(file);
  }, [applyPreset]);

  // ── Lifecycle ────────────────────────────────────────────
  useEffect(() => {
    if (!bootDone) return;
    const ok = initGL();
    if (!ok) return;
    const sched = createScheduler({
      render,
      onScaleChange: () => resize(),
      onFps: (fps) => setFps(fps),
      // v1.3.49: fxQuality / renderScale pinned at 1.0 — no adaptive scaling.
      adaptiveResolution: false,
    });
    schedulerRef.current = sched;
    resize();
    window.addEventListener("resize", resize);
    sched.start();
    // v1.2.54: the loop parks itself while hidden (Capacitor fires
    // visibilitychange on background). Kick it back off on return.
    const onVisChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") sched.resume();
    };
    document.addEventListener("visibilitychange", onVisChange);
    return () => {
      sched.stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisChange);
      schedulerRef.current = null;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootDone]);

  // Auto-start camera when source mode wants the camera, OR when face FX
  // is engaged on a non-camera source (v1.2.51 composite path needs the
  // camera + segmenter running underneath gen/upload so the person can be
  // cut out and laid over the source).
  // v1.2.53: removed the cleanup that reset startCameraInFlightRef — it
  // allowed multiple in-flight startCamera() calls to stack when the user
  // toggled sourceMode/faceFxMode quickly, racing two getUserMedia()
  // requests against the same video element and leaving the camera in a
  // stuck state where the next manual retry was needed to recover. The
  // in-flight flag now naturally clears in startCamera()'s finally block.
  useEffect(() => {
    if (!bootDone) return;
    if (sourceMode === "camera" || faceFxMode !== "OFF") {
      void startCamera();
    } else if (cameraActive) {
      stopCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootDone, sourceMode, faceFxMode]);

  // v1.3.14 — CAMERA WATCHDOG. The default boot state is GEN+CAM+FACE
  // (gen on subject, camera as background). If the very first
  // startCamera() call after boot loses a race (permission prompt
  // dismissed late, getUserMedia stalled, WebView not ready) the user
  // sees "just gen" full-screen forever because nothing re-arms the
  // camera. Ditto after a resume where the recover() path silently
  // failed. This watchdog runs every 2.5s: if we *want* a camera
  // (sourceMode==camera OR faceFx armed) but cameraActive is false and
  // no startCamera is currently in-flight, kick startCamera again.
  useEffect(() => {
    if (!bootDone) return;
    const iv = window.setInterval(() => {
      const wantsCam = sourceModeRef.current === "camera" || faceFxModeRef.current !== "OFF";
      if (!wantsCam) return;
      if (startCameraInFlightRef.current) return;
      const stream = streamRef.current;
      const live = !!stream && stream.active && (stream.getVideoTracks?.() ?? []).some(t => t.readyState === "live");
      if (live && cameraActive) return;
      try { console.warn("[GPS] camera watchdog: re-arming startCamera (wantsCam=true, active=", cameraActive, ", live=", live, ")"); } catch {}
      void startCamera(true);
    }, 2500);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootDone, cameraActive]);

  // v1.2.96 — Resume handler. When the user backgrounds the app and
  // returns (without a hard kill), Android may have torn down the camera
  // tracks even though our React state still says cameraActive=true. The
  // result was a frozen black/glitched preview until the user toggled CAM.
  // We now listen for both the WebView visibilitychange AND the Capacitor
  // App appStateChange event — on resume, if a camera is wanted but the
  // underlying MediaStream is no longer live, force-restart it.
  useEffect(() => {
    if (!bootDone) return;
    const wantsCamera = () =>
      sourceModeRef.current === "camera" || faceFxModeRef.current !== "OFF";
    const streamDead = () => {
      const s = streamRef.current;
      if (!s) return true;
      if (!s.active) return true;
      const tracks = s.getVideoTracks?.() ?? [];
      if (tracks.length === 0) return true;
      return tracks.every(t => t.readyState === "ended" || !t.enabled);
    };
    const recover = () => {
      if (!wantsCamera()) return;
      // v1.3.10 — UNCONDITIONAL re-init on resume. The streamDead probe
      // gave false negatives on Android (tracks reported readyState=
      // "live" but were actually frozen, so we never restarted and the
      // preview stayed broken until the user toggled CAM manually).
      // Always tear down + restart and re-kick the segmenter; both ops
      // are cheap and the user's "closing app breaks it" report
      // correlates 1:1 with that false-negative path.
      if (faceFxModeRef.current !== "OFF") {
        setFaceFxKick((k) => k + 1);
      }
      void startCamera(true);
    };
    const onVis = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      // Small delay so the WebView has a chance to settle on resume.
      setTimeout(recover, 120);
    };
    document.addEventListener("visibilitychange", onVis);
    let removeAppListener: (() => void) | null = null;
    (async () => {
      try {
        if (!Capacitor.isNativePlatform?.()) return;
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("appStateChange", (state: { isActive: boolean }) => {
          if (state?.isActive) setTimeout(recover, 120);
        });
        removeAppListener = () => { try { handle.remove(); } catch {} };
      } catch {
        // @capacitor/app not available — visibilitychange path still covers it.
      }
    })();
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (removeAppListener) removeAppListener();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootDone]);

  useEffect(() => {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as SpectraPreset[];
      if (Array.isArray(parsed)) setPresets(parsed);
    } catch {}
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem(QUICK_SLOTS_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Array<string | null>;
      if (Array.isArray(parsed)) {
        const fixed = Array.from({ length: 8 }, (_, i) => typeof parsed[i] === "string" ? parsed[i] : null);
        setQuickSlots(fixed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    try {
      const s = JSON.parse(raw) as SessionStateV1;
      if (!s || typeof s !== "object") return;
      // Spectra startup policy: boot into GEN + CAM with Face FX (FACE) every
      // time so PXL/MOSH and the FX rack always have a real composite to
      // chew on by default. v1.2.97 — previously this restore path forced
      // sourceMode="camera" with no faceFxMode reset, so a warm relaunch
      // dropped users into camera-only with no person rotoscope, even
      // though the cold-launch defaults were GEN+CAM+FACE. Now matches
      // the cold default exactly.
      setMode(0);
      setComboMode(true);
      setComboLayers([{mode:7,gain:1},{mode:9,gain:1}]);
      setSourceMode("generator");
      setFaceFxMode("FACE");
      setGenPalette("MONO");
      setGenAutoCycle(false);
      // v1.2.46: boot user-facing for the same reason as the state default.
      setCameraFacing("user");

      setGain(0.5);
      setBrightness(1.0);
      setContrast(1.0);
      setSaturation(1.0);
      setHueShift(0.0);
      setScanlines(0.0);
      setZoom(0.0);
      setSpeed(1.0);

      setSortAmt(0.0);
      setScanTear(0.0);
      setBlockGlitch(0.0);
      setDatamosh(0.0);
      setMoshHard(false);
      setChrash(0.0);
      setLiquid(0.0);
      setFeedback(0.0);
      setContour(0.0);
      setAscii(0.0);
      setVenetian(0.0);
      setKaleido(0.0);
      setDisrupt(0.0);
      setDisruptCount(0.4);
      setDisruptSize(0.4);
      setDisruptContrary(1.0);
      setTile(0.0);
      setInvertSym(0.0);
      setDroste(0.0);
      setSpiral(0.0);
      setYantra(0.0);
      setMandala(0.0);
      setRosette(0.0);
      setStarfold(0.0);
      setHexfold(0.0);
      setSortKey(0);
      setSortLow(0.35);
      setSortHigh(0.92);
      setSortMode(0);
      setSortSegment(0.35);
      setSortRandom(0.18);
      setSortWobble(0.12);
      setMoshIFrame(0.7);
      setMoshMotion(0.55);
      setMoshBleed(0.45);
      setMoshMap(0.0);
      setMoshDistort(0.5);
      setParamsByMode(defaultsForAllModes());

      setExportFormat(s.exportFormat ?? exportFormat);
      setExportQuality(s.exportQuality ?? exportQuality);
      setExportProfile(s.exportProfile ?? exportProfile);
      if (Array.isArray(s.openSections)) setOpenSections(new Set(s.openSections));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const payload: SessionStateV1 = {
      mode,
      gain,
      brightness,
      contrast,
      saturation,
      hueShift,
      scanlines,
      zoom,
      speed,
      sortAmt,
      scanTear,
      blockGlitch,
      datamosh,
      moshHard,
      chrash,
      liquid,
      feedback,
      contour,
      ascii,
      venetian,
      kaleido,
      disrupt,
      disruptCount,
      disruptSize,
      disruptContrary,
      tile,
      invertSym,
      droste,
      spiral,
      yantra,
      mandala,
      rosette,
      starfold,
      hexfold,
      sortKey,
      sortLow,
      sortHigh,
      sortSegment,
      sortRandom,
      sortWobble,
      moshIFrame,
      moshMotion,
      moshBleed,
      moshMap,
      moshDistort,
      exportFormat,
      exportQuality,
      exportProfile,
      openSections: Array.from(openSections),
      paramsByMode,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  }, [
    mode, gain, brightness, contrast, saturation, hueShift, scanlines, zoom, speed,
    sortAmt, scanTear, blockGlitch, datamosh, moshHard, chrash, liquid,
    feedback, contour, ascii, venetian,
    kaleido, disrupt, disruptCount, disruptSize, disruptContrary,
    tile, invertSym, droste, spiral, yantra, mandala, rosette, starfold, hexfold,
    sortKey, sortLow, sortHigh,
    sortSegment, sortRandom, sortWobble, moshIFrame, moshMotion,
    moshBleed, moshMap, moshDistort, exportFormat, exportQuality,
    exportProfile, openSections,
    paramsByMode,
  ]);

  // ── Phase 1B: per-mode rack hydrate + debounced save ───────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RACK_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as Record<string, Record<string, number>>;
      if (!stored || typeof stored !== "object") return;
      const merged = defaultsForAllModes();
      for (const m of MODES) {
        const entry = stored[String(m.id)];
        if (entry && typeof entry === "object") {
          merged[m.id] = { ...merged[m.id], ...entry };
        }
      }
      setParamsByMode(merged);
    } catch (err) {
      console.warn("[spectra] failed to load rack params", err);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(RACK_KEY, JSON.stringify(paramsByMode));
      } catch (err) {
        console.warn("[spectra] failed to save rack params", err);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [paramsByMode]);

  // ── Phase 1B: rack helpers (kept minimal — only persistence still active) ─
  // Note: the rack UI (ModeRack/SliderRow) was removed when SpectraAfter was
  // stripped to PXL+MOSH+GEN. paramsByMode persistence stays for legacy save
  // files but the per-mode update helpers are no longer wired into the UI.

  // v1.3.37 — hslToHex + the rainbow-cycle interval useEffect removed.
  // Both only existed to power the never-shipped color-cycle DRAW UI.

  // ── Device motion / accelerometer → accelEnergyRef ───────────────────────
  useEffect(() => {
    let active = true;
    let listening = false;
    let prevAx = 0, prevAy = 0, prevAz = 0;
    let requestMotion: (() => void) | null = null;

    const addMotionListener = () => {
      if (listening) return;
      listening = true;
      window.addEventListener("devicemotion", handleMotion, { passive: true });
    };

    function handleMotion(e: DeviceMotionEvent) {
      if (!active) return;
      const acc = e.accelerationIncludingGravity;
      if (!acc) return;
      const ax = acc.x ?? 0, ay = acc.y ?? 0, az = acc.z ?? 0;
      const rawDelta = (Math.abs(ax - prevAx) + Math.abs(ay - prevAy) + Math.abs(az - prevAz)) / 36;
      const delta = Math.min(1, Math.max(0, rawDelta - 0.04));
      accelEnergyRef.current = accelEnergyRef.current * 0.9 + delta * 0.1;
      accelTiltXRef.current = accelTiltXRef.current * 0.92 + Math.max(-1, Math.min(1, ax / 9.8)) * 0.08;
      accelTiltYRef.current = accelTiltYRef.current * 0.92 + Math.max(-1, Math.min(1, ay / 9.8)) * 0.08;
      accelPushRef.current = accelPushRef.current * 0.82 + delta * 0.18;
      prevAx = ax; prevAy = ay; prevAz = az;
    }

    // iOS 13+ requires a user-gesture permission request; bind it to first tap.
    const dme = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof dme.requestPermission === "function") {
      requestMotion = () => {
        dme.requestPermission?.().then((state: string) => {
          if (state === "granted" && active) addMotionListener();
        }).catch(() => { /* permission denied – graceful no-op */ });
      };
      window.addEventListener("pointerdown", requestMotion, { once: true, passive: true });
    } else {
      addMotionListener();
    }

    return () => {
      active = false;
      window.removeEventListener("devicemotion", handleMotion);
      if (requestMotion) window.removeEventListener("pointerdown", requestMotion);
    };
  }, []);

  const layerArmed = (id: ModeId) => comboMode && comboLayers.some(l => l.mode === id);
  void layerArmed; // referenced indirectly via comboLayers in shader path



  // ── Render ───────────────────────────────────────────────
  // Layer modes were removed — both PXL and MOSH are always live and
  // combineable. The per-effect AMOUNT/INTENS knobs gate contribution.
  const showSortRack = true;
  const showMoshRack = true;
  void showSortRack; void showMoshRack;
  const modeLabel = MODES.find(m => m.id === mode)?.label ?? "NORMAL";
  const camStatus = cameraActive ? "active" : cameraRequesting ? "requesting" : sourceError ? "error" : "idle";
  const camStatusColor = camStatus === "active" ? "#52C97A" : camStatus === "requesting" ? "#E8A020" : camStatus === "error" ? "#E03D3D" : "rgba(200,180,220,0.35)";

  return (
    <div
      ref={tiltRootRef}
      className={"flex flex-col h-dvh overflow-hidden text-white" + (neonMode ? " neon-mode" : "") + (uiHidden ? " ui-hidden" : "") + " skin-neon"}
      style={{ fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)", background: "#000" }}
    >
      <style>{`
        /* v1.2.76 — IMMERSIVE / HIDE-UI mode. */
        .ui-hidden .sp-panel-glass { display: none !important; }
        .ui-hidden .sp-canvas-pane { height: 100dvh !important; flex: 1 1 auto !important; }

        /* v1.2.76 — PHONE LANDSCAPE reflow (Tailwind lg: is desktop-only).
           v1.2.77 — widened: drop the 600px height clamp so taller phones
           (Pixel 8 Pro, foldables, etc.) also reflow on rotate. We still
           guard with max-width:1023px so we never fight the desktop lg: layout. */
        @media (orientation: landscape) and (max-height: 600px) {
          /* v1.2.81 — switched gate from (max-width:1023px) to
             (max-height:600px). On modern phones in landscape the CSS
             width can be 900\u20131180px which sometimes missed the old
             query; height in landscape is reliably <600px. This guarantees
             the reflow fires on every phone in landscape orientation,
             regardless of width. */
          .sp-body { flex-direction: row !important; }
          .landscape-row { flex-direction: row !important; }
          .sp-canvas-pane {
            flex: 1 1 0 !important;
            width: auto !important;
            height: 100% !important;
            min-height: 0 !important;
            min-width: 0 !important;
          }
          /* Inline style on inner wrapper pins aspectRatio:1/1 which would
             collapse the canvas to a square sized off the SHORT landscape
             height. Override so the canvas fills the entire pane. */
          .sp-canvas-pane > div {
            aspect-ratio: auto !important;
            width: 100% !important;
            height: 100% !important;
            max-width: 100% !important;
            max-height: 100% !important;
          }
          .sp-panel-glass {
            flex: 0 0 17rem !important;
            width: 17rem !important;
            height: 100% !important;
          }
        }

        /* ── 2.5D SLOT-MACHINE WHEEL FOR SYNTHPANELS ──
           The settings pane is the wheel container; each .sp-rack is a slot
           that gets perspective-tilted in JS based on distance from center.
           Scroll-snap pulls the nearest rack into the centered position. */
        .sp-panel-glass {
          /* v1.5.4 — plain scrolling; the 2.5D snap wheel is retired. */
          /* v1.2.62 — reserve room for the Android gesture-nav bar at the
             bottom of the device. Without this, the last controls in an
             open section (RECORD button, CAM HARD RESET, etc.) sit
             underneath the system gesture area and can't be tapped. */
          padding-bottom: max(env(safe-area-inset-bottom, 0px), 16px);
        }
        .sp-rack {
          transition: transform 160ms cubic-bezier(.22,.9,.32,1.2),
                      opacity   160ms ease,
                      padding   180ms ease,
                      margin    180ms ease;
          transform-style: preserve-3d;
          backface-visibility: hidden;
        }
        /* Open rack pulls forward and stays flat so its content is fully
           usable while the wheel still tilts the neighbours away. */
        .sp-rack.sp-rack-open {
          transform: translate3d(0, 0, 0) rotateX(0deg) scale(1.03) !important;
          opacity: 1 !important;
          z-index: 2;
        }
        /* Pop-up animation: when an inner workspace mounts (rack opened),
           it grows from a flat slab into the full panel and fades in.
           When the rack closes, React unmounts the inner so the chassis
           collapses back via the transition above — the perceived
           "minimize" effect. */
        @keyframes sp-rack-pop {
          0%   { transform: translateY(-6px) scaleY(0.6); opacity: 0; filter: blur(2px); }
          60%  { transform: translateY(1px)  scaleY(1.02); opacity: 1; filter: blur(0); }
          100% { transform: translateY(0)    scaleY(1);    opacity: 1; filter: blur(0); }
        }
        /* v1.3.65 — recording shutter button glow pulse */
        @keyframes spRecPulse {
          0%, 100% { box-shadow: 0 0 18px rgba(224,61,61,0.85), 0 0 36px rgba(224,61,61,0.40); }
          50%      { box-shadow: 0 0 28px rgba(224,61,61,1.00), 0 0 60px rgba(224,61,61,0.65); }
        }
        .sp-rack-inner {
          transform-origin: top center;
          animation: sp-rack-pop 220ms cubic-bezier(.22,1.2,.36,1) both;
          will-change: transform, opacity;
        }
        /* Closed rack: chevron + title-only, very tight footprint. */
        .sp-rack.sp-rack-closed {
          opacity: 0.85;
        }
        /* ── NEON MODE — CHUNKY GLASS EVERYTHING + tilt parallax ──
           Strategy: keep the original flex layout (so nothing
           can escape the body region), but overlap the panel
           upward over the bottom of the camera with a negative
           margin so the backdrop-filter blur has actual pixels
           behind it to blur. Then turn EVERY button, tile, and
           panel surface into a chunky frosted-glass slab so the
           live FX bleed through the entire UI. */
        .neon-mode .sp-canvas-pane {
          height: 70dvh !important;
          transform: translate3d(calc(var(--tilt-tx, 0px) * -0.4), calc(var(--tilt-ty, 0px) * -0.4), 0);
          transition: transform 0.05s linear;
          will-change: transform;
        }
        /* GLASS-BOTTOM-BOAT: in NEON the camera/image fills the entire
           body region and the panel floats over the bottom as glass.
           This makes the FX read full-bleed under the controls. */
        .neon-mode .sp-body { position: relative !important; }
        .neon-mode .sp-canvas-pane {
          position: absolute !important;
          inset: 0 !important;
          height: auto !important;
          z-index: 0;
        }
        .neon-mode .sp-canvas-pane > div {
          aspect-ratio: auto !important;
          width: 100% !important;
          height: 100% !important;
          max-width: none !important;
          max-height: none !important;
        }
        .neon-mode .sp-panel-glass {
          margin-top: 0 !important;
          position: absolute !important;
          left: 0; right: 0;
          /* v1.2.62 — anchor above the Android gesture-nav bar so the
             EXPORT panel's RECORD button isn't swallowed by the system
             gesture area. Falls back to 0 on iOS/desktop where the env
             var is 0. */
          bottom: env(safe-area-inset-bottom, 0px);
          /* Carousel is capped to 1/4 of the viewport so the camera/FX
             always reads at ≥ 75% full. The wheel uses heavy z-depth
             (see .sp-rack transform in JS) so off-center racks recede
             instead of needing more vertical scroll real-estate. */
          /* v1.5.4 — the rack gets half the screen (was 24dvh, which left a
             sliver under the tabs). The camera stays full-bleed behind it. */
          max-height: 56dvh;
          overflow-y: auto;
          overscroll-behavior: contain;
          z-index: 5;
          /* v1.2.49 — full glass-bottom-boat: drop the panel tint to a
             whisper so the FX layer reads through almost unobstructed.
             The blur + tilt do the heavy visual lifting now. */
          /* v1.5.4 — readable over a bright feed: real tint + stronger blur
             (was 2–8% tint, which made labels vanish over white). */
          background: linear-gradient(180deg, rgba(15,0,28,0.78) 0%, rgba(10,0,22,0.84) 38%, rgba(8,0,18,0.90) 100%) !important;
          backdrop-filter: blur(10px) saturate(1.15);
          -webkit-backdrop-filter: blur(10px) saturate(1.15);
          border-top: 1px solid rgba(231,174,255,0.35) !important;
          box-shadow:
            0 -10px 36px rgba(176,20,240,0.25),
            inset 0 1px 0 rgba(255,255,255,0.18),
            inset 0 -1px 0 rgba(0,0,0,0.4);
          transform: none;
          transition: background 0.3s ease, max-height 0.28s ease;
          will-change: transform;
        }

        /* v1.2.49 — racks themselves were fully-opaque deep purple
           chassis (the biggest opacity offender); make them whisper
           glass too so the FX layer reads through every rack body and
           inner workspace. Inline gradient stays for the lg/dock layout
           where racks aren't in glass mode. */
        .neon-mode .sp-rack {
          background: linear-gradient(180deg,
            rgba(42,10,74,0.10) 0%,
            rgba(26,5,48,0.08) 60%,
            rgba(15,2,32,0.12) 100%) !important;
          backdrop-filter: blur(2px) saturate(1.15);
          -webkit-backdrop-filter: blur(2px) saturate(1.15);
          border: 1px solid rgba(231,174,255,0.18) !important;
          box-shadow:
            0 4px 14px rgba(0,0,0,0.35),
            inset 0 1px 0 rgba(255,255,255,0.05) !important;
        }
        .neon-mode .sp-rack-inner {
          background:
            repeating-linear-gradient(90deg, rgba(255,255,255,0.012) 0 1px, transparent 1px 3px),
            linear-gradient(180deg, rgba(28,28,34,0.08) 0%, rgba(20,20,26,0.06) 50%, rgba(14,14,20,0.10) 100%) !important;
          backdrop-filter: blur(1.5px) saturate(1.1);
          -webkit-backdrop-filter: blur(1.5px) saturate(1.1);
          border: 1px solid rgba(231,174,255,0.10) !important;
          box-shadow:
            inset 0 1px 2px rgba(0,0,0,0.35),
            inset 0 -1px 0 rgba(255,255,255,0.03) !important;
        }
        @media (min-width: 1024px) {
          .neon-mode .sp-canvas-pane {
            height: auto !important;
            margin-right: -10rem !important;
          }
          .neon-mode .sp-panel-glass {
            margin-top: 0 !important;
            border-top: none !important;
            border-left: 1px solid rgba(231,174,255,0.55) !important;
            box-shadow:
              -10px 0 36px rgba(176,20,240,0.25),
              inset 1px 0 0 rgba(255,255,255,0.18),
              inset -1px 0 0 rgba(0,0,0,0.4);
          }
        }
        /* CHUNKY GLASS BUTTONS — sp-btn (top nav + small) and sp-tile
           (preset/export pads). Override any inline backgrounds with
           a translucent purple/pink frost and stack inset bevels for
           that "thick poured glass" feel. */
        .neon-mode .sp-btn,
        .neon-mode .sp-tile,
        .neon-mode button.sp-btn,
        .neon-mode button.sp-tile {
          /* v1.2.49 — buttons go nearly clear; just bevel + border define them. */
          background: linear-gradient(180deg,
            rgba(80,30,120,0.04) 0%,
            rgba(20,5,40,0.02) 50%,
            rgba(8,0,18,0.04) 100%) !important;
          backdrop-filter: blur(1.5px) saturate(1.1);
          -webkit-backdrop-filter: blur(1.5px) saturate(1.1);
          border: 1px solid rgba(231,174,255,0.40) !important;
          border-radius: 6px !important;
          color: rgba(255,235,255,0.98) !important;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.45),
            inset 0 -2px 0 rgba(0,0,0,0.45),
            inset 0 0 18px rgba(176,20,240,0.22),
            0 4px 14px rgba(176,20,240,0.32),
            0 0 0 1px rgba(255,180,255,0.10) !important;
          /* Crisp halo around every glyph so text stays legible over
             whatever colors are pumping through behind it. */
          text-shadow:
            0 0 4px rgba(0,0,0,0.95),
            0 0 2px rgba(0,0,0,0.95),
            0 1px 0 rgba(0,0,0,0.85) !important;
          transition: transform 0.08s ease, box-shadow 0.18s ease, background 0.18s ease;
        }
@media (hover: hover) and (pointer: fine) {
        .neon-mode .sp-btn:hover,
        .neon-mode .sp-tile:hover {
          background: linear-gradient(180deg,
            rgba(120,40,170,0.18) 0%,
            rgba(40,15,75,0.10) 50%,
            rgba(20,0,40,0.18) 100%) !important;
          border-color: rgba(255,200,255,0.85) !important;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.42),
            inset 0 -2px 0 rgba(0,0,0,0.5),
            inset 0 0 32px rgba(255,80,255,0.28),
            0 6px 20px rgba(255,40,255,0.42),
            0 0 0 1px rgba(255,200,255,0.12) !important;
        }
        }
        .neon-mode .sp-btn:active,
        .neon-mode .sp-tile:active,
        .neon-mode .sp-panel-glass button:active {
          /* v1.2.50 — hold-to-magnify: button pops to 1.35× while held
             instead of pressing down. Lifts above siblings + glows so
             the user knows exactly which control they have. */
          transform: scale(1.35);
          z-index: 50;
          position: relative;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.5),
            inset 0 -2px 0 rgba(0,0,0,0.5),
            0 10px 22px rgba(176,20,240,0.55),
            0 0 0 1px rgba(255,200,255,0.25) !important;
        }
        .neon-mode .sp-btn,
        .neon-mode .sp-tile,
        .neon-mode .sp-panel-glass button {
          transition: transform 160ms cubic-bezier(.2,.9,.25,1.1),
                      box-shadow 160ms ease,
                      background 160ms ease,
                      border-color 160ms ease;
          transform-origin: center center;
        }
        /* Beef text contrast against the live FX backdrop. */
        .neon-mode .sp-panel-glass button,
        .neon-mode .sp-panel-glass label,
        .neon-mode .sp-panel-glass span {
          text-shadow: 0 0 3px rgba(0,0,0,0.9), 0 1px 0 rgba(0,0,0,0.8);
        }
        /* CHUNKY GLASS — applies to EVERY button inside the rack panel,
           not just the explicitly-classed sp-btn / sp-tile pads. Most
           generator / mode / palette buttons have inline-style only,
           and we want them all to read as the same poured-glass slabs.
           These rules are last so !important wins over inline styles. */
        .neon-mode .sp-panel-glass button {
          /* v1.2.49 — in-rack buttons match the new whisper-glass tint. */
          background: linear-gradient(180deg,
            rgba(80,30,120,0.04) 0%,
            rgba(20,5,40,0.02) 50%,
            rgba(8,0,18,0.05) 100%) !important;
          backdrop-filter: blur(1.5px) saturate(1.1);
          -webkit-backdrop-filter: blur(1.5px) saturate(1.1);
          border: 1px solid rgba(231,174,255,0.35) !important;          border-radius: 6px !important;
          color: rgba(255,235,255,0.98) !important;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.40),
            inset 0 -2px 0 rgba(0,0,0,0.45),
            inset 0 0 18px rgba(176,20,240,0.22),
            0 4px 12px rgba(176,20,240,0.32) !important;
          text-shadow:
            0 0 4px rgba(0,0,0,0.95),
            0 0 2px rgba(0,0,0,0.95),
            0 1px 0 rgba(0,0,0,0.85) !important;
        }
@media (hover: hover) and (pointer: fine) {
        .neon-mode .sp-panel-glass button:hover {
          background: linear-gradient(180deg,
            rgba(120,40,170,0.18) 0%,
            rgba(40,15,75,0.10) 50%,
            rgba(20,0,40,0.20) 100%) !important;
          border-color: rgba(255,200,255,0.8) !important;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.45),
            inset 0 -2px 0 rgba(0,0,0,0.5),
            inset 0 0 30px rgba(255,80,255,0.28),
            0 6px 18px rgba(255,40,255,0.42) !important;
        }
        }
        /* PHOTO button must float ABOVE the glass panel in NEON mode
           so the user can still snap a still while controls overlay
           the bottom of the canvas. Bumped to z-index 10. */
        .neon-mode .sp-photo-btn-neon {
          position: fixed !important;
          right: 12px !important;
          bottom: calc(56dvh + 12px) !important;
          z-index: 10 !important;
          transition: bottom 0.28s ease;
        }
        .neon-mode .sp-panel-glass.glass-expanded ~ * .sp-photo-btn-neon,
        body:has(.neon-mode .sp-panel-glass.glass-expanded) .sp-photo-btn-neon {
          bottom: calc(55dvh + 12px) !important;
        }
        /* v1.5.0 — SELECTED state. The glass rule above pins background /
           border / color with !important on every rack button, which hid
           the inline "active" styles entirely in NEON: a chosen tile looked
           exactly like its neighbours. Every selectable tile now carries
           aria-pressed, and this rule (later, more specific) lights it. */
        .neon-mode .sp-panel-glass button[aria-pressed="true"] {
          background: linear-gradient(180deg,
            rgba(200,64,255,0.62) 0%,
            rgba(130,24,190,0.50) 50%,
            rgba(60,0,100,0.58) 100%) !important;
          border: 1px solid rgba(255,205,255,0.98) !important;
          color: #FFFFFF !important;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.55),
            inset 0 0 18px rgba(255,120,255,0.38),
            0 0 14px rgba(200,64,255,0.75),
            0 2px 6px rgba(0,0,0,0.6) !important;
          text-shadow: 0 0 8px rgba(255,140,255,0.95), 0 1px 0 rgba(0,0,0,0.8) !important;
        }
        /* SynthPanel borders + Knob caps in NEON mode also get a hint
           of glass so the rack chrome itself melts into the panel
           rather than staying opaque metal-textured slab. */
        .neon-mode .sp-panel-glass [style*="border"] {
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
        }
        /* SynthPanel chassis + brushed-metal inner workspace go GLASS
           in NEON so the rack frames don't block the FX. The deep
           purple chassis becomes a translucent purple film and the
           brushed-metal interior becomes a subtle dark wash. */
        .neon-mode .sp-rack {
          background: linear-gradient(180deg,
            rgba(42,10,74,0.18) 0%,
            rgba(26,5,48,0.14) 60%,
            rgba(15,2,32,0.20) 100%) !important;
          backdrop-filter: blur(3px) saturate(1.25);
          -webkit-backdrop-filter: blur(3px) saturate(1.25);
          border: 1px solid rgba(231,174,255,0.28) !important;
          box-shadow:
            0 6px 18px rgba(176,20,240,0.20),
            inset 0 1px 0 rgba(255,255,255,0.10),
            inset 0 -2px 4px rgba(0,0,0,0.35) !important;
        }
        .neon-mode .sp-rack-inner {
          background: linear-gradient(180deg,
            rgba(28,28,34,0.22) 0%,
            rgba(20,20,26,0.16) 50%,
            rgba(14,14,20,0.24) 100%) !important;
          backdrop-filter: blur(2px);
          -webkit-backdrop-filter: blur(2px);
          box-shadow:
            inset 0 2px 4px rgba(0,0,0,0.40),
            inset 0 -1px 0 rgba(255,255,255,0.08) !important;
          border: 1px solid rgba(231,174,255,0.18) !important;
        }
        /* Sliders + range inputs get a glassy track too. */
        .neon-mode input[type="range"] {
          background: rgba(20,5,40,0.35) !important;
          border-radius: 6px;
          box-shadow:
            inset 0 1px 2px rgba(0,0,0,0.6),
            inset 0 -1px 0 rgba(255,255,255,0.08),
            0 0 0 1px rgba(231,174,255,0.35);
        }
        /* Top-nav NEON button glow when active (overrides chunky glass
           with a brighter pink). */
        .neon-mode .topnav-neon-on,
        .topnav-neon-on {
          color: rgba(255,200,255,1) !important;
          border-color: rgba(255,140,255,0.95) !important;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.5),
            inset 0 -2px 0 rgba(0,0,0,0.5),
            inset 0 0 36px rgba(255,80,255,0.45),
            0 0 18px rgba(255,80,255,0.7),
            0 0 4px rgba(255,180,255,0.6) inset !important;
          text-shadow: 0 0 8px rgba(255,80,255,0.95);
        }

      `}</style>
      {introVisible && <SpectraIntro onDone={() => setIntroWantsClose(true)} />}
      <BugReportModal open={bugOpen} onClose={() => setBugOpen(false)} />
      <WalkthroughModal
        open={walkthroughOpen}
        onClose={closeWalkthrough}
        onRateApp={() => openExternalLink(PLAY_STORE_URL)}
        onOpenPrivacy={() => openExternalLink(PRIVACY_URL)}
        onOpenTerms={() => openExternalLink(TERMS_URL)}
        onCaptureScreenshot={() => { try { captureStillRef.current(); } catch { /* ignore */ } }}
      />
      <BootScreen progress={bootProgress} done={bootDone} onSkip={() => { setBootProgress(100); setBootDone(true); }} />

      {/* Runtime error overlay — only shows if window.error or unhandled
          rejection fires. Lets us see crashes instead of a blank screen. */}
      {runtimeError && (
        <div
          style={{
            position: "fixed", left: 8, right: 8, bottom: 8, zIndex: 99999,
            background: "rgba(40,0,8,0.96)",
            border: "1px solid rgba(255,80,120,0.7)",
            color: "rgba(255,210,210,0.98)",
            fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)", fontSize: 10,
            padding: 10, borderRadius: 4,
            maxHeight: "40vh", overflowY: "auto",
            boxShadow: "0 0 20px rgba(255,40,80,0.5)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <strong style={{ letterSpacing: 2 }}>RUNTIME ERROR</strong>
            <button
              onClick={() => setRuntimeError(null)}
              style={{ background: "transparent", border: "1px solid rgba(255,210,210,0.5)", color: "inherit", padding: "2px 8px", cursor: "pointer", fontSize: 9 }}
            >DISMISS ✕</button>
          </div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{runtimeError}</pre>
        </div>
      )}

      {/* v1.2.72 — HANDS-FREE floating button removed; lives back in the
          EXPORT panel next to RECORD. The big top pill obfuscated other
          UI controls, so we only keep the big-numeral overlay below. */}

      {/* v1.2.71 — HANDS-FREE big-numeral overlay. Three phases:
          IN (gold, 3-2-1 pre-record), REC (small persistent secs-left
          pill mid-shoot, no big numeral), OUT (red 3-2-1 final-3-secs
          warning so the dancer holds the pose). Pointer-transparent so
          the floating top button stays tappable for cancel. */}
      {handsFreeCountdown != null && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 99999,
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
            background: handsFreeCountdown.phase === "rec"
              ? "transparent"
              : (handsFreeCountdown.phase === "out"
                  ? "radial-gradient(circle at center, rgba(40,5,12,0.45) 0%, rgba(15,5,28,0.0) 60%)"
                  : "radial-gradient(circle at center, rgba(15,5,28,0.35) 0%, rgba(15,5,28,0.0) 60%)"),
          }}
        >
          {handsFreeCountdown.phase === "rec" ? (
            <div style={{
              position: "absolute", top: 96, left: "50%",
              transform: "translateX(-50%)",
              fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
              fontSize: 16, letterSpacing: "3px",
              color: "rgba(255,210,210,0.95)",
              padding: "6px 14px",
              border: "1px solid rgba(255,80,120,0.8)",
              borderRadius: 4,
              background: "rgba(40,0,8,0.55)",
              textShadow: "0 0 8px rgba(255,80,120,0.9)",
              boxShadow: "0 0 14px rgba(255,40,80,0.55)",
            }}>● REC · {handsFreeCountdown.n}s LEFT</div>
          ) : (
            <>
              <div style={{
                fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
                fontSize: 220, lineHeight: 1, fontWeight: 900,
                color: handsFreeCountdown.phase === "out"
                  ? "rgba(255,180,190,0.98)"
                  : "rgba(255,235,205,0.98)",
                letterSpacing: "8px",
                textShadow: handsFreeCountdown.phase === "out"
                  ? "0 0 40px rgba(255,40,80,0.95), 0 0 14px rgba(255,80,160,0.8)"
                  : "0 0 40px rgba(232,160,32,0.95), 0 0 14px rgba(255,80,160,0.7)",
                transform: "scale(1)",
                animation: "activeGlow 1s ease-in-out infinite",
              }}>{handsFreeCountdown.n}</div>
              <div style={{
                marginTop: 24,
                fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
                fontSize: 12, letterSpacing: "3px",
                color: handsFreeCountdown.phase === "out"
                  ? "rgba(255,210,210,0.95)"
                  : "rgba(255,235,205,0.85)",
                textTransform: "uppercase",
              }}>{handsFreeCountdown.phase === "out"
                  ? "HOLD · STOPPING"
                  : `HANDS-FREE · RECORDS ${HANDS_FREE_SEC}s`}</div>
            </>
          )}
        </div>
      )}

      {/* FACE FX transient toast (placeholder until v1.3.0 shader lands). */}
      {faceFxToast && (
        <div
          style={{
            position: "fixed", left: "50%", top: 70, transform: "translateX(-50%)",
            zIndex: 99998,
            background: "rgba(15,5,28,0.92)",
            border: "1px solid rgba(255,210,140,0.65)",
            color: "rgba(255,235,205,0.98)",
            fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)", fontSize: 11, letterSpacing: "1.6px",
            padding: "8px 14px", borderRadius: 4,
            boxShadow: "0 0 20px rgba(232,160,32,0.45)",
            pointerEvents: "none",
          }}
        >{faceFxToast}</div>
      )}

      {/* ── TIER info modal ── */}
      {tierInfoOpen && (
        <div
          onClick={() => setTierInfoOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 9997,
            background: "rgba(3,5,16,0.85)", backdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16, fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 520, width: "100%",
              background: "linear-gradient(180deg,#170824 0%,#080214 100%)",
              border: "1px solid rgba(255,210,140,0.45)",
              borderRadius: 8, padding: 18, color: "rgba(231,210,255,0.95)",
              boxShadow: "0 0 24px rgba(176,20,240,0.45), inset 0 0 12px rgba(0,0,0,0.7)",
              maxHeight: "85vh", overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 14, letterSpacing: "3px", color: "rgba(255,210,140,0.95)", textShadow: "0 0 8px rgba(232,160,32,0.7)" }}>
                GPS · PLANS
              </div>
              <button
                onClick={() => setTierInfoOpen(false)}
                style={{
                  fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)", fontSize: 11,
                  background: "transparent", border: "1px solid rgba(231,174,255,0.4)",
                  color: "rgba(231,174,255,0.85)", padding: "4px 10px", borderRadius: 4,
                  cursor: "pointer", letterSpacing: "1.5px",
                }}
              >CLOSE ✕</button>
            </div>
            <div style={{ fontSize: 10, letterSpacing: "1.6px", color: "rgba(200,180,220,0.6)", marginBottom: 14 }}>
              Status: <span style={{ color: entitlement === "studio" ? "rgba(120,255,200,0.95)" : entitlement === "paid" ? "rgba(255,210,140,0.95)" : "rgba(231,174,255,0.95)" }}>
                {entitlement === "studio" ? "STUDIO subscriber" : entitlement === "paid" ? "PAID (lifetime)" : `LOCKED — ${Math.ceil(graceRemaining/1000)}s grace left`}
              </span>
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, letterSpacing: "2px", color: "rgba(255,210,140,0.95)", marginBottom: 8, textShadow: "0 0 6px rgba(232,160,32,0.55)" }}>GPS — $3.99 lifetime</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, lineHeight: 1.6, color: "rgba(255,235,205,0.92)" }}>
                {TIER_FEATURES.paid.map((f) => <li key={f}>{f}</li>)}
              </ul>
            </div>

            <div>
              <div style={{ fontSize: 11, letterSpacing: "2px", color: "rgba(120,255,200,0.95)", marginBottom: 8, textShadow: "0 0 6px rgba(40,200,140,0.45)" }}>GPS STUDIO — $6.90 / month</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, lineHeight: 1.6, color: "rgba(220,255,235,0.9)" }}>
                {TIER_FEATURES.studio.map((f) => <li key={f}>{f}</li>)}
              </ul>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 10, letterSpacing: "1.8px", color: "rgba(255,210,140,0.92)", marginBottom: 8 }}>QUICK ACTIONS</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={() => { setTierInfoOpen(false); setWalkthroughOpen(true); }}
                  style={{
                    fontFamily: "inherit", fontSize: 10, letterSpacing: "1.2px",
                    background: "linear-gradient(180deg,#3A0852,#1A0224)",
                    border: "1px solid rgba(231,174,255,0.65)", color: "#fff",
                    borderRadius: 6, padding: "7px 10px", cursor: "pointer",
                  }}
                >WALKTHROUGH</button>
                <button
                  onClick={() => openExternalLink(PLAY_STORE_URL)}
                  style={{
                    fontFamily: "inherit", fontSize: 10, letterSpacing: "1.2px",
                    background: "linear-gradient(180deg,#402004,#241102)",
                    border: "1px solid rgba(255,210,140,0.65)", color: "rgba(255,235,205,0.98)",
                    borderRadius: 6, padding: "7px 10px", cursor: "pointer",
                  }}
                >★ RATE APP</button>
                <button
                  onClick={() => openExternalLink(PRIVACY_URL)}
                  style={{
                    fontFamily: "inherit", fontSize: 10, letterSpacing: "1.2px",
                    background: "transparent", border: "1px solid rgba(231,174,255,0.5)",
                    color: "rgba(231,174,255,0.9)", borderRadius: 6, padding: "7px 10px", cursor: "pointer",
                  }}
                >PRIVACY</button>
                <button
                  onClick={() => openExternalLink(TERMS_URL)}
                  style={{
                    fontFamily: "inherit", fontSize: 10, letterSpacing: "1.2px",
                    background: "transparent", border: "1px solid rgba(231,174,255,0.5)",
                    color: "rgba(231,174,255,0.9)", borderRadius: 6, padding: "7px 10px", cursor: "pointer",
                  }}
                >TERMS</button>
              </div>
            </div>

            <div style={{ marginTop: 14, fontSize: 10, color: "rgba(220,255,235,0.85)" }}>
              <div style={{ fontSize: 10, letterSpacing: "1.8px", color: "rgba(120,255,200,0.92)", marginBottom: 6 }}>PLAY STORE SCREENSHOT CHECKLIST</div>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
                <li>Live camera home (with top controls visible)</li>
                <li>Pixel Sort controls in action</li>
                <li>Datamosh controls in action</li>
                <li>Face FX mode (FACE or BG)</li>
                <li>Export panel (SNAP / REC workflow)</li>
              </ul>
              <button
                onClick={() => { try { captureStillRef.current(); } catch { /* ignore */ } }}
                style={{
                  marginTop: 8,
                  fontFamily: "inherit", fontSize: 10, letterSpacing: "1.2px",
                  background: "linear-gradient(180deg,#173260,#0b1b36)",
                  border: "1px solid rgba(120,170,255,0.65)", color: "rgba(220,235,255,0.95)",
                  borderRadius: 6, padding: "7px 10px", cursor: "pointer",
                }}
              >SNAP SCREENSHOT NOW</button>
            </div>

            <div style={{ marginTop: 18, fontSize: 9, letterSpacing: "1.4px", color: "rgba(200,180,220,0.55)", textTransform: "uppercase", lineHeight: 1.6 }}>
              In-app purchase wires up in the next update. For now, install
              gets a 30-minute cumulative grace period before the lock screen.
            </div>
          </div>
        </div>
      )}

      {/* v1.3.52 — LOCK SCREEN removed (no trial / paywall in current build). */}

      {/* ── Processing overlay (GIF/video encode + save) */}
      {processingStatus && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9998,
          background: "rgba(3,5,16,0.78)",
          backdropFilter: "blur(4px)",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          fontFamily: "var(--font-nunito,'Nunito',sans-serif)",
          color: "#F4F6FF", letterSpacing: "1.2px",
          pointerEvents: "all",
        }}>
          <style>{`@keyframes gpsBufBar{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}`}</style>
          <div style={{
            fontWeight: 800, fontSize: 14, textTransform: "uppercase",
            color: "#6F7DFF", textShadow: "0 0 12px rgba(26,28,242,0.6)",
            marginBottom: 14,
          }}>{processingStatus.label}</div>
          <div style={{
            width: "min(70vw, 320px)", height: 8, borderRadius: 6,
            background: "rgba(111,125,255,0.15)",
            border: "1px solid rgba(111,125,255,0.4)",
            overflow: "hidden", position: "relative",
            boxShadow: "0 0 14px rgba(26,28,242,0.35)",
          }}>
            {typeof processingStatus.pct === "number" ? (
              <div style={{
                width: `${Math.max(0, Math.min(100, processingStatus.pct))}%`,
                height: "100%",
                background: "linear-gradient(90deg, #1A1CF2 0%, #6F7DFF 50%, #FF8500 100%)",
                transition: "width 200ms ease",
              }}/>
            ) : (
              <div style={{
                position: "absolute", top: 0, bottom: 0, width: "40%",
                background: "linear-gradient(90deg, transparent 0%, #6F7DFF 50%, transparent 100%)",
                animation: "gpsBufBar 1.1s linear infinite",
              }}/>
            )}
          </div>
          <div style={{
            marginTop: 10, fontSize: 10, color: "rgba(244,246,255,0.55)",
            letterSpacing: "2px",
          }}>GPS • don’t close the app</div>
        </div>
      )}

      {/* ── Saved-to-phone toast (no share sheet — file is already on disk) */}
      {savedToast && (
        <div style={{
          position: "fixed", top: 80, left: "50%", transform: "translateX(-50%)",
          zIndex: 9999,
          padding: "10px 18px",
          borderRadius: 10,
          background: "linear-gradient(180deg, rgba(14,26,62,0.96) 0%, rgba(10,20,48,0.96) 100%)",
          border: "1px solid rgba(111,125,255,0.7)",
          boxShadow: "0 6px 24px rgba(26,28,242,0.45), inset 0 1px 0 rgba(255,255,255,0.18)",
          color: "#F4F6FF",
          fontFamily: "var(--font-nunito,'Nunito',sans-serif)",
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: "1.2px",
          textTransform: "uppercase",
          textAlign: "center",
          maxWidth: "min(86vw, 380px)",
          pointerEvents: "none",
        }}>
          <div style={{ color: "#6F7DFF", marginBottom: 3 }}>✓ Saved to phone</div>
          <div style={{ fontSize: 10, opacity: 0.78, letterSpacing: "0.8px", textTransform: "none", wordBreak: "break-all" }}>
            {savedToast.path}
          </div>
        </div>
      )}

      {/* Hidden video */}
      <video ref={videoRef} style={{ display: "none" }} playsInline muted autoPlay/>
      <input ref={projectFileInputRef} type="file" accept=".gps,.spectra,application/json" style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) { loadProject(f); } e.target.value = ""; }}/>

      {/* ── Top bar (GPS — slim, navy gradient, electric-blue accent)
           v1.2.77 — SINGLE-ROW layout: brand pill on the left, action
           icons on the right. All buttons are now icon-first (square
           hit targets) with the wordmark collapsing on narrow phones
           so everything fits without wrapping to a second line.
           v1.2.76 — hidden when uiHidden is true (immersive view). */}
      {!uiHidden && (
      <div style={{
        background: "linear-gradient(180deg, #3A0852 0%, #1A0224 100%)",
        borderBottom: "1px solid rgba(231,174,255,0.45)",
        display: "flex", flexDirection: "row",
        alignItems: "center", justifyContent: "space-between",
        padding: "4px 8px", gap: 6,
        flexShrink: 0, zIndex: 20,
        boxShadow: "0 2px 12px rgba(0,0,0,0.85), 0 0 18px rgba(176,20,240,0.22)",
      }}>
        {/* Left — brand icon only (v1.2.78: wordmark removed; single-row nav was wrapping on phones) */}
        <div style={{ display: "flex", alignItems: "center", flex: "0 0 auto" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={GPS_APP_ICON} alt="Glitch Pixel Studio" width={36} height={36} style={{
            width: 36, height: 36, borderRadius: 8, objectFit: "cover",
            boxShadow: "0 0 12px rgba(26,28,242,0.55), 0 0 4px rgba(111,125,255,0.6) inset",
          }}/>
        </div>
        {/* Right — action icons. v1.3.71 — allow wrap to a second row so
            SNAP / REC / UI SKIN / HANDS-FREE / RANDOMIZE / CLOSE are never
            clipped off the right edge on narrow phones. */}
        <div style={{ display: "flex", gap: 4, rowGap: 4, alignItems: "center", justifyContent: "flex-end", flex: "1 1 auto", flexWrap: "wrap", minWidth: 0 }}>
          <button
            className="sp-btn"
            onClick={() => {
              if (cameraActive) { void flipCamera(); }
              else { void startCamera(true); }
            }}
            style={{
              ...topBtnStyle,
              width: 44, height: 36, padding: 0, fontSize: 11, borderRadius: 9, letterSpacing: "0.4px",
              opacity: 1,
              color: cameraActive ? T.ochre : undefined,
              borderColor: cameraActive ? T.amber : undefined,
              boxShadow: cameraActive ? `${T.glow}, ${T.bevel}` : topBtnStyle.boxShadow,
            }}
            title={cameraActive ? `Camera ON — tap to FLIP (now ${cameraFacing === "environment" ? "REAR" : "FRONT"})` : "Tap to START camera"}
          >{cameraActive ? (cameraFacing === "user" ? "FLIP" : "FLIP") : "CAM"}</button>
          {/* (v1.3.57 — DRAW button removed; GLITCH PALETTE moved to FX Panel 2.) */}
          {/* v1.3.66 — Auto-VJ (visualizer) toggle. Replaces the old
              mic toggle. When ON: synthetic LFOs drive the audio-react
              shader uniforms AND a periodic engine re-rolls FX values
              for autonomous "auto-VJ" blending suitable for projector,
              DJ booth, or phone-as-visualizer use. */}
          <button
            className="sp-btn"
            onClick={() => { setVjMode(a => !a); playSfx("toggle"); }}
            style={{
              ...topBtnStyle,
              width: 36, height: 36, padding: 0, fontSize: 14, borderRadius: 9, letterSpacing: 0,
              color: vjMode ? T.ochre : undefined,
              borderColor: vjMode ? T.amber : undefined,
              boxShadow: vjMode ? `${T.glow}, ${T.bevel}` : topBtnStyle.boxShadow,
              ...(vjMode ? { animation: "activeGlow 1.6s ease-in-out infinite" } : {}),
            }}
            title={vjMode ? "AUTO-VJ ON — autonomous FX blending + synthetic audio-react. Tap to stop." : "AUTO-VJ — autonomous visualizer mode (no mic needed)"}
          >{vjMode ? "◉" : "○"}</button>

          {/* v1.3.68 — LOAD TRACK / PLAY-PAUSE.
              Long-press / second tap once a track is loaded toggles play state.
              Audio routes through MediaElementSource → AnalyserNode → destination,
              and the analyser is handed to AUTO-VJ for true beat-matched FX cycling. */}
          <button
            className="sp-btn"
            onClick={() => { openVjAudioPanel(); playSfx("open"); }}
            style={{
              ...topBtnStyle,
              width: 36, height: 36, padding: 0, fontSize: 12, borderRadius: 9, letterSpacing: 0,
              color: (audioInInfo || trackName) ? T.ochre : undefined,
              borderColor: (audioInInfo || trackName) ? T.amber : undefined,
              boxShadow: (audioInInfo || trackName) ? `${T.glow}, ${T.bevel}` : topBtnStyle.boxShadow,
              ...((audioInInfo || trackPlaying) ? { animation: "activeGlow 1.6s ease-in-out infinite" } : {}),
            }}
            title={
              audioInInfo
                ? `AUDIO IN · ${audioInInfo.label} — tap for VJ audio settings`
                : trackName
                  ? `Track: ${trackName} — tap for VJ audio settings`
                  : "AUDIO — open VJ audio in / out (mic, USB interface, DJ mixer, track)"
            }
          >♪</button>
          <input
            ref={trackFileInputRef}
            type="file"
            accept="audio/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleTrackFile(f);
              // Reset so picking the same file again still fires onChange.
              e.target.value = "";
            }}
          />
          <button
            className="sp-btn"
            onClick={cycleFaceFx}
            style={{
              ...topBtnStyle,
              width: 36, height: 36, padding: 0, fontSize: 14, borderRadius: 9, letterSpacing: 0,
              color: faceFxMode === "OFF" ? undefined : T.ochre,
              borderColor: faceFxMode === "OFF" ? undefined : T.amber,
              boxShadow: faceFxMode === "OFF" ? topBtnStyle.boxShadow : `${T.glow}, ${T.bevel}`,
            }}
            title={`FACE FX — ${faceFxMode} (cycle OFF / FACE-ONLY / BG-ONLY)`}
          >{faceFxMode === "OFF" ? "👤" : faceFxMode === "FACE" ? "👤" : "▣"}</button>
          {/* v1.3.69 — Bug-report button removed; in-app feedback channel
              moved off-device. */}
          {/* v1.3.72 — SNAP / REC moved out of the top bar entirely.
              They now live as a sticky thumb-reach bar pinned to the
              TOP of the bottom panel (see sp-snap-rec-strip below) so
              the user's thumbs naturally land on them while holding
              the phone in shooting position. */}
          {/* v1.3.66 — RANDOMIZE FX (replaces the v1.2.73 fullscreen
              toggle). Tap to roll fresh values across ALL FX panels:
              ARTIST FX (9 families + variants), GLITCH rack, DATAMOSH
              rack, PIXEL SORT, RGB shift, distortion bank, generator
              motion, and post-process. Fun, instant, fully reversible. */}
          <button
            className="sp-btn"
            onClick={() => {
              playSfx("click");
              const r = () => Math.random();
              // Sparse roll: ~50% chance each FX fires, biased toward
              // mid-range so the picture doesn't get crushed.
              const roll = (max = 0.9, lo = 0.25) => (r() < 0.5 ? Math.min(1, lo + r() * (max - lo)) : 0);
              const fam = (n = 3) => Math.floor(r() * n);
              const tinyRoll = (max = 0.5) => (r() < 0.4 ? r() * max : 0);
              // ARTIST FX (9 × amount + family)
              setMenkmanFX(roll());  setMenkmanFam(fam());
              setMolnarFX(roll());   setMolnarFam(fam());
              setUcnvFX(roll());     setUcnvFam(fam());
              setGysinFX(roll());    setGysinFam(fam());
              setAsendorfFX(roll()); setAsendorfFam(fam());
              setJodiFX(roll());     setJodiFam(fam());
              setArcangelFX(roll()); setArcangelFam(fam());
              setPaikFX(roll());     setPaikFam(fam());
              setFentonFX(roll());   setFentonFam(fam());
              // GLITCH rack
              setSortAmt(roll(0.85));
              setScanTear(tinyRoll(0.6));
              setBlockGlitch(tinyRoll(0.6));
              setChrash(tinyRoll(0.4));
              setLiquid(tinyRoll(0.5));
              setGlyph(tinyRoll(0.4));
              setAscii(tinyRoll(0.35));
              setRupture(tinyRoll(0.5));
              setHsync(tinyRoll(0.5));
              setVoroSort(tinyRoll(0.5));
              setReactD(0.4 + r() * 0.5);
              // RGB shift
              setRgbR((r() - 0.5) * 0.6);
              setRgbG((r() - 0.5) * 0.6);
              setRgbB((r() - 0.5) * 0.6);
              setRgbBars(tinyRoll(0.4));
              // DATAMOSH rack
              setDatamosh(roll(0.85));
              setMoshIFrame(r() * 0.7);
              setMoshMotion(r() * 0.7);
              setMoshBleed(r() * 0.6);
              setMoshDistort(tinyRoll(0.5));
              setMoshFamily(fam(4));
              // DISTORTION bank (sparse; these can dominate the frame)
              setFeedback(tinyRoll(0.5));
              setContour(tinyRoll(0.4));
              setVenetian(tinyRoll(0.35));
              setKaleido(tinyRoll(0.35));
              setTile(tinyRoll(0.35));
              setInvertSym(tinyRoll(0.3));
              setDroste(tinyRoll(0.3));
              setSpiral(tinyRoll(0.35));
              setYantra(tinyRoll(0.3));
              setMandala(tinyRoll(0.3));
              setRosette(tinyRoll(0.3));
              setStarfold(tinyRoll(0.3));
              setHexfold(tinyRoll(0.3));
              setDisrupt(tinyRoll(0.5));
              // GENERATOR motion (don't touch source/style/colors)
              setGenWarp(r() * 0.7);
              setGenJitter(r() * 0.5);
              setGenMoshX((r() - 0.5) * 1.0);
              setGenMoshY((r() - 0.5) * 1.0);
              setGenScatter(r() * 0.6);
              // POST
              setScanlines(tinyRoll(0.5));
            }}
            style={{
              ...topBtnStyle,
              width: 36, height: 36, padding: 0, fontSize: 18, borderRadius: 9, letterSpacing: 0,
              fontWeight: 800,
            }}
            title="RANDOMIZE — roll fresh values across ALL FX panels"
            id="gps-randomize-btn"
          >🎲</button>
          {/* v1.3.3 — CLOSE: hard-shutdown for Android. Stops camera/audio,
              clears the WebView, then asks Capacitor App to exit so the
              process is fully torn down (next launch is a cold start). */}
          <button
            className="sp-btn"
            onClick={() => {
              try { void stopCamera?.(); } catch {}
              try { setAudioActive(false); } catch {}
              try {
                if (streamRef.current) {
                  streamRef.current.getTracks().forEach(t => { try { t.stop(); } catch {} });
                  streamRef.current = null;
                }
              } catch {}
              if (Capacitor.isNativePlatform?.()) {
                import("@capacitor/app").then(({ App }) => {
                  App.exitApp().catch(() => {});
                }).catch(() => {});
              } else {
                try { window.close(); } catch {}
              }
            }}
            style={{
              ...topBtnStyle,
              width: 36, height: 36, padding: 0, fontSize: 14, borderRadius: 9, letterSpacing: 0,
              color: TE.red, borderColor: TE.red,
            }}
            title="CLOSE — hard-shutdown the app (releases camera; cold start next launch)"
          >✕</button>
        </div>
      </div>
      )}

      {/* ── TE gradient flourish strip (OP-1 knob color language) */}
      {!uiHidden && (
      <div style={{
        height: 3, flexShrink: 0,
        background: `linear-gradient(90deg, ${TE.blue} 0%, ${TE.green} 30%, ${TE.amber} 58%, ${TE.lilac} 78%, ${TE.red} 100%)`,
        opacity: 0.72,
      }}/>
      )}

      {/* ── Body: camera top, settings bottom (mobile); side-by-side (lg).
           v1.2.76 — also goes side-by-side on phones in landscape
           orientation so anamorphic shots get a real wide canvas. */}
      <div
        className="sp-body flex-1 min-h-0 flex overflow-hidden"
        style={{ flexDirection: isLandscape ? "row" : "column" }}
      >

        {/* Camera viewport — top half on mobile, left pane on desktop.
            When an accordion panel is open we shrink this pane so the
            open panel can occupy more vertical real estate. Other
            (collapsed) panels stay visible as headers. */}
        <div
          className="sp-canvas-pane relative bg-black overflow-hidden flex items-center justify-center"
          style={isLandscape
            ? { flex: "1 1 0", height: "100%", minWidth: 0, minHeight: 0 }
            : { flex: "none", height: "44dvh" }}
        >
          <div style={isLandscape
            ? { position: "relative", width: "100%", height: "100%" }
            : { position: "relative", aspectRatio: "1 / 1", height: "100%", maxHeight: "100%", maxWidth: "100%" }}
          >
            {/* Scanlines overlay */}
            <div style={{
              position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none",
              backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(176,20,240,0.018) 2px, rgba(176,20,240,0.018) 3px)",
            }}/>
            <div style={{ position: "absolute", inset: 10, border: "1px solid rgba(176,20,240,0.26)", zIndex: 2, pointerEvents: "none" }}/>

            <canvas
              ref={canvasRef}
              style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }}
              // v1.3.64 — ARTIST FX touch interactivity. Swiping/pressing on
              // the live camera surface feeds touchRef.x/y/active which the
              // shader reads as `uTouch`+`uTouchActive`. Each ARTIST FX
              // block bends its anchor/center/scroll toward the finger so
              // the live image visibly distorts under touch.
              onPointerDown={(e) => {
                e.preventDefault();
                const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
                touchRef.current.x = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
                touchRef.current.y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / Math.max(1, r.height)));
                touchRef.current.active = true;
                try { (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId); } catch {}
              }}
              onPointerMove={(e) => {
                if (!touchRef.current.active) return;
                const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
                touchRef.current.x = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
                touchRef.current.y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / Math.max(1, r.height)));
              }}
              onPointerUp={(e) => {
                touchRef.current.active = false;
                try { (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId); } catch {}
              }}
              onPointerCancel={() => { touchRef.current.active = false; }}
              onPointerLeave={() => { touchRef.current.active = false; }}
            />

            {/* v1.3.69 — split-button capture controls.
                  · While the top bar is visible (!uiHidden) the SNAP and REC
                    buttons live in the menu bar so they don't block the canvas.
                  · When uiHidden (immersive view) the bar is gone, so we render
                    a translucent floating pair on the canvas so the user can
                    still capture without un-hiding the UI. */}
            {uiHidden && (<>
            <button
              className={"sp-btn sp-photo-btn" + (neonMode ? " sp-photo-btn-neon" : "")}
              onClick={() => {
                playSfx("shutter");
                captureStillRef.current();
              }}
              style={{
                ...topBtnStyle,
                position: "absolute",
                right: 10,
                bottom: 10,
                zIndex: 6,
                width: 56,
                height: 38,
                fontSize: 11,
                borderRadius: 19,
                letterSpacing: "0.6px",
                fontWeight: 800,
                opacity: 0.42,
                background: "rgba(10,2,36,0.32)",
                backdropFilter: "blur(6px)",
                boxShadow: "none",
              }}
              title="Snap a still"
            >○ SNAP</button>
            <button
              className={"sp-btn sp-photo-btn" + (neonMode ? " sp-photo-btn-neon" : "")}
              onClick={() => {
                if (recording) { playSfx("recStop"); stopRecordingRef.current(); }
                else { playSfx("recStart"); startRecordingRef.current(); }
              }}
              style={{
                ...topBtnStyle,
                position: "absolute",
                left: 10,
                bottom: 10,
                zIndex: 6,
                width: 56,
                height: 38,
                fontSize: 11,
                borderRadius: 19,
                letterSpacing: "0.6px",
                fontWeight: 800,
                background: recording ? "rgba(224,61,61,0.92)" : "rgba(10,2,36,0.32)",
                borderColor: recording ? "#E03D3D" : (topBtnStyle.borderColor as string | undefined),
                boxShadow: recording
                  ? "0 0 22px rgba(224,61,61,1.0), 0 0 44px rgba(224,61,61,0.55)"
                  : "none",
                color: recording ? "#fff" : undefined,
                opacity: recording ? 0.96 : 0.42,
                backdropFilter: "blur(6px)",
                animation: recording ? "spRecPulse 1.05s ease-in-out infinite" : undefined,
              }}
              title={recording ? "Stop recording" : "Start recording"}
            >{recording ? "■ STOP" : "● REC"}</button>
            </>)}
            {/* v1.3.66 — capture-mode toggle removed; PHOTO and REC are
                now distinct buttons on opposite sides of the canvas. */}
            {/* v1.2.76 — floating eye toggle, always over the canvas, so
                even when the chrome is hidden the user can bring it back. */}
            <button
              onClick={() => {
                setUiHidden(v => {
                  const next = !v;
                  if (Capacitor.isNativePlatform()) {
                    import("@capacitor/status-bar").then(({ StatusBar }) => {
                      if (next) { StatusBar.hide().catch(() => {}); StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {}); }
                      else { StatusBar.show().catch(() => {}); StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {}); }
                    }).catch(() => {});
                  }
                  return next;
                });
              }}
              style={{
                /* v1.2.78 — bottom-left was getting buried under the
                   bottom toolbar / safe-area inset. Pin to fixed top-
                   right of the viewport with a very high zIndex so it
                   floats above EVERYTHING (nav, panels, recorder UI). */
                position: "fixed", right: 10, top: 56, zIndex: 9999,
                width: 44, height: 44, borderRadius: 10,
                background: uiHidden ? "rgba(231,174,255,0.32)" : "rgba(10,2,36,0.78)",
                border: "1px solid rgba(231,174,255,0.65)",
                color: "#F4F6FF", fontSize: 18,
                cursor: "pointer",
                boxShadow: "0 0 12px rgba(0,0,0,0.85)",
              }}
              title={uiHidden ? "Show UI" : "Hide UI · view canvas only"}
            >{uiHidden ? "▲" : "▽"}</button>


            {/* (v1.3.57 — draw overlay canvas, pxCanvas, floating GLITCH
                PALETTE UI, and drawCrash banner all removed. Artist preset
                rack now lives in FX Panel 2 with a single ON/OFF switch.) */}
            {/* Hidden mask canvas retained for legacy uMask sampler compat. */}
            <canvas ref={maskCanvasRef} style={{ display: "none" }} width={256} height={256} />

            {/* Flash feedback on capture */}
            {flashVisible && <div style={{ position: "absolute", inset: 0, background: "white", opacity: 0.6, zIndex: 10, pointerEvents: "none" }}/>}

            {/* HUD */}
            <div style={{ position: "absolute", top: 12, left: 12, zIndex: 4, pointerEvents: "none" }}>
              <div style={{ fontSize: 13, letterSpacing: "2px", color: "rgba(231,174,255,0.98)", textShadow: "0 0 12px rgba(176,20,240,0.7)", textTransform: "uppercase" }}>
                {modeLabel}
              </div>
              <div style={{ fontSize: 10, letterSpacing: "0.8px", color: "rgba(243,238,255,0.86)", marginTop: 2 }}>{fps} fps</div>
              <div style={{ fontSize: 9, letterSpacing: "1px", color: camStatusColor, marginTop: 2, display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: camStatusColor, flexShrink: 0 }}/>
                {camStatus.toUpperCase()}
              </div>
              {recording && <div style={{ fontSize: 11, letterSpacing: "1px", color: "#E86040", marginTop: 4, animation: "blink 0.8s infinite" }}>● RECORDING</div>}
              {recordingHint && (
                <div style={{
                  marginTop: 5,
                  fontSize: 10,
                  letterSpacing: "0.6px",
                  color: "rgba(240,222,180,0.92)",
                  background: "rgba(12,9,5,0.58)",
                  border: "1px solid rgba(176,20,240,0.42)",
                  borderRadius: 6,
                  padding: "3px 6px",
                  display: "inline-block",
                }}>
                  {recordingHint}
                </div>
              )}
            </div>

            {cameraRequesting && !cameraActive && !sourceError && (
              <div style={{
                position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
                background: "rgba(80,50,10,0.12)", border: "1px solid rgba(232,160,32,0.3)",
                borderRadius: 10, padding: "6px 14px", fontSize: 11, letterSpacing: "1px",
                color: "#E8A020", zIndex: 5, maxWidth: "85%", textAlign: "center",
                pointerEvents: "none",
              }}>
                Allow camera access in your browser
              </div>
            )}
            {sourceError && (
              <div style={{
                position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
                background: "rgba(192,90,42,0.15)", border: "1px solid rgba(192,90,42,0.4)",
                borderRadius: 10, padding: "6px 14px", fontSize: 11, letterSpacing: "1px",
                color: "#E86040", zIndex: 5, maxWidth: "85%", textAlign: "center",
              }}>
                {sourceError}
                <button onClick={() => { setSourceError(null); void startCamera(); }}
                  style={{ marginLeft: 8, color: "#E86040", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontSize: 10 }}>
                  retry
                </button>
                <button onClick={() => { void hardResetCamera(); }}
                  style={{ marginLeft: 8, color: "#E86040", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontSize: 10 }}>
                  hard reset
                </button>
              </div>
            )}
            {!recording && (
              <div style={{
                position: "absolute", bottom: 12, left: 12, zIndex: 4,
                background: "rgba(18,0,31,0.52)", border: "1px solid rgba(176,20,240,0.32)", borderRadius: 8,
                padding: "5px 8px", fontSize: 10, letterSpacing: "0.5px", color: "rgba(243,238,255,0.9)",
              }}>
                Hold screen to record {exportFormat.toUpperCase()}
              </div>
            )}
            {shaderError && (
              <div style={{
                position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
                background: "rgba(192,90,42,0.15)", border: "1px solid rgba(192,90,42,0.4)",
                borderRadius: 10, padding: "10px 16px", fontSize: 10, letterSpacing: "1px",
                color: "#E86040", zIndex: 5, maxWidth: "90%", textAlign: "center",
              }}>
                ⚠ {shaderError}
              </div>
            )}
          </div>
        </div>

        {/* Settings panel — bottom half on mobile (scrollable), right pane on desktop */}
        <div
          ref={panelRef}
          className={"sp-panel-glass flex-1 min-h-0 overflow-y-auto lg:w-[23rem] lg:flex-none"}
          style={isLandscape
            ? { background: "linear-gradient(180deg,#0F001C 0%,#080012 100%)", borderTop: `1px solid rgba(61,10,92,0.9)`, position: "relative", flex: "0 0 17rem", width: "17rem", height: "100%" }
            : { background: "linear-gradient(180deg,#0F001C 0%,#080012 100%)", borderTop: `1px solid rgba(61,10,92,0.9)`, position: "relative" }}
          onPointerDown={(e) => {
            // v1.2.69 — ONLY arm the pull-to-reload gesture when the pointer
            // landed on the panel's own scroll surface, NOT on a child like a
            // knob, button, switch, or selector. Previously a downward knob
            // drag at scrollTop=0 would arm the gesture and reload the WebView
            // — which on Android Capacitor looked exactly like a hard crash
            // (camera/WebGL torn down, splash flash, knob settings reset). This
            // single guard fixes the user-reported "REALSORT crash", "datamosh
            // does nothing" (every test turn-down reloaded the app), and the
            // generic "any knob nulling out resets the app" bug.
            if (e.target !== e.currentTarget) return;
            if (!panelRef.current || panelRef.current.scrollTop > 0) return;
            pullStartYRef.current = e.clientY;
          }}
          onPointerMove={(e) => {
            if (pullStartYRef.current == null) return;
            if (!panelRef.current || panelRef.current.scrollTop > 0) return;
            const d = Math.max(0, Math.min(120, e.clientY - pullStartYRef.current));
            setPullDistance(d);
            setPullArmed(d > 82);
          }}
          onPointerUp={() => {
            const armed = pullArmed;
            pullStartYRef.current = null;
            setPullDistance(0);
            setPullArmed(false);
            if (armed) window.location.reload();
          }}
          onPointerCancel={() => {
            pullStartYRef.current = null;
            setPullDistance(0);
            setPullArmed(false);
          }}
        >
          {/* v1.5.4 — no accordion: every rack on a tab is open, the tab scrolls.
              (The accordion context stays defined for SynthPanel's prop types.) */}
          {((children: React.ReactNode) => <>{children}</>)(<>
          {/* v1.3.72 — sticky SNAP / REC strip pinned to the TOP of the
              bottom panel. On mobile this is exactly where the user's
              thumbs naturally rest while holding the phone in shooting
              position, so the two most-used capture controls are always
              one tap away even as the panel scrolls underneath. */}
          <div
            className="sp-snap-rec-strip"
            style={{
              position: "sticky", top: 0, zIndex: 30,
              display: "flex", flexDirection: "row", gap: 8,
              padding: "6px 10px",
              background: "linear-gradient(180deg, rgba(15,0,28,0.96) 0%, rgba(15,0,28,0.82) 100%)",
              borderBottom: "1px solid rgba(231,174,255,0.35)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          >
            <button
              className="sp-btn"
              onClick={() => { playSfx("shutter"); captureStillRef.current(); }}
              style={{
                ...topBtnStyle,
                flex: 1, height: 44, padding: 0, fontSize: 12, borderRadius: 10, letterSpacing: "1.2px", fontWeight: 700,
              }}
              title="SNAP — capture a still"
            >○ SNAP</button>
            <button
              className="sp-btn"
              onClick={() => {
                if (recording) { playSfx("recStop"); stopRecordingRef.current(); }
                else { playSfx("recStart"); startRecordingRef.current(); }
              }}
              style={{
                ...topBtnStyle,
                flex: 1, height: 44, padding: 0, fontSize: 12, borderRadius: 10, letterSpacing: "1.2px", fontWeight: 700,
                background: recording ? "rgba(224,61,61,0.92)" : (topBtnStyle.background as string | undefined),
                borderColor: recording ? "#E03D3D" : (topBtnStyle.borderColor as string | undefined),
                boxShadow: recording ? "0 0 14px rgba(224,61,61,0.85)" : topBtnStyle.boxShadow,
                color: recording ? "#fff" : undefined,
                animation: recording ? "spRecPulse 1.05s ease-in-out infinite" : undefined,
              }}
              title={recording ? `Stop ${exportFormat.toUpperCase()} recording` : `Start ${exportFormat.toUpperCase()} recording`}
            >{recording ? "■ STOP" : "● REC"}</button>
          </div>
          <div style={{
            height: pullDistance,
            opacity: pullDistance > 0 ? 1 : 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, letterSpacing: "1.2px", color: pullArmed ? "rgba(240,222,180,0.98)" : "rgba(232,160,32,0.78)",
            transition: "height 0.08s ease",
          }}>{pullArmed ? "RELEASE TO RELOAD" : "PULL DOWN TO QUICK RESET"}</div>

          {/* Hidden file input — used by SOURCE panel "LOAD MEDIA" */}
          <input
            ref={sourceFileInputRef}
            type="file"
            accept="image/*,video/*,image/gif"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUploadFile(f);
              e.currentTarget.value = "";
            }}
          />

          {/* v1.5.0 — five tabs: SOURCE · FX · LOOK · VJ · EXPORT */}
          <div className="sp-rack-tabs" role="tablist">
            {RACK_TABS.map(t => (
              <button key={t.id} role="tab" aria-selected={activeTab === t.id} data-active={activeTab === t.id} className="sp-rack-tab"
                onClick={() => { setActiveTab(t.id); playSfx("click"); }} style={{ color: activeTab === t.id ? "#fff" : undefined }}>
                <span className="pip" style={{ background: t.pip, color: t.pip }} />
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ display: activeTab === "source" ? "contents" : "none" }}>

            {/* ── INPUT ───────────────────────────────────────────────
                v1.3.4 — split the old 4-way SOURCE picker into two
                INDEPENDENT rows so each button does ONE thing:
                  BASE: CAM | UPLD  → which feed underlies everything
                  GEN OVERLAY: OFF | FULL | SUBJECT | BG → where the
                    procedural generator paints (off = base only,
                    full = generator only, subject = on the person,
                    bg = on the background behind the person).
                The internal sourceMode/faceFxMode plumbing is
                unchanged; this UI just stops partitioning GEN as a
                separate "source" (which was the source of all the
                wonky button interactions). */}
            <SynthPanel
              title="INPUT"
              subtitle={(() => {
                // v1.3.7 — diagnostic subtitle: literal state vars +
                // segmenter health (texValid). Any "looks like nothing
                // happened" report can now be triaged at a glance.
                const sm = sourceMode === "generator" ? "GEN" : sourceMode === "upload" ? "UPLD" : "CAM";
                const fx = faceFxMode;
                const cam = cameraActive ? "Y" : "n";
                const seg = faceFxRef.current.texValid ? "Y" : "n";
                return `${sm} · FX ${fx} · CAM ${cam} · SEG ${seg}`;
              })()}
              accent="rgba(255,210,140,0.85)"
            >
              {/* Row 1 — BASE FEED */}
              <div style={{ fontSize: 8, letterSpacing: "1.4px", color: "rgba(255,210,140,0.7)", marginBottom: 4 }}>BASE</div>
              <div style={{ display: "grid", gridTemplateColumns: cameraActive ? "repeat(3,1fr)" : "repeat(2,1fr)", gap: 6, marginBottom: 8 }}>
                {cameraActive && (
                  <button
                    onClick={() => { void flipCamera(); }}
                    title={`Camera is ${cameraFacing === "user" ? "FRONT" : "REAR"} — tap to flip`}
                    style={{
                      padding: "11px 4px", fontSize: 11, letterSpacing: "1.4px", fontWeight: 700,
                      fontFamily: "'Trebuchet MS',sans-serif", cursor: "pointer", borderRadius: 5,
                      border: "1px solid rgba(255,210,140,0.7)", color: "rgba(255,235,200,0.95)",
                      background: "linear-gradient(180deg, #2A1808 0%, #120A02 100%)",
                    }}
                  >{cameraFacing === "user" ? "⇄ FRONT" : "⇄ REAR"}</button>
                )}
                {(["camera","upload"] as const).map((sm) => {
                  const lbl = sm === "camera" ? "CAM" : "UPLD";
                  // Active = the renderer is actually consuming this feed.
                  // CAM is "active" whenever the camera is live (covers
                  // both pure CAM and any GEN-overlay-on-camera combo).
                  // v1.5.4 — one lit tile: the feed the renderer is actually using.
                  const active =
                    sm === "camera" ? (sourceMode === "camera" && cameraActive) :
                    sourceMode === "upload";
                  return (
                    <button
                      aria-pressed={active}
                      key={sm}
                      onClick={() => {
                        if (sm === "camera") {
                          // v1.3.7 — UNAMBIGUOUS CAM TAP: always switch
                          // to plain camera mode + ensure camera is on.
                          clearUploadSource();
                          setSourceMode("camera");
                          // Drop face FX so plain CAM = plain CAM.
                          setFaceFxMode("OFF");
                          if (!cameraActive) void startCamera();
                        } else {
                          // UPLD: open file picker; on pick, the file
                          // handler sets sourceMode="upload" and clears
                          // GEN. Don't pre-flip state in case user cancels.
                          sourceFileInputRef.current?.click();
                        }
                      }}
                      style={{
                        padding: "11px 4px",
                        fontSize: 11, letterSpacing: "1.4px", fontWeight: 700,
                        fontFamily: "'Trebuchet MS',sans-serif",
                        cursor: "pointer",
                        borderRadius: 5,
                        // v1.3.6 — match GEN OVERLAY: bright white border for
                        // active so the lit button is unmistakable.
                        border: active ? "2px solid rgba(255,255,255,0.95)" : "1px solid rgba(0,0,0,0.72)",
                        color: active ? "rgba(255,255,255,1)" : "rgba(195,190,200,0.72)",
                        textShadow: active ? "0 0 8px rgba(255,255,255,0.85)" : "none",
                        background: active
                          ? "linear-gradient(180deg, #5A0E16 0%, #2A060A 100%)"
                          : "linear-gradient(180deg, #3A3A3E 0%, #1A1A1E 48%, #101014 100%)",
                        boxShadow: active
                          ? "inset 0 1px 1px rgba(255,255,255,0.3), inset 0 -2px 4px rgba(0,0,0,0.74), 0 0 12px rgba(255,255,255,0.55)"
                          : "inset 0 1px 1px rgba(255,255,255,0.08), inset 0 -2px 4px rgba(0,0,0,0.72)",
                      }}
                    >{lbl}</button>
                  );
                })}
              </div>

              {/* Row 2 — GEN OVERLAY (where the generator paints) */}
              <div style={{ fontSize: 8, letterSpacing: "1.4px", color: "rgba(255,210,140,0.7)", marginBottom: 4 }}>GEN OVERLAY</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 8 }}>
                {(["off","full","subject","bg"] as const).map((g) => {
                  // v1.3.8 — explicit FG/BG labels so the routing intent
                  // is unambiguous. SUBJ → "GEN▸FG" (generator paints
                  // the subject, camera is the background); BG → "GEN▸BG"
                  // (generator IS the background, real person on top).
                  const lbl =
                    g === "off"     ? "OFF" :
                    g === "full"    ? "GEN" :
                    g === "subject" ? "GEN▸FG" :
                                      "GEN▸BG";
                  const active =
                    g === "off"     ? sourceMode !== "generator" :
                    g === "full"    ? (sourceMode === "generator" && !cameraActive) :
                    g === "subject" ? (sourceMode === "generator" && cameraActive && faceFxMode === "FACE") :
                                      (sourceMode === "generator" && cameraActive && faceFxMode === "BG");
                  return (
                    <button
                      key={g}
                      onClick={() => {
                        if (g === "off") {
                          // Drop back to plain BASE camera. Force face
                          // FX off so the result is unambiguous.
                          setFaceFxMode("OFF");
                          if (uploadName && sourceMode === "upload") {
                            setSourceMode("upload");
                          } else {
                            setSourceMode("camera");
                            if (!cameraActive) void startCamera();
                          }
                        } else if (g === "full") {
                          // Pure full-frame generator. Face FX OFF so the
                          // renderer doesn't keep masking the generator.
                          // Camera released since the segmenter is off.
                          clearUploadSource();
                          setFaceFxMode("OFF");
                          setSourceMode("generator");
                          if (cameraActive) stopCamera();
                        } else if (g === "subject") {
                          // GEN painted on the person; real-world BG behind.
                          // v1.3.10 — HARD-RESET every press so re-tapping
                          // an already-active tile still forces a fresh
                          // camera + segmenter re-init. Previously when
                          // GEN▸FG was already the state, pressing it
                          // again was a no-op (React state-dedupe even
                          // with the kick) and bugs persisted.
                          clearUploadSource();
                          setSourceMode("generator");
                          setFaceFxMode("FACE");
                          setFaceFxKick((k) => k + 1);
                          if (cameraActive) stopCamera();
                          setTimeout(() => { void startCamera(true); }, 80);
                        } else {
                          // GEN as the background; clean person on top.
                          // Same hard-reset rationale as SUBJ.
                          clearUploadSource();
                          setSourceMode("generator");
                          setFaceFxMode("BG");
                          setFaceFxKick((k) => k + 1);
                          if (cameraActive) stopCamera();
                          setTimeout(() => { void startCamera(true); }, 80);
                        }
                      }}
                      style={{
                        padding: "11px 4px",
                        fontSize: 10, letterSpacing: "1.2px", fontWeight: 700,
                        fontFamily: "'Trebuchet MS',sans-serif",
                        cursor: "pointer",
                        borderRadius: 5,
                        // v1.3.6 — color-blind-safe active highlight: bright
                        // WHITE border + thicker (2px) so the lit button is
                        // unmistakable regardless of hue perception.
                        border: active ? "2px solid rgba(255,255,255,0.95)" : "1px solid rgba(0,0,0,0.72)",
                        color: active ? "rgba(255,255,255,1)" : "rgba(195,190,200,0.72)",
                        textShadow: active ? "0 0 8px rgba(255,255,255,0.85)" : "none",
                        background: active
                          ? "linear-gradient(180deg, #5A1880 0%, #2A0838 100%)"
                          : "linear-gradient(180deg, #3A3A3E 0%, #1A1A1E 48%, #101014 100%)",
                        boxShadow: active
                          ? "inset 0 1px 1px rgba(255,255,255,0.3), inset 0 -2px 4px rgba(0,0,0,0.74), 0 0 12px rgba(255,255,255,0.55)"
                          : "inset 0 1px 1px rgba(255,255,255,0.08), inset 0 -2px 4px rgba(0,0,0,0.72)",
                      }}
                    >{lbl}</button>
                  );
                })}
              </div>
              {/* v1.3.8 — SWAP FG/BG. One-tap inversion of the
                  generator routing. If GEN▸FG looks backwards on your
                  device, tap SWAP to flip it without re-picking the tile.
                  Hidden when GEN routing is irrelevant (OFF/FULL or no cam). */}
              {(sourceMode === "generator" && cameraActive && (faceFxMode === "FACE" || faceFxMode === "BG")) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6, marginBottom: 8 }}>
                  <button
                    onClick={() => {
                      setFaceFxMode(faceFxMode === "FACE" ? "BG" : "FACE");
                      setFaceFxKick((k) => k + 1);
                    }}
                    style={{
                      padding: "8px 4px",
                      fontSize: 9, letterSpacing: "1.6px", fontWeight: 700,
                      fontFamily: "'Trebuchet MS',sans-serif",
                      cursor: "pointer",
                      borderRadius: 5,
                      border: "1px solid rgba(255,210,140,0.7)",
                      color: "rgba(255,235,200,0.95)",
                      textShadow: "0 0 6px rgba(255,210,140,0.55)",
                      background: "linear-gradient(180deg, #2A1808 0%, #120A02 100%)",
                      boxShadow: "inset 0 1px 1px rgba(255,255,255,0.12), inset 0 -2px 3px rgba(0,0,0,0.7)",
                    }}
                  >SWAP FG ⇄ BG</button>
                </div>
              )}
              {/* v1.3.17 — MASK EXPAND knob. Only shown when the
                  segmenter is actually driving a matte (FACE or BG).
                  Lets the user dial how far the mask spills outward
                  to fully cover the subject (the segmenter often
                  under-cuts shoulders/hair). 0 = raw matte, 1 = max. */}
              {(faceFxMode === "FACE" || faceFxMode === "BG") && (
                <div style={{ marginBottom: 8 }}>
                  <SliderRow
                    label="MASK EXPAND"
                    value={maskExpand}
                    min={0} max={1} step={0.01}
                    onChange={setMaskExpand}
                  />
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, alignItems: "center" }}>
                <div style={{
                  fontSize: 9, fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
                  letterSpacing: "0.8px",
                  color: "rgba(255,210,140,0.85)",
                  background: "linear-gradient(180deg, #0A0312 0%, #160726 100%)",
                  border: "1px solid rgba(0,0,0,0.6)",
                  padding: "6px 8px", borderRadius: 4,
                  boxShadow: "inset 0 1px 2px rgba(0,0,0,0.7)",
                  textShadow: "0 0 5px rgba(232,160,32,0.55)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {(() => {
                    const fxTag = comboMode ? " · PXL+MOSH" : mode === 7 ? " · PXL" : mode === 9 ? " · MOSH" : "";
                    if (sourceMode === "upload") return uploadName ? `▣ ${uploadKind === "video" ? "VID" : "IMG"} · ${uploadName}${fxTag}` : "▣ NO MEDIA LOADED";
                    if (sourceMode === "camera") return cameraActive ? `▣ CAMERA LIVE${fxTag}` : "▣ CAMERA OFFLINE";
                    return cameraActive ? `▣ GEN+CAM · ${genStyle}${fxTag}` : `▣ GEN · ${genStyle}${fxTag}`;
                  })()}
                </div>
                <button
                  onClick={() => sourceFileInputRef.current?.click()}
                  style={{
                    padding: "6px 10px", fontSize: 9, letterSpacing: "1.2px",
                    fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)", fontWeight: 700,
                    cursor: "pointer", borderRadius: 5,
                    border: "1px solid rgba(0,0,0,0.7)",
                    color: "rgba(255,210,140,0.95)",
                    background: "linear-gradient(180deg, #3A0852 0%, #1A0224 100%)",
                    boxShadow: "inset 0 1px 1px rgba(255,255,255,0.12), inset 0 -2px 3px rgba(0,0,0,0.7)",
                    textShadow: "0 0 5px rgba(232,160,32,0.55)",
                  }}
                >LOAD…</button>
              </div>
                <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
                  <button
                    onClick={() => { void resetSettings(); }}
                    style={{
                      padding: "7px 12px", fontSize: 9, letterSpacing: "1.3px",
                      fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)", fontWeight: 700,
                      cursor: "pointer", borderRadius: 5,
                      border: "1px solid rgba(0,0,0,0.72)",
                      color: "rgba(255,210,140,0.98)",
                      background: "linear-gradient(180deg, #4B1228 0%, #250915 100%)",
                      boxShadow: "inset 0 1px 1px rgba(255,255,255,0.12), inset 0 -2px 3px rgba(0,0,0,0.72)",
                      textShadow: "0 0 5px rgba(232,160,32,0.55)",
                    }}
                    title="Reset to normal view and clear triggers"
                  >RESET SETTINGS</button>
                </div>
            </SynthPanel>

            {/* ── PIXEL GENERATOR RACK ──────────────────────────────── */}
            <SynthPanel title="PIXEL GENERATOR" subtitle={`GEN · ${genStyle} · 1 LAYER`} accent="rgba(255,210,140,0.95)">
              {/* v1.3.44 — MIX: pre-FX hard-light blend of generator over the
                  active source (camera or upload). At 0 the generator only
                  appears when SOURCE = GEN (legacy). At >0 the generator
                  pixel-integrates with the camera/upload feed BEFORE the
                  shader FX run, so PIXEL SORT / DATAMOSH / WARPS act on the
                  blended pixel signal — generator stops being an island. */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: 10,
                alignItems: "center",
                marginBottom: 8,
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid rgba(255,210,140,0.25)",
                background: "linear-gradient(180deg, rgba(255,210,140,0.06), rgba(0,0,0,0.0))",
              }}>
                <Knob label="MIX" value={genMix} min={0} max={1} step={0.01} defaultValue={0.0} onChange={setGenMixThrottled}/>
                <div style={{ fontSize: 8, letterSpacing: "1px", color: "rgba(255,210,140,0.62)", lineHeight: 1.3 }}>
                  Blend GEN over CAM/UPLD before FX run. 0 = isolated source,
                  &gt;0 pixel-integrates so SORT/MOSH/WARPS chew on both.
                </div>
              </div>
              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(255,210,140,0.7)", textTransform: "uppercase", marginBottom: 4, paddingLeft: 2, display: "flex", justifyContent: "space-between" }}>
                <span>Style · {FAMILY_NAMES[(FV_BY_STYLE[genStyle]?.[0] ?? 3)]}</span>
                <span style={{ opacity: 0.6 }}>{genStyle}</span>
              </div>
              {/* v1.5.0 — direct style picker (replaces the FAMILY / VARIANT knobs). */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 4, marginBottom: 10 }}>
                {GEN_STYLES.map((st) => {
                  const on = genStyle === st;
                  const meta = GEN_STYLE_META[st];
                  return (
                    <button key={st} onClick={() => setGenStyleThrottled(st)} title={st} style={{
                      padding: "6px 1px", fontSize: 7.5, letterSpacing: "0.4px", fontWeight: 700,
                      fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
                      cursor: "pointer", borderRadius: 4,
                      border: on ? `1px solid ${meta?.color ?? "#fff"}` : "1px solid rgba(0,0,0,0.7)",
                      color: on ? "#fff" : (meta?.color ? `${meta.color}bb` : "rgba(255,210,140,0.7)"),
                      background: on ? (meta?.bg ?? "linear-gradient(180deg,#3A0852,#1A0224)") : "linear-gradient(180deg,#1a1a1e 0%,#0a0a12 100%)",
                      boxShadow: on ? `0 0 8px ${meta?.glow ?? "#fff"}66` : "inset 0 1px 1px rgba(255,255,255,0.05)",
                      textShadow: on ? `0 0 5px ${meta?.glow ?? "#fff"}` : "none",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{st}</button>
                  );
                })}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginBottom: 8, justifyItems: "center" }}>
                <SynthSelector label="BLEND" options={[...GEN_BLEND_KEYS]} value={Math.max(0, GEN_BLEND_KEYS.indexOf(genBlend))} onChange={(i) => setGenBlend(GEN_BLEND_KEYS[i] as GenBlend)}/>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 6, justifyItems: "center" }}>
                <Knob label="DENSITY" value={genDensity}    min={0}    max={1} step={0.01} defaultValue={0.55} onChange={setGenDensityThrottled}/>
                <Knob label="SCALE"   value={genScale}      min={0.25} max={4} step={0.01} defaultValue={1.0}  onChange={setGenScaleThrottled}/>
                <Knob label="SPEED"   value={genSpeed}      min={0}    max={3} step={0.01} defaultValue={0.6}  onChange={setGenSpeedThrottled}/>
                <Knob label="WARP"    value={genWarp}       min={0}    max={1} step={0.01} defaultValue={0.25} onChange={setGenWarpThrottled}/>
                <Knob label="RES"     value={genResolution} min={8}    max={160} step={1}  defaultValue={48}   onChange={setGenResolutionThrottled}/>
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 12 }}>
                <SynthSwitch label="INVERT" on={genInvert} onChange={setGenInvert} onLabel="ON" offLabel="OFF"/>
                <button
                  onClick={() => setGenSeed(Math.floor(Math.random() * 999))}
                  style={{
                    padding: "6px 12px", fontSize: 10, letterSpacing: "1.4px",
                    fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)", fontWeight: 700,
                    cursor: "pointer", borderRadius: 5,
                    border: "1px solid rgba(0,0,0,0.7)",
                    color: "rgba(255,210,140,0.95)",
                    background: "linear-gradient(180deg, #3A0852 0%, #1A0224 100%)",
                    boxShadow: "inset 0 1px 1px rgba(255,255,255,0.12), inset 0 -2px 3px rgba(0,0,0,0.7)",
                    textShadow: "0 0 5px rgba(232,160,32,0.55)",
                    alignSelf: "center", height: 30,
                  }}
                >⟲ RANDOM</button>
              </div>
            </SynthPanel>


          </div>

          <div style={{ display: activeTab === "fx" ? "contents" : "none" }}>
            {/* v1.5.3 — the two things people reach for most on the FX tab. */}
            <div style={{ display: "flex", gap: 6, padding: "8px 10px 2px" }}>
              <button className="sp-tile" onClick={() => document.getElementById("gps-randomize-btn")?.click()}
                title="Roll fresh values across every FX rack (same as 🎲 in the top bar)"
                style={{ ...modeBtnStyle, flex: 1, minHeight: 40, fontSize: 11, letterSpacing: "1.6px" }}>🎲 RANDOMIZE</button>
              <button className="sp-tile" onClick={() => { void resetSettings(); }}
                title="Reset every rack to neutral and return to the plain camera view"
                style={{ ...modeBtnStyle, flex: 1, minHeight: 40, fontSize: 11, letterSpacing: "1.6px", color: "rgba(255,140,140,0.95)" }}>RESET ALL FX</button>
            </div>

            {/* ── PIXEL SORT RACK ───────────────────────────────────── */}
            <SynthPanel title="PIXEL SORT" subtitle="SORT · HOMAGE · 9 CTRL" accent="rgba(174,255,231,0.95)">
              {/* v1.3.44 — REALSORT moved out of this panel (it was a
                  duplicate of the same knob in ASENDORF / GYSIN, which is
                  its real home as the CPU Asendorf homage cross-fade).
                  Per v1.2.68 the shader sort knobs are already decoupled
                  from REALSORT — AMOUNT directly drives the shader sort
                  uniform, so each sub-knob produces a visible, independent
                  change without needing REALSORT lifted at all. */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 8, justifyItems: "center" }}>
                <Knob label="AMOUNT"  value={sortAmt}      min={0} max={1}    step={0.01} defaultValue={0.0}  onChange={setSortAmt}/>
                <Knob label="LOW"     value={sortLow}      min={0} max={1}    step={0.01} defaultValue={0.0}  onChange={setSortLow}/>
                <Knob label="HIGH"    value={sortHigh}     min={0} max={1}    step={0.01} defaultValue={1.0}  onChange={setSortHigh}/>
                <Knob label="SEGMENT" value={sortSegment}  min={0} max={1}    step={0.01} defaultValue={0.0}  onChange={setSortSegment}/>
                <Knob label="NOISE"   value={sortRandom}   min={0} max={1}    step={0.01} defaultValue={0.0}  onChange={setSortRandom}/>
              </div>
              {/* v1.5.0 — ASENDORF / GYSIN homage rack folded in here. */}
              <div style={{ fontSize: 8, letterSpacing: "1.4px", color: "rgba(174,255,231,0.6)", textTransform: "uppercase", margin: "10px 0 4px", paddingLeft: 2 }}>Homage · Asendorf / Gysin</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, justifyItems: "center" }}>
                <Knob label="REALSORT" value={sortMix}  min={0} max={1} step={0.01} defaultValue={0.0} onChange={setSortMix}/>
                <Knob label="GLYPH"    value={glyph}    min={0} max={1} step={0.01} defaultValue={0.0} onChange={setGlyph}/>
                <Knob label="REACT-D"  value={reactD}   min={0} max={1} step={0.01} defaultValue={0.0} onChange={setReactD}/>
                <Knob label="VOROSRT"  value={voroSort} min={0} max={1} step={0.01} defaultValue={0.0} onChange={setVoroSort}/>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8, justifyItems: "center" }}>
                <SynthSelector label="MODE" options={["LINE","SPIRAL","BLOCK","SLICE","HILBERT","ASENDORF"]} value={Math.round(sortMode)} onChange={(v) => setSortMode(v)}/>
                <SynthSelector label="INTERVAL" options={["BAND","BRIGHT","DARK","RAND","WAVE","EDGE","NONE"]} value={Math.round(sortInterval)} onChange={(v) => setSortInterval(v)}/>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 8, justifyItems: "center" }}>
                <SynthSelector label="ANGLE" options={["HORZ","VERT","DIAG↗","DIAG↘"]} value={Math.round(sortAngle)} onChange={(v) => setSortAngle(v)}/>
              </div>
              <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
                <button
                  className="sp-btn"
                  onClick={() => {
                    // v1.3.47 — true null reset. AMOUNT=0 means no work; LOW/HIGH
                    // bracket the full luma range so any subsequent dial-up is visible.
                    setSortAmt(0.0); setSortLow(0.0); setSortHigh(1.0); setSortSegment(0.0);
                    setSortRandom(0.0); setSortWobble(0.0); setScanTear(0.0);
                    setSortMode(0); setSortInterval(0); setSortAngle(0);
                    setGlyph(0); setSortMix(0); setReactD(0); setVoroSort(0);
                  }}
                  style={{ fontSize: 9, padding: "6px 12px", letterSpacing: "1.4px", color: "rgba(255,140,140,0.95)" }}
                  title="Reset every PIXEL SORT control to null"
                >HARD RESET</button>
              </div>
            </SynthPanel>

            {/* v1.2.73 — RGBNDR + PIXEL DRAWER racks removed per user
                request: cluttered the synth view, rarely yielded
                meaningful results in field testing. Underlying state +
                shader uniforms remain so saved presets still load. */}

            {/* ── DATAMOSH RACK ─────────────────────────────────────────── */}
            {/* v1.3.47 — BLEED + COMPRES knobs replaced by the FAMILY selector.
                FAMILY shapes the character of INTENS by driving moshBleed +
                moshDistort uniforms to fixed values per family. State for the
                old knobs is kept for preset round-trip but no longer surfaced.
                v1.3.48 — added FAMILY as a Knob next to INTENS (per user) so it
                lives in the knob rack; the SynthSelector below stays as a
                visual legend showing which family the knob position maps to. */}
            <SynthPanel title="DATAMOSH" subtitle="MOSH · 7 CTRL + FAMILY" accent="rgba(231,174,255,0.95)">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, justifyItems: "center" }}>
                <Knob label="INTENS"   value={datamosh}     min={0} max={2}  step={0.01} defaultValue={0.0}  onChange={setDatamosh}/>
                <Knob label="I-FRAME"  value={moshIFrame}   min={0} max={1}  step={0.01} defaultValue={0.0}  onChange={setMoshIFrame}/>
                <Knob label="MOTION"   value={moshMotion}   min={0} max={1}  step={0.01} defaultValue={0.0}  onChange={setMoshMotion}/>
                <Knob label="CHRASH"   value={chrash}       min={0} max={1}  step={0.01} defaultValue={0.0}  onChange={setChrash}/>
                <Knob label="FEEDBK"   value={feedback}     min={0} max={1}  step={0.01} defaultValue={0.0}  onChange={setFeedback}/>
                <Knob label="BLOCK"    value={blockGlitch}  min={0} max={1}  step={0.01} defaultValue={0.0}  onChange={setBlockGlitch}/>
                <Knob label="LIQUID"   value={liquid}       min={0} max={1}  step={0.01} defaultValue={0.0}  onChange={setLiquid}/>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 8, justifyItems: "center" }}>
                <SynthSelector
                  label="FAMILY"
                  options={["SOFT","HARD","SLICE","SMEAR","CHAOS","GLITCH"]}
                  value={moshFamily}
                  onChange={(v) => {
                    // v1.3.47 — family character matrix [bleed, distort].
                    const fv = ([
                      [0.20, 0.10], // SOFT  — gentle smear, low compression
                      [0.55, 0.40], // HARD  — solid mosh body
                      [0.10, 0.75], // SLICE — clean compression slabs
                      [0.85, 0.15], // SMEAR — long bleed, soft compress
                      [0.60, 0.60], // CHAOS — equal parts both
                      [0.35, 0.90], // GLITCH — heavy compression, sharp bleed
                    ][v]) || [0, 0];
                    setMoshFamily(v);
                    setMoshBleed(fv[0]);
                    setMoshDistort(fv[1]);
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
                <button
                  className="sp-btn"
                  onClick={() => {
                    // v1.3.47 — true null reset. FAMILY back to SOFT but bleed/distort
                    // forced to 0 so nothing is active until INTENS is dialed up.
                    setDatamosh(0.0); setMoshIFrame(0.0); setMoshMotion(0.0); setMoshBleed(0.0);
                    setMoshMap(0.0); setMoshDistort(0.0); setChrash(0.0);
                    setFeedback(0.0); setBlockGlitch(0.0); setLiquid(0.0); setMoshHard(false);
                    setMoshFamily(0);
                  }}
                  style={{ fontSize: 9, padding: "6px 12px", letterSpacing: "1.4px", color: "rgba(255,140,140,0.95)" }}
                  title="Reset every DATAMOSH control to null"
                >HARD RESET</button>
              </div>
            </SynthPanel>

            {/* ── FX SETTINGS ─────────────────────────────────────── */}
            <SynthPanel title="VISION" subtitle="VISUAL MODE · DISRUPT · 3 CTRL" accent="rgba(231,174,255,0.95)">
              {/* Full visual-mode picker (the classic NIGHT/THERMAL/EDGE/MOTION
                  /CMYK/etc. set). Selecting any of these overrides the LAYER
                  MODE PXL/MOSH selection so the entire shader pipeline runs
                  that effect instead. NORMAL clears the override. */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(4,minmax(0,1fr))",
                gap: 4,
                marginBottom: 10,
              }}>
                {([
                  [0,"NORMAL"],[1,"NIGHT"],[2,"THERMAL"],[3,"EDGE"],
                  [4,"MOTION"],[5,"CMYK"],[6,"HALFT"],[11,"POSTER"],
                  [13,"FEEDBK"],[14,"BLKROT"],[19,"ACID"],[20,"DITHER"],
                  [22,"MELT"],[24,"MIRROR"],
                ] as [ModeId,string][]).map(([id, lbl]) => {
                  const on = mode === id;
                  return (
                    <button
                      aria-pressed={on}
                      key={`vm-${id}`}
                      onClick={() => { setMode(id); }}
                      style={{
                        padding: "7px 2px",
                        fontSize: 9,
                        letterSpacing: "1px",
                        fontWeight: 700,
                        fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
                        cursor: "pointer", borderRadius: 4,
                        border: on ? "1px solid rgba(231,174,255,0.85)" : "1px solid rgba(0,0,0,0.72)",
                        color: on ? "rgba(255,220,255,1)" : "rgba(200,180,220,0.72)",
                        textShadow: on ? "0 0 6px rgba(231,174,255,0.7)" : "none",
                        background: on
                          ? "linear-gradient(180deg, #3a1a4d 0%, #1a0a25 100%)"
                          : "linear-gradient(180deg, #2a2a30 0%, #14141a 100%)",
                        boxShadow: on
                          ? "inset 0 1px 1px rgba(255,220,255,0.18), 0 0 8px rgba(231,174,255,0.35)"
                          : "inset 0 1px 1px rgba(255,255,255,0.06), inset 0 -2px 3px rgba(0,0,0,0.7)",
                      }}
                    >{lbl}</button>
                  );
                })}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, justifyItems: "center" }}>
                <Knob label="DISRUPT"  value={disrupt}         min={0} max={1} step={0.01} defaultValue={0.0} onChange={setDisrupt}/>
                <Knob label="COUNT"    value={disruptCount}    min={0} max={1} step={0.01} defaultValue={0.4} onChange={setDisruptCount}/>
                <Knob label="SIZE"     value={disruptSize}     min={0} max={1} step={0.01} defaultValue={0.4} onChange={setDisruptSize}/>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 8, justifyItems: "center" }}>
                <SynthSelector label="SHAPE" options={["BLOB","RING","HEX","CROSS","STRIPE","SPIRAL"]} value={Math.round(disruptShape)} onChange={(v) => setDisruptShape(v)}/>
              </div>
              <div style={{ marginTop: 8, fontSize: 8, letterSpacing: "1px", color: "rgba(231,174,255,0.55)", textAlign: "center" }}>
                roving pixel-groups disrupt with contrary motion · 6 shapes
              </div>
            </SynthPanel>

            {/* ── v1.2.60 RADIAL FX rack ───────────────────────────────────────
                10 mask-gated UV warps chained sequentially. Order in shader:
                KALEIDO → TILE → INVERT → DROSTE → SPIRAL → YANTRA → MANDALA
                → ROSETTE → STARFOLD → HEXFOLD. Any combo produces a unique
                pattern because each warp feeds the next. Kaleido is the
                anchor; the 9 sisters were declared in v1.2.58 but never
                wired — wired in v1.2.60 as combo-friendly siblings. */}
            <SynthPanel title="RADIAL FX" subtitle="UV WARPS · 10 CTRL · COMBOS" accent="rgba(231,174,255,0.95)">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 8, justifyItems: "center" }}>
                <Knob label="KALEIDO"  value={kaleido}   min={0} max={1} step={0.01} defaultValue={0.0} onChange={setKaleido}/>
                <Knob label="TILE"     value={tile}      min={0} max={1} step={0.01} defaultValue={0.0} onChange={setTile}/>
                <Knob label="INVERT"   value={invertSym} min={0} max={1} step={0.01} defaultValue={0.0} onChange={setInvertSym}/>
                <Knob label="DROSTE"   value={droste}    min={0} max={1} step={0.01} defaultValue={0.0} onChange={setDroste}/>
                <Knob label="SPIRAL"   value={spiral}    min={0} max={1} step={0.01} defaultValue={0.0} onChange={setSpiral}/>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 8, marginTop: 8, justifyItems: "center" }}>
                <Knob label="YANTRA"   value={yantra}    min={0} max={1} step={0.01} defaultValue={0.0} onChange={setYantra}/>
                <Knob label="MANDALA"  value={mandala}   min={0} max={1} step={0.01} defaultValue={0.0} onChange={setMandala}/>
                <Knob label="ROSETTE"  value={rosette}   min={0} max={1} step={0.01} defaultValue={0.0} onChange={setRosette}/>
                <Knob label="STARFOLD" value={starfold}  min={0} max={1} step={0.01} defaultValue={0.0} onChange={setStarfold}/>
                <Knob label="HEXFOLD"  value={hexfold}   min={0} max={1} step={0.01} defaultValue={0.0} onChange={setHexfold}/>
              </div>
              <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
                <button
                  className="sp-btn"
                  onClick={() => {
                    setKaleido(0); setTile(0); setInvertSym(0); setDroste(0); setSpiral(0);
                    setYantra(0); setMandala(0); setRosette(0); setStarfold(0); setHexfold(0);
                  }}
                  style={{ fontSize: 9, padding: "6px 12px", letterSpacing: "1.4px", color: "rgba(255,140,140,0.95)" }}
                  title="Reset every RADIAL FX control to 0"
                >HARD RESET</button>
              </div>
              <div style={{ marginTop: 8, fontSize: 8, letterSpacing: "1px", color: "rgba(231,174,255,0.55)", textAlign: "center" }}>
                chain any combo · each warp feeds the next · all mask-gated
              </div>
            </SynthPanel>
          </div>

          <div style={{ display: activeTab === "look" ? "contents" : "none" }}>
            {/* ── COLOR (master color bus — every color control lives here) ── */}
            <SynthPanel title="COLOR" subtitle={`PAL · ${genPalette}`} accent="rgba(255,180,255,0.95)">
              {/* Palette selector — moved from PIXEL GENERATOR */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 8 }}>
                {GEN_PALETTE_KEYS.map((pk) => {
                  const active = genPalette === pk;
                  const sw = pk === "MONO"    ? "linear-gradient(135deg,#fff,#888,#222)"
                           : pk === "WARM"    ? "linear-gradient(135deg,#ffd27a,#ff7a3a,#a8003c)"
                           : pk === "COOL"    ? "linear-gradient(135deg,#7ad6ff,#3a78ff,#001ea8)"
                           : pk === "PINK"    ? "linear-gradient(135deg,#ffd2f0,#ff3aa3,#7a006a)"
                           : pk === "ACID"    ? "linear-gradient(135deg,#d6ff3a,#3aff8e,#0a8000)"
                           : pk === "RAINBOW" ? "linear-gradient(90deg,#ff3a3a,#ffd23a,#3aff7a,#3ad6ff,#7a3aff,#ff3ad6)"
                           :                    "linear-gradient(135deg,#3A0852,#1A0224)";
                  return (
                    <button
                      key={pk}
                      onClick={() => setGenPalette(pk)}
                      title={pk === "CUSTOM" ? "Use HUE / SPREAD / SAT knobs" : `${pk} palette`}
                      style={{
                        padding: "6px 2px 4px",
                        fontSize: 8, letterSpacing: "0.6px", fontWeight: 700,
                        fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
                        cursor: "pointer", borderRadius: 4,
                        border: active ? "1px solid rgba(255,180,255,0.95)" : "1px solid rgba(0,0,0,0.7)",
                        color: active ? "#fff" : "rgba(255,180,255,0.7)",
                        background: active
                          ? "linear-gradient(180deg,#3A0852 0%,#1A0224 100%)"
                          : "linear-gradient(180deg,#1a1a1e 0%,#0a0a12 100%)",
                        boxShadow: active
                          ? "inset 0 1px 1px rgba(255,255,255,0.18), 0 0 8px rgba(255,180,255,0.4)"
                          : "inset 0 1px 1px rgba(255,255,255,0.05)",
                        textShadow: active ? "0 0 5px rgba(255,180,255,0.8)" : "none",
                        position: "relative", overflow: "hidden",
                      }}
                    >
                      <div style={{
                        height: 6, marginBottom: 3, borderRadius: 2, background: sw,
                        opacity: active ? 1 : 0.7,
                      }}/>
                      {pk}
                    </button>
                  );
                })}
              </div>
              {/* Master tone/color (was in MASTER + PIXEL SORT) */}
              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(255,180,255,0.7)", textTransform: "uppercase", marginBottom: 4, paddingLeft: 2 }}>Master Color</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, justifyItems: "center", marginBottom: 12 }}>
                <Knob label="HUE"     value={hueShift}    min={-0.5} max={0.5} step={0.01} defaultValue={0.0} onChange={setHueShift}/>
                <Knob label="SAT"     value={saturation}  min={0} max={3}      step={0.01} defaultValue={1.0} onChange={setSaturation}/>
                <Knob label="BRIGHT"  value={brightness}  min={0.2} max={2.0}  step={0.01} defaultValue={1.0} onChange={setBrightness}/>
                <Knob label="CONT"    value={contrast}    min={0.2} max={3.0}  step={0.01} defaultValue={1.0} onChange={setContrast}/>
              </div>
              {/* v1.3.37 — Output bus row (was the standalone MASTER panel).
                  Folded in here so every post-process control lives in one
                  place: Master Color tints the output, OUT scales it. */}
              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(255,180,255,0.7)", textTransform: "uppercase", marginBottom: 4, paddingLeft: 2 }}>Output</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, justifyItems: "center", marginBottom: 12 }}>
                <Knob label="SPEED"  value={speed}      min={0} max={4}  step={0.05} defaultValue={1.0} onChange={setSpeed}/>
                <Knob label="SCAN"   value={scanlines}  min={0} max={1}  step={0.01} defaultValue={0.0} onChange={setScanlines}/>
                <Knob label="ZOOM"   value={zoom}       min={0} max={2}  step={0.01} defaultValue={0.0} onChange={setZoom}/>
              </div>
              {/* Sort key (color channel that drives PIXEL SORT) */}
              <div style={{ display: "flex", justifyContent: "center" }}>
                <SynthSelector label="SORT KEY" options={["LUM","HUE","SAT","R","G","B","INTENS","MIN"]} value={Math.round(sortKey)} onChange={(v) => setSortKey(v)}/>
              </div>
            </SynthPanel>



            {/* v1.3.78 — PIXEL GEN II removed (perf). */}

            {/* ── v1.3.58/v1.3.60 GLITCH PALETTE rack (kept as POWER-gated
                fallback for the v1.3.60 modulator system; ARTIST FX above
                is the new primitive layer). */}
            <SynthPanel title="GLITCH PALETTE" subtitle="9 HOMAGES · LIVE + RAW" accent="rgba(255,180,255,0.95)">
              <SynthSwitch
                label="POWER"
                offLabel="OFF"
                onLabel="ON"
                on={glitchPresetEnabled}
                onChange={setGlitchPresetEnabled}
              />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginTop: 10 }}>
                {GLITCH_PRESETS.map((p, i) => {
                  const active = glitchPreset === i;
                  return (
                    <button
                      aria-pressed={active}
                      key={p.name}
                      onClick={() => setGlitchPreset(i)}
                      title={`${p.name} — ${p.signature}`}
                      style={{
                        padding: "8px 4px 6px",
                        fontSize: 11,
                        letterSpacing: "1px",
                        fontWeight: 700,
                        fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
                        background: active ? `${p.color}33` : "rgba(255,255,255,0.04)",
                        border: `1px solid ${active ? p.color : "rgba(244,246,255,0.2)"}`,
                        color: active ? p.color : "rgba(244,246,255,0.72)",
                        cursor: "pointer",
                        borderRadius: 5,
                        boxShadow: active ? `0 0 10px ${p.color}77, inset 0 0 6px ${p.color}33` : "none",
                        transition: "all 0.15s ease",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 2,
                        lineHeight: 1.1,
                      }}
                    >
                      <span>{p.name}</span>
                      <span style={{ fontSize: 7, fontWeight: 500, letterSpacing: "0.4px", opacity: 0.75 }}>
                        {p.signature}
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* v1.5.0 — ARTIST FX raw primitives folded in here, behind a disclosure. */}
              <button className="sp-tile" onClick={() => setRawFxOpen(v => !v)}
                style={{ ...modeBtnStyle, width: "100%", marginTop: 10, fontSize: 9, letterSpacing: "1.6px" }}
                title="Nine raw GPU primitives, one per artist family (the tiles above are the live, modulated versions)">
                {rawFxOpen ? "▾ RAW PRIMITIVES" : "▸ RAW PRIMITIVES · 9 KNOBS"}
              </button>
              {rawFxOpen && (() => {
                const artistRows: Array<{ label: string; amt: number; setAmt: (v: number) => void }> = [
                  { label: "MENK", amt: menkmanFX,  setAmt: setMenkmanFX  },
                  { label: "MOLN", amt: molnarFX,   setAmt: setMolnarFX   },
                  { label: "UCNV", amt: ucnvFX,     setAmt: setUcnvFX     },
                  { label: "GYSN", amt: gysinFX,    setAmt: setGysinFX    },
                  { label: "ASEN", amt: asendorfFX, setAmt: setAsendorfFX },
                  { label: "JODI", amt: jodiFX,     setAmt: setJodiFX     },
                  { label: "ARCN", amt: arcangelFX, setAmt: setArcangelFX },
                  { label: "PAIK", amt: paikFX,     setAmt: setPaikFX     },
                  { label: "FENT", amt: fentonFX,   setAmt: setFentonFX   },
                ];
                return (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 8, marginTop: 10, justifyItems: "center" }}>
                      {artistRows.map(row => (
                        <Knob key={row.label} label={row.label} value={row.amt} min={0} max={1} step={0.01} defaultValue={0} onChange={row.setAmt} size={44} />
                      ))}
                    </div>
                    <div style={{ marginTop: 8, display: "flex", justifyContent: "center" }}>
                      <button className="sp-btn"
                        onClick={() => {
                          setMenkmanFX(0); setMolnarFX(0); setUcnvFX(0); setGysinFX(0);
                          setAsendorfFX(0); setJodiFX(0); setArcangelFX(0); setPaikFX(0); setFentonFX(0);
                          setMenkmanFam(0); setMolnarFam(0); setUcnvFam(0); setGysinFam(0);
                          setAsendorfFam(0); setJodiFam(0); setArcangelFam(0); setPaikFam(0); setFentonFam(0);
                        }}
                        style={{ fontSize: 9, padding: "6px 12px", letterSpacing: "1.4px", color: "rgba(255,140,140,0.95)" }}
                        title="Reset all 9 raw primitives">ALL OFF</button>
                    </div>
                  </>
                );
              })()}
              <div style={{ marginTop: 8, fontSize: 8, letterSpacing: "1px", color: "rgba(255,180,255,0.55)", textAlign: "center" }}>
                each preset is a live generator · uniforms breathe per frame
              </div>
            </SynthPanel>
          </div>


          {false && <Section title="PRESETS" id="presets" open={openSections.has("presets")} onToggle={toggleSection}>
            <div style={{ padding: "8px 10px", display: "grid", gap: 6 }}>
              <div style={{ fontSize: 9, letterSpacing: "1.1px", color: "rgba(200,180,220,0.66)", textTransform: "uppercase" }}>Local presets only. No login required.</div>
              {/* Rainbow Quick-Slot Scroll Wheel — large touch targets, color-coded
                  per slot so favourites are recognisable at a glance and harder
                  to fat-finger. Scrolls vertically when the list overflows. */}
              <div style={{
                fontSize: 9, letterSpacing: "1.4px", color: "rgba(248,248,248,0.55)",
                textTransform: "uppercase", padding: "4px 2px 0",
              }}>Quick Slots · Rainbow Wheel</div>
              <div
                style={{
                  display: "grid", gridTemplateColumns: "1fr",
                  gap: 8, padding: 8, borderRadius: 10,
                  background: "linear-gradient(180deg,#08080d,#03030a)",
                  border: "1px solid rgba(18,0,255,0.35)",
                  boxShadow: "inset 0 0 12px rgba(18,0,255,0.18)",
                  maxHeight: 360, overflowY: "auto",
                  WebkitOverflowScrolling: "touch",
                  scrollSnapType: "y proximity",
                }}
              >
                {quickSlots.map((slotName, i) => {
                  const hue = (i / quickSlots.length) * 360;
                  const accent = `hsl(${hue},95%,55%)`;
                  const accentDim = `hsla(${hue},95%,55%,0.18)`;
                  const filled = !!slotName;
                  return (
                    <button
                      key={`slot-${i}`}
                      onClick={() => {
                        if (!slotName) return;
                        const p = presets.find(x => x.name === slotName);
                        if (p) applyPreset(p);
                      }}
                      title={slotName || `Empty slot S${i+1} — assign with ★ on a saved preset below`}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "14px 14px",
                        minHeight: 56,
                        border: filled ? `1px solid ${accent}` : "1px solid rgba(255,255,255,0.07)",
                        borderRadius: 8,
                        background: filled
                          ? `linear-gradient(90deg, ${accentDim}, transparent 75%), linear-gradient(180deg,#0a0a12,#05050b)`
                          : "linear-gradient(180deg,#0a0a12,#05050b)",
                        color: filled ? "#f8f8f8" : "rgba(248,248,248,0.4)",
                        fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
                        fontSize: 12, letterSpacing: "1.2px", fontWeight: 700,
                        textAlign: "left",
                        cursor: filled ? "pointer" : "default",
                        boxShadow: filled
                          ? `0 0 14px ${accent}55, inset 0 0 0 0 transparent`
                          : "none",
                        scrollSnapAlign: "start",
                        textTransform: "uppercase",
                        position: "relative", overflow: "hidden",
                      }}
                    >
                      <div style={{
                        width: 8, height: 36, borderRadius: 4,
                        background: filled ? accent : "rgba(255,255,255,0.08)",
                        boxShadow: filled ? `0 0 10px ${accent}` : "none",
                        flexShrink: 0,
                      }}/>
                      <div style={{
                        fontSize: 10, opacity: 0.7,
                        color: filled ? "#f8f8f8" : "rgba(248,248,248,0.4)",
                        minWidth: 26,
                      }}>{`S${i+1}`}</div>
                      <div style={{
                        flex: 1, minWidth: 0,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>{slotName || "EMPTY"}</div>
                      {filled && (
                        <div style={{
                          fontSize: 16, lineHeight: 1, color: accent,
                          textShadow: `0 0 8px ${accent}`,
                        }}>▶</div>
                      )}
                    </button>
                  );
                })}
              </div>
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="preset name"
                style={{
                  background: "#120E07", border: "1px solid rgba(61,48,32,0.9)", color: "rgba(240,222,180,0.9)",
                  borderRadius: 8, padding: "8px 10px", fontSize: 10, letterSpacing: "1px", textTransform: "uppercase",
                }}
              />
              <button className="sp-tile" onClick={savePreset} style={{ ...modeBtnStyle, width: "100%" }}>SAVE CURRENT AS PRESET</button>
              {filteredPresets.length > 0 && (
                <div style={{ fontSize: 9, letterSpacing: "1.5px", color: "rgba(200,180,220,0.5)", padding: "6px 2px 2px", textTransform: "uppercase" }}>SAVED PRESETS</div>
              )}
              {filteredPresets.map((p) => (
                <div key={p.name} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 6 }}>
                  <button className="sp-tile" onClick={() => applyPreset(p)} style={{ ...modeBtnStyle, textAlign: "left", padding: "10px" }}>{p.name}</button>
                  <button className="sp-tile" onClick={() => autoAssignQuickSlot(p.name)} style={{ ...modeBtnStyle, minWidth: 44 }} title="Assign to quick slot">★</button>
                  <button className="sp-tile" onClick={() => setPresetName(p.name)} style={{ ...modeBtnStyle, minWidth: 44 }}>✎</button>
                  <button className="sp-tile" onClick={() => deletePreset(p.name)} style={{ ...modeBtnStyle, minWidth: 44 }}>✕</button>
                </div>
              ))}
            </div>
          </Section>}

          <div style={{ display: activeTab === "vj" ? "contents" : "none" }}>
            <SynthPanel title="VJ" subtitle="AUTO-VJ · AUDIO IN · DISPLAY OUT" accent="rgba(82,201,122,0.95)">
              <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Auto-VJ</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="sp-tile" onClick={() => { setVjMode(a => !a); playSfx("toggle"); }}
                  title="Autonomous FX blending — presets cycle on the beat of the selected audio input"
                  aria-pressed={!!(vjMode)} style={{ ...modeBtnStyle, ...(vjMode ? modeBtnActive : {}), minWidth: 120, ...(vjMode ? { animation: "activeGlow 1.6s ease-in-out infinite" } : {}) }}>
                  {vjMode ? "◉ AUTO-VJ ON" : "○ AUTO-VJ OFF"}</button>
              {/* v1.2.72 — HANDS-FREE compact button: 3-2-1 count-IN, then
                  60 s auto-record, then 3-2-1 count-OUT, then auto-stop.
                  Tap again at any phase to cancel/stop. Lives next to
                  RECORD so it doesn't obscure other UI. */}
              <button
                className="sp-tile"
                onClick={startHandsFree}
                title="3-2-1 countdown, then auto-record 60 s, then auto-stop"
                aria-pressed={!!(handsFreeCountdown != null)} style={{
                  ...modeBtnStyle,
                  ...(handsFreeCountdown != null ? modeBtnActive : {}),
                  minWidth: 150, minHeight: 36, fontSize: 10, letterSpacing: "1.5px",
                  ...(handsFreeCountdown != null ? { animation: "activeGlow 1s ease-in-out infinite" } : {}),
                }}
              >{handsFreeCountdown == null
                  ? `⏱ HANDS-FREE · ${HANDS_FREE_SEC}s`
                  : handsFreeCountdown.phase === "in"
                    ? `✕ CANCEL · ${handsFreeCountdown.n}…`
                    : handsFreeCountdown.phase === "out"
                      ? `✕ STOP · ${handsFreeCountdown.n}s`
                      : `✕ STOP · ${handsFreeCountdown.n}s LEFT`}</button>
              </div>
              {/* vj-io (v1.4.2) — plug-and-play audio in / display out */}
              <div id="gps-vj-audio-in" style={{
                fontSize: 9, letterSpacing: "1.4px", color: vjRowFlash ? "rgba(174,255,231,1)" : "rgba(231,174,255,0.55)", textTransform: "uppercase",
                scrollMarginTop: 12, transition: "color 0.4s",
              }}>VJ · Audio In</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", outline: vjRowFlash ? "1px solid rgba(174,255,231,0.8)" : "1px solid transparent", outlineOffset: 4, borderRadius: 6, transition: "outline-color 0.4s" }}>
                <button className="sp-tile" onClick={() => setAudioReactOn(!audioReactOn)} title="Listen to the selected input and drive the racks from it"
                  aria-pressed={!!(audioReactOn)} style={{ ...modeBtnStyle, ...(audioReactOn ? modeBtnActive : {}), minWidth: 110 }}>{audioReactOn ? "● AUDIO REACT ON" : "○ AUDIO REACT OFF"}</button>
                <button className="sp-tile"
                  onClick={() => { if (trackName) toggleTrackPlayback(); else trackFileInputRef.current?.click(); }}
                  title={trackName ? `Track: ${trackName} — tap to ${trackPlaying ? "pause" : "play"}` : "Load an audio file from the phone and react to it (plays through the speaker)"}
                  aria-pressed={!!(trackName)} style={{ ...modeBtnStyle, ...(trackName ? modeBtnActive : {}), minWidth: 90 }}>{trackName ? (trackPlaying ? "▮▮ TRACK" : "▶ TRACK") : "LOAD TRACK"}</button>
                {trackName && (
                  <button className="sp-tile" onClick={() => stopTrack()} title="Unload the track and go back to the live input"
                    style={{ ...modeBtnStyle, minWidth: 70 }}>UNLOAD</button>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="sp-tile" onClick={() => setAudioInPref("auto")} title="External input whenever one is plugged in, phone mic otherwise"
                  aria-pressed={!!(audioInPref === "auto")} style={{ ...modeBtnStyle, ...(audioInPref === "auto" ? modeBtnActive : {}), minWidth: 70 }}>AUTO</button>
                <button className="sp-tile" onClick={() => setAudioInPref("builtin")}
                  aria-pressed={!!(audioInPref === "builtin")} style={{ ...modeBtnStyle, ...(audioInPref === "builtin" ? modeBtnActive : {}), minWidth: 70 }}>PHONE MIC</button>
                {audioInputs.filter(d => d.kind === "external").map(d => (
                  <button key={d.deviceId} className="sp-tile" onClick={() => setAudioInPref({ deviceId: d.deviceId })} title={d.label}
                    aria-pressed={!!(typeof audioInPref === "object" && audioInPref.deviceId === d.deviceId)} style={{ ...modeBtnStyle, ...(typeof audioInPref === "object" && audioInPref.deviceId === d.deviceId ? modeBtnActive : {}), minWidth: 70, maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.label.replace(/\s*\([^)]*\)\s*$/, "").slice(0, 20).toUpperCase()}
                  </button>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "center" }}>
                <Knob label="REACT" value={audioReactAmt} min={0} max={1} step={0.01} defaultValue={0.75} onChange={setAudioReactAmt} size={46} />
                <div style={{ fontSize: 8, letterSpacing: "1px", color: "rgba(200,180,220,0.6)", lineHeight: 1.35, textTransform: "uppercase" }}>
                  How hard the input pushes SORT / MOSH on top of your knobs. 0 = shader-only reactivity, 1 = full lift on every beat.
                </div>
              </div>
              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Audio Rack · what the sound drives</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                {AUDIO_RACK.map(e => (
                  <button key={e.id} className="sp-tile" aria-pressed={!!audioRackOn[e.id]} onClick={() => toggleAudioRack(e.id)} title={e.hint}
                    style={{ ...modeBtnStyle, ...(audioRackOn[e.id] ? modeBtnActive : {}), padding: "8px 4px 6px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, lineHeight: 1.1 }}>
                    <span style={{ fontSize: 11, letterSpacing: "1.2px" }}>{e.label}</span>
                    <span style={{ fontSize: 7, letterSpacing: "0.6px", opacity: 0.75 }}>{e.src}</span>
                  </button>
                ))}
              </div>
              {/* live meter: level / bass / beat straight from the render loop's analysis */}
              <div style={{ display: "grid", gridTemplateColumns: "34px 1fr", gap: "3px 8px", alignItems: "center", fontSize: 7, letterSpacing: "1px", color: "rgba(200,180,220,0.6)", textTransform: "uppercase" }}>
                {([["LEVEL", "rgba(174,255,231,0.9)"], ["BASS", "rgba(231,174,255,0.9)"], ["BEAT", "rgba(255,180,80,0.95)"]] as [string, string][]).map(([lbl, c], i) => (
                  <Fragment key={lbl}>
                    <span>{lbl}</span>
                    <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                      <div ref={(el) => { meterRefs.current[i] = el; }} style={{ height: "100%", width: "0%", background: c, transition: "width 100ms linear" }} />
                    </div>
                  </Fragment>
                ))}
              </div>
              <div ref={audioDiagRef} style={{ fontSize: 7, letterSpacing: "1px", color: "rgba(200,180,220,0.5)", textTransform: "uppercase", fontVariantNumeric: "tabular-nums" }}>—</div>
              <div style={{ fontSize: 8, letterSpacing: "1px", color: audioInInfo ? "rgba(174,255,231,0.8)" : "rgba(200,180,220,0.55)", textTransform: "uppercase" }}>
                {!audioReactOn
                  ? "IN · OFF — tap AUDIO REACT or ♪ to listen"
                  : trackName
                    ? `IN · TRACK · ${trackName}${trackPlaying ? " · playing" : " · paused"}`
                    : audioInInfo
                      ? `IN · ${audioInInfo.label} · ${Math.round(audioInInfo.sampleRate / 1000)} kHz · ${audioInInfo.channelCount >= 2 ? "stereo" : "mono"}${audioInInfo.kind === "external" ? " · line" : ""}`
                      : "IN · opening audio input… (allow the microphone if asked) · a USB interface or DJ mixer takes over when plugged in"}
              </div>

              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>VJ · Display Out</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="sp-tile" onClick={() => setVjOutAuto(true)} title="Hide the UI and keep the screen awake whenever an external display is connected"
                  aria-pressed={!!(vjOutAuto)} style={{ ...modeBtnStyle, ...(vjOutAuto ? modeBtnActive : {}), minWidth: 70 }}>AUTO</button>
                <button className="sp-tile" onClick={() => setVjOutAuto(false)}
                  aria-pressed={!!(!vjOutAuto)} style={{ ...modeBtnStyle, ...(!vjOutAuto ? modeBtnActive : {}), minWidth: 70 }}>MANUAL</button>
              </div>
              <div style={{ fontSize: 8, letterSpacing: "1px", color: vjOutDisplay ? "rgba(174,255,231,0.8)" : "rgba(200,180,220,0.55)", textTransform: "uppercase" }}>
                {vjOutDisplay
                  ? `OUT · ${vjOutDisplay.name ?? "external display"}${vjOutDisplay.width ? ` · ${vjOutDisplay.width}×${vjOutDisplay.height}` : ""} · mirrored`
                  : "OUT · plug a USB-C → HDMI adapter or cast · the canvas goes full-bleed on its own"}
              </div>

              </div>
            </SynthPanel>
          </div>

          <div style={{ display: activeTab === "export" ? "contents" : "none" }}>
            <SynthPanel title="EXPORT" subtitle="GIF · VIDEO · CAMERA · PROJECT" accent="rgba(232,160,32,0.95)">
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Format</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  className="sp-tile"
                  onClick={() => setExportFormat("gif")}
                  aria-pressed={!!(exportFormat === "gif")} style={{ ...modeBtnStyle, ...(exportFormat === "gif" ? modeBtnActive : {}), minWidth: 80 }}
                >GIF</button>
                <button
                  className="sp-tile"
                  onClick={() => setExportFormat("video")}
                  aria-pressed={!!(exportFormat === "video")} style={{ ...modeBtnStyle, ...(exportFormat === "video" ? modeBtnActive : {}), minWidth: 80 }}
                >VIDEO</button>
              </div>

              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Quality</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="sp-tile" onClick={() => setExportQuality("standard")} aria-pressed={!!(exportQuality === "standard")} style={{ ...modeBtnStyle, ...(exportQuality === "standard" ? modeBtnActive : {}), minWidth: 70 }}>STD</button>
                <button className="sp-tile" onClick={() => setExportQuality("high")} aria-pressed={!!(exportQuality === "high")} style={{ ...modeBtnStyle, ...(exportQuality === "high" ? modeBtnActive : {}), minWidth: 70 }}>HIGH</button>
                <button className="sp-tile" onClick={() => setExportQuality("ultra")} aria-pressed={!!(exportQuality === "ultra")} style={{ ...modeBtnStyle, ...(exportQuality === "ultra" ? modeBtnActive : {}), minWidth: 70 }}>ULTRA</button>
              </div>

              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Aspect</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="sp-tile" onClick={() => setExportProfile("native")} aria-pressed={!!(exportProfile === "native")} style={{ ...modeBtnStyle, ...(exportProfile === "native" ? modeBtnActive : {}), minWidth: 70 }}>NATIVE</button>
                <button className="sp-tile" onClick={() => setExportProfile("vertical")} aria-pressed={!!(exportProfile === "vertical")} style={{ ...modeBtnStyle, ...(exportProfile === "vertical" ? modeBtnActive : {}), minWidth: 70 }}>9:16</button>
                <button className="sp-tile" onClick={() => setExportProfile("square")} aria-pressed={!!(exportProfile === "square")} style={{ ...modeBtnStyle, ...(exportProfile === "square" ? modeBtnActive : {}), minWidth: 70 }}>1:1</button>
                <button className="sp-tile" onClick={() => setExportProfile("widescreen")} aria-pressed={!!(exportProfile === "widescreen")} style={{ ...modeBtnStyle, ...(exportProfile === "widescreen" ? modeBtnActive : {}), minWidth: 70 }}>16:9</button>
              </div>

              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Frame Rate</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="sp-tile" onClick={() => setRecordFps(24)} aria-pressed={!!(recordFps === 24)} style={{ ...modeBtnStyle, ...(recordFps === 24 ? modeBtnActive : {}), minWidth: 70 }}>24 FPS</button>
                <button className="sp-tile" onClick={() => setRecordFps(30)} aria-pressed={!!(recordFps === 30)} style={{ ...modeBtnStyle, ...(recordFps === 30 ? modeBtnActive : {}), minWidth: 70 }}>30 FPS</button>
                <button className="sp-tile" onClick={() => setRecordFps(60)} aria-pressed={!!(recordFps === 60)} style={{ ...modeBtnStyle, ...(recordFps === 60 ? modeBtnActive : {}), minWidth: 70 }}>60 FPS</button>
              </div>

              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Length</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="sp-tile" onClick={() => setRecordMaxSec(5)}  aria-pressed={!!(recordMaxSec === 5 )} style={{ ...modeBtnStyle, ...(recordMaxSec === 5  ? modeBtnActive : {}), minWidth: 60 }}>5s</button>
                <button className="sp-tile" onClick={() => setRecordMaxSec(15)} aria-pressed={!!(recordMaxSec === 15)} style={{ ...modeBtnStyle, ...(recordMaxSec === 15 ? modeBtnActive : {}), minWidth: 60 }}>15s</button>
                <button className="sp-tile" onClick={() => setRecordMaxSec(30)} aria-pressed={!!(recordMaxSec === 30)} style={{ ...modeBtnStyle, ...(recordMaxSec === 30 ? modeBtnActive : {}), minWidth: 60 }}>30s</button>
                <button className="sp-tile" onClick={() => setRecordMaxSec(60)} aria-pressed={!!(recordMaxSec === 60)} style={{ ...modeBtnStyle, ...(recordMaxSec === 60 ? modeBtnActive : {}), minWidth: 60 }}>60s</button>
              </div>

              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Loop</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="sp-tile" onClick={() => setPerfectLoop(true)}  aria-pressed={!!(perfectLoop )} style={{ ...modeBtnStyle, ...(perfectLoop  ? modeBtnActive : {}), minWidth: 90 }}>PERFECT LOOP</button>
                <button className="sp-tile" onClick={() => setPerfectLoop(false)} aria-pressed={!!(!perfectLoop)} style={{ ...modeBtnStyle, ...(!perfectLoop ? modeBtnActive : {}), minWidth: 70 }}>FULL LEN</button>
              </div>

              <div style={{
                fontSize: 9, letterSpacing: "1px", color: "rgba(200,134,10,0.7)",
                padding: "6px 8px", borderRadius: 6,
                background: "rgba(20,2,32,0.55)",
                border: "1px solid rgba(83,16,120,0.4)",
              }}>
                {exportFormat === "gif"
                  ? `${exportQuality.toUpperCase()} GIF — ${getGifProfile(exportQuality).maxDim}px @ ${Math.round(getGifProfile(exportQuality).fps)}fps · ${exportProfile === "native" ? "native aspect" : exportProfile === "vertical" ? "9:16" : exportProfile === "square" ? "1:1" : "16:9"} · ${recordMaxSec}s`
                  : `${exportQuality.toUpperCase()} VIDEO — ${getExportMaxDim(exportQuality)}px @ ${recordFps}fps · ${exportProfile === "native" ? "native aspect" : exportProfile === "vertical" ? "9:16" : exportProfile === "square" ? "1:1" : "16:9"} · ${recordMaxSec}s${audioActive ? " · 🔊 AUDIO" : ""}`}
              </div>
              {exportFormat === "video" && !audioActive && (
                <div style={{ fontSize: 8, letterSpacing: "1px", color: "rgba(200,180,220,0.55)", textAlign: "center", textTransform: "uppercase" }}>
                  Audio is recorded from the VJ · Audio In source (tap ♪)
                </div>
              )}
              {exportFormat === "gif" && (
                <div style={{ fontSize: 8, letterSpacing: "1px", color: "rgba(200,180,220,0.55)", textAlign: "center", textTransform: "uppercase" }}>
                  GIF export is silent (no audio track)
                </div>
              )}

              <button
                className="sp-tile"
                onClick={() => { if (recording) stopRecordingRef.current(); else startRecordingRef.current(); }}
                aria-pressed={!!(recording)} style={{
                  ...modeBtnStyle,
                  ...(recording ? modeBtnActive : {}),
                  width: "100%", minHeight: 56, fontSize: 13, letterSpacing: "2px",
                  ...(recording ? { animation: "activeGlow 1s ease-in-out infinite" } : {}),
                }}
              >{recording ? "■ STOP RECORDING" : "● RECORD"}</button>
              <div style={{ fontSize: 8, letterSpacing: "1px", color: "rgba(200,180,220,0.4)", textAlign: "center", textTransform: "uppercase" }}>
                Tip: hold canvas also records
              </div>

              <div style={{ height: 4 }}/>
              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Camera</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  className="sp-tile"
                  onClick={cameraActive ? stopCamera : () => { void startCamera(); }}
                  aria-pressed={!!(cameraActive)} style={{ ...modeBtnStyle, ...(cameraActive ? modeBtnActive : {}), flex: 1, minWidth: 86 }}
                >{cameraActive ? "CAM ON" : "CAM OFF"}</button>
                <button
                  className="sp-tile"
                  onClick={() => { void hardResetCamera(); }}
                  style={{ ...modeBtnStyle, flex: 1, minWidth: 110 }}
                >HARD RESET CAM</button>
              </div>

              <div style={{ height: 4 }}/>
              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Project</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="sp-tile" onClick={saveProject} style={{ ...modeBtnStyle, flex: 1, fontSize: 10 }}>SAVE PROJECT</button>
                <button className="sp-tile" onClick={() => projectFileInputRef.current?.click()} style={{ ...modeBtnStyle, flex: 1, fontSize: 10 }}>LOAD PROJECT</button>
              </div>

              {/* ── v1.3.43 MACROS row (4 global FX dials) ────────── */}
              <div style={{ height: 4 }}/>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase",
              }}>
                <span>Macros · Global FX Mix</span>
                <button
                  onClick={() => { setIntensityMacro(1.0); setMotionMacro(1.0); setColorMacro(1.0); setBreakMacro(1.0); }}
                  title="Reset all 4 macros to 1.0 (pass-through)"
                  style={{
                    background: "transparent", border: "1px solid rgba(231,174,255,0.25)",
                    color: "rgba(231,174,255,0.7)", borderRadius: 4, padding: "1px 6px",
                    fontSize: 8, letterSpacing: "1px", cursor: "pointer", textTransform: "uppercase",
                  }}
                >reset</button>
              </div>
              {([
                { label: "INT", v: intensityMacro, set: setIntensityMacro, hint: "Intensity: structured FX amount (sort, mosh, glyph, react, radial warps, liquid)" },
                { label: "MOT", v: motionMacro,    set: setMotionMacro,    hint: "Motion: temporal animation (sort wobble, mosh motion / bleed / I-frame)" },
                { label: "COL", v: colorMacro,     set: setColorMacro,     hint: "Color: palette aggressiveness (sat / contrast / brightness lerp from neutral, hue shift scale)" },
                { label: "BRK", v: breakMacro,     set: setBreakMacro,     hint: "Break: chaos / corruption (chrash, feedback, block glitch, mosh distort, scan tear, sort random, disrupt, RGB drift)" },
              ] as const).map(({ label, v, set, hint }) => (
                <div key={label} title={hint} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <div style={{
                    width: 32, fontSize: 10, letterSpacing: "1.5px",
                    color: Math.abs(v - 1.0) < 0.005 ? "rgba(231,174,255,0.55)" : "rgba(232,160,32,0.95)",
                    fontWeight: 600,
                  }}>{label}</div>
                  <input
                    type="range" min={0} max={1.5} step={0.01} value={v}
                    onChange={(e) => set(parseFloat(e.target.value))}
                    onDoubleClick={() => set(1.0)}
                    style={{ flex: 1, background: "linear-gradient(to right, #1A0329, #B014F0 66%, #C840FF)" }}
                  />
                  <div style={{
                    width: 36, textAlign: "right", fontSize: 10,
                    color: Math.abs(v - 1.0) < 0.005 ? "rgba(231,174,255,0.55)" : "rgba(232,160,32,0.95)",
                    fontVariantNumeric: "tabular-nums",
                  }}>{v.toFixed(2)}</div>
                </div>
              ))}

              {/* ── PERFORMANCE / TIER row */}
              <div style={{ height: 4 }}/>
              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Performance · Tier</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  className="sp-tile"
                  onClick={() => setLowPowerOn(v => !v)}
                  title="Cap render to ~30fps to reduce battery + heat"
                  aria-pressed={!!(lowPowerOn)} style={{
                    ...modeBtnStyle,
                    ...(lowPowerOn ? modeBtnActive : {}),
                    flex: 1, fontSize: 10, minWidth: 110,
                  }}
                >{lowPowerOn ? "❄ LOW POWER ON" : "❄ LOW POWER"}</button>
                <button
                  className="sp-tile"
                  onClick={() => setTierInfoOpen(true)}
                  title="View plans"
                  style={{
                    ...modeBtnStyle, flex: 1, fontSize: 10, minWidth: 110,
                    color: entitlement === "studio" ? "rgba(120,255,200,0.98)" : entitlement === "paid" ? "rgba(255,210,140,0.98)" : "rgba(231,174,255,0.95)",
                    textShadow: entitlement ? "0 0 6px rgba(232,160,32,0.7)" : "none",
                  }}
                >ℹ {entitlement === "studio" ? "STUDIO" : entitlement === "paid" ? "PAID" : "PLANS"}</button>
              </div>
              <div style={{ fontSize: 8, letterSpacing: "1px", color: "rgba(200,180,220,0.5)", textAlign: "center", textTransform: "uppercase", marginTop: 2 }}>
                Phone running hot? Try LOW POWER. · Tap status badge to see plans.
              </div>
              <div style={{ height: 6 }}/>
              <div style={{ fontSize: 9, letterSpacing: "1.4px", color: "rgba(231,174,255,0.55)", textTransform: "uppercase" }}>Legal · Listing</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  className="sp-tile"
                  onClick={() => openExternalLink(PRIVACY_URL)}
                  title="Open privacy policy"
                  style={{ ...modeBtnStyle, fontSize: 10, minWidth: 92 }}
                >PRIVACY</button>
                <button
                  className="sp-tile"
                  onClick={() => openExternalLink(TERMS_URL)}
                  title="Open terms of service"
                  style={{ ...modeBtnStyle, fontSize: 10, minWidth: 88 }}
                >TERMS</button>
                <button
                  className="sp-tile"
                  onClick={() => openExternalLink(PLAY_STORE_URL)}
                  title="Rate this app on Google Play"
                  style={{ ...modeBtnStyle, fontSize: 10, minWidth: 110 }}
                >★ RATE APP</button>
              </div>
            </div>
            </SynthPanel>
          </div>

          <div style={{ height: 28 }}/>
          </>)}
        </div>
      </div>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes btnPress  { 0%{transform:scale(1) translateY(0)} 45%{transform:scale(0.90) translateY(2px)} 100%{transform:scale(1) translateY(0)} }
        @keyframes tilePress { 0%{transform:scale(1) translateY(0)} 40%{transform:scale(0.92) translateY(3px)} 100%{transform:scale(1) translateY(0)} }
        @keyframes activeGlow{ 0%,100%{box-shadow:0 0 10px 1px rgba(200,134,10,0.3),0 3px 10px rgba(0,0,0,0.5)} 50%{box-shadow:0 0 22px 5px rgba(232,160,32,0.55),0 3px 10px rgba(0,0,0,0.5)} }
        .sp-btn:active  { animation: btnPress  0.18s ease forwards !important; filter: brightness(1.25); }
        .sp-tile:active { animation: tilePress 0.15s ease forwards !important; filter: brightness(1.2); }
        /* v1.5.0 — on touch screens a tapped button used to keep its hover
           look until the next tap landed elsewhere, so the previous choice
           stayed lit next to the new one. No tap highlight, no focus ring,
           hover styles only for mice (see @media (hover: hover) above). */
        button { -webkit-tap-highlight-color: transparent; }
        .sp-btn:focus:not(:focus-visible), .sp-tile:focus:not(:focus-visible) { outline: none; }
        .sp-rack-tabs { position: sticky; top: 56px; z-index: 29; display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; padding: 6px 10px 8px;
          background: linear-gradient(180deg, rgba(15,0,28,0.96) 0%, rgba(15,0,28,0.86) 100%); border-bottom: 1px solid rgba(231,174,255,0.25); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
        .sp-rack-tab { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 7px 2px 6px; border-radius: 8px; cursor: pointer;
          font-family: var(--font-space-mono,'Space Mono','Courier New',monospace); font-size: 9px; font-weight: 700; letter-spacing: 1.4px;
          color: rgba(237,232,248,0.6); background: linear-gradient(180deg,#1a1a22 0%,#0e0e14 100%); border: 1px solid rgba(0,0,0,0.7); }
        .sp-rack-tab[data-active="true"] { color: #fff; background: linear-gradient(180deg,#3a1a4d 0%,#1a0a25 100%); border-color: rgba(231,174,255,0.85);
          box-shadow: inset 0 1px 1px rgba(255,220,255,0.18), 0 0 10px rgba(231,174,255,0.35); text-shadow: 0 0 6px rgba(231,174,255,0.7); }
        .sp-rack-tab .pip { width: 6px; height: 6px; border-radius: 50%; opacity: 0.55; }
        .sp-rack-tab[data-active="true"] .pip { opacity: 1; box-shadow: 0 0 6px currentColor; }
        input[type=range] { -webkit-appearance:none; appearance:none; height:12px; border-radius:7px; cursor:pointer; outline:none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:28px; height:28px; border-radius:50%; cursor:grab; background:#B014F0; border:3px solid #D34BFF; box-shadow:0 2px 10px rgba(0,0,0,0.7),0 0 10px rgba(176,20,240,0.5); transition:transform .1s,box-shadow .1s; }
        input[type=range]:active::-webkit-slider-thumb { transform:scale(1.28); box-shadow:0 0 18px 4px rgba(211,75,255,0.7); cursor:grabbing; }
        input[type=range]::-moz-range-thumb { width:26px; height:26px; border-radius:50%; border:3px solid #D34BFF; background:#B014F0; cursor:grab; }
        input[type=range]::-webkit-slider-runnable-track { border-radius:7px; }
      `}</style>
    </div>
  );
}

// ── Design tokens ───────────────────────────────────────────
const T = {
  bg0:        "#060009",                            // deep black violet
  bg1:        "#0F001C",                            // dark purple panel
  bg2:        "#1A0329",                            // raised violet surface
  bg3:        "#26063C",                            // highlight purple surface
  border:     "#3D0A5C",                            // purple border (muted)
  borderHi:   "#8A22CC",                            // active border
  amber:      "#A012D8",                            // primary accent (more restrained)
  ochre:      "#C840FF",                            // bright accent / text active
  cream:      "#EDE8F8",                            // main text (slightly warmer)
  creamDim:   "rgba(237,232,248,0.58)",
  creamFaint: "rgba(237,232,248,0.24)",
  terracotta: "#C05A2A",                            // record / warning
  moss:       "#4A7A4C",                            // camera on / success
  cyan:       "#B055F0",                            // cool HUD accent only
  shadow:     "0 4px 16px rgba(0,0,0,0.8)",
  bevel:      "inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.6)",
  glow:       "0 0 12px 2px rgba(160,18,216,0.38)",
  glowActive: "0 0 20px 4px rgba(200,64,255,0.48)",
};

// ── TE gradient hallmark colors (OP-1 knob language) ────────
const TE = {
  blue:   "#4B9EFF",   // OP-1 blue knob   → VISION / ANIMATION
  green:  "#52C97A",   // OP-1 green knob  → SIGNAL FX / DRAW
  amber:  "#E8A020",   // TX-6 orange pip  → FX INTENSITY / PRESETS / EXPORT
  red:    "#E03D3D",   // OP-1 red knob    → GLITCH / CAMERA
  lilac:  "#C765FF",   // Spectra accent   → IMAGE / USER SETTINGS
};

// Colored pip per section (OP-1 knob language applied to panel sections)
const SECTION_PIP: Record<string, string> = {
  modes:   TE.blue,
  glitch:  TE.red,
  signal:  TE.green,
  fx:      TE.amber,
  image:   TE.lilac,
  anim:    TE.blue,
  draw:    TE.green,
  presets: TE.amber,
  camera:  TE.red,
  export:  TE.green,
  user:    TE.lilac,
};

// Mode button positional gradient (OP-XY key gradient: cool indigo → warm violet)
// Kept for legacy preset import compatibility — no longer rendered in current UI.
function modeBtnPositionalStyle(index: number, total: number): React.CSSProperties {
  const t = index / Math.max(1, total - 1);
  const hue = Math.round(252 + t * 38);
  const l1  = Math.round(11 + t * 5);
  const l2  = Math.round(7  + t * 4);
  const bh  = Math.round(252 + t * 38);
  const bl  = Math.round(20 + t * 10);
  return {
    background: `linear-gradient(170deg, hsl(${hue},62%,${l1}%) 0%, hsl(${hue},58%,${l2}%) 60%, hsl(${hue},55%,${l1-1}%) 100%)`,
    borderColor: `hsl(${bh},52%,${bl}%)`,
  };
}
void modeBtnPositionalStyle;

// ── Shared styles ────────────────────────────────────────────
const topBtnStyle: React.CSSProperties = {
  background: `linear-gradient(175deg, ${T.bg3} 0%, ${T.bg1} 55%, ${T.bg2} 100%)`,
  border: `2px solid ${T.border}`,
  borderBottom: `4px solid #090705`,
  borderRadius: 12,
  color: T.cream,
  width: 48, height: 48,
  fontSize: 18,
  cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "inherit",
  boxShadow: `0 4px 12px rgba(0,0,0,0.7), ${T.bevel}`,
  transition: "all 0.1s ease",
  flexShrink: 0,
};

const modeBtnStyle: React.CSSProperties = {
  background: `linear-gradient(170deg, ${T.bg3} 0%, ${T.bg1} 55%, ${T.bg2} 100%)`,
  border: `1px solid ${T.border}`,
  borderBottom: `2px solid #090705`,
  borderRadius: 8,
  color: T.creamDim,
  // Slim chip footprint (was 12px/8px @ minHeight 54). Tiles still read
  // as press-targets (>=32px tall) but stack 40% denser so 4- and 5-col
  // grids no longer dominate the carousel y-axis.
  padding: "6px 6px",
  fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
  fontSize: 9,
  letterSpacing: "1.2px",
  textTransform: "uppercase",
  cursor: "pointer",
  minWidth: 40, minHeight: 32,
  boxShadow: `0 2px 6px rgba(0,0,0,0.45), ${T.bevel}`,
  transition: "all 0.12s ease",
  lineHeight: 1.1,
};

const modeBtnActive: React.CSSProperties = {
  background: `linear-gradient(170deg, #2E2008 0%, #1A1205 55%, #251A07 100%)`,
  border: `1px solid ${T.amber}`,
  borderBottom: `2px solid #090705`,
  color: T.ochre,
  boxShadow: `${T.glowActive}, ${T.bevel}`,
  textShadow: `0 0 10px rgba(232,160,32,0.7)`,
};

// ── Section label helper ─────────────────────────────────────
function Section({ title, id, open, onToggle, children }: {
  title: string; id: string; open: boolean;
  onToggle: (id: string) => void; children: React.ReactNode;
}) {
  const pipColor = SECTION_PIP[id] ?? TE.lilac;
  return (
    <div style={{ borderBottom: "1px solid rgba(61,10,92,0.45)" }}>
      <button onClick={() => onToggle(id)} style={{
        width: "100%", display: "flex", alignItems: "center",
        background: open
          ? `linear-gradient(90deg, rgba(${hexToRgb(pipColor)},0.12) 0%, transparent 75%)`
          : "rgba(9,0,16,0.75)",
        border: "none", borderTop: `1px solid rgba(${hexToRgb(pipColor)},0.22)`,
        padding: "11px 12px", cursor: "pointer",
        fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
        fontSize: 11, letterSpacing: "1.5px",
        color: open ? T.cream : T.creamDim,
        textTransform: "uppercase", textAlign: "left",
      }}>
        {/* TE-style colored pip (OP-1 knob language) */}
        <span style={{
          display: "inline-block", width: 7, height: 7,
          background: open ? pipColor : `rgba(${hexToRgb(pipColor)},0.45)`,
          borderRadius: 2,
          marginRight: 9, flexShrink: 0,
          boxShadow: open ? `0 0 6px 1px ${pipColor}` : "none",
          transition: "all 0.15s ease",
        }}/>
        <span style={{
          display: "inline-block", width: 10, fontSize: 9,
          color: open ? pipColor : T.creamFaint,
          transform: open ? "rotate(90deg)" : "none",
          transition: "transform 0.15s ease", lineHeight: 1, marginRight: 8, flexShrink: 0,
        }}>▶</span>
        {title}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

// hex color → "r,g,b" for rgba()
function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// ── Slider helper ────────────────────────────────────────────
function SliderRow({
  label, value, min, max, step, onChange, index = 0,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; index?: number; compact?: boolean;
}) {
  const pct = Math.round(((value - min) / (max - min)) * 100);
  const isEven = index % 2 === 0;
  const displayVal = step >= 1 ? Math.round(value).toString() : value.toFixed(2);
  // v1.3.78 — rAF-coalesce onChange. A drag along the slider can fire
  // onInput/onChange 100+ times per second on a high-Hz touchscreen; React
  // can't keep up with that for a parent that re-renders the whole shader
  // panel. We collapse all events within one animation frame into a single
  // commit, which keeps the visual identical (you only see frames anyway).
  const pendingValRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const scheduleChange = (v: number) => {
    pendingValRef.current = v;
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const pv = pendingValRef.current;
      pendingValRef.current = null;
      if (pv != null) onChange(pv);
    });
  };
  useEffect(() => () => {
    if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
  }, []);
  // Subtle scan-line texture: alternates row direction so two rows feel woven.
  const rowTexture = isEven
    ? "repeating-linear-gradient(0deg, rgba(255,255,255,0.018) 0 1px, transparent 1px 3px)"
    : "repeating-linear-gradient(0deg, rgba(0,0,0,0.16) 0 1px, transparent 1px 3px)";
  const rowBase = isEven
    ? "linear-gradient(180deg, rgba(48,12,72,0.46) 0%, rgba(28,6,48,0.58) 100%)"
    : "linear-gradient(180deg, rgba(22,4,36,0.62) 0%, rgba(12,2,22,0.72) 100%)";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "88px 1fr 54px",
      alignItems: "stretch",
      background: `${rowTexture}, ${rowBase}`,
      borderTop: isEven ? "1px solid rgba(255,255,255,0.04)" : "1px solid rgba(0,0,0,0.32)",
      borderBottom: "1px solid rgba(83,16,120,0.32)",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.025), inset 0 -1px 0 rgba(0,0,0,0.34)",
      minHeight: 48,
    }}>
      <div style={{
        padding: "0 8px 0 12px", touchAction: "pan-y",
        display: "flex", alignItems: "center",
        fontSize: 10, letterSpacing: "0.8px", fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
        color: isEven ? "rgba(243,238,255,0.94)" : "rgba(231,174,255,0.86)",
        userSelect: "none", cursor: "ns-resize",
        borderRight: "1px solid rgba(83,16,120,0.42)",
        textShadow: "0 1px 0 rgba(0,0,0,0.55), 0 -1px 0 rgba(255,255,255,0.04)",
        textTransform: "uppercase",
      }}>{label}</div>
      <div style={{
        padding: "0 10px", touchAction: "none",
        display: "flex", alignItems: "center",
        background: "linear-gradient(180deg, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0.0) 35%, rgba(0,0,0,0.0) 65%, rgba(0,0,0,0.28) 100%)",
      }}>
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={e => scheduleChange(Number(e.target.value))}
          style={{
            width: "100%", cursor: "pointer", touchAction: "none",
            background: `linear-gradient(90deg, ${TE.blue} 0%, ${TE.lilac} ${pct}%, #15041F ${pct}%, #1C0630 100%)`,
            accentColor: T.ochre,
            borderRadius: 999,
            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.55), inset 0 -1px 0 rgba(255,255,255,0.05)",
          }}
        />
      </div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "flex-end",
        padding: "0 10px", fontSize: 11, fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
        color: "rgba(255,210,140,0.95)", userSelect: "none",
        borderLeft: "1px solid rgba(0,0,0,0.45)",
        background: "linear-gradient(180deg, #0A0312 0%, #160726 50%, #0A0312 100%)",
        boxShadow: "inset 1px 0 0 rgba(83,16,120,0.35), inset 0 1px 2px rgba(0,0,0,0.7)",
        textShadow: "0 0 6px rgba(232,160,32,0.55), 0 0 1px rgba(255,210,140,0.85)",
        letterSpacing: "0.5px",
      }}>{displayVal}</div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// SynthSwitch — chunky 2-position toggle (brushed metal lever)
// ───────────────────────────────────────────────────────────────────────
function SynthSwitch({
  label, on, onChange, onLabel = "ON", offLabel = "OFF",
}: {
  label: string; on: boolean; onChange: (v: boolean) => void;
  onLabel?: string; offLabel?: string;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 4, userSelect: "none", padding: "2px 4px", minWidth: 60,
    }}>
      <div style={{
        fontSize: 8, letterSpacing: "1.4px", textTransform: "uppercase",
        color: "rgba(243,238,255,0.78)", fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
        textShadow: "0 1px 0 rgba(0,0,0,0.7)",
        whiteSpace: "nowrap",
      }}>{label}</div>
      <div
        onClick={() => onChange(!on)}
        title={`${label}: ${on ? onLabel : offLabel}`}
        style={{
          position: "relative",
          width: 54, height: 30,
          borderRadius: 6,
          cursor: "pointer",
          background: "linear-gradient(180deg, #0E0E14 0%, #1C1C22 50%, #0A0A10 100%)",
          boxShadow: `
            inset 0 2px 4px rgba(0,0,0,0.85),
            inset 0 -1px 0 rgba(255,255,255,0.06),
            0 1px 0 rgba(255,255,255,0.04)
          `,
          border: "1px solid rgba(0,0,0,0.7)",
          padding: 2,
          display: "flex",
        }}
      >
        <div style={{
          width: "50%", height: "100%",
          marginLeft: on ? "50%" : "0%",
          transition: "margin-left 0.12s ease",
          borderRadius: 4,
          background: on
            ? "linear-gradient(180deg, #F4F4F8 0%, #BFBFC8 35%, #6E6E78 70%, #2C2C34 100%)"
            : "linear-gradient(180deg, #5A5A66 0%, #3A3A44 50%, #1E1E26 100%)",
          boxShadow: on
            ? "inset 0 1px 1px rgba(255,255,255,0.55), inset 0 -1px 2px rgba(0,0,0,0.6), 0 0 8px rgba(231,174,255,0.55), 0 1px 2px rgba(0,0,0,0.6)"
            : "inset 0 1px 1px rgba(255,255,255,0.18), inset 0 -1px 2px rgba(0,0,0,0.6), 0 1px 2px rgba(0,0,0,0.6)",
          // brushed metal grain
          backgroundImage: on
            ? "repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 3px), linear-gradient(180deg, #F4F4F8 0%, #BFBFC8 35%, #6E6E78 70%, #2C2C34 100%)"
            : "repeating-linear-gradient(90deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 3px), linear-gradient(180deg, #5A5A66 0%, #3A3A44 50%, #1E1E26 100%)",
        }}/>
      </div>
      <div style={{
        fontSize: 9, fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
        letterSpacing: "0.5px",
        color: on ? "rgba(255,210,140,0.95)" : "rgba(180,140,90,0.55)",
        background: "linear-gradient(180deg, #0A0312 0%, #160726 100%)",
        border: "1px solid rgba(0,0,0,0.55)",
        padding: "1px 6px",
        borderRadius: 3,
        minWidth: 36,
        textAlign: "center",
        textShadow: on ? "0 0 5px rgba(232,160,32,0.6)" : "none",
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.6)",
      }}>{on ? onLabel : offLabel}</div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// SynthSelector — chunky multi-position rotary selector (enum)
// ───────────────────────────────────────────────────────────────────────
function SynthSelector({
  label, options, value, onChange,
}: {
  label: string; options: readonly string[]; value: number; onChange: (v: number) => void;
}) {
  const v = Math.max(0, Math.min(options.length - 1, value));
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 4, userSelect: "none", padding: "2px 4px",
    }}>
      <div style={{
        fontSize: 8, letterSpacing: "1.4px", textTransform: "uppercase",
        color: "rgba(243,238,255,0.78)", fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
        textShadow: "0 1px 0 rgba(0,0,0,0.7)",
        whiteSpace: "nowrap",
      }}>{label}</div>
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 2,
        padding: 3,
        borderRadius: 6,
        background: "linear-gradient(180deg, #0E0E14 0%, #1C1C22 50%, #0A0A10 100%)",
        boxShadow: "inset 0 2px 4px rgba(0,0,0,0.85), 0 1px 0 rgba(255,255,255,0.04)",
        border: "1px solid rgba(0,0,0,0.7)",
        maxWidth: 120,
        justifyContent: "center",
      }}>
        {options.map((opt, i) => {
          const active = i === v;
          return (
            <button
              aria-pressed={active}
              key={opt}
              onClick={() => onChange(i)}
              style={{
                padding: "3px 6px",
                fontSize: 8, letterSpacing: "0.8px",
                fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
                fontWeight: active ? 700 : 500,
                cursor: "pointer",
                borderRadius: 3,
                border: "1px solid rgba(0,0,0,0.7)",
                color: active ? "rgba(255,210,140,1)" : "rgba(200,180,220,0.55)",
                textShadow: active ? "0 0 6px rgba(232,160,32,0.7)" : "none",
                background: active
                  ? "linear-gradient(180deg, #4A0F66 0%, #2A0540 100%)"
                  : "linear-gradient(180deg, #2A2A33 0%, #14141A 100%)",
                boxShadow: active
                  ? "inset 0 1px 1px rgba(255,255,255,0.18), inset 0 -1px 2px rgba(0,0,0,0.6), 0 0 6px rgba(176,20,240,0.5)"
                  : "inset 0 1px 1px rgba(255,255,255,0.05), inset 0 -1px 2px rgba(0,0,0,0.6)",
                minWidth: 28,
              }}
            >{opt}</button>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// SynthPanel — chunky brushed-metal chassis with screws + amber title strip
// ───────────────────────────────────────────────────────────────────────
// Accordion coordinator. When a SynthPanel is rendered inside a
// provider, only one panel is open at a time and tapping the title
// strip toggles it. Without a provider, all panels render expanded
// (legacy / desktop layout).
const SynthPanelAccordionContext = createContext<{
  openTitle: string | null;
  setOpenTitle: Dispatch<SetStateAction<string | null>>;
} | null>(null);

function SynthPanel({
  title, subtitle, accent, children, keepMounted,
}: {
  title: string; subtitle?: string; accent?: string; children: React.ReactNode;
  // v1.3.76 — when true, children stay mounted even while the
  // accordion is collapsed (their parent <div> just toggles to
  // display:none). Required for panels that own a long-running rAF
  // loop or a live-source ref (e.g. PIXEL GEN II) — without this the
  // simulation halts and the LIVE feed goes dead the moment the user
  // opens any other panel.
  keepMounted?: boolean;
}) {
  const accentColor = accent ?? "rgba(231,174,255,0.95)";
  // ── Accordion integration. If a parent has provided
  // SynthPanelAccordionContext (e.g. the glass-mode panel container),
  // this rack becomes collapsible: tapping the title strip toggles it
  // open as the single active panel and closes any sibling. Default
  // collapsed → user sees a tidy stack of title strips and only the
  // panel they want to fiddle with shows controls.
  const acc = useContext(SynthPanelAccordionContext);
  const collapsible = !!acc;
  const isOpen = collapsible ? acc!.openTitle === title : true;
  const onToggle = () => {
    if (!collapsible) return;
    acc!.setOpenTitle(prev => prev === title ? null : title);
  };
  const screw = (top?: string | number, left?: string | number, right?: string | number, bottom?: string | number) => (
    <div style={{
      position: "absolute",
      top, left: left as string | number | undefined, right: right as string | number | undefined, bottom: bottom as string | number | undefined,
      width: 10, height: 10,
      borderRadius: "50%",
      background: "radial-gradient(circle at 35% 30%, #C8C8D0 0%, #6E6E78 45%, #1E1E26 100%)",
      boxShadow: "inset 0 1px 1px rgba(255,255,255,0.4), inset 0 -1px 2px rgba(0,0,0,0.7), 0 1px 2px rgba(0,0,0,0.7)",
      pointerEvents: "none",
    }}>
      <div style={{
        position: "absolute", left: "50%", top: "20%", width: 1, height: "60%",
        marginLeft: -0.5, background: "rgba(0,0,0,0.65)", transform: "rotate(35deg)", transformOrigin: "center",
      }}/>
    </div>
  );
  return (
    <div className={"sp-rack" + (collapsible ? (isOpen ? " sp-rack-open" : " sp-rack-closed") : "")} style={{
      position: "relative",
      margin: collapsible ? "2px 5px" : "8px 10px 10px",
      padding: collapsible ? "2px 6px" : "8px 12px 12px",
      borderRadius: 10,
      // deep purple chassis
      background: `
        linear-gradient(180deg, #2A0A4A 0%, #1A0530 60%, #0F0220 100%)
      `,
      boxShadow: `
        0 6px 18px rgba(0,0,0,0.7),
        inset 0 1px 0 rgba(255,255,255,0.06),
        inset 0 -2px 4px rgba(0,0,0,0.55)
      `,
      border: "1px solid rgba(0,0,0,0.6)",
    }}>
      {screw(6, 6)}
      {screw(6, undefined, 6)}
      {screw(undefined, 6, undefined, 6)}
      {screw(undefined, undefined, 6, 6)}

      {/* Amber-LCD title strip — clickable when used inside the
          accordion, giving the rack a chevron to indicate state. */}
      <div
        onClick={onToggle}
        role={collapsible ? "button" : undefined}
        aria-expanded={collapsible ? isOpen : undefined}
        style={{
          margin: isOpen && !collapsible ? "0 0 8px" : (collapsible ? 0 : "0 0 8px"),
          padding: collapsible ? "2px 8px" : "3px 8px",
          borderRadius: 5,
          background: "linear-gradient(180deg, #0A0312 0%, #160726 100%)",
          border: "1px solid rgba(0,0,0,0.65)",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.65), inset 0 -1px 0 rgba(255,255,255,0.04)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          cursor: collapsible ? "pointer" : "default",
          userSelect: "none",
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          {collapsible && (
            <span style={{
              fontSize: 13,
              color: "rgba(255,210,140,0.85)",
              transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.15s ease",
              display: "inline-block",
              width: 13,
            }}>▶</span>
          )}
          <div style={{
            fontSize: 14, letterSpacing: "2.4px", textTransform: "uppercase",
            fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)", fontWeight: 700,
            color: "rgba(255,210,140,0.95)",
            textShadow: "0 0 6px rgba(232,160,32,0.7)",
          }}>{title}</div>
        </div>
        {subtitle && (
          <div style={{
            fontSize: 11, letterSpacing: "1.6px", textTransform: "uppercase",
            fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
            color: accentColor,
            textShadow: `0 0 5px ${accentColor}`,
          }}>{subtitle}</div>
        )}
      </div>

      {/* Brushed-metal inner workspace — hidden when accordion-collapsed.
          When keepMounted is true (e.g. PIXEL GEN II) we toggle
          display:none instead of unmounting so the rAF loop and any
          live-source refs survive collapse. */}
      {(isOpen || keepMounted) && (
      <div className="sp-rack-inner" style={{
        marginTop: 4,
        padding: "5px 5px 5px",
        borderRadius: 6,
        background: `
          repeating-linear-gradient(90deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 3px),
          linear-gradient(180deg, #1C1C22 0%, #14141A 50%, #0E0E14 100%)
        `,
        boxShadow: "inset 0 2px 4px rgba(0,0,0,0.7), inset 0 -1px 0 rgba(255,255,255,0.05)",
        border: "1px solid rgba(0,0,0,0.7)",
        display: isOpen ? undefined : "none",
      }}>
        {children}
      </div>
      )}
    </div>
  );
}

// v1.3.78 - PIXEL GEN II engine + UI removed (perf optimization).

// ──────────────────────────────────────────────────────────────
// Knob — hardware-style rotary control. Drag vertically or scroll wheel.
// Double-click to reset to default. Range mapped across -135°..+135°.
// ──────────────────────────────────────────────────────────────
function Knob({
  label, value, min, max, step, defaultValue, onChange, size = 42,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  onChange: (v: number) => void;
  size?: number;
}) {
  const pct = (value - min) / Math.max(0.0001, max - min);
  const angle = -135 + pct * 270; // -135° to +135°
  const display = step >= 1 ? Math.round(value).toString() : value.toFixed(2);

  const startRef = useRef<{ y: number; v: number } | null>(null);
  const [held, setHeld] = useState(false);
  // v1.3.78 — rAF-coalesce onChange so 120Hz pointermove events don't trigger
  // 120 React re-renders per second. We keep the latest value in a ref and
  // flush at most once per animation frame.
  const pendingValRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const scheduleChange = (v: number) => {
    pendingValRef.current = v;
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const pv = pendingValRef.current;
      pendingValRef.current = null;
      if (pv != null) onChange(pv);
    });
  };
  useEffect(() => () => {
    if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
  }, []);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = { y: e.clientY, v: value };
    setHeld(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    const dy = startRef.current.y - e.clientY; // up = +
    const range = max - min;
    const fast = e.shiftKey ? 0.25 : 1;
    const delta = (dy / 140) * range * fast;
    let next = startRef.current.v + delta;
    next = Math.max(min, Math.min(max, next));
    if (step >= 1) next = Math.round(next);
    else next = Math.round(next / step) * step;
    scheduleChange(next);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    startRef.current = null;
    setHeld(false);
    // Flush any pending value synchronously on release for snappy final commit.
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
      const pv = pendingValRef.current;
      pendingValRef.current = null;
      if (pv != null) onChange(pv);
    }
  };
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const range = max - min;
    const delta = (-Math.sign(e.deltaY)) * (e.shiftKey ? range * 0.005 : range * 0.025);
    let next = value + delta;
    next = Math.max(min, Math.min(max, next));
    if (step >= 1) next = Math.round(next);
    else next = Math.round(next / step) * step;
    scheduleChange(next);
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 4, userSelect: "none", padding: "2px 4px",
      // v1.2.50 — hold-to-magnify: while a knob is being dragged it
      // pops to 1.9× and lifts above siblings so the value/indicator
      // are huge and easy to read with a thumb. Snaps back on release.
      transform: held ? "scale(1.9)" : "scale(1)",
      transformOrigin: "center center",
      transition: "transform 180ms cubic-bezier(.2,.9,.25,1.1), filter 180ms ease",
      zIndex: held ? 50 : 1,
      position: "relative",
      filter: held ? "drop-shadow(0 8px 18px rgba(176,20,240,0.55))" : "none",
      willChange: "transform",
    }}>
      {/* Label above (engraved) */}
      <div style={{
        fontSize: 11, letterSpacing: "1.6px", textTransform: "uppercase",
        color: "rgba(243,238,255,0.82)", fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
        fontWeight: 700,
        textShadow: "0 1px 0 rgba(0,0,0,0.7), 0 -1px 0 rgba(255,255,255,0.05)",
        whiteSpace: "nowrap",
      }}>{label}</div>

      {/* Knob body */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={() => onChange(defaultValue)}
        title={`${label}: ${display}  (drag · wheel · dbl-click resets)`}
        style={{
          position: "relative",
          width: size, height: size,
          cursor: "ns-resize",
          touchAction: "none",
          borderRadius: "50%",
          // Outer bezel ring (dark)
          background: `
            radial-gradient(circle at 50% 35%, #6A6A78 0%, #2A2A33 55%, #0E0E14 100%),
            conic-gradient(from -135deg, rgba(231,174,255,0.85) 0deg, rgba(231,174,255,0.85) ${pct * 270}deg, rgba(0,0,0,0.55) ${pct * 270}deg, rgba(0,0,0,0.55) 270deg, transparent 270deg)
          `,
          backgroundClip: "padding-box",
          boxShadow: `
            0 4px 8px rgba(0,0,0,0.7),
            inset 0 2px 2px rgba(255,255,255,0.18),
            inset 0 -2px 3px rgba(0,0,0,0.6),
            0 0 0 1px rgba(0,0,0,0.6)
          `,
        }}
      >
        {/* Active arc indicator (thin lilac ring filling clockwise) */}
        <svg
          width={size} height={size}
          viewBox="0 0 100 100"
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          {/* Track */}
          <path
            d="M 18.93 81.07 A 45 45 0 1 1 81.07 81.07"
            fill="none"
            stroke="rgba(0,0,0,0.55)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          {/* Active fill */}
          <path
            d="M 18.93 81.07 A 45 45 0 1 1 81.07 81.07"
            fill="none"
            stroke="rgba(231,174,255,0.85)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="212"
            strokeDashoffset={212 * (1 - pct)}
            style={{ filter: "drop-shadow(0 0 3px rgba(176,20,240,0.65))" }}
          />
        </svg>

        {/* Inner chrome cap with indicator line */}
        <div style={{
          position: "absolute",
          left: "16%", top: "16%", width: "68%", height: "68%",
          borderRadius: "50%",
          background: `
            radial-gradient(circle at 35% 25%, #F4F4F8 0%, #BFBFC8 25%, #6E6E78 60%, #2C2C34 100%)
          `,
          boxShadow: `
            inset 0 2px 3px rgba(255,255,255,0.45),
            inset 0 -2px 4px rgba(0,0,0,0.55),
            0 1px 2px rgba(0,0,0,0.6)
          `,
          transform: `rotate(${angle}deg)`,
          transition: "transform 0.04s linear",
        }}>
          {/* Indicator line */}
          <div style={{
            position: "absolute",
            left: "50%", top: "8%",
            width: 2, height: "32%",
            marginLeft: -1,
            background: "linear-gradient(180deg, #1A0224 0%, #3A0852 100%)",
            borderRadius: 1,
            boxShadow: "0 0 4px rgba(176,20,240,0.7), 0 1px 0 rgba(255,255,255,0.25)",
          }}/>
        </div>
      </div>

      {/* Value LCD readout */}
      <div style={{
        fontSize: 13, fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
        letterSpacing: "0.5px",
        fontWeight: 700,
        color: "rgba(255,210,140,0.95)",
        background: "linear-gradient(180deg, #0A0312 0%, #160726 100%)",
        border: "1px solid rgba(0,0,0,0.55)",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        padding: "2px 8px",
        borderRadius: 3,
        minWidth: 44,
        textAlign: "center",
        textShadow: "0 0 5px rgba(232,160,32,0.55)",
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.6)",
      }}>{display}</div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// ModeRack — schema-driven per-mode parameter rack (Phase 1C)
// ───────────────────────────────────────────────────────────────────────
function ModeRack({
  modeId,
  values,
  onChange,
  onReset,
  onApplyPreset,
}: {
  modeId: ModeId;
  values: Record<string, number>;
  onChange: (key: string, val: number) => void;
  onReset: () => void;
  onApplyPreset: (preset: ModePreset) => void;
}) {
  const schema = MODE_SCHEMAS[modeId];
  const presets = MODE_PRESETS[modeId] ?? [];
  const modeMeta = MODES.find(m => m.id === modeId);
  const title = modeMeta ? `${modeMeta.short}` : `MODE ${modeId}`;
  const subtitle = modeMeta?.label ?? "";
  if (!schema || schema.length === 0) return null;
  const numKnobs = schema.filter(p => p.kind === "num");
  const enums = schema.filter(p => p.kind === "enum");
  return (
    <div style={{
      margin: "0 10px 12px",
      borderRadius: 12,
      overflow: "hidden",
      // Deep purple chassis (Minimoog Voyager purple) with raised metal trim.
      background: "linear-gradient(180deg, #2A0A4A 0%, #1A0530 100%)",
      border: "1px solid #0A0118",
      boxShadow: `
        0 6px 18px rgba(0,0,0,0.7),
        inset 0 1px 0 rgba(231,174,255,0.22),
        inset 0 -3px 6px rgba(0,0,0,0.5)
      `,
      padding: 4,
    }}>
      {/* Inner brushed metal panel */}
      <div style={{
        borderRadius: 8,
        overflow: "hidden",
        background: [
          "repeating-linear-gradient(90deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 3px)",
          "linear-gradient(180deg, #1C1C22 0%, #0E0E14 100%)",
        ].join(", "),
        border: "1px solid rgba(0,0,0,0.7)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.6)",
      }}>
        {/* Title strip */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "6px 10px",
          borderBottom: "1px solid rgba(0,0,0,0.6)",
          background: "linear-gradient(180deg, rgba(231,174,255,0.06) 0%, transparent 100%)",
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <span style={{
              fontSize: 11, letterSpacing: "2px",
              color: "rgba(255,210,140,0.95)",
              textTransform: "uppercase", fontWeight: "bold",
              textShadow: "0 1px 0 rgba(0,0,0,0.7), 0 0 8px rgba(232,160,32,0.3)",
            }}>{title}</span>
            <span style={{
              fontSize: 8, letterSpacing: "1.4px",
              color: "rgba(231,174,255,0.55)",
              textTransform: "uppercase",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{subtitle}</span>
          </div>
          <button
            onClick={onReset}
            title="Reset to defaults"
            style={{
              fontSize: 8, letterSpacing: "1px",
              padding: "3px 8px", cursor: "pointer",
              background: "linear-gradient(180deg, #4A4A55 0%, #1E1E26 100%)",
              color: "rgba(243,238,255,0.92)",
              border: "1px solid rgba(0,0,0,0.7)",
              borderTop: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 4,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.1), 0 1px 2px rgba(0,0,0,0.5)",
              textShadow: "0 1px 0 rgba(0,0,0,0.6)",
              textTransform: "uppercase",
            }}
          >↺ RESET</button>
        </div>

        {/* Preset chips (lit backlit pill buttons) */}
        {presets.length > 0 && (
          <div style={{
            padding: "6px 10px",
            display: "flex", flexWrap: "wrap", gap: 5,
            background: "linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.15) 100%)",
            borderBottom: "1px solid rgba(0,0,0,0.5)",
          }}>
            {presets.map((p) => (
              <button
                key={p.name}
                onClick={() => onApplyPreset(p)}
                title={`Preset: ${p.name}`}
                style={{
                  fontSize: 8, letterSpacing: "1px",
                  padding: "3px 9px", cursor: "pointer",
                  background: "linear-gradient(180deg, #3A3A45 0%, #16161C 100%)",
                  color: "rgba(255,210,140,0.92)",
                  border: "1px solid rgba(0,0,0,0.7)",
                  borderTop: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 10,
                  textTransform: "uppercase",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 1px 2px rgba(0,0,0,0.5)",
                  textShadow: "0 0 4px rgba(232,160,32,0.4), 0 1px 0 rgba(0,0,0,0.6)",
                }}
              >{p.name}</button>
            ))}
          </div>
        )}

        {/* Knob rail */}
        {numKnobs.length > 0 && (
          <div style={{
            display: "flex", flexWrap: "wrap",
            justifyContent: numKnobs.length <= 2 ? "flex-start" : "space-around",
            alignItems: "flex-start",
            gap: 10,
            padding: "12px 12px 14px",
            background: [
              "radial-gradient(ellipse at 50% 0%, rgba(231,174,255,0.05) 0%, transparent 60%)",
              "linear-gradient(180deg, #1A1A22 0%, #0A0A10 100%)",
            ].join(", "),
            borderBottom: enums.length > 0 ? "1px solid rgba(0,0,0,0.5)" : "none",
          }}>
            {numKnobs.map((p) => {
              if (p.kind !== "num") return null;
              return (
                <Knob
                  key={p.id}
                  label={p.label}
                  value={values[p.id] ?? p.default}
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  defaultValue={p.default}
                  onChange={(v) => onChange(p.id, v)}
                />
              );
            })}
          </div>
        )}

        {/* Switch sections (enums as labeled segmented buttons) */}
        {enums.map((p) => {
          if (p.kind !== "enum") return null;
          const current = Math.round(values[p.id] ?? p.default);
          return (
            <div key={p.id} style={{
              padding: "8px 10px",
              background: "linear-gradient(180deg, #16161C 0%, #0A0A10 100%)",
              borderTop: "1px solid rgba(255,255,255,0.04)",
              borderBottom: "1px solid rgba(0,0,0,0.5)",
            }}>
              <div style={{
                fontSize: 8, letterSpacing: "1.4px",
                color: "rgba(243,238,255,0.7)",
                fontFamily: "var(--font-space-mono,'Space Mono','Courier New',monospace)",
                textTransform: "uppercase",
                marginBottom: 5,
                textShadow: "0 1px 0 rgba(0,0,0,0.6)",
              }}>{p.label}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {p.options.map((opt, idx) => (
                  <button
                    key={`${p.id}-${idx}`}
                    onClick={() => onChange(p.id, idx)}
                    style={{
                      fontSize: 8, letterSpacing: "0.9px",
                      padding: "5px 10px", cursor: "pointer",
                      background: current === idx
                        ? "linear-gradient(180deg, rgba(255,210,140,0.55) 0%, rgba(200,134,10,0.4) 100%)"
                        : "linear-gradient(180deg, #2A2A33 0%, #0E0E14 100%)",
                      color: current === idx ? "#0A0118" : "rgba(231,174,255,0.85)",
                      border: "1px solid rgba(0,0,0,0.7)",
                      borderTop: current === idx
                        ? "1px solid rgba(255,255,255,0.3)"
                        : "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 4,
                      textTransform: "uppercase",
                      boxShadow: current === idx
                        ? "0 0 10px rgba(232,160,32,0.5), inset 0 1px 0 rgba(255,255,255,0.3)"
                        : "inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.5)",
                      textShadow: current === idx
                        ? "0 1px 0 rgba(255,255,255,0.3)"
                        : "0 1px 0 rgba(0,0,0,0.6)",
                      fontWeight: current === idx ? "bold" : "normal",
                    }}
                  >{opt}</button>
                ))}
              </div>
            </div>
          );
        })}

        {modeId === 9 && (
          <div style={{
            padding: "5px 10px",
            fontSize: 8, letterSpacing: "1px",
            color: "rgba(231,174,255,0.5)",
            textTransform: "uppercase",
            background: "rgba(0,0,0,0.35)",
          }}>
            Note: shader-only datamosh approximation.
          </div>
        )}
      </div>
    </div>
  );
}
// Legacy components — retained for backward compat with imported presets but
// no longer rendered in the stripped PXL+MOSH+GEN UI.
void SliderRow;
void ModeRack;


