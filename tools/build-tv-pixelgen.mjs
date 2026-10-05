// Transpiles src/utils/pixelGenerator.ts -> a browser-global IIFE that exposes
// window.TV_PIXELGEN.draw(canvas, params). Type annotations are erased via the
// TypeScript compiler's transpileModule (no type-checking, no external deps).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "../src/utils/pixelGenerator.ts");
const OUT = resolve(
  here,
  "../../lovebeing/public/collections/terminalvelocity/tv-pixelgen.js"
);

let source = readFileSync(SRC, "utf8");

// Strip the `export ` keyword so transpile emits plain top-level declarations
// (we re-expose explicitly via window at the end). The file has no imports.
source = source.replace(/^export\s+/gm, "");

const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2019,
    module: ts.ModuleKind.None,
    removeComments: false,
    newLine: ts.NewLineKind.LineFeed,
  },
  reportDiagnostics: false,
});

const banner = `/* tv-pixelgen.js — AUTO-GENERATED from spectra-app/src/utils/pixelGenerator.ts
   Procedural pattern engine ported from the GPS/Spectra app. 11 generator
   families x 4 variants (39 styles), driven by GenParams knobs.
   Rebuild: node spectra-app/tools/build-tv-pixelgen.mjs
   Public API: window.TV_PIXELGEN.draw(canvas, params)  // params = GenParams
   DO NOT hand-edit — edit pixelGenerator.ts and rebuild. */
`;

const wrapped = `${banner}(function () {
  'use strict';
${outputText}
  window.TV_PIXELGEN = {
    draw: drawPixelGenerator,
  };
})();
`;

writeFileSync(OUT, wrapped, "utf8");
console.log("wrote", OUT, "(", wrapped.length, "bytes )");
