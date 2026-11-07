package com.robonuggets.ytplayer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.support.v4.media.MediaDescriptionCompat;

import androidx.core.app.NotificationCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

/**
 * NativePlayerService — ExoPlayer inside a MediaSessionService (Phase 4).
 *
 * Media3's session service gives us, correctly and for free: the media
 * notification with transport controls, audio-focus handling, becoming-
 * noisy (headphone unplug) behavior, and screen-off playback owned by the
 * OS rather than a WebView. This file follows the Media3 1.5 documented
 * service pattern (see media3-session docs: "Media session service apps").
 *
 * STATUS: not yet compiled (no Android SDK in the authoring environment).
 */
public class NativePlayerService extends MediaSessionService {

    public static final String ACTION_PREPARE = "com.robonuggets.ytplayer.PREPARE";
    public static final String ACTION_PLAY = "com.robonuggets.ytplayer.PLAY";
    public static final String ACTION_PAUSE = "com.robonuggets.ytplayer.PAUSE";
    public static final String ACTION_SEEK = "com.robonuggets.ytplayer.SEEK";
    public static final String ACTION_RELEASE = "com.robonuggets.ytplayer.RELEASE";
    public static final String EXTRA_URL = "url";
    public static final String EXTRA_HLS = "hls";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_ARTWORK = "artwork";
    public static final String EXTRA_POSITION = "position";
    public static final String EXTRA_AUTOPLAY = "autoplay";

    private static final String CHANNEL_ID = "yt_player";
    private static final int NOTIFICATION_ID = 0x7974; // "yt"

    private MediaSession mediaSession;
    private static volatile PlayerSnapshot lastSnapshot;

    /** Snapshot for the plugin's position() probe. */
    public static class PlayerSnapshot {
        public final String state;
        public final double position;
        public final double duration;
        PlayerSnapshot(String s, double p, double d) { state = s; position = p; duration = d; }
    }

    public static PlayerSnapshot snapshot() {
        return lastSnapshot;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ExoPlayer player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(this))
                .build();
        player.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                publish(player);
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                publish(player);
            }
        });
        mediaSession = new MediaSession.Builder(this, player).build();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) return START_STICKY;
        String action = intent.getAction();
        Player player = mediaSession.getPlayer();
        switch (action) {
            case ACTION_PREPARE: {
                String url = intent.getStringExtra(EXTRA_URL);
                boolean hls = intent.getBooleanExtra(EXTRA_HLS, false);
                String title = intent.getStringExtra(EXTRA_TITLE);
                String artist = intent.getStringExtra(EXTRA_ARTIST);
                double position = intent.getDoubleExtra(EXTRA_POSITION, 0d);
                boolean autoplay = intent.getBooleanExtra(EXTRA_AUTOPLAY, true);
                MediaMetadata meta = new MediaMetadata.Builder()
                        .setTitle(title == null ? "" : title)
                        .setArtist(artist == null ? "" : artist)
                        .build();
                MediaItem item = new MediaItem.Builder()
                        .setUri(url)
                        .setMimeType(hls ? "application/x-mpegURL" : null)
                        .setMediaMetadata(meta)
                        .build();
                player.setMediaItem(item, (long) (position * 1000L));
                player.prepare();
                if (autoplay) player.play();
                break;
            }
            case ACTION_PLAY:
                player.play();
                break;
            case ACTION_PAUSE:
                player.pause();
                break;
            case ACTION_SEEK: {
                double to = intent.getDoubleExtra(EXTRA_POSITION, 0d);
                player.seekTo((long) (to * 1000L));
                break;
            }
            case ACTION_RELEASE:
                stopSelf();
                return START_NOT_STICKY;
            default:
                break;
        }
        return START_STICKY;
    }

    private void publish(Player player) {
        String state;
        switch (player.getPlaybackState()) {
            case Player.STATE_ENDED: state = "ended"; break;
            case Player.STATE_IDLE: state = player.getPlaybackSuppressionReason() == Player.PLAYBACK_SUPPRESSION_REASON_NONE ? "ready" : "ready"; break;
            case Player.STATE_BUFFERING: state = player.isPlaying() ? "playing" : "paused"; break;
            default: state = player.isPlaying() ? "playing" : "paused"; break;
        }
        double pos = player.getCurrentPosition() / 1000.0;
        double dur = player.getDuration() / 1000.0;
        if (dur < 0) dur = 0;
        lastSnapshot = new PlayerSnapshot(state, pos, dur);
        YtPlayerPlugin plugin = YtPlayerPlugin.instance;
        if (plugin != null) {
            try {
                org.json.JSONObject o = new org.json.JSONObject();
                o.put("state", state);
                o.put("position", pos);
                o.put("duration", dur);
                plugin.emitState(o);
            } catch (org.json.JSONException ignored) {
            }
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                nm.createNotificationChannel(new NotificationChannel(
                        CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW));
            }
        }
    }

    @Override
    public MediaSession onGetSession(ControllerInfo controllerInfo) {
        return mediaSession;
    }

    // MediaSessionService builds the media notification itself from the
    // session; onTaskRemoved must stop playback when the task is swiped
    // away (documented Media3 behavior).
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Player player = mediaSession.getPlayer();
        if (!player.getPlayWhenReady() || player.getPlaybackState() == Player.STATE_ENDED) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        if (mediaSession != null) {
            mediaSession.getPlayer().release();
            mediaSession.release();
            mediaSession = null;
        }
        lastSnapshot = null;
        super.onDestroy();
    }
}
