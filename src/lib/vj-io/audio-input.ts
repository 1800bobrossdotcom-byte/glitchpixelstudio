// vj-io / audio-input
//
// Plug-and-play audio input for VJ mode. Framework-free.
//
//   - Enumerates audio inputs and classifies them: the phone's own mic
//     ("builtin") vs anything plugged in ("external": USB audio interfaces,
//     USB-C / 3.5 mm line-in, a DJ controller or mixer that exposes a USB
//     audio class device, wired headsets).
//   - "auto" prefers an external input the moment one is present, and falls
//     back to the built-in mic when it is unplugged — hot-plug is handled via
//     `devicechange`, so a Numark / Pioneer / Denon rig that comes online
//     mid-set takes over without touching the screen.
//   - Opens the stream RAW (no echo cancellation / AGC / noise suppression,
//     stereo, 48 kHz preferred) and exposes an AnalyserNode the render loop
//     already knows how to read (fftSize 1024, smoothing 0.55).
//
// Capturing *other apps'* playback ("what the phone is playing") is not
// possible from a WebView — Android only allows that through MediaProjection
// in native code. The built-in mic, a loaded track, or a line-in are the
// supported sources.

export type AudioInputKind = "builtin" | "external";

export interface AudioInputDevice {
  deviceId: string;
  label: string;
  kind: AudioInputKind;
  isDefault: boolean;
}

export interface AudioInputInfo {
  deviceId: string;
  label: string;
  kind: AudioInputKind;
  sampleRate: number;
  channelCount: number;
}

export interface AudioInputSession {
  stream: MediaStream;
  context: AudioContext;
  analyser: AnalyserNode;
  info: AudioInputInfo;
}

/** "auto" = external if present, else the default (built-in) mic. */
export type AudioInputPref = "auto" | "builtin" | { deviceId: string };

export interface AudioInputOptions {
  pref?: AudioInputPref;
  fftSize?: number;
  smoothingTimeConstant?: number;
  /** Called whenever the active input changes (hot-plug, pref change, loss). */
  onChange?: (session: AudioInputSession | null, reason: string) => void;
  onDevices?: (devices: AudioInputDevice[]) => void;
  onError?: (err: unknown) => void;
}

// Labels Android / Chrome give to things that are not the phone's own mic.
const EXTERNAL_RE =
  /usb|line|interface|mixer|\bdj\b|numark|pioneer|denon|rane|reloop|hercules|traktor|serato|focusrite|scarlett|behringer|motu|presonus|zoom|rode|shure|audio-technica|akai|roland|yamaha|allen|xone|headset|wired|external|aux|hdmi|bluetooth|bt\b/i;
const BUILTIN_RE = /built-?in|internal|default|phone|handset|speakerphone|microphone\s*\(?(bottom|top|back|front)?\)?$/i;

export function classifyInput(label: string): AudioInputKind {
  if (EXTERNAL_RE.test(label)) return "external";
  if (BUILTIN_RE.test(label)) return "builtin";
  // Unknown label: Android lists the phone mic first and names extras explicitly.
  return "builtin";
}

export async function listAudioInputs(): Promise<AudioInputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  const inputs = all.filter((d) => d.kind === "audioinput");
  // Chrome lists a virtual "default" / "communications" entry that aliases a
  // real device — drop those so each physical input appears once.
  const real = inputs.filter((d) => d.deviceId !== "default" && d.deviceId !== "communications");
  const list = (real.length ? real : inputs).map((d, i) => {
    const label = d.label || (i === 0 ? "Phone microphone" : `Audio input ${i + 1}`);
    return { deviceId: d.deviceId, label, kind: classifyInput(label), isDefault: i === 0 };
  });
  // Stable order: built-in first, then externals in enumeration order.
  return list.sort((a, b) => Number(a.kind === "external") - Number(b.kind === "external"));
}

export function pickDevice(devices: AudioInputDevice[], pref: AudioInputPref): AudioInputDevice | null {
  if (!devices.length) return null;
  if (typeof pref === "object") return devices.find((d) => d.deviceId === pref.deviceId) ?? null;
  if (pref === "builtin") return devices.find((d) => d.kind === "builtin") ?? devices[0];
  // auto: first external wins, else built-in / default.
  return devices.find((d) => d.kind === "external") ?? devices.find((d) => d.kind === "builtin") ?? devices[0];
}

