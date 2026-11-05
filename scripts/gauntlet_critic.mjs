// ============================================================================
// gauntlet_critic.mjs — blind A/B gauntlet critic (the judge).
//
// Compares two screenshots WITHOUT knowing which product is which and emits a
// machine-parsable verdict. Used by scripts/gauntlet-loop.mjs; the loop's exit
// condition is "WINNER=ours or TIE-with-reason", never a round count.
//
// Usage: node scripts/gauntlet_critic.mjs <ours.png> <reference.png> <context>
//   env: CRITIC_MODEL (default glm-4.6v)
//
// Output (stdout, last block is the verdict):
//   VERDICT: WINNER=ours | WINNER=reference | TIE
//   REASON: <one sentence — for TIE this is REQUIRED and must name the trade>
//   GAP: <single biggest remaining gap in the losing/our image>
//   CONFIDENCE: high | medium | low
// Exit codes: 0 = judged, 2 = judge failed (never treat as a win).
//
// The order of images is randomized internally (the model never learns which
// slot ours is in) and un-randomized only in the human-readable NOTES.
// ============================================================================
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'node:fs';

const [,, imgA, imgB, context] = process.argv;
if (!imgA || !imgB || !context) {
  console.error('usage: node scripts/gauntlet_critic.mjs <ours.png> <reference.png> <context>');
  process.exit(1);
}
if (!fs.existsSync(imgA) || !fs.existsSync(imgB)) {
  console.error(`input missing: ${!fs.existsSync(imgA) ? imgA : imgB}`);
  process.exit(2);
}

const toDataUrl = (p) => `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;

// Randomize slot order so the model cannot anchor on "Image 1 = the clone"
// across many calls. We remember the flip to translate the verdict back.
const flip = Math.random() < 0.5;
const first = flip ? imgB : imgA;   // reference first when flipped
const second = flip ? imgA : imgB;
const slotOf = (img) => (img === first ? 'Image 1' : 'Image 2');

let raw = '';
try {
  const zai = await ZAI.create();
  const res = await zai.chat.completions.createVision({
    model: process.env.CRITIC_MODEL || 'glm-4.6v',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `You are a harsh UI critic doing a BLIND comparison of two screenshots of ${context}. Image 1 and Image 2. Do NOT assume which product is which; judge purely on visual design quality, layout fidelity to YouTube's design language, spacing, typography, information density, and polish.

A TIE is only allowed when both images are genuinely indistinguishable in quality at this surface, and you must then name the trade-off that makes them equivalent.

Answer in exactly this format (all four lines, nothing else):
VERDICT: WINNER=Image 1 or WINNER=Image 2 or TIE
REASON: [one sentence; mandatory and substantive for TIE]
GAP: [the single biggest remaining gap in the LOSING image — for a TIE, the biggest gap in Image 2]
CONFIDENCE: high or medium or low` },
          { type: 'image_url', image_url: { url: toDataUrl(first) } },
          { type: 'image_url', image_url: { url: toDataUrl(second) } },
        ],
      },
    ],
    thinking: { type: 'disabled' },
  });
  raw = res.choices[0].message.content || '';
} catch (e) {
  console.error(`critic call failed: ${String(e).slice(0, 300)}`);
  process.exit(2);
}

// Parse + translate the slot verdict back to ours/reference.
const get = (key) => {
  const m = raw.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, 'mi'));
  return m ? m[1].trim() : '';
};
const v = get('VERDICT');
let verdict = '';
if (/Image\s*1/i.test(v)) verdict = flip ? 'WINNER=ours' : 'WINNER=reference';
else if (/Image\s*2/i.test(v)) verdict = flip ? 'WINNER=reference' : 'WINNER=ours';
else if (/TIE/i.test(v)) verdict = 'TIE';

if (!verdict) {
  console.error(`unparsable verdict from model:\n${raw.slice(0, 400)}`);
  process.exit(2);
}

// A TIE without a written reason is not a TIE (the plan's rule).
const reason = get('REASON');
if (verdict === 'TIE' && reason.length < 10) {
  console.error('TIE without a substantive REASON — downgrading to reference win (no free ties).');
  verdict = 'WINNER=reference';
}

console.log(`VERDICT: ${verdict}`);
if (reason) console.log(`REASON: ${reason}`);
const gap = get('GAP');
if (gap) console.log(`GAP: ${gap}`);
console.log(`CONFIDENCE: ${get('CONFIDENCE') || 'medium'}`);
console.log(`SLOTS: ours=${slotOf(imgA)} reference=${slotOf(imgB)}`);
