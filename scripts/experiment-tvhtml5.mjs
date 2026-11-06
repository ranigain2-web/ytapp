// experiment-tvhtml5.mjs — phase A evidence: on a datacenter IP where
// WEB/IOS/ANDROID are bot-gated (playability != OK), does the
// TVHTML5_SIMPLY_EMBEDDED_PLAYER client still return playable streams?
// That client is designed for embedded playback, and the videos that hit our
// embed fallback are, by definition, embeddable. If this works from a
// bot-gated IP, most embed-fallback videos convert to direct streams
// (which is what makes background play possible for them).
import Innertube from "youtubei.js";

const VIDEOS = ["jNQXAC9IVRw", "aqz-KE-bpKQ", "9bZkp7q19f0", "dQw4w9WgXcQ"];
const CLIENTS = ["TV_EMBEDDED", "WEB_EMBEDDED", "TV", "MWEB", "ANDROID_VR"];

const yt = await Innertube.create({ retrieve_player: true, generate_session_locally: false });

for (const id of VIDEOS) {
  console.log(`\n=== ${id} ===`);
  for (const client of CLIENTS) {
    try {
      const info = await yt.getInfo(id, { client });
      const status = info.playability_status?.status;
      const sd = info.streaming_data;
      const formats = sd?.formats?.length || 0;
      const adaptive = sd?.adaptive_formats?.length || 0;
      const hasHls = !!sd?.hls_manifest_url;
      let playableUrls = 0;
      for (const f of [...(sd?.formats || []), ...(sd?.adaptive_formats || [])]) {
        try { if (f.decipher(yt.actions.session.player)) playableUrls++; } catch {}
      }
      console.log(`  ${client.padEnd(32)} status=${status} fmt=${formats}+${adaptive} hls=${hasHls} decipherable=${playableUrls}`);
      if (status === "OK" && (formats || adaptive || hasHls)) {
        // probe ONE stream URL to confirm it's not a 403 shell
        try {
          const f = (sd.formats || sd.adaptive_formats || [])[0];
          if (f) {
            const url = f.decipher(yt.actions.session.player);
            const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10000) });
            console.log(`     probe: HTTP ${r.status} content-type=${r.headers.get("content-type") || "?"}`);
          }
        } catch (e) { console.log(`     probe failed: ${String(e.message).slice(0, 80)}`); }
      }
    } catch (e) {
      console.log(`  ${client.padEnd(32)} ERROR ${String(e.message).slice(0, 90)}`);
    }
  }
}
process.exit(0);
