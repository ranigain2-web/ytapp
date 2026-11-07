// generate-testers-guide.js — ytapp Feature Testing Guide (.docx)
// English document · R1 cover (DM-1 Deep Cyan) · 3-section architecture
// (cover / TOC-roman / body-arabic) per the docx skill references.
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  PageBreak, Header, Footer, PageNumber, NumberFormat, SectionType,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  TableLayoutType, LevelFormat, TableOfContents,
} = require("docx");
const fs = require("fs");

// ---------- palette: DM-1 Deep Cyan (tech) ----------
const P = {
  bg: "162235", accent: "37DCF2",
  cover: { titleColor: "FFFFFF", subtitleColor: "B0B8C0", metaColor: "90989F", footerColor: "687078" },
  table: { headerBg: "1B6B7A", headerText: "FFFFFF", accentLine: "1B6B7A", innerLine: "C8DDE2", surface: "EDF3F5" },
  headingColor: "0F2540", body: "1A2430", secondary: "5A6B7A",
};

const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

const FONT = { ascii: "Times New Roman", eastAsia: "Times New Roman" };
const FONT_H = { ascii: "Times New Roman", eastAsia: "Times New Roman" };

function safeText(v, ph) {
  if (v === undefined || v === null || v === "" || String(v) === "NaN" || String(v) === "undefined") return ph || "[missing]";
  return String(v);
}

// ---------- title layout calculators (design-system.md) ----------
function splitTitleLines(title, cpl) {
  const words = title.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + (cur ? " " : "") + w).length <= cpl) cur = cur + (cur ? " " : "") + w;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  // orphan prevention: merge a tiny last line into the previous one
  if (lines.length > 1 && lines[lines.length - 1].length <= 4) {
    const last = lines.pop();
    lines[lines.length - 1] += " " + last;
  }
  return lines;
}
function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  // English text: average glyph width ~= pt * 10 twips (narrower than CJK's pt*20)
  const charWidth = (pt) => pt * 10;
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) {
    lines = splitTitleLines(title, charsPerLine(minPt));
    titlePt = minPt;
  }
  return { titlePt, titleLines: lines };
}
function calcCoverSpacing(params) {
  const {
    titleLineCount = 1, titlePt = 36, hasSubtitle = false,
    hasEnglishLabel = false, metaLineCount = 0,
    fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0,
  } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const remainingSpace = usableHeight - contentHeight;
  const safeRemaining = Math.max(remainingSpace, 400);
  // postcheck caps any single spacing.before at 5000 — clamp and let the
  // exact-height wrapper absorb the remainder as bottom whitespace
  const topSpacing = Math.min(Math.max(Math.floor(safeRemaining * 0.42), 400), 4800);
  const bottomSpacing = Math.min(Math.max(safeRemaining - topSpacing, 400), 4800);
  return { topSpacing, bottomSpacing };
}

// ---------- R1 cover (design-system.md, verbatim architecture) ----------
function buildCoverR1(config) {
  const PC = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length,
    fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: PC.accent, space: 12 };
  const children = [];
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));
  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: PC.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join("  "), size: 18, color: PC.accent, font: { ascii: "Calibri", eastAsia: "SimHei" }, characterSpacing: 40 })],
    }));
  }
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true, color: PC.cover.titleColor, font: { eastAsia: "Arial", ascii: "Arial" } })],
    }));
  }
  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 800 },
      children: [new TextRun({ text: config.subtitle, size: 24, color: PC.cover.subtitleColor, font: { eastAsia: "Arial", ascii: "Arial" } })],
    }));
  }
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200 }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({ text: safeText(line), size: 24, color: PC.cover.metaColor, font: { eastAsia: "Arial", ascii: "Arial" } })],
    }));
  }
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: PC.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: PC.cover.footerColor, font: { ascii: "Arial" } }),
      new TextRun({ text: "                                        " }),
      new TextRun({ text: config.footerRight || "", size: 16, color: PC.cover.footerColor, font: { ascii: "Arial" } }),
    ],
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: PC.bg }, borders: noBorders,
        verticalAlign: "top",
        children,
      })],
    })],
  })];
}

