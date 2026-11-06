// probe-cipher.mjs — what do OUR player attempts actually return: direct URLs,
// signatureCipher, or n-params needing transforms? Evidence for the decipher design.
const WEB_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const ANDROID_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";
const IT_HOST = "https://www.youtube.com";
const VR_CTX = {
  client: {
    clientName: "ANDROID_VR", clientVersion: "1.60.19", deviceModel: "Quest 3",
    osName: "Android", osVersion: "12L", androidSdkVersion: 32, hl: "en", gl: "US",
  },
};
const TV_CTX = {
  client: { clientName: "TVHTML5", clientVersion: "7.20260909.12.00", hl: "en", gl: "US" },
};
const WEB_CTX = { client: { clientName: "WEB", clientVersion: "2.20240726.00.00", hl: "en", gl: "US" } };

const post = async (ep, body, key) =>
  (await fetch(`${IT_HOST}/youtubei/v1/${ep}?key=${key}&prettyPrint=false`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })).json();

const id = process.argv[2] || "dQw4w9WgXcQ";

const IOS_CTX = { client: { clientName: "IOS", clientVersion: "20.10.4", deviceModel: "iPhone16,2", hl: "en", gl: "US", timeZone: "UTC", utcOffsetMinutes: 0 } };
const AND_CTX = { client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 35, osName: "Android", osVersion: "15", hl: "en", gl: "US" } };
const MWEB_CTX = { client: { clientName: "MWEB", clientVersion: "2.20250122.01.00", hl: "en", gl: "US" } };
for (const [name, ctx, key] of [["ANDROID_VR", VR_CTX, ANDROID_KEY], ["IOS", IOS_CTX, ANDROID_KEY], ["ANDROID", AND_CTX, ANDROID_KEY], ["MWEB", MWEB_CTX, WEB_KEY], ["TVHTML5", TV_CTX, WEB_KEY]]) {
  try {
    const j = await post("player", { context: ctx, videoId: id, contentCheckOk: true, racyCheckOk: true }, key);
    const ps = j.playabilityStatus?.status;
    const f = j.streamingData?.formats || [];
    const af = j.streamingData?.adaptiveFormats || [];
    const all = [...f, ...af];
    const stats = all.reduce((acc, x) => {
      if (x.url) acc.url++;
      if (x.signatureCipher || x.cipher) acc.cipher++;
      if (x.url && /[?&]n=/.test(x.url)) acc.nParam++;
      return acc;
    }, { url: 0, cipher: 0, nParam: 0 });
    const sample = all.find(x => x.url)?.url || all.find(x => x.signatureCipher)?.signatureCipher || "";
    console.log(`${name}: playability=${ps} formats=${f.length}+${af.length} url=${stats.url} cipher=${stats.cipher} nParam=${stats.nParam}`);
    console.log(`  sample: ${sample.slice(0, 130)}`);
    const sc = all.find(x => x.signatureCipher)?.signatureCipher;
    if (sc) console.log(`  sigCipher: ${sc.slice(0, 160)}`);
  } catch (e) { console.log(name, "FAILED:", String(e).slice(0, 100)); }
}
process.exit(0);
