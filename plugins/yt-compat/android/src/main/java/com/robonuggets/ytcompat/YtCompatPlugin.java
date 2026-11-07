package com.robonuggets.ytcompat;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * YtCompat — the Compat Mode WebView (ytapp Phase 2).
 *
 * Opens YouTube's real mobile site in a fullscreen NATIVE WebView added on
 * top of the app (not an iframe: X-Frame-Options forbids embedding and a
 * cross-origin frame can never be scripted). The app passes a JS bundle that
 * is injected at document start on every navigation; the bundle spoofs page
 * visibility, guards background playback, strips ad payloads from InnerTube
 * responses, and reports player state / cookies back through the
 * {@code ytCompatNative} bridge. Control flows the other way through
 * {@link #execute} (evaluateJavascript) — the lock-screen notification
 * drives the YouTube player through it.
 */
@CapacitorPlugin(name = "YtCompat")
public class YtCompatPlugin extends Plugin {

    // A real mobile-Chrome UA: m.youtube.com serves its mobile web app to it,
    // and a desktop UA would serve the desktop page instead.
    private static final String MOBILE_UA =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

    private WebView compatView;
    private FrameLayout compatRoot;
    private String pendingInjection = "";
    private volatile boolean injectedOnce = false;

    @PluginMethod
    public void open(final PluginCall call) {
        final String url = call.getString("url", "");
        final String injection = call.getString("injection", "");
        if (url.isEmpty()) {
            call.reject("url required");
            return;
        }
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        pendingInjection = injection;
        injectedOnce = false;

        activity.runOnUiThread(() -> {
            try {
                closeInternal();
                compatView = createWebView(activity);
                compatRoot = new FrameLayout(activity);
                compatRoot.setBackgroundColor(Color.BLACK);
                compatRoot.setLayoutParams(new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                compatRoot.addView(compatView, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                // SYSTEM_UI flags: the compat surface is immersive video, and the
                // app's own Close affordance lives in the injected bundle bar.
                activity.getWindow().getDecorView().addView(compatRoot);
                compatView.loadUrl(url);
                call.resolve();
            } catch (Exception e) {
                call.reject("open failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void execute(final PluginCall call) {
        final String js = call.getString("js", "");
        final WebView view = compatView;
        if (view == null) {
            call.reject("compat view not open");
            return;
        }
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        activity.runOnUiThread(() ->
                view.evaluateJavascript(js, value -> {
                    JSObject ret = new JSObject();
                    ret.put("value", value);
                    call.resolve(ret);
                }));
    }

    @PluginMethod
    public void close(final PluginCall call) {
        final Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(this::closeInternal);
        }
        call.resolve();
    }

    @Override
    public void handleOnDestroy() {
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(this::closeInternal);
        }
        super.handleOnDestroy();
    }

    // ------------------------------------------------------------------

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private WebView createWebView(Activity activity) {
        WebView view = new WebView(activity);
        view.getSettings().setJavaScriptEnabled(true);
        view.getSettings().setDomStorageEnabled(true);
        view.getSettings().setMediaPlaybackRequiresUserGesture(false);
        view.getSettings().setUserAgentString(MOBILE_UA);
        view.getSettings().setCacheMode(WebSettings.LOAD_DEFAULT);
        view.setBackgroundColor(Color.BLACK);
        view.setWebChromeClient(new WebChromeClient()); // autoplay + fullscreen video
        view.addJavascriptInterface(new CompatBridge(), "ytCompatNative");
        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView v, String url, android.graphics.Bitmap favicon) {
                // Document-start injection: the earliest point where the
                // document exists and evaluateJavascript can define the
                // visibility spoof BEFORE YouTube's scripts read it.
                if (!pendingInjection.isEmpty()) {
                    v.evaluateJavascript(pendingInjection, null);
                    injectedOnce = true;
                }
                super.onPageStarted(v, url, favicon);
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                // Belt and braces: some navigations (SPA route changes) never
                // fire onPageStarted for the new "document" — re-arming is
                // idempotent by construction in the bundle.
                if (!injectedOnce && !pendingInjection.isEmpty()) {
                    v.evaluateJavascript(pendingInjection, null);
                }
                injectedOnce = false;
                super.onPageFinished(v, url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                // Stay inside our WebView for everything: YouTube hosts for the
                // video, accounts.google.com for sign-in (users MAY log in inside
                // compat mode — that's what makes the cookie export valuable).
                return false;
            }
        });
        return view;
    }

    private void closeInternal() {
        if (compatRoot != null) {
            ViewGroup parent = (ViewGroup) compatRoot.getParent();
            if (parent != null) parent.removeView(compatRoot);
            compatRoot.removeAllViews();
            compatRoot = null;
        }
        if (compatView != null) {
            compatView.loadUrl("about:blank");
            compatView.destroy();
            compatView = null;
        }
    }

    /** JS → app bridge. The injected bundle calls
     *  ytCompatNative.postMessage(JSON.stringify({...})). */
    private class CompatBridge {
        @JavascriptInterface
        public void postMessage(String raw) {
            try {
                JSONObject data = new JSONObject(raw);
                notifyListeners("message", JSObject.fromJSONObject(data));
            } catch (JSONException ignored) {
                // malformed bridge traffic is dropped, never fatal — the
                // compat surface must fail safe
            }
        }
    }
}