// ---------- body helpers ----------
let listSeq = 0;
// build numbered paragraphs against a pre-registered reference
function stepList(docConfigRefs, items) {
  const ref = `steps-${++listSeq}`;
  docConfigRefs.push({
    reference: ref,
    levels: [{
      level: 0, format: LevelFormat.DECIMAL, text: "%1.",
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 620, hanging: 360 } } },
    }],
  });
  return items.map(t => new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { line: 312, after: 60 },
    children: [new TextRun({ text: t, size: 22, font: FONT, color: P.body })],
  }));
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160, line: 312 },
    children: [new TextRun({ text, bold: true, size: 32, font: FONT_H, color: P.headingColor })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120, line: 312 },
    children: [new TextRun({ text, bold: true, size: 26, font: FONT_H, color: P.headingColor })],
  });
}
function para(text, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: opts.after ?? 120, before: opts.before ?? 0 },
    keepNext: opts.keepNext || false,
    children: [new TextRun({ text, size: 22, font: FONT, color: P.body, bold: opts.bold || false, italics: opts.italics || false })],
  });
}
function labeled(label, text, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: opts.after ?? 100 },
    keepNext: opts.keepNext || false,
    children: [
      new TextRun({ text: label, size: 22, bold: true, font: FONT, color: P.headingColor }),
      new TextRun({ text: "  " + text, size: 22, font: FONT, color: P.body }),
    ],
  });
}
function worksWhen(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, after: 200 },
    border: { left: { style: BorderStyle.SINGLE, size: 10, color: P.table.accentLine, space: 10 } },
    indent: { left: 200 },
    children: [
      new TextRun({ text: "It works when: ", size: 22, bold: true, font: FONT, color: P.table.accentLine }),
      new TextRun({ text, size: 22, font: FONT, color: P.body }),
    ],
  });
}
function tableTitle(text) {
  return new Paragraph({
    keepNext: true,
    spacing: { before: 160, after: 80, line: 312 },
    children: [new TextRun({ text, bold: true, size: 21, font: FONT, color: P.headingColor })],
  });
}
function makeTable(headers, rows, widths) {
  const cellMargins = { top: 60, bottom: 60, left: 120, right: 120 };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: P.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: P.table.accentLine },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine },
      insideVertical: NB,
    },
    rows: [
      new TableRow({
        tableHeader: true, cantSplit: true,
        children: headers.map((text, i) => new TableCell({
          children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text, bold: true, size: 20, font: FONT, color: P.table.headerText })] })],
          shading: { type: ShadingType.CLEAR, fill: P.table.headerBg },
          margins: cellMargins,
          width: { size: widths[i], type: WidthType.PERCENTAGE },
        })),
      }),
      ...rows.map((row, ri) => new TableRow({
        cantSplit: true,
        children: row.map((text, i) => new TableCell({
          children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: safeText(text), size: 20, font: FONT, color: P.body })] })],
          shading: ri % 2 === 1 ? { type: ShadingType.CLEAR, fill: P.table.surface } : undefined,
          margins: cellMargins,
          width: { size: widths[i], type: WidthType.PERCENTAGE },
        })),
      })),
    ],
  });
}

// ---------- document assembly ----------
const numberingConfigs = [];

function featureBlock(title, whatTexts, stepItems, worksText) {
  const out = [h2(title)];
  for (const w of whatTexts) out.push(para(w));
  for (const s of stepList(numberingConfigs, stepItems)) out.push(s);
  out.push(worksWhen(worksText));
  return out;
}

const body = [];

// ===== 1. How to use this guide =====
body.push(h1("1. How to Use This Guide"));
body.push(para("This guide explains every feature in ytapp in plain language, then tells you exactly how to test it on your phone and what you should see when it works. Each feature follows the same three-part pattern: What it is explains the feature in a sentence or two, How to test gives you numbered steps to follow, and It works when describes the exact thing you should observe. If what you see matches that description, the feature is working; if it does not, you have found a bug worth reporting."));
body.push(para("Before anything else, you need to understand one concept: a video in ytapp can play in one of three ways, and several features behave differently depending on which one is active. When you open a normal video, ytapp's own player plays the video stream directly, with no ads. If the server cannot extract a video's stream (some videos are age-gated, region-locked, or the server's IP is temporarily blocked by YouTube), the app falls back to YouTube's own embedded player inside the page, with an honest warning below it that ads may appear. Third, on Android, any embed video can also be handed to Compat Mode, a fullscreen controlled browser that loads YouTube's real mobile site."));
body.push(tableTitle("Table 1. The three playback modes"));
body.push(makeTable(
  ["Mode", "How you can tell it is active", "Ads", "Background behavior"],
  [
    ["Direct player (default)", "ytapp's own player with the seek bar, speed and quality menus", "None", "Full: audio continues, notification, lock screen, floating window"],
    ["Embed player (fallback)", "Yellow-dot notice below the video: ads may appear", "YouTube decides", "Floating window on Home; audio only if the app can take over the stream"],
    ["Compat Mode (optional)", "You tapped Play in Compat Mode; fullscreen YouTube mobile site", "Stripped where possible", "Video keeps playing screen-off and in background"],
  ],
  [22, 34, 14, 30],
));
body.push(para("Most test steps below need nothing special: a phone with the app installed, an internet connection, and any video. Where a test needs a specific kind of video (for example one that falls back to the embed player), the guide says so and explains how to find one.", { after: 200 }));

