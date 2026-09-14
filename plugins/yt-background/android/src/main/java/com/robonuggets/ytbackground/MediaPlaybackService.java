package com.robonuggets.ytbackground;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
// NOTE: keep the legacy `android.support.v4.media.*` names. The androidx.media
// equivalents (androidx.media.MediaMetadataCompat / .session.MediaSessionCompat
// / .session.PlaybackStateCompat) DO NOT resolve on this module's compile
// classpath even with `androidx.media:media` declared — verified by a CI run
// that failed with "cannot find symbol ... location: package androidx.media"
// while `androidx.media.app.NotificationCompat.MediaStyle` resolved fine. The
// support-4 names are provided through Jetifier (the generated Android project
// has enableJetifier on) and are the configuration CI has proven green. Do not
// "modernise" these imports without an Android SDK to compile against.
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.annotation.Nullable;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Foreground service (mediaPlayback type) that keeps ytapp's WebView streaming
 * while the app is backgrounded / screen-off, with a MediaStyle notification
 * and a MediaSession wired to the WebView player through the plugin.
 */
public class MediaPlaybackService extends Service {

    private static final String CHANNEL_ID = "yt_media_playback";
    private static final int NOTIFICATION_ID = 4242;

    public static final String ACTION_ENABLE = "com.robonuggets.ytbackground.action.ENABLE";
    public static final String ACTION_UPDATE = "com.robonuggets.ytbackground.action.UPDATE";
    public static final String ACTION_DISABLE = "com.robonuggets.ytbackground.action.DISABLE";
    public static final String ACTION_PLAY = "com.robonuggets.ytbackground.action.PLAY";
    public static final String ACTION_PAUSE = "com.robonuggets.ytbackground.action.PAUSE";
    public static final String ACTION_NEXT = "com.robonuggets.ytbackground.action.NEXT";
    public static final String ACTION_STOP = "com.robonuggets.ytbackground.action.STOP";
    public static final String ACTION_SEEK = "com.robonuggets.ytbackground.action.SEEK";

    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_ARTIST = "artist";
    private static final String EXTRA_ARTWORK = "artwork";
    private static final String EXTRA_DURATION = "duration";
    private static final String EXTRA_PLAYING = "playing";
    private static final String EXTRA_POSITION = "position";
    private static final String EXTRA_SEEK_TO = "seekTo";

    /**
     * The live service instance.
     *
     * This exists because Android 12+ forbids starting a foreground service
     * from the background (ForegroundServiceStartNotAllowedException). Once the
     * app is backgrounded, every {@code startForegroundService()} call — the
     * periodic position sync AND the re-assert fired on visibilitychange —
     * would throw and be swallowed, so the notification went stale and a
     * service that had been reclaimed was never brought back. Talking to the
     * already-running instance directly sidesteps the restriction entirely.
     */
    private static volatile MediaPlaybackService instance;

    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaSessionCompat mediaSession;
    private PowerManager.WakeLock wakeLock;
    private String title = "YouTube";
    private String artist = "";
    private String artworkUrl = "";
    private Bitmap artwork;
    private boolean playing = false;
    private double duration = 0.0;
    private double position = 0.0;
    private boolean tornDown = false;

    // ---- static command entrypoints (called from the plugin) ----

    static void start(Context ctx, String title, String artist, String artwork, double duration) {
        MediaPlaybackService live = instance;
        if (live != null) {
            // Already running: mutate it in place (no background service start).
            final String t = title, a = artist, aw = artwork;
            final double d = duration;
            live.main.post(new Runnable() {
                @Override
                public void run() {
                    live.applyEnable(t, a, aw, d);
                }
            });
            return;
        }
        Intent i = new Intent(ctx, MediaPlaybackService.class);
        i.setAction(ACTION_ENABLE);
        i.putExtra(EXTRA_TITLE, title);
        i.putExtra(EXTRA_ARTIST, artist);
        i.putExtra(EXTRA_ARTWORK, artwork);
        i.putExtra(EXTRA_DURATION, duration);
        startSafe(ctx, i);
    }

    static void update(Context ctx, Boolean playing, double position, double duration, String title, String artist) {
        MediaPlaybackService live = instance;
        if (live != null) {
            // Runs on every ~5s tick and on every play/pause while backgrounded,
            // so this MUST NOT go through startForegroundService().
            final Boolean p = playing;
            final double pos = position, dur = duration;
            final String t = title, a = artist;
            live.main.post(new Runnable() {
                @Override
                public void run() {
                    live.applyUpdate(p, pos, dur, t, a);
                }
            });
            return;
        }
        Intent i = new Intent(ctx, MediaPlaybackService.class);
        i.setAction(ACTION_UPDATE);
        if (playing != null) i.putExtra(EXTRA_PLAYING, playing.booleanValue());
        if (position >= 0) i.putExtra(EXTRA_POSITION, position);
        if (duration >= 0) i.putExtra(EXTRA_DURATION, duration);
        if (title != null) i.putExtra(EXTRA_TITLE, title);
        if (artist != null) i.putExtra(EXTRA_ARTIST, artist);
        startSafe(ctx, i);
    }

