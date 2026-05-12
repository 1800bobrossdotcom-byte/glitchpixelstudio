// Ambient declarations for raw shader imports.
// v1.3.41 — shader sources live in standalone .vert / .frag files loaded via
// webpack's asset/source rule (configured in next.config.ts). This permanently
// retires the recurring "backtick inside GLSL comment terminates the JS
// template literal" build-break footgun (see /memories/spectra-stable-fallback.md,
// v1.3.33 + v1.3.40 lessons).
declare module "*.vert" {
  const src: string;
  export default src;
}
declare module "*.frag" {
  const src: string;
  export default src;
}
declare module "*.glsl" {
  const src: string;
  export default src;
}