// ===== 2. Setup =====
body.push(h1("2. First: Confirm You Are Testing the Right Build"));
body.push(para("Everything below assumes the current build. The version number is visible in two places: Settings, About, and the What's new card that appears once after an update. Testing on an old build wastes your time, because the feature you are checking may not exist yet or may already have been fixed."));
for (const s of stepList(numberingConfigs, [
  "Install the app: download the APK from the GitHub Releases page of the project (the file named ytapp-vX.Y.Z-debug.apk is the easiest to install) and open it. Android will ask to allow installs from that source; allow it once.",
  "Open the app and tap your profile picture (top right), then Settings.",
  "Scroll to the About section and check the version. It should say v2.8.1 or newer.",
  "Play any video from the home feed. The first time playback starts in the background, Android will ask for notification permission - tap Allow, otherwise the background-play notification cannot appear (the test in section 4 would fail for the wrong reason).",
])) body.push(s);
body.push(worksWhen("Settings, About shows v2.8.1 or a higher number, and a normal video plays with sound and picture from the home feed without errors."));
body.push(para("Note: the app works standalone out of the box - it finds a server by itself. If you run your own ytapp server, you can point the app at it in Settings, Data source; that is optional for everything in this guide except the server-related checks in section 11.", { after: 200 }));

// ===== 3. The video player =====
body.push(h1("3. The Video Player (Direct Playback)"));
body.push(para("The direct player is ytapp's own video engine and the default way videos play. It fetches the video stream through the server, so there are no YouTube ads at all, and it is the mode where every player feature works fully. The tests in this section all use the player controls: tap a video once to show them, tap again to hide them."));

body.push(...featureBlock("3.1 Basic playback",
  ["The core promise of the app: pick any video from the home feed or search, and it plays immediately, without a pre-roll ad, mid-roll ad, or ad banner. The seek bar at the bottom fills with a lighter buffer bar ahead of your position."],
  ["Open the app and tap any video on the home feed.", "Watch for about thirty seconds.", "Drag the seek bar to the middle of the video and release.", "Tap the pause button, then tap play again."],
  "Playback starts within a few seconds, no ad plays at any point, seeking jumps to the new position quickly, and pause and play respond instantly."));

body.push(...featureBlock("3.2 Playback speed and speed memory",
  ["You can change playback speed, and since v2.8.0 the app remembers your chosen speed: the next video you open starts at the same speed instead of resetting to 1x. This mirrors YouTube's own behavior for people who always watch at 1.5x or 2x."],
  ["Play a video and tap the gear icon in the player controls.", "Tap Playback speed and choose 1.5x. Confirm the audio and motion are faster.", "Go back (or tap another video from the feed) so the player stops.", "Open a different video and let it play."],
  "The second video starts at 1.5x speed (listen for the faster pace), and when you open the speed menu again, 1.5x is the selected value. Speed survives closing and reopening the app too."));

body.push(...featureBlock("3.3 Long-press for 2x speed",
  ["A YouTube-mobile trick: press and hold anywhere on the playing video and it jumps to 2x speed only while your finger stays down. Release and it returns to normal speed. Useful for skimming a slow part without opening any menu."],
  ["Play a video at normal speed.", "Press and hold your finger on the video area for a few seconds.", "Release."],
  "While holding, playback is clearly twice as fast and a small 2x badge appears near the center; the moment you lift your finger, speed returns to exactly what it was before."));

body.push(...featureBlock("3.4 Quality menu",
  ["You can force a specific resolution instead of automatic quality. Lower it on a slow connection or raise it on Wi-Fi; the choice applies to the current video."],
  ["Play a video, tap the gear icon, then Quality.", "Pick a specific resolution such as 360p, then pick 1080p (on a video that has it)."],
  "The picture visibly sharpens when you step up the resolution (give the buffer a second), and the Quality menu shows your chosen value as selected rather than Auto."));

body.push(...featureBlock("3.5 Captions",
  ["Videos that have subtitles can show them. English captions on an English video are the reliable case."],
  ["Play a video known to have captions (most music videos and talks do).", "Tap the gear icon, then Captions, and choose a language."],
  "Caption lines appear near the bottom of the picture and change as the video speaks. Choosing Off removes them again."));

