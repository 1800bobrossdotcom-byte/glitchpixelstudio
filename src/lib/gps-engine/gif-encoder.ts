// gps-engine / gif-encoder
//
// The GIF pipeline moved verbatim out of SpectraAfter.tsx so it can run in a
// Worker: a fixed 8x8x4 palette with ordered (Bayer) dither and an LZW
// encoder, plus the perfect-loop trim. Pure functions — no DOM — so the
// output is byte-identical wherever they run.

/**
 * Perfect-loop trim: compare each candidate end frame in the last ~22% of
 * the recording against frame 0 with a 32x32 luma SAD and cut after the
 * best match, so frame[N-1] visually leads back into frame[0].
 */
export function trimToLoopPoint(frames: Uint8ClampedArray[], gw: number, gh: number): Uint8ClampedArray[] {
  if (frames.length < 12) return frames;
  const G = 32;
  const sx = Math.max(1, Math.floor(gw / G));
  const sy = Math.max(1, Math.floor(gh / G));
  const luma = (f: Uint8ClampedArray): Uint8Array => {
    const out = new Uint8Array(G * G);
    let p = 0;
    for (let y = 0; y < G; y++) {
      const yy = Math.min(gh - 1, y * sy);
      for (let x = 0; x < G; x++) {
        const xx = Math.min(gw - 1, x * sx);
        const i = (yy * gw + xx) << 2;
        // Rec.601 luma, fast int (>>8 ≈ /256).
        out[p++] = (f[i] * 77 + f[i + 1] * 150 + f[i + 2] * 29) >> 8;
      }
    }
    return out;
  };
  const first = luma(frames[0]);
  // Restrict the search to the LAST ~22% of the recording so we trim only a
  // small near-loop tail, preserving the user's chosen length.
  const startSearch = Math.floor(frames.length * 0.78);
  let bestIdx = frames.length - 1;
  let bestSad = Infinity;
  for (let k = startSearch; k < frames.length; k++) {
    const cur = luma(frames[k]);
    let sad = 0;
    for (let q = 0; q < first.length; q++) sad += Math.abs(first[q] - cur[q]);
    if (sad < bestSad) { bestSad = sad; bestIdx = k; }
  }
  // Keep frame[bestIdx]: in GIF the last frame's delay still elapses before
  // the loop restarts, so ... near-match → frame[0] reads as a perfect loop.
  return frames.slice(0, bestIdx + 1);
}

/**
 * Encode RGBA frames to an animated GIF. `delays` is in centiseconds: one
 * value for every frame, or per-frame values (mobile v1.3.31: a dropped
 * render frame extends the previous frame's playback so motion matches the
 * live preview). Missing per-frame entries fall back to the last one.
 */
export function encodeGIF(
  gw: number,
  gh: number,
  frames: Uint8ClampedArray[],
  delays: number | ArrayLike<number>,
  ditherStrength = 2.0,
): Uint8Array {
  const delayAt = (f: number): number => {
    if (typeof delays === "number") return Math.max(2, delays | 0);
    const d = delays[f] ?? delays[delays.length - 1] ?? 4;
    return Math.max(2, d | 0);
  };
  const buf: number[] = [];
  const wb = (b: number) => buf.push(b & 0xFF);
  const w16 = (v: number) => { wb(v); wb(v >> 8); };
  const ws = (s: string) => { for (let i = 0; i < s.length; i++) wb(s.charCodeAt(i)); };
  const palette: number[] = [];
  // Higher-fidelity fixed palette: 8x8x4 RGB cube (256 colors)
  for (let ri = 0; ri < 8; ri++) {
    for (let gi = 0; gi < 8; gi++) {
      for (let bi = 0; bi < 4; bi++) {
        palette.push(
          Math.round((ri * 255) / 7),
          Math.round((gi * 255) / 7),
          Math.round((bi * 255) / 3),
        );
      }
    }
  }
  const bayer4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];
  const quant = (r: number, g: number, b: number) => {
    const qr = Math.max(0, Math.min(7, Math.round((r * 7) / 255)));
    const qg = Math.max(0, Math.min(7, Math.round((g * 7) / 255)));
    const qb = Math.max(0, Math.min(3, Math.round((b * 3) / 255)));
    return qr * 32 + qg * 4 + qb;
  };
  function lzwEnc(px: Uint8Array) {
    let cs = 9, next = 258, mx = 512, bits = 0, bc = 0;
    const dict: Record<string, number> = {}, out: number[] = [];
    const emit = (code: number) => { bits |= code << bc; bc += cs; while (bc >= 8) { out.push(bits & 0xFF); bits >>= 8; bc -= 8; } };
    const reset = () => { Object.keys(dict).forEach(k => delete dict[k]); cs = 9; next = 258; mx = 512; };
    emit(256); let pre = px[0];
    for (let i = 1; i < px.length; i++) {
      const suf = px[i], key = pre + "," + suf;
      if (dict[key] !== undefined) { pre = dict[key]; }
      else { emit(pre); if (next < 4096) { dict[key] = next++; if (next > mx && cs < 12) { cs++; mx <<= 1; } } else { emit(256); reset(); } pre = suf; }
    }
    emit(pre); emit(257); if (bc > 0) out.push(bits & 0xFF); return out;
  }
  ws("GIF89a"); w16(gw); w16(gh); wb(0xF7); wb(0); wb(0);
  for (let p = 0; p < palette.length; p++) wb(palette[p]);
  wb(0x21); wb(0xFF); wb(11); ws("NETSCAPE2.0"); wb(3); wb(1); w16(0); wb(0);
  for (let f = 0; f < frames.length; f++) {
    const px = frames[f];
    wb(0x21); wb(0xF9); wb(4); wb(0); w16(delayAt(f)); wb(0); wb(0);
    wb(0x2C); w16(0); w16(0); w16(gw); w16(gh); wb(0);
    const idx = new Uint8Array(gw * gh);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const p = y * gw + x;
        const d = (bayer4[y & 3][x & 3] - 7.5) * ditherStrength;
        const r = Math.max(0, Math.min(255, px[p * 4] + d));
        const g = Math.max(0, Math.min(255, px[p * 4 + 1] + d));
        const b = Math.max(0, Math.min(255, px[p * 4 + 2] + d));
        idx[p] = quant(r, g, b);
      }
    }
    wb(8);
    const enc = lzwEnc(idx); let off = 0;
    while (off < enc.length) { const sz = Math.min(255, enc.length - off); wb(sz); for (let j = 0; j < sz; j++) buf.push(enc[off + j]); off += sz; }
    wb(0);
  }
  wb(0x3B);
  return new Uint8Array(buf);
}
