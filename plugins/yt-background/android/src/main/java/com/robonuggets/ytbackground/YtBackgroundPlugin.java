package com.robonuggets.ytbackground;

import android.content.Context;
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

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) {
            instance = null;
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
        String title = call.getString("title", "YouTube");
        String artist = call.getString("artist", "");
        String artwork = call.getString("artwork", "");
        Double duration = call.getDouble("duration", 0.0);
        MediaPlaybackService.start(ctx, title, artist, artwork, duration == null ? 0.0 : duration);
        call.resolve();
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