body.push(...featureBlock("3.6 Audio mode (data saver)",
  ["Audio mode plays only the audio stream with the thumbnail on screen, using a fraction of the data. Good for music and long talks. There is a toggle in Settings, and a quick Audio button in the bar under the video."],
  ["Play any video.", "In the bar under the video, tap the Audio button (or use Settings, Playback, Audio mode).", "Let it play for half a minute, then switch it off again."],
  "The picture is replaced by the video thumbnail, playback continues as audio only, and the network indicator (or your phone's data usage) shows far less traffic. Switching off brings the moving picture back."));

body.push(...featureBlock("3.7 Seek-bar preview",
  ["When you scrub along the seek bar, small preview images from that point of the video appear above your finger, like YouTube's hover previews, so you can find the right moment without guessing."],
  ["Play a video with a decent length (ten minutes or more).", "Touch and slowly drag the seek bar left and right without releasing."],
  "A storyboard image appears above the seek bar and changes as your finger moves, matching roughly what is at that timestamp."));

body.push(...featureBlock("3.8 Autoplay and the countdown card",
  ["With autoplay on, when a video ends the app shows a five-second countdown card for the next related video, then plays it automatically. You can cancel the countdown. With autoplay off, a video just ends."],
  ["In the bar under the video, make sure the Autoplay switch is on.", "Let a video play to its very end (or seek to the last ten seconds and wait).", "When the countdown card appears, wait or tap Cancel; then repeat with Autoplay switched off."],
  "A countdown ring with the next video's title appears for five seconds; if you do nothing the next video starts, if you tap Cancel it does not. With autoplay off, the video ends and nothing further happens."));

// ===== 4. Background play =====
body.push(h1("4. Background Play and the Floating Window"));
body.push(para("This is the area that was recently fixed after a test report, so it deserves the most careful checking. The rule of thumb: what happens when you minimize depends on which of the three playback modes is active. The direct player keeps playing as audio with a lock-screen notification. An embed video shrinks into a floating window when you press Home, because YouTube's own player always pauses itself when its page is hidden - no app can change that - and the app additionally tries once to take over the stream so it can continue as background audio. Compat Mode keeps playing in background and screen-off by design."));
body.push(tableTitle("Table 2. What should happen when you leave the app"));
body.push(makeTable(
  ["You do this", "Direct player", "Embed player", "Compat Mode"],
  [
    ["Press Home", "Shrinks to floating window (or keeps playing as audio if the floating-window setting is off)", "Shrinks to floating window - the fixed behavior", "Keeps playing (audio in background)"],
    ["Turn the screen off (power button)", "Audio continues, lock-screen controls", "Audio continues only if the app could take over the stream; otherwise it stops and an explanation appears when you return", "Audio continues"],
    ["Open another app from Recents", "Same as pressing Home", "Playback stops (the floating window needs the Home press); check the explanation note when you return", "Keeps playing"],
  ],
  [24, 26, 30, 20],
));
body.push(para("All tests below assume the two Settings toggles are at their defaults: Background play is on and Picture-in-picture on Home is on (both are on unless you changed them).", { after: 100 }));

body.push(...featureBlock("4.1 Background audio (direct player)",
  ["The headline feature: minimize the app or turn the screen off while a normal video plays, and the sound keeps going, with a media notification showing the video title and controls. This is the mode to test first, because everything else builds on it."],
  ["Play any normal video (no yellow notice under it).", "Press Home. Pull down the notification shade.", "Use the notification: tap pause, then play; tap Next.", "Lock the screen with the power button and unlock again."],
  "Audio never stops through any of this. The notification shows the video title and channel with prev, pause and next buttons, and they control the sound. On the lock screen the same controls appear without unlocking."));

body.push(...featureBlock("4.2 Floating window on Home (direct player)",
  ["Pressing Home while a video plays shrinks the app into a small floating window you can drag anywhere, and the video keeps playing in it. The power button (screen off) instead keeps audio only - that distinction is intentional."],
  ["Play any normal video.", "Press the Home button once.", "Drag the small window to another corner of the screen.", "Tap the window to expand the app again."],
  "Instead of going to the launcher, the app becomes a movable floating window with the video still playing and its sound uninterrupted. Tapping it expands back to fullscreen at the same position. Dismissing the window stops playback."));

body.push(...featureBlock("4.3 Floating window for embed videos (the fix from the user report)",
  ["Before the fix, an embed video (the one with the ads-may-appear notice) simply stopped when you pressed Home. Now a playing embed shrinks into the same floating window, because that is the only way YouTube's own player can survive you leaving the app. This is the exact scenario from the bug report, so please test it exactly."],
  ["Open a video that shows the yellow-dot notice below the player (if your feed has none, see the note after this test).", "Start the video playing and let it run a few seconds.", "Press the Home button once.", "Watch the floating window for half a minute, then tap it to return."],
  "The video keeps playing in the floating window instead of going silent. Sound and picture continue, and tapping the window returns you to the app with playback intact. Note: use the Home button, not the Recents swipe - the floating window only triggers on Home."));