function rawConstraints(deviceId?: string): MediaStreamConstraints {
  const audio: MediaTrackConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 2 },
    sampleRate: { ideal: 48000 },
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return { audio, video: false };
}

export async function openAudioInput(
  device: AudioInputDevice | null,
  opts: { fftSize?: number; smoothingTimeConstant?: number } = {},
): Promise<AudioInputSession> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia unavailable");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(rawConstraints(device?.deviceId));
  } catch (e) {
    // `exact` deviceId can fail right after a hot-plug (id not settled yet):
    // fall back to the default input rather than failing the whole session.
    if (!device) throw e;
    stream = await navigator.mediaDevices.getUserMedia(rawConstraints());
  }
  const Ctor =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new Ctor();
  try { await context.resume(); } catch { /* ignore */ }
  const src = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = opts.fftSize ?? 1024;
  analyser.smoothingTimeConstant = opts.smoothingTimeConstant ?? 0.55;
  src.connect(analyser);

  const track = stream.getAudioTracks()[0];
  const settings = track?.getSettings?.() ?? {};
  const label = track?.label || device?.label || "Audio input";
  const info: AudioInputInfo = {
    deviceId: settings.deviceId || device?.deviceId || "",
    label,
    kind: device?.kind ?? classifyInput(label),
    sampleRate: settings.sampleRate || context.sampleRate,
    channelCount: settings.channelCount || 1,
  };
  return { stream, context, analyser, info };
}

export function closeAudioInput(s: AudioInputSession | null | undefined) {
  if (!s) return;
  try { s.analyser.disconnect(); } catch { /* ignore */ }
  try { s.stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
  try { void s.context.close(); } catch { /* ignore */ }
}

export interface AudioInputManager {
  readonly session: AudioInputSession | null;
  readonly devices: AudioInputDevice[];
  readonly pref: AudioInputPref;
  setPref(pref: AudioInputPref): Promise<void>;
  refresh(): Promise<void>;
  dispose(): void;
}

/**
 * Keeps one input open according to `pref`, re-evaluating on hot-plug.
 * Returns synchronously; the first session arrives through `onChange`.
 */
export function createAudioInputManager(opts: AudioInputOptions = {}): AudioInputManager {
  let pref: AudioInputPref = opts.pref ?? "auto";
  let session: AudioInputSession | null = null;
  let devices: AudioInputDevice[] = [];
  let disposed = false;
  let generation = 0;

  const emit = (s: AudioInputSession | null, reason: string) => { if (!disposed) opts.onChange?.(s, reason); };

  const apply = async (reason: string) => {
    const gen = ++generation;
    try {
      // Labels only populate after a permission grant: open the default
      // input first if we have never had one, then enumerate.
      if (!devices.length || devices.every((d) => /^(Phone microphone|Audio input \d+)$/.test(d.label))) {
        if (!session) {
          session = await openAudioInput(null, opts);
          if (gen !== generation || disposed) { closeAudioInput(session); return; }
          emit(session, "initial");
        }
      }
      devices = await listAudioInputs();
      opts.onDevices?.(devices);
      const want = pickDevice(devices, pref);
      const cur = session?.info.deviceId;
      const sameDevice = !!want && !!session && (want.deviceId === cur || want.label === session.info.label);
      if (sameDevice) return;
      const next = await openAudioInput(want, opts);
      if (gen !== generation || disposed) { closeAudioInput(next); return; }
      const prev = session;
      session = next;
      closeAudioInput(prev);
      emit(session, reason);
    } catch (e) {
      if (gen !== generation || disposed) return;
      opts.onError?.(e);
      if (!session) emit(null, "error");
    }
  };

  const onDeviceChange = () => {
    // Give Android a beat to finish binding the new USB device.
    window.setTimeout(() => { if (!disposed) void apply("hotplug"); }, 400);
  };
  navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
  void apply("start");

  return {
    get session() { return session; },
    get devices() { return devices; },
    get pref() { return pref; },
    async setPref(p) { pref = p; await apply("pref"); },
    refresh: () => apply("refresh"),
    dispose() {
      disposed = true;
      generation++;
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      closeAudioInput(session);
      session = null;
    },
  };
}
