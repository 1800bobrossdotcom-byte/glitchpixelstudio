# GPS 1.2.7 — backlog

## User notes from 1.2.6 testing (2026-05-03)

### Bugs
- **Upload buggy on start** — camera works, but Upload source is glitchy on app start (need repro)
- **GIF / video / photo not saving to phone** — Capacitor Filesystem write or share intent not landing in Pictures/DCIM

### UX
- **Boot intro screen background** — match the logo electric blue (`#1A1CF2`) so the logo sits flush against background (currently navy/black, looks like a frame around the logo)
- **Top nav alignment** — logo + wordmark LEFT-aligned together, app action buttons (camera/upload/record/etc) RIGHT-aligned. Currently logo+wordmark is centered.
- **Processing progress** — when GIF or video is encoding, the UI looks frozen. Add a modal or inline progress bar with a buffer animation + % so user knows it's working.

## Carry-over from 1.2.6 plan
- **Finger-draw FX params** — transparent overlay canvas → Float32 RGBA mask texture; R/G/B channels gate per-mode params, A = touchMask. Brush UI with size + channel chips + clear/invert/auto-cycle.