body.push(para("Finding an embed video to test: they appear when the server cannot extract a particular video - commonly age-restricted videos, some music videos, or videos restricted in the server's country. If nothing in your feed falls back, try a music video from a major label or a video marked 18+ on YouTube. The tell is always the same: the yellow-dot notice below the player saying the official YouTube player is in use.", { after: 100 }));

body.push(...featureBlock("4.4 The background takeover (embed to audio)",
  ["When you background an embed video, the app makes one silent attempt to fetch a playable stream for it and, if that works, switches playback to its own audio engine at the exact spot you were watching. When it works, even an embed video continues as background audio with the notification."],
  ["Play an embed video (yellow-dot notice).", "Press Home so the floating window appears, then dismiss the floating window or switch to another app from Recents so the app is truly hidden.", "Wait about ten seconds and listen."],
  "If the takeover worked, audio continues with the media notification present even though the app is hidden. The case is somewhat rare - it needs the extraction to succeed on the retry - so a silent stop here is not automatically a bug; check the next test to see the honest explanation."));

body.push(...featureBlock("4.5 The honest explanation note",
  ["If the takeover is impossible (the video simply has no extractable stream), the app cannot keep an embed playing in the background - but it no longer fails silently. When you come back, a short notice under the player explains what happened and what to do instead."],
  ["Play an embed video, then background the app with the Recents swipe (not Home, so no floating window).", "Wait ten seconds, then reopen the app.", "Read the notice under the player, then tap Dismiss."],
  "A notice appears under the video explaining that this video cannot play in the background because it has no extractable stream, and suggesting the floating window (Home button) instead. Dismiss removes it."));

body.push(...featureBlock("4.6 Screen-off playback",
  ["For a direct-player video, turning the screen off must not stop the music. This is the daily-driver scenario: phone in pocket, video as audio."],
  ["Play a normal (direct) video.", "Press the power button to turn the screen off.", "Wait thirty seconds with the screen off, then press power and check the lock screen."],
  "Audio keeps playing the whole time with the screen off, and the lock screen shows the media controls when you wake it. (For an embed video, screen-off audio only works when the takeover from test 4.4 succeeded - that is a YouTube limitation the app cannot remove, and the notice from 4.5 explains it when it happens.)"));

body.push(...featureBlock("4.7 Offline banner",
  ["The app tells you when your connection drops, so a feed that suddenly shows nothing does not look like a broken app."],
  ["Turn on airplane mode (or turn off Wi-Fi and mobile data) while the app is open.", "Look at the top of the app, then restore the connection."],
  "A small banner appears saying you are offline, and it disappears on its own once the network returns."));

body.push(...featureBlock("4.8 Headset button",
  ["The media session is real, so the play or pause button on a wired or Bluetooth headset controls playback."],
  ["Play a direct video, then lock the screen.", "Press the play or pause button on your headset once."],
  "Playback toggles exactly as it would in YouTube or a music app. If your headset has a double-press next-track function, that skips to the related next video when one is queued."));

// ===== 5. Miniplayer =====
body.push(h1("5. The Miniplayer"));
body.push(para("The video never has to stop just because you want to browse. Scroll the watch page down past the player and it docks into a small corner player; tap it to jump back. Closing the miniplayer stops playback for real. This is also the behavior when you navigate from a playing video to Home or your library."));
body.push(...featureBlock("5.1 Dock on scroll-past",
  ["Scrolling the watch page down while a video plays shrinks it into a draggable corner window, exactly like YouTube's miniplayer, and the audio never gaps during the switch."],
  ["Play a normal video.", "Scroll the page down until the player has left the screen.", "Watch the corner appear, then keep scrolling the feed.", "Tap the corner player."],
  "The video docks into the corner and keeps playing without any pause in the sound; tapping it scrolls you smoothly back to the fullscreen player at the same position."));
body.push(...featureBlock("5.2 Navigate away, then return",
  ["Going from a playing watch page to the home feed (or search, or your library) also docks playback into the miniplayer instead of stopping it."],
  ["Play a video, then tap Home in the sidebar or bottom bar.", "Browse the feed with the miniplayer running.", "Tap the miniplayer."],
  "Playback continued the whole time, and tapping the miniplayer takes you back to the watch page of that video. Tapping the X on the miniplayer stops playback completely - that is by design, not a bug."));

