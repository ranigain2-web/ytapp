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
  root.style.colorScheme = light ? "light" : "dark";
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
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var m="dark";var raw=localStorage.getItem("yt-app-store");if(raw){var j=JSON.parse(raw);var p=j&&j.state&&j.state.prefs;if(p&&p.theme){m=p.theme;}}var l=m==="light"||(m==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches);var r=document.documentElement;r.classList.toggle("yt-light",l);r.classList.toggle("yt-dark",!l);r.style.colorScheme=l?"light":"dark";}catch(e){}})();`;
