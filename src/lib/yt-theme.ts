// Theme engine — YouTube-style Appearance setting (Dark / Light / Device theme).
// Colors live in CSS variables (globals.css: :root dark values, html.yt-light
// overrides). This module only flips the class + persists the preference.

export type ThemeMode = "dark" | "light" | "system";

export function resolveIsLight(mode: ThemeMode): boolean {
  if (mode === "light") return true;
  if (mode === "dark") return false;
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const light = resolveIsLight(mode);
  const root = document.documentElement;
  root.classList.toggle("yt-light", light);
  root.classList.toggle("yt-dark", !light);
  // color-scheme is driven by html.yt-dark / html.yt-light in globals.css, NOT
  // by an inline style: the boot script runs before hydration, and adding a
  // style attribute the server never rendered broke hydration on <html>
  // (React error #418 on every page). Class changes are suppressed via
  // suppressHydrationWarning on that element; style changes were not.
}

/** Subscribe to OS theme changes (only acts when mode === "system"). */
export function watchSystemTheme(getMode: () => ThemeMode) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const onChange = () => {
    if (getMode() === "system") applyTheme("system");
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Inline <head> script source (layout.tsx) — applies the stored theme before
 * first paint so there is no dark/light flash on the static APK. Reads the
 * zustand persist storage key directly.
 *
 * It also stamps `yt-android` on <html> when the Capacitor bridge is present.
 * That is what pins the mobile shell (48px app bar + bottom nav) in the Android
 * WebView at ANY width — YouTube picks its chrome from the user agent, so an
 * Android tablet at 834px must not render the desktop guide rail. The class is
 * stamped here rather than in a React effect so an Android tablet never paints
 * desktop chrome for a frame before correcting itself. Detection is duplicated
 * from yt-native.ts `isAndroidApp()` because this string must stay
 * dependency-free and run before any module loads.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var m="dark";var raw=localStorage.getItem("yt-app-store");if(raw){var j=JSON.parse(raw);var p=j&&j.state&&j.state.prefs;if(p&&p.theme){m=p.theme;}}var l=m==="light"||(m==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches);var r=document.documentElement;r.classList.toggle("yt-light",l);r.classList.toggle("yt-dark",!l);var a=false;try{a=!!window.androidBridge||!!(window.Capacitor&&window.Capacitor.getPlatform&&window.Capacitor.getPlatform()==="android");}catch(e2){}r.classList.toggle("yt-android",a);}catch(e){}})();`;