// ===== 6. Downloads =====
body.push(h1("6. Downloads"));
body.push(para("Downloads let you keep a video or just its audio as a file on the device, played back from the Downloads page without the network. Under the hood the server fetches the file with yt-dlp using your session, so it works for videos the direct player can handle. The download queue lives in the sheet you open from the watch page."));
body.push(...featureBlock("6.1 Download a video",
  ["The entry point is on the watch page: a download control in the row under the video opens a sheet where you pick video or audio-only and start the job."],
  ["Play any normal video.", "Tap the Download control under the video.", "In the sheet, choose the video option and confirm.", "Watch the progress until it finishes (a short video finishes in well under a minute on Wi-Fi)."],
  "Progress is visible while it runs, and when it completes the entry shows as done. If you started a second download while the first ran, they queue one after the other rather than competing."));
body.push(...featureBlock("6.2 Audio-only download",
  ["The same sheet offers an audio-only option, producing a small audio file - the music-listener path."],
  ["Open the download sheet on any video and choose the audio option.", "Let it finish."],
  "The job completes and the entry is marked audio. The audio download is much smaller and faster than the video one for the same clip."));
body.push(...featureBlock("6.3 The Downloads page and offline playback",
  ["Finished files are listed on the Downloads page in the library, and play from the device - airplane mode is the honest test."],
  ["Turn on airplane mode.", "Open the library and go to the Downloads page.", "Tap the file you downloaded in test 6.1."],
  "The list shows your finished downloads with names, and the downloaded video plays with the network completely off. A download that is still running when you go offline simply pauses until the network returns."));

// ===== 7. Compat Mode =====
body.push(h1("7. Compat Mode"));
body.push(para("Compat Mode is the escape hatch for videos the app cannot play directly: it loads YouTube's real mobile site inside the app's own fullscreen controlled browser, strips ads where possible, enforces background play, and wires the lock-screen controls. It exists only on Android (a browser page cannot script YouTube's site), and it can be switched off entirely in Settings."));
body.push(...featureBlock("7.1 Enter and play",
  ["The entry appears exactly where you need it: on an embed video's watch page, as a Play in Compat Mode button. Tapping it opens the fullscreen controlled YouTube page."],
  ["Open an embed video (yellow-dot notice under the player).", "Tap the Play in Compat Mode button under the notice.", "Play the video inside the compat page."],
  "A fullscreen player takes over with YouTube's own mobile interface. The video plays, and a small back to ytapp pill floats at the top so you can always leave."));
body.push(...featureBlock("7.2 Background and screen-off in Compat Mode",
  ["Inside Compat Mode, playback is owned by the app's controlled browser, so background play and screen-off audio work by design - this is the reliable way to background the stubborn videos that neither the embed takeover nor anything else can save."],
  ["Play a video inside Compat Mode.", "Press Home, listen, then turn the screen off and listen."],
  "Audio continues in both cases, with the media notification present. When you return, the compat page is where you left it."));
body.push(...featureBlock("7.3 The exit and the kill switch",
  ["Every compat session has an obvious exit, and the whole feature can be turned off in Settings, which removes every entry point."],
  ["Tap the back to ytapp pill at the top of the compat page.", "Go to Settings, Compat Mode, and switch Compat Mode off.", "Return to an embed video's watch page."],
  "The pill returns you to the app immediately. With the toggle off, the Play in Compat Mode button no longer appears anywhere. Switching it back on restores the buttons."));
body.push(para("One more Compat Mode setting, Share compat cookies with your server, exports your logged-in YouTube cookies from the compat browser to your own server, which can unblock extraction for bot-gated videos. It is only meaningful if you run your own server, and it is off by default - cookies are private material, so only share them with a server you control.", { after: 200 }));

// ===== 8. Native player =====
body.push(h1("8. Native Player (Experimental)"));
body.push(para("The native player is a second video engine: instead of the in-page player, it hands the stream to ExoPlayer, Android's professional media engine, with a true system media session. In theory this is the most reliable screen-off and background playback of all, because the OS itself owns the playback. It is marked experimental and off by default because it has not yet been verified on a device build - which makes it an interesting thing for you to test and report on."));
body.push(...featureBlock("8.1 Try the native engine",
  ["One toggle switches the engine; every other control keeps working the same way."],
  ["Go to Settings, Playback, and switch Native player (experimental) on.", "Play a normal video.", "Press Home, then turn the screen off, listening both times."],
  "The video plays (if it does not, that is exactly the kind of finding this experiment wants reported: which video, what happened). While it plays, background behavior should match or beat the built-in player: audio on Home, audio with the screen off, notification controls. Turn the toggle off afterwards to return to the proven engine."));

