package com.robonuggets.ytplayer;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * YtPlayer — the native Media3 playback engine (ytapp Phase 4).
 *
 * The WebView player is fine until the screen turns off: WebView timers
 * starve and HLS playback dies. This plugin moves the MEDIA to a
 * Media3 ExoPlayer owned by a foreground service with a real MediaSession:
 * screen-off background play becomes the OS's problem, solved properly.
 * The app's playback store stays the UI's source of truth — state flows
 * back through the "state" listener (position/duration/play-state) and the
 * lock-screen controls arrive through the session's own handlers.
 *
 * STATUS: written against Capacitor 7 + Media3 1.5 APIs; NOT yet compiled —
 * this sandbox has no Android SDK. Needs one Gradle build (CI or a dev
 * machine) before the experimental toggle should be flipped for users.
 */
@CapacitorPlugin(name = "YtPlayer")
public class YtPlayerPlugin extends Plugin {

    static volatile YtPlayerPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** Emit a state event to JS (called by NativePlayerService). */
    void emitState(JSONObject state) {
        try {
            notifyListeners("state", JSObject.fromJSONObject(state));
        } catch (JSONException ignored) {
            // malformed state is dropped, never fatal
        }
    }

    @PluginMethod
    public void prepare(final PluginCall call) {
        final String url = call.getString("url", "");
        if (url.isEmpty()) {
            call.reject("url required");
            return;
        }
        Intent i = new Intent(getContext(), NativePlayerService.class)
                .setAction(NativePlayerService.ACTION_PREPARE)
                .putExtra(NativePlayerService.EXTRA_URL, url)
                .putExtra(NativePlayerService.EXTRA_HLS, call.getBoolean("hls", false))
                .putExtra(NativePlayerService.EXTRA_TITLE, call.getString("title", ""))
                .putExtra(NativePlayerService.EXTRA_ARTIST, call.getString("artist", ""))
                .putExtra(NativePlayerService.EXTRA_ARTWORK, call.getString("artwork", ""))
                .putExtra(NativePlayerService.EXTRA_POSITION, call.getDouble("position", 0d))
                .putExtra(NativePlayerService.EXTRA_AUTOPLAY, call.getBoolean("autoplay", true));
        try {
            com.getcapacitor.Bridge bridge = getBridge();
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                bridge.getContext().startForegroundService(i);
            } else {
                bridge.getContext().startService(i);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("prepare failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void play(final PluginCall call) {
        sendAction(NativePlayerService.ACTION_PLAY);
        call.resolve();
    }

    @PluginMethod
    public void pause(final PluginCall call) {
        sendAction(NativePlayerService.ACTION_PAUSE);
        call.resolve();
    }

    @PluginMethod
    public void seekTo(final PluginCall call) {
        Double to = call.getDouble("to", 0d);
        Intent i = new Intent(getContext(), NativePlayerService.class)
                .setAction(NativePlayerService.ACTION_SEEK)
                .putExtra(NativePlayerService.EXTRA_POSITION, to);
        getContext().startService(i);
        call.resolve();
    }

    @PluginMethod
    public void position(final PluginCall call) {
        NativePlayerService.PlayerSnapshot s = NativePlayerService.snapshot();
        if (s == null) {
            call.reject("player not prepared");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("state", s.state);
        ret.put("position", s.position);
        ret.put("duration", s.duration);
        call.resolve(ret);
    }

    @PluginMethod
    public void release(final PluginCall call) {
        Intent i = new Intent(getContext(), NativePlayerService.class).setAction(NativePlayerService.ACTION_RELEASE);
        getContext().startService(i);
        call.resolve();
    }

    private void sendAction(String action) {
        Intent i = new Intent(getContext(), NativePlayerService.class).setAction(action);
        // play/pause can be latency-sensitive: startService is enough while
        // the service is alive; prepare() is what promotes it to foreground.
        getContext().startService(i);
    }
}
