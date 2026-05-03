import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.lovebeing.spectra",
  appName: "SPECTRA",
  webDir: "out",           // Next.js static export target directory
  server: {
    // hostname is used inside the WKWebView — keep consistent across deploys
    hostname: "spectra.lovebeing.app",
    iosScheme: "spectra",
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,          // we handle the boot screen ourselves
      backgroundColor: "#000000",
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
    StatusBar: {
      style: "Dark",
      backgroundColor: "#000000",
      overlaysWebView: true,
    },
  },
  ios: {
    contentInset: "always",
    backgroundColor: "#000000",
    preferredContentMode: "mobile",
  },
  android: {
    backgroundColor: "#000000",
    allowMixedContent: false,
  },
};

export default config;