// ===== 9. Skipping and extras =====
body.push(h1("9. Skipping and Extras"));
body.push(...featureBlock("9.1 SponsorBlock",
  ["With SponsorBlock on, the player automatically skips over sponsor segments, self-promotions and similar inside videos, using the community-maintained database. It is off by default because it relies on third-party crowd data."],
  ["Go to Settings, Playback, and switch SponsorBlock on.", "Play a video that contains a sponsored segment (search results for sponsor examples work, or any recent video by a channel that reads ads).", "Watch what happens around the sponsor moment; also drag the seek bar across the middle of the video."],
  "The player visibly jumps over the sponsored stretch - the playhead leaps and a brief skip indication appears - and playback never stalls doing it. Videos without segments play straight through, and the toggle off restores everything."));
body.push(...featureBlock("9.2 Return YouTube Dislike",
  ["YouTube hides public dislike counts; the app restores an estimate of them from the Return YouTube Dislike project, shown next to the like count under the player. It needs the server to reach the RYD service."],
  ["Play a well-known video with many dislikes (any controversial or extremely popular video).", "Look at the like and dislike row under the player."],
  "A dislike count appears next to the like count, formatted the same way (for example 1.2K). A zero or a missing number on an obscure video is normal - estimates need data to exist."));
body.push(...featureBlock("9.3 Themes",
  ["The app follows a dark and a light theme, switchable in Settings, Appearance."],
  ["Go to Settings, Appearance, and switch the theme.", "Open a watch page in each theme."],
  "The whole app, including the player chrome, changes consistently; no white flash on navigation in dark mode and no unreadable text in either theme."));
body.push(...featureBlock("9.4 Keep screen on",
  ["While a video is playing in the foreground, the screen must not sleep on its timer; when you pause or the video ends, normal sleep behavior returns."],
  ["Set your phone's screen timeout to its shortest value (15 or 30 seconds).", "Play a video fullscreen and leave it for a minute without touching anything."],
  "The screen stays on while playback runs. Pause the video and wait the timeout again - this time the screen sleeps normally."));

// ===== 10. Browsing =====
body.push(h1("10. Browsing: Home, Search, Shorts, Channels, Library"));
body.push(para("The browsing surfaces are the parity layer: they should feel like YouTube without the ads. Each surface has one thing worth actively testing, listed below; everything else you can simply use as you normally would and note anything that looks broken or empty."));
body.push(tableTitle("Table 3. Quick browsing checks"));
body.push(makeTable(
  ["Surface", "How to get there", "What to verify"],
  [
    ["Home feed", "Open the app", "Feed loads with thumbnails, channel names and view counts; scroll a few pages deep without gaps or repeats"],
    ["Search", "Tap the search icon, type a common term", "Results appear as you type or on submit; open one result and play it"],
    ["Shorts", "Tap Shorts in the sidebar", "A vertical fullscreen short plays; swipe up for the next one; swipe or navigate away and any background audio pauses (by design)"],
    ["Channel page", "Tap a channel name under any video", "The channel's videos, Shorts and about info load; play something from the list"],
    ["Watch Later and Likes", "Tap Save or Like under a video, then open Library", "The video appears in the corresponding library list and plays from there"],
    ["Comments", "Scroll below any playing video", "Comments load and can be expanded; posting is not part of the app (read-only by design)"],
  ],
  [18, 30, 52],
));
body.push(para("The library also contains History (what you watched, resumable at the last position), Notifications if your server provides them, and the Downloads page from section 6.", { after: 200 }));

// ===== 11. Settings reference =====
body.push(h1("11. Settings Reference"));
body.push(para("Every control in Settings, in the order you meet it, with what it actually does. Use this as the map when a test above tells you to flip a toggle; nothing here changes anything until you change it."));
body.push(tableTitle("Table 4. The Settings page, section by section"));
body.push(makeTable(
  ["Section", "Control", "What it does"],
  [
    ["Data source", "API base", "Which server the app uses. Standalone mode picks one automatically; enter your own server's address only if you run one"],
    ["Your server", "Test connection", "Pings the server and shows per-extraction-client statistics - the first place to look when videos unexpectedly fall back to the embed player"],
    ["Server cookies", "Set cookies", "Stores your YouTube cookies on YOUR OWN server so it can extract videos a clean IP cannot (bot-gated videos). Only meaningful with your own server"],
    ["Compat Mode", "Compat Mode", "The master switch for the whole Compat Mode feature (section 7); off removes every entry point"],
    ["Compat Mode", "Share compat cookies", "Exports the compat browser's YouTube cookies to your server; off by default, private by nature"],
    ["Appearance", "Theme", "Dark or light for the entire app"],
    ["Playback", "Background play", "Master switch for background audio, the notification and lock-screen controls (section 4)"],
    ["Playback", "Picture-in-picture on Home", "Whether pressing Home shrinks a playing video into the floating window; off means Home simply backgrounds (audio only for direct videos)"],
    ["Playback", "Autoplay next video", "Whether endings chain into the next related video (section 3.8)"],
    ["Playback", "Audio mode (data saver)", "Audio-only playback with the thumbnail on screen (section 3.6)"],
    ["Playback", "SponsorBlock", "Community-data segment skipping (section 9.1)"],
    ["Playback", "Data saver", "Prefers lower-bitrate streams to save data"],
    ["Playback", "Native player (experimental)", "Switches the video engine to ExoPlayer (section 8); off is the proven default"],
    ["Your data", "Clear / export", "Your local data lives on the device; export before reinstalling if you care about history and preferences"],
    ["About", "Version", "Confirms the build you are testing (section 2)"],
  ],
  [16, 24, 60],
));

