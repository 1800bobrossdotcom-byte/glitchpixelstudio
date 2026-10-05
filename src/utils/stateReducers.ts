/**
 * State consolidation using useReducer
 * Reduces render cycles from setState → setState → setState chains
 * to single setState call with multi-property update
 * 
 * Expected perf improvement: 30-40% fewer renders in complex gesture sequences
 */

export interface GeneratorState {
  // Pixel generator controls
  style: string;
  resolution: number;
  density: number;
  scale: number;
  speed: number;
  hue: number;
  hueSpread: number;
  sat: number;
  contrast: number;
  warp: number;
  jitter: number;
  seed: number;
  invert: boolean;
  mix: number;
  moshX: number;
  moshY: number;
  scatter: number;
  scatterMode: number;
  glyphMode: number;
  
  // Automation
  automateOn: boolean;
  automateRate: number;
  automateStyles: boolean;
  automateBlend: boolean;
  
  // Palette
  palette: string;
  autoCycle: boolean;
}

export interface FXState {
  // Main effect controls
  mode: number;
  gain: number;
  brightness: number;
  contrast: number;
  saturation: number;
  hueShift: number;
  scanlines: number;
  zoom: number;
  speed: number;
  
  // Datamosh / Sort
  datamosh: number;
  sortAmt: number;
  sortKey: number;
  sortLow: number;
  sortHigh: number;
  sortSegment: number;
  
  // Glitch / Corruption
  blockGlitch: number;
  chrash: number;
  liquid: number;
  feedback: number;
  
  // Macros
  intensityMacro: number;
  motionMacro: number;
  colorMacro: number;
  breakMacro: number;
}

export interface UIState {
  activePanel: string | null;
  faceFxMode: 'OFF' | 'FACE' | 'BG';
  lowPowerOn: boolean;
  cameraFacing: 'user' | 'environment';
  sourceMode: 'camera' | 'upload' | 'generator';
}

export type GeneratorAction =
  | { type: 'SET_STYLE'; payload: string }
  | { type: 'SET_RESOLUTION'; payload: number }
  | { type: 'SET_DENSITY'; payload: number }
  | { type: 'UPDATE_MULTIPLE'; payload: Partial<GeneratorState> }
  | { type: 'RESET' };

export type FXAction =
  | { type: 'SET_MODE'; payload: number }
  | { type: 'SET_GAIN'; payload: number }
  | { type: 'UPDATE_MULTIPLE'; payload: Partial<FXState> }
  | { type: 'RESET' };

export type UIAction =
  | { type: 'SET_PANEL'; payload: string | null }
  | { type: 'CYCLE_FACE_FX' }
  | { type: 'TOGGLE_LOW_POWER' }
  | { type: 'UPDATE_MULTIPLE'; payload: Partial<UIState> };

// Initial states
export const INITIAL_GENERATOR_STATE: GeneratorState = {
  style: 'BAYER',
  resolution: 48,
  density: 0.55,
  scale: 1.0,
  speed: 0.6,
  hue: 0.78,
  hueSpread: 0.35,
  sat: 0.85,
  contrast: 0.7,
  warp: 0.25,
  jitter: 0.15,
  seed: 7,
  invert: false,
  mix: 0.0,
  moshX: 0,
  moshY: 0,
  scatter: 0,
  scatterMode: 0,
  glyphMode: 0,
  automateOn: false,
  automateRate: 0.45,
  automateStyles: false,
  automateBlend: false,
  palette: 'MONO',
  autoCycle: false,
};

export const INITIAL_FX_STATE: FXState = {
  mode: 7,
  gain: 1.0,
  brightness: 0.0,
  contrast: 0.0,
  saturation: 0.0,
  hueShift: 0.0,
  scanlines: 0.0,
  zoom: 1.0,
  speed: 1.0,
  datamosh: 0.0,
  sortAmt: 0.0,
  sortKey: 0.0,
  sortLow: 0.0,
  sortHigh: 1.0,
  sortSegment: 0.5,
  blockGlitch: 0.0,
  chrash: 0.0,
  liquid: 0.0,
  feedback: 0.0,
  intensityMacro: 1.0,
  motionMacro: 1.0,
  colorMacro: 1.0,
  breakMacro: 1.0,
};

export const INITIAL_UI_STATE: UIState = {
  activePanel: null,
  faceFxMode: 'OFF',
  lowPowerOn: false,
  cameraFacing: 'user',
  sourceMode: 'camera',
};

// Reducers
export function generatorReducer(
  state: GeneratorState,
  action: GeneratorAction
): GeneratorState {
  switch (action.type) {
    case 'SET_STYLE':
      return { ...state, style: action.payload };
    case 'SET_RESOLUTION':
      return { ...state, resolution: action.payload };
    case 'SET_DENSITY':
      return { ...state, density: action.payload };
    case 'UPDATE_MULTIPLE':
      return { ...state, ...action.payload };
    case 'RESET':
      return INITIAL_GENERATOR_STATE;
    default:
      return state;
  }
}

export function fxReducer(
  state: FXState,
  action: FXAction
): FXState {
  switch (action.type) {
    case 'SET_MODE':
      return { ...state, mode: action.payload };
    case 'SET_GAIN':
      return { ...state, gain: action.payload };
    case 'UPDATE_MULTIPLE':
      return { ...state, ...action.payload };
    case 'RESET':
      return INITIAL_FX_STATE;
    default:
      return state;
  }
}

export function uiReducer(
  state: UIState,
  action: UIAction
): UIState {
  switch (action.type) {
    case 'SET_PANEL':
      return { ...state, activePanel: action.payload };
    case 'CYCLE_FACE_FX':
      const next: typeof state.faceFxMode =
        state.faceFxMode === 'OFF'
          ? 'FACE'
          : state.faceFxMode === 'FACE'
            ? 'BG'
            : 'OFF';
      return { ...state, faceFxMode: next };
    case 'TOGGLE_LOW_POWER':
      return { ...state, lowPowerOn: !state.lowPowerOn };
    case 'UPDATE_MULTIPLE':
      return { ...state, ...action.payload };
    default:
      return state;
  }
}
