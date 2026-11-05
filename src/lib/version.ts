// Single source of truth for the app version shown in Settings → About and
// referenced in GitHub Releases. DERIVED from package.json — the v1.3.0
// session caught this file drifting after a version bump (the What's-new
// dialog opened for the wrong version and broke the e2e suite), so the
// hand-sync is gone for good.
import pkg from "../../package.json";

export const APP_VERSION = pkg.version as string;
