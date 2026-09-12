// Direct youtubei.js probe: what does the IOS/WEB client actually return today?
import { Innertube } from 'youtubei.js';

const BGUTIL = 'http://127.0.0.1:4416';

async function getPot() {
  const r = await fetch(`${BGUTIL}/get_pot`);
  const j = await r.json();
  return j; // { po_token, visitor_data }
}

const pot = await getPot();
console.log('PO token:', String(pot.po_token).slice(0, 20) + '...', '| visitor:', String(pot.visitor_data).slice(0, 20) + '...');

const yt = await Innertube.create({
  visitor_data: pot.visitor_data,
  po_token: pot.po_token,
  retrieve_player: true,
});

const vid = process.argv[2] || 'aqz-KE-bpKQ';

for (const client of ['IOS', 'WEB', 'ANDROID']) {
  try {
    const info = await yt.getInfo(vid, { client });
    const ps = info.playability_status;
    console.log(`\n[${client}] playability: ${ps?.status} | reason: ${String(ps?.reason || '').slice(0, 80)}`);
    console.log(`[${client}] streaming_data: ${!!info.streaming_data} | formats: ${info.streaming_data?.formats?.length || 0} adaptive: ${info.streaming_data?.adaptive_formats?.length || 0}`);
    if (info.streaming_data?.hls_manifest_url) console.log(`[${client}] HLS manifest: YES`);
    if (ps?.status !== 'OK') {
      console.log(`[${client}] full playability:`, JSON.stringify(ps).slice(0, 300));
    }
  } catch (e) {
    console.log(`\n[${client}] THREW: ${String(e.message).slice(0, 150)}`);
  }
}
process.exit(0);
