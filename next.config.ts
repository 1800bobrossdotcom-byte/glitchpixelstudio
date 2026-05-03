import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import path from "node:path";

let buildSha = "";
try { buildSha = execSync("git rev-parse HEAD").toString().trim(); } catch { buildSha = "mobile"; }
const SHORT_SHA = buildSha.slice(0, 7);

const nextConfig: NextConfig = {
  output: "export",          // static export — required for Capacitor
  trailingSlash: true,       // ensures index.html is created for each route
  images: { unoptimized: true }, // no server-side image optimization
  // v1.2.54: pin tracing root to this folder so Next.js stops auto-detecting
  // the parent directory's stray package-lock.json as the workspace root.
  // This silences the "multiple lockfiles" warning at every build and ensures
  // file-tracing only walks files under this app.
  outputFileTracingRoot: path.resolve(__dirname),
  env: {
    NEXT_PUBLIC_BUILD_SHA: SHORT_SHA,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
