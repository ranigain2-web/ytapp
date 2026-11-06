// probe-worker-eval.mjs — does the REAL base.js eval inside a browser Worker?
// (WebView on-device is a real browser; node:vm lacks too many APIs.)
import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:3999/", { waitUntil: "domcontentloaded" });
page.on("console", m => console.log("PAGE:", m.text().slice(0, 150)));

const result = await page.evaluate(async () => {
  try {
    const js = await (await fetch("/base-test.js")).text();
    // worker that evals base.js then tries to resolve + call the sig-apply fn
    const workerSrc = `
      let evalOk = false, evalErr = "";
      try { (0, eval)(BASE_JS_PLACEHOLDER); evalOk = true; } catch (e) { evalErr = String(e).slice(0, 200); }
      let callOut = null, callErr = "";
      if (evalOk) {
        try {
          // marker-walk: find the fn containing a.set("alr","yes")
          const marker = 'a.set("alr","yes")';
          const mi = BASE_JS_PLACEHOLDER.indexOf(marker);
          const fnStart = BASE_JS_PLACEHOLDER.lastIndexOf("=function(", mi);
          const nameStart = BASE_JS_PLACEHOLDER.lastIndexOf("\\n", fnStart) + 1;
          const header = BASE_JS_PLACEHOLDER.slice(nameStart, fnStart + 60);
          const m = /^([\\w$.]+)\\s*=\\s*function\\s*\\(([^)]*)\\)/.exec(header);
          const fnName = m ? m[1] : null;
          const target = fnName ? fnName.split(".").reduce((o, k) => (o ? o[k] : undefined), self) : null;
          if (typeof target === "function") {
            const out = target("https://rr4---sn-test.googlevideo.com/videoplayback?vtag=test&clen=123&expire=9999999999&id=o-TEST&c=WEB", "sig", "TESTSIGVALUE1234567890");
            callOut = { fnName, out: String(out).slice(0, 220), hasAlr: String(out).includes("alr"), sigParam: (String(out).match(/[?&]sig=[^&]*/) || [""])[0].slice(0, 60) };
          } else {
            callOut = { fnName, resolvable: false };
          }
        } catch (e) { callErr = String(e).slice(0, 200); }
      }
      self.postMessage({ evalOk, evalErr, callOut, callErr });
    `;
    const code = workerSrc.replace("BASE_JS_PLACEHOLDER", () => JSON.stringify(js));
    const blob = new Blob([code], { type: "application/javascript" });
    const w = new Worker(URL.createObjectURL(blob));
    const res = await new Promise((resolve) => {
      const t = setTimeout(() => resolve({ timeout: true }), 20000);
      w.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
      w.onerror = (e) => { clearTimeout(t); resolve({ workerError: String(e.message).slice(0, 200) }); };
    });
    return res;
  } catch (e) {
    return { pageError: String(e).slice(0, 200) };
  }
});
console.log("RESULT:", JSON.stringify(result, null, 1));
await browser.close();
