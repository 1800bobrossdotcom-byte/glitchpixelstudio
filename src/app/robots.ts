import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: "https://glitchpixelstudio.app/sitemap.xml",
    host: "https://glitchpixelstudio.app",
  };
}
