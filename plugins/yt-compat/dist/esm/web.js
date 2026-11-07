// Web fallback — Compat Mode needs a NATIVE WebView we can inject into at
// document start. A cross-origin iframe cannot be scripted, so on web/desktop
// the plugin reports unavailable and the UI hides the entry point. Pure JS
// on purpose (compiled dist).
export class YtCompatWeb {
  async open() {
    throw new Error("Compat Mode is only available in the Android app");
  }
  async execute() {
    throw new Error("Compat Mode is only available in the Android app");
  }
  async close() {}
  async addListener() {
    return { remove: async () => {} };
  }  async removeAllListeners() {}
}
