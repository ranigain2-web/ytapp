package com.robonuggets.ytbackground;

import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * YtBackground — YouTube-Premium-style background playback for ytapp.
 *
 * While a direct-stream video is playing and the user has background play
 * enabled, the JS layer calls {@link #enable} once and {@link #update} as
 * playback advances. The service keeps the app process in the foreground
 * (so the WebView keeps streaming when the activity is backgrounded or the
 * screen is off), shows a MediaStyle lock-screen notification with
 * Play/Pause/Next/Close actions, and mirrors metadata into a MediaSession
 * so headset buttons and the system media routes control the WebView player.
 * Control events flow back to JS through the "control" listener.
 */
@CapacitorPlugin(name = "YtBackground")
public class YtBackgroundPlugin extends Plugin {

    static volatile YtBackgroundPlugin instance;

    /** True while a background-play session is live (enable() … disable()). */
    private volatile boolean mediaActive = false;

    /** Phase 2 (PiP): JS-side toggle for Home-press → PiP ([A5]). */
    private volatile boolean pipOnHome = true;

    @Override
    public void load() {
        instance = this;
    }

    /**
     * Android pauses WebView timers once the activity is not visible. For
     * MediaSource/HLS playback that is fatal: hls.js needs its timers to append
     * new segments to the buffer, so playback starves a few seconds after the
     * app is backgrounded even though the <video> element itself is fine. The
     * foreground service keeps the process alive; this keeps the JS timers
     * alive so the buffer keeps filling.
     */
    @Override
    protected void handleOnPause() {
        // Phase 2 (PiP, [A5]): the CI-injected MainActivity.onUserLeaveHint
        // sets the flag just before this pause when the USER chose to leave
        // (Home/Recents — not the power button, which never fires the hint).
        // Entering PiP from the pause path is the documented-safe moment.
        if (PipHomeWatcher.HOME_REQUESTED) {
            PipHomeWatcher.HOME_REQUESTED = false;
            if (pipOnHome && mediaActive) tryEnterPip();
        }
        if (mediaActive) resumeWebViewTimers();
    }

    @Override
    protected void handleOnResume() {
        // back in the app (incl. expanding PiP back to fullscreen): forget any
        // pending dismiss signal so it can't later fire as a false stop
        PipHomeWatcher.DISMISSED = false;
    }

    @Override
    protected void handleOnStop() {
        // PiP window DISMISSED: the injected MainActivity's
        // onPictureInPictureModeChanged(false) set the flag, and onStop only
        // runs when the activity truly leaves the screen — expanding back
        // goes through onResume instead. Route it as the existing "stop".
        if (PipHomeWatcher.DISMISSED) {
            PipHomeWatcher.DISMISSED = false;
            emitControl("stop");
        }
    }

    /** Phase 2 (PiP): shrink into a floating ~16:9 window (API 26+). */
    private void tryEnterPip() {
        try {
            if (Build.VERSION.SDK_INT < 26) return;
            final android.app.Activity act = getActivity();
            if (act == null) return;
            act.runOnUiThread(() -> {
                try {
                    android.app.PictureInPictureParams params =
                            new android.app.PictureInPictureParams.Builder()
                                    .setAspectRatio(new android.util.Rational(16, 9))
                                    .build();
                    act.enterPictureInPictureMode(params);
                } catch (Throwable ignored) {
                    // unsupported / not eligible right now: silent no-op
                }
            });
        } catch (Throwable ignored) {
        }
    }

    private void resumeWebViewTimers() {
        try {
            Bridge bridge = getBridge();
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().resumeTimers();
            }
        } catch (Throwable ignored) {
            // best-effort insurance; playback is unaffected if unavailable
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) {
            instance = null;
            mediaActive = false;
            Context ctx = getContext();
            if (ctx != null) {
                MediaPlaybackService.stop(ctx);
            }
        }
    }

    @PluginMethod
    public void enable(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("no context");
            return;
        }
        // Android 13+: the MediaStyle notification needs POST_NOTIFICATIONS
        // granted at runtime, otherwise the FGS runs but silently. Ask once
        // when background playback first starts.
        requestNotificationsPermissionIfNeeded();
        mediaActive = true;
        String title = call.getString("title", "YouTube");
        String artist = call.getString("artist", "");
        String artwork = call.getString("artwork", "");
        Double duration = call.getDouble("duration", 0.0);
        MediaPlaybackService.start(ctx, title, artist, artwork, duration == null ? 0.0 : duration);
        call.resolve();
    }

    private void requestNotificationsPermissionIfNeeded() {
        try {
            if (Build.VERSION.SDK_INT >= 33
                    && getContext() != null
                    && getContext().checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                            != PackageManager.PERMISSION_GRANTED
                    && getActivity() != null) {
                getActivity().requestPermissions(
                        new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 4242);
            }
        } catch (Throwable ignored) {
            // permission flow is best-effort — the FGS itself works regardless
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        Context ctx = getContext();
        if (ctx == null) {
            call.reject("no context");
            return;
        }
        Boolean playing = call.getBoolean("playing");
        Double position = call.getDouble("position");
        Double duration = call.getDouble("duration");
        String title = call.getString("title");
        String artist = call.getString("artist");
        MediaPlaybackService.update(
                ctx,
                playing,
                position == null ? -1.0 : position,
                duration == null ? -1.0 : duration,
                title,
                artist);
        call.resolve();
    }

    @PluginMethod
    public void disable(PluginCall call) {
        mediaActive = false;
        Context ctx = getContext();
        if (ctx != null) {
            MediaPlaybackService.stop(ctx);
        }
        call.resolve();
    }

    /**
     * Phase 1: keep-screen-on control. The web layer's
     * `capacitor.config.ts > keepScreenOn` never existed as a Capacitor
     * feature — this is the real mechanism: setKeepScreenOn() on the WebView.
     * While a video is PLAYING in the foreground the screen must not sleep
     * (YouTube behavior); on pause/background it must.
     */
    @PluginMethod
    public void keepAwake(PluginCall call) {
        Boolean enable = call.getBoolean("enable", Boolean.TRUE);
        final boolean e = enable == null || enable.booleanValue();
        try {
            Bridge bridge = getBridge();
            if (bridge == null || bridge.getWebView() == null) {
                call.reject("no webview");
                return;
            }
            final android.webkit.WebView wv = bridge.getWebView();
            Runnable apply = new Runnable() {
                @Override
                public void run() {
                    try {
                        wv.setKeepScreenOn(e);
                    } catch (Throwable ignored) {
                    }
                }
            };
            // Views may only be mutated on the UI thread.
            android.app.Activity act = getActivity();
            if (act != null) act.runOnUiThread(apply);
            else wv.post(apply);
            call.resolve();
        } catch (Throwable t) {
            call.reject("keepAwake failed: " + t.getMessage());
        }
    }

    void emitControl(String action) {
        JSObject data = new JSObject();
        data.put("action", action);
        notifyListeners("control", data);
    }

    void emitSeek(double seconds) {
        JSObject data = new JSObject();
        data.put("action", "seek");
        data.put("seekTo", seconds);
        notifyListeners("control", data);
    }

    /**
     * Phase 2 (PiP, [A5]): the player's PiP button on Android. Leaving PiP is
     * user-driven; dismissing the window arrives as the existing "stop"
     * control event (see handleOnStop above).
     */
    @PluginMethod
    public void enterPip(PluginCall call) {
        tryEnterPip();
        call.resolve();
    }

    /**
     * Phase 2 (PiP, [A5]): whether a Home-press while playing enters PiP.
     * The JS layer pushes the Settings toggle through here; the plugin
     * consults it when the onUserLeaveHint flag fires.
     */
    @PluginMethod
    public void setPipOnHome(PluginCall call) {
        Boolean enable = call.getBoolean("enable", Boolean.TRUE);
        pipOnHome = enable == null || enable.booleanValue();
        call.resolve();
    }
}