    static void stop(Context ctx) {
        MediaPlaybackService live = instance;
        if (live != null) {
            live.main.post(new Runnable() {
                @Override
                public void run() {
                    live.teardown();
                }
            });
            return;
        }
        try {
            ctx.stopService(new Intent(ctx, MediaPlaybackService.class));
        } catch (Throwable ignored) {
        }
    }

    private static void startSafe(Context ctx, Intent i) {
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }
        } catch (Throwable ignored) {
            // app in background + service not yet foreground: updates are best-effort
        }
    }

    // ---- service lifecycle ----

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();
        mediaSession = new MediaSessionCompat(this, "ytapp-media");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                emitControl("play");
            }

            @Override
            public void onPause() {
                emitControl("pause");
            }

            @Override
            public void onSkipToNext() {
                emitControl("next");
            }

            @Override
            public void onStop() {
                emitControl("stop");
            }

            @Override
            public void onSeekTo(long pos) {
                emitSeek(pos / 1000.0);
            }
        });
        mediaSession.setActive(true);
        acquireWakeLock();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null && intent.getAction() != null ? intent.getAction() : ACTION_UPDATE;
        switch (action) {
            case ACTION_ENABLE: {
                String t = intent.getStringExtra(EXTRA_TITLE);
                String a = intent.getStringExtra(EXTRA_ARTIST);
                String aw = intent.getStringExtra(EXTRA_ARTWORK);
                double d = intent.hasExtra(EXTRA_DURATION) ? intent.getDoubleExtra(EXTRA_DURATION, duration) : duration;
                applyEnable(t, a, aw, d);
                break;
            }
            case ACTION_UPDATE: {
                Boolean p = intent.hasExtra(EXTRA_PLAYING) ? intent.getBooleanExtra(EXTRA_PLAYING, playing) : null;
                double pos = intent.hasExtra(EXTRA_POSITION) ? intent.getDoubleExtra(EXTRA_POSITION, position) : -1.0;
                double dur = intent.hasExtra(EXTRA_DURATION) ? intent.getDoubleExtra(EXTRA_DURATION, duration) : -1.0;
                String t = intent.hasExtra(EXTRA_TITLE) ? intent.getStringExtra(EXTRA_TITLE) : null;
                String a = intent.hasExtra(EXTRA_ARTIST) ? intent.getStringExtra(EXTRA_ARTIST) : null;
                applyUpdate(p, pos, dur, t, a);
                break;
            }
            case ACTION_PLAY: {
                playing = true;
                startForeground(NOTIFICATION_ID, buildNotification());
                refreshSession();
                emitControl("play");
                break;
            }
            case ACTION_PAUSE: {
                playing = false;
                startForeground(NOTIFICATION_ID, buildNotification());
                refreshSession();
                emitControl("pause");
                break;
            }
            case ACTION_NEXT: {
                emitControl("next");
                break;
            }
            case ACTION_STOP: {
                emitControl("stop");
                teardown();
                break;
            }
            case ACTION_SEEK: {
                double s = intent.getDoubleExtra(EXTRA_SEEK_TO, -1.0);
                if (s >= 0) emitSeek(s);
                break;
            }
            default:
                break;
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // user swiped the app away → stop playback
        emitControl("stop");
        teardown();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        if (!tornDown) teardown();
        super.onDestroy();
    }

    // ---- in-place mutation (main thread) ----

    private void applyEnable(String t, String a, String aw, double d) {
        tornDown = false;
        if (t != null && !t.isEmpty()) title = t;
        if (a != null) artist = a;
        if (aw != null && !aw.equals(artworkUrl)) {
            artworkUrl = aw;
            artwork = null;
        }
        if (d > 0) duration = d;
        playing = true;
        startForeground(NOTIFICATION_ID, buildNotification());
        refreshSession();
        fetchArtwork();
    }

    private void applyUpdate(Boolean p, double pos, double dur, String t, String a) {
        if (tornDown) return;
        if (t != null && !t.isEmpty()) title = t;
        if (a != null) artist = a;
        if (p != null) playing = p.booleanValue();
        if (dur > 0) duration = dur;
        if (pos >= 0) position = pos;
        startForeground(NOTIFICATION_ID, buildNotification());
        refreshSession();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ---- internals ----

    private void teardown() {
        tornDown = true;
        try {
            if (mediaSession != null) {
                mediaSession.setActive(false);
                mediaSession.release();
            }
        } catch (Throwable ignored) {
        }
        mediaSession = null;
        releaseWakeLock();
        try {
            if (Build.VERSION.SDK_INT >= 24) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Throwable ignored) {
        }
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) {
            try {
                nm.cancel(NOTIFICATION_ID);
            } catch (Throwable ignored) {
            }
        }
        stopSelf();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Media playback status");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
    }

    private void acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ytapp:mediaplayback");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire(4 * 60 * 60 * 1000L); // 4h cap, renewed on re-enable
            }
        } catch (Throwable ignored) {
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Throwable ignored) {
        }
        wakeLock = null;
    }

    private int appIcon() {
        try {
            int id = getResources().getIdentifier("ic_launcher", "mipmap", getPackageName());
            if (id != 0) return id;
        } catch (Throwable ignored) {
        }
        return android.R.drawable.ic_media_play;
    }

    private PendingIntent servicePi(String action, int requestCode) {
        Intent i = new Intent(this, MediaPlaybackService.class);
        i.setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getService(this, requestCode, i, flags);
    }

    private PendingIntent contentPi() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open == null) {
            open = new Intent(this, MediaPlaybackService.class);
            open.setAction(ACTION_STOP);
            return servicePi(ACTION_STOP, 0);
        }
        return PendingIntent.getActivity(this, 0, open, flags);
    }

    private Notification buildNotification() {
        PendingIntent content = contentPi();
        try {
            mediaSession.setSessionActivity(content);
        } catch (Throwable ignored) {
        }

        NotificationCompat.Action playPause = playing
                ? new NotificationCompat.Action(android.R.drawable.ic_media_pause, "Pause", servicePi(ACTION_PAUSE, 1))
                : new NotificationCompat.Action(android.R.drawable.ic_media_play, "Play", servicePi(ACTION_PLAY, 1));

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(appIcon())
                .setContentTitle(title)
                .setContentText(artist == null || artist.isEmpty() ? "Playing in background" : artist)
                .setLargeIcon(artwork)
                .setContentIntent(content)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .addAction(playPause)
                .addAction(new NotificationCompat.Action(android.R.drawable.ic_media_next, "Next", servicePi(ACTION_NEXT, 2)))
                .addAction(new NotificationCompat.Action(android.R.drawable.ic_menu_close_clear_cancel, "Close", servicePi(ACTION_STOP, 3)));

        try {
            b.setStyle(new MediaStyle()
                    .setMediaSession(mediaSession.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2));
        } catch (Throwable ignored) {
        }
        return b.build();
    }

    private void updateNotification() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification());
        } catch (Throwable ignored) {
        }
    }

    private void refreshSession() {
        if (mediaSession == null) return;
        try {
            MediaMetadataCompat.Builder mb = new MediaMetadataCompat.Builder()
                    .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                    .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                    .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, title)
                    .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, artist)
                    .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_DESCRIPTION, "ytapp — background playback");
            if (duration > 0) mb.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, (long) (duration * 1000));
            if (artwork != null) {
                mb.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, artwork);
                mb.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork);
                mb.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, artwork);
            }
            mediaSession.setMetadata(mb.build());

            PlaybackStateCompat.Builder pb = new PlaybackStateCompat.Builder()
                    .setActions(PlaybackStateCompat.ACTION_PLAY
                            | PlaybackStateCompat.ACTION_PAUSE
                            | PlaybackStateCompat.ACTION_PLAY_PAUSE
                            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                            | PlaybackStateCompat.ACTION_STOP
                            | PlaybackStateCompat.ACTION_SEEK_TO);
            pb.setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                    (long) (position * 1000), playing ? 1f : 0f);
            mediaSession.setPlaybackState(pb.build());
        } catch (Throwable ignored) {
        }
    }

    private void fetchArtwork() {
        final String url = artworkUrl;
        if (url == null || url.isEmpty() || artwork != null) return;
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                InputStream is = c.getInputStream();
                Bitmap bmp = BitmapFactory.decodeStream(is);
                if (bmp != null && !url.equals("")) {
                    artwork = bmp;
                    refreshSession();
                    updateNotification();
                }
            } catch (Throwable ignored) {
            }
        }).start();
    }

    private void emitControl(String action) {
        try {
            YtBackgroundPlugin p = YtBackgroundPlugin.instance;
            if (p != null) p.emitControl(action);
        } catch (Throwable ignored) {
        }
    }

    private void emitSeek(double seconds) {
        try {
            YtBackgroundPlugin p = YtBackgroundPlugin.instance;
            if (p != null) p.emitSeek(seconds);
        } catch (Throwable ignored) {
        }
    }
}
