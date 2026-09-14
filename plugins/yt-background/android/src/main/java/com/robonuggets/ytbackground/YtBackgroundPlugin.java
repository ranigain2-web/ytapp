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
        if (mediaActive) resumeWebViewTimers();
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
}
