import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Glitch Pixel Studio",
    short_name: "GPS",
    description: "Real-time glitch & pixel FX camera studio — GPS 42069+",
    start_url: "/",
    display: "standalone",
    background_color: "#030510",
    theme_color: "#030510",
    orientation: "portrait",
    icons: [
      {
        src: "/spectra/gps_logo.png",
        sizes: "any",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
