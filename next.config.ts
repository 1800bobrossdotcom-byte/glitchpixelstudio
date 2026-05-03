import type { NextConfig } from "next";
import { execSync } from "node:child_process";

let buildSha = "";
try { buildSha = execSync("git rev-parse HEAD").toString().trim(); } catch { buildSha = "mobile"; }
const SHORT_SHA = buildSha.slice(0, 7);

const nextConfig: NextConfig = {
  output: "export",          // static export — required for Capacitor
  trailingSlash: true,       // ensures index.html is created for each route
  images: { unoptimized: true }, // no server-side image optimization
  env: {
    NEXT_PUBLIC_BUILD_SHA: SHORT_SHA,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
