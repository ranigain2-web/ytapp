// Tiny static server for the Capacitor web dir with /api proxy —
// mirrors how the APK serves ./out, plus LAN-server mode if one is configured.
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
const ROOT = path.resolve(process.argv[2] || "out");
const PORT = parseInt(process.argv[3] || "3999", 10);
const API = process.argv[4] || "http://127.0.0.1:3001";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".txt": "text/plain", ".png": "image/png", ".json": "application/json" };

async function proxy(req, res) {
  const url = new URL(req.url, "http://x");
  const target = `${API}${url.pathname}${url.search}`;
  const opts = { method: req.method, headers: { ...req.headers, host: new URL(API).host } };
  delete opts.headers["accept-encoding"];
  try {
    const body = await new Promise((resolve) => {
      const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => resolve(Buffer.concat(chunks)));
    });
    if (body.length) opts.body = body;
    const r = await fetch(target, opts);
    const text = await r.text();
    res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") || "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(text);
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e.message || e).slice(0, 120) }));
  }
}

http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) return proxy(req, res);
  const url = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(ROOT, url);
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(ROOT, "index.html");
  if (!existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`static on :${PORT} from ${ROOT} (api→${API})`));
