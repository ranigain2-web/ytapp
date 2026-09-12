// preload.cjs — runs in the renderer BEFORE any page script.
// Injects the runtime API base (127.0.0.1 + dynamic port) into localStorage
// so the frontend's API client (src/lib/yt-api.ts → getApiBase()) resolves
// against the bundled local yt-api instead of the build-time default.
// Overwritten on every launch → port changes are always picked up.
try {
  const arg = process.argv.find((a) => a.startsWith('--ytapp-api-base='));
  if (arg) {
    const base = arg.slice('--ytapp-api-base='.length);
    window.localStorage.setItem('yt_api_base', base);
  }
  // Small bridge the Settings page can read to show desktop status
  Object.defineProperty(window, 'ytapp', {
    value: { desktop: true, platform: process.platform },
    configurable: false,
    writable: false,
    enumerable: false,
  });
} catch (err) {
  console.error('[ytapp-preload]', err);
}
