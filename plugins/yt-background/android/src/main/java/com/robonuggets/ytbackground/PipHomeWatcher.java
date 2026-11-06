package com.robonuggets.ytbackground;

/**
 * Phase 2 (PiP, plan amendment [A5]): the CI-injected MainActivity snippet
 * can't reach the plugin directly (the activity is template-generated), so it
 * sets STATIC flags here that the plugin polls on its own lifecycle events.
 *
 *   onUserLeaveHint()          → HOME_REQUESTED = true   (user is leaving via
 *                                Home/Recents — NOT the power button, which
 *                                is exactly the distinction PiP needs)
 *   onPictureInPictureModeChanged(false) → DISMISSED = true (window closed or
 *                                expanded back — onStop tells them apart)
 *
 * The plugin reads + clears these in handleOnPause / handleOnStop /
 * handleOnResume, which Capacitor forwards from the activity.
 */
public final class PipHomeWatcher {

    /** Set by MainActivity.onUserLeaveHint; consumed by the plugin on pause. */
    public static volatile boolean HOME_REQUESTED = false;

    /**
     * Set when the PiP window goes away (dismiss OR expand-back). Consumed by
     * the plugin in handleOnStop — expanding back also resumes the activity
     * (handleOnResume clears it first), so only a real dismissal turns into
     * the "stop" control event.
     */
    public static volatile boolean DISMISSED = false;

    private PipHomeWatcher() {}
}
