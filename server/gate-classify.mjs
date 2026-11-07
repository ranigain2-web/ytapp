// gate-classify.mjs — pure playability classification (Phase 1, E-04).
// Kept dependency-free and side-effect-free so it is unit-testable without
// booting the server; index.mjs imports it for the extraction chain.

// Classify WHY the chain failed. The UI (and the user) get an actionable
// class instead of one opaque embed_fallback.
export function classifyGate(playabilityMap, webReason) {
  const all = Object.values(playabilityMap || {}).join(' ') + ' ' + String(webReason || '');
  if (/members[- _]only|join this channel/i.test(all)) return 'members_only';
  if (/\bdrm\b|protected content|requires drm/i.test(all)) return 'drm';
  if (/age.restricted|inappropriate|years old|confirm your age/i.test(all)) return 'age_gate';
  // hollow extraction = playability OK but the format URLs 403: YouTube's
  // soft gate (the ANDROID_VR lesson) — same family as bot gating.
  if (/LOGIN_REQUIRED|sign in to confirm|not a bot|verify|hollow extraction/i.test(all)) return 'bot_gate';
  if (/live event has ended|has ended|premiere/i.test(all)) return 'live_ended';
  if (/UNPLAYABLE|unavailable|removed|private/i.test(all)) return 'unavailable';
  return 'unknown';
}
