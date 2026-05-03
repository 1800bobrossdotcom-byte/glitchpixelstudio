import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Glitch Pixel Studio",
  description: "Real-time glitch & pixel FX camera studio — GPS 42069+",
  applicationName: "Glitch Pixel Studio",
  keywords: ["glitch", "pixel", "camera", "art", "effects", "GPS", "glitch art"],
  authors: [{ name: "GPS 42069+" }],
  themeColor: "#030510",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "GPS",
  },
  openGraph: {
    type: "website",
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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={nunito.variable}>
      <body style={{ margin: 0, background: "#000", overflow: "hidden" }}>
        {children}
      </body>
    </html>
  );
}