// ===== 12. When something fails =====
body.push(h1("12. When Something Fails"));
body.push(para("Some behaviors look like bugs but are honest limits of what any app can do against YouTube's platform. Before reporting, check this list: an embed video stopping on screen-off (when the takeover in 4.4 did not apply) is a YouTube platform rule, and the app now explains it on your return; a feed that suddenly falls back to embeds everywhere usually means the server's IP is bot-gated, and the embed notice will say so with a pointer to the server-cookies setting; an age-gated video without server cookies lands on the embed or Compat Mode by design. None of these are app bugs, though the bot-gated case is worth reporting if it persists for days."));
body.push(para("When something does look like a real bug, report it with three things: what you did (the steps from this guide), what you expected, and what happened instead. Two app tools make the report much stronger. Settings, Your server, Test connection shows which extraction clients are alive, so include a screenshot of it. And after the failing video, replay the scenario and note the video - support can reproduce from the video id alone. The fastest useful format: the section number from this guide, the video, and whether it happens every time."));
body.push(para("A note on build sources: always test the APK from the project's GitHub Releases for feature work, not an old sideloaded copy. Every release there has passed the automated build checks for Android, macOS and the web app, so a failure you find is a real finding, not a stale artifact.", { after: 0 }));

// ---------- page-number footers ----------
function pageFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, font: FONT, color: P.secondary })],
    })],
  });
}
function docHeader() {
  return new Header({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine, space: 4 } },
      children: [new TextRun({ text: "ytapp Feature Testing Guide", size: 16, font: FONT, color: P.secondary })],
    })],
  });
}

const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: FONT, size: 22, color: P.body },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: FONT_H, size: 32, bold: true, color: P.headingColor },
        paragraph: { spacing: { before: 360, after: 160, line: 312 }, outlineLevel: 0 },
      },
      heading2: {
        run: { font: FONT_H, size: 26, bold: true, color: P.headingColor },
        paragraph: { spacing: { before: 280, after: 120, line: 312 }, outlineLevel: 1 },
      },
    },
  },
  numbering: { config: numberingConfigs },
  sections: [
    { // Section 1: cover — margin 0, no footer/header, no pageNumbers
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1({
        title: "Feature Testing Guide",
        subtitle: "What every feature does, how to test it on your phone, and what you should see when it works",
        englishLabel: "YTAPP TESTER HANDBOOK",
        metaLines: [
          "App: ytapp - a personal, ad-free YouTube client",
          "Covers: v2.8.1 and later builds (Android APK)",
          "Includes: the background-play fix from the November 7 report",
          "Updated: November 7, 2026",
        ],
        footerLeft: "ytapp",
        footerRight: "v2.8.1",
        palette: P,
      }),
    },
    { // Section 2: TOC — roman numerals
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      footers: { default: pageFooter() },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 480, after: 360 },
          children: [new TextRun({ text: "Table of Contents", bold: true, size: 32, font: FONT_H, color: P.headingColor })],
        }),
        new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({
            text: "Note: This Table of Contents is generated via field codes. To ensure page number accuracy after editing, please right-click the TOC and select \"Update Field.\"",
            italics: true, size: 18, color: "888888", font: FONT,
          })],
        }),
        // no trailing PageBreak here: the next section is NEXT_PAGE — adding
        // both is a double break and postcheck correctly flags a blank page
      ],
    },
    { // Section 3: body — arabic from 1
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: docHeader() },
      footers: { default: pageFooter() },
      children: body,
    },
  ],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.mkdirSync("/home/z/my-project/download", { recursive: true });
  const out = "/home/z/my-project/download/ytapp-feature-testing-guide.docx";
  fs.writeFileSync(out, buffer);
  console.log("WROTE", out, buffer.length, "bytes");
});

