import type { Metadata, Viewport } from "next";
import { Nunito, Space_Mono } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
  variable: "--font-nunito",
  display: "swap",
});

// v1.3.34 — Space Mono for the synth-panel chrome. Slab-serif terminals
// + geometric proportions = legible at small sizes AND distinctive
// (more personality than Courier New, which fragments into smudge on
// dense Android UIs). Keeps the monospace contract so knob labels +
// value LCDs still align in fixed columns.
const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://glitchpixelstudio.app"),
  title: "Glitch Pixel Studio",
  description: "Real-time glitch & pixel FX camera studio — GPS 42069+",
  applicationName: "Glitch Pixel Studio",
  category: "photography",
  alternates: {
    canonical: "/",
  },
  keywords: ["glitch", "pixel", "camera", "art", "effects", "GPS", "glitch art"],
  authors: [{ name: "GPS 42069+" }],
  other: {
    "privacy-policy": "https://glitchpixelstudio.app/privacy",
    "terms-of-service": "https://glitchpixelstudio.app/terms",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "GPS",
  },
  openGraph: {
    type: "website",
    url: "https://glitchpixelstudio.app",
    title: "Glitch Pixel Studio — GPS 42069+",
    description: "Real-time glitch & pixel FX camera studio. Pixel sort, datamosh, GLSL shaders & more.",
    siteName: "Glitch Pixel Studio",
    images: [
      {
        url: "/spectra/gps_logo.png",
        width: 1024,
        height: 1024,
        alt: "GPS — Glitch Pixel Studio",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Glitch Pixel Studio — GPS 42069+",
    description: "Real-time glitch & pixel FX camera studio. Pixel sort, datamosh, GLSL shaders & more.",
    images: ["/spectra/gps_logo.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#030510",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${nunito.variable} ${spaceMono.variable}`}>
      <body style={{ margin: 0, background: "#000", overflow: "hidden" }}>
        {children}
      </body>
    </html>
  );
}
