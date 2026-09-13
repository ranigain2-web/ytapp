// Web fallback — background playback is an Android-only feature (it needs a
// foreground service). On web/desktop every method is a silent no-op so the
// same app code runs everywhere. Pure JS on purpose (compiled dist).
export class YtBackgroundWeb {
  async enable() {}
  async update() {}
  async disable() {}
  async addListener() {
    return { remove: async () => {} };
  }
  async removeAllListeners() {}
}
