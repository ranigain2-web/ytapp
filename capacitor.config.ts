import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.robonuggets.ytapp",
  appName: "YouTube",
  webDir: "out",
  android: {
    allowMixedContent: true,
  },
  server: {
    androidScheme: "https",
    // The app talks to the deployed yt-api backend. The base URL is read at
    // runtime from localStorage ("yt_api_base") — set it in the app's Settings
    // page, or bake a default at build time with NEXT_PUBLIC_API_BASE.
  },
};

export default config;
