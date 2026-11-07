// Web fallback — the native engine exists only in the Android app (it needs
// ExoPlayer + a mediaPlayback foreground service). On web/desktop every
// method reports unavailable and the app keeps using the WebView player.
export class YtPlayerWeb {
  async prepare() {
    throw new Error("The native player is only available in the Android app");
  }
  async play() {
    throw new Error("The native player is only available in the Android app");
  }
  async pause() {
    throw new Error("The native player is only available in the Android app");
  }
  async seekTo() {
    throw new Error("The native player is only available in the Android app");
  }
  async position() {
    throw new Error("The native player is only available in the Android app");
  }
  async release() {}
  async addListener() {
    return { remove: async () => {} };
  }
  async removeAllListeners() {}
}
