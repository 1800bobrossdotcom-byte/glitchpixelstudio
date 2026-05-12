// One-shot extraction script for v1.3.41 GLSL refactor.
// Reads SpectraApp.tsx as UTF-8, writes shader bodies to .vert/.frag files,
// replaces the in-file template literals with a marker comment.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "src/components/SpectraApp.tsx");
const VERT_OUT = path.join(ROOT, "src/shaders/scene.vert");
const FRAG_OUT = path.join(ROOT, "src/shaders/scene.frag");

const src = fs.readFileSync(TSX, "utf8");
// Preserve original line endings so re-emit is byte-identical for unchanged sections.
const useCrlf = src.includes("\r\n");
const eol = useCrlf ? "\r\n" : "\n";
const lines = src.split(/\r?\n/);

// Sanity: confirm anchors (1-based file line N == lines[N-1]).
const expect = (line1, prefix) => {
  const got = lines[line1 - 1] ?? "";
  if (!got.startsWith(prefix)) {
    throw new Error(`anchor mismatch at L${line1}: expected prefix ${JSON.stringify(prefix)}, got ${JSON.stringify(got.slice(0, 60))}`);
  }
};
expect(2312, "const VERT_SRC = `");
expect(2318, "}`;");
expect(2320, "const FRAG_SRC = `");
expect(3952, "`;");

// VERT body = lines 2313..2317 (full) + "}" (the "}" from L2318 stripped of trailing `;)
const vertBody = lines.slice(2312, 2317).join("\n") + "\n}\n";
// FRAG body = lines 2321..3951 (everything between the surrounding backticks)
const fragBody = lines.slice(2320, 3951).join("\n") + "\n";

// Replace L2311..L3952 (1-based inclusive) with a 4-line marker.
const head = lines.slice(0, 2310);   // L1..L2310
const tail = lines.slice(3952);      // L3953..EOF (kept verbatim incl. trailing blank)
const marker = [
  "// -- WebGL shaders ---------------------------------------",
  "// v1.3.41: VERT_SRC + FRAG_SRC moved to src/shaders/scene.{vert,frag}.",
  "// Imported at the top of this file as raw strings (webpack asset/source).",
  "// Permanently retires the backtick-in-shader-comment build-break footgun.",
];
const out = head.concat(marker, tail).join(eol);

fs.mkdirSync(path.dirname(VERT_OUT), { recursive: true });
fs.writeFileSync(VERT_OUT, vertBody, "utf8");
fs.writeFileSync(FRAG_OUT, fragBody, "utf8");
fs.writeFileSync(TSX, out, "utf8");

console.log(JSON.stringify({
  eol: useCrlf ? "CRLF" : "LF",
  vertBytes: Buffer.byteLength(vertBody, "utf8"),
  fragBytes: Buffer.byteLength(fragBody, "utf8"),
  tsxBytesBefore: Buffer.byteLength(src, "utf8"),
  tsxBytesAfter: Buffer.byteLength(out, "utf8"),
  linesBefore: lines.length,
  linesAfter: head.length + marker.length + tail.length,
}, null, 2));
