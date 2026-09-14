// Builds the visual assets for the pitch video.
//
//   node video/build.mjs            # everything
//   node video/build.mjs slides     # only the generated slides
//   node video/build.mjs captures   # only the live captures
//
// Two kinds of asset come out of here, and the distinction matters for
// honesty: `assets/slides/*.png` are *generated* (titles, diagrams, metrics),
// while `assets/captures/*.png` are *photographed from the running system* —
// the live Vercel deployment, the live Testnet-backed docs pages and the real
// GitHub org. No capture is redrawn by hand, so if the deployment regresses
// the video regresses with it.
//
// Every slide asserts that its text actually reached the DOM before the
// screenshot is taken, so a template bug fails the build instead of silently
// producing a blank frame.

import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outSlides = join(here, "assets", "slides");
const outCaptures = join(here, "assets", "captures");

const plan = JSON.parse(await readFile(join(here, "scenes.json"), "utf8"));
const { width, height } = plan.video;

// Layout is authored at 1920x1080 and shot at 2x, so every zoom or pan in the
// edit is a downscale rather than an upscale. Text stays crisp under motion;
// screenshotting at 1x and zooming in visibly softens it.
const SCALE = 2;

const FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">';

const CSS = `
:root {
  --bg: #05070d;
  --panel: rgba(255,255,255,0.045);
  --line: rgba(255,255,255,0.10);
  --fg: #eef2f8;
  --muted: #93a1b8;
  --cyan: #38bdf8;
  --green: #34d399;
  --amber: #fbbf24;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
body {
  background:
    radial-gradient(1100px 620px at 12% -6%, rgba(56,189,248,0.16), transparent 62%),
    radial-gradient(900px 540px at 96% 108%, rgba(52,211,153,0.13), transparent 60%),
    var(--bg);
  color: var(--fg);
  font-family: Inter, system-ui, -apple-system, "Segoe UI", "DejaVu Sans", sans-serif;
  display: flex; flex-direction: column;
  padding: 92px 108px 118px;
  position: relative;
}
.mono { font-family: "JetBrains Mono", ui-monospace, "DejaVu Sans Mono", monospace; }
.kicker {
  font-size: 21px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--cyan); margin-bottom: 26px;
}
h1 { font-size: 88px; line-height: 1.04; font-weight: 800; letter-spacing: -0.02em; white-space: pre-line; }
h1.sm { font-size: 70px; }
.sub { margin-top: 30px; font-size: 29px; line-height: 1.5; color: var(--muted); max-width: 1450px; }
.body { flex: 1; display: flex; flex-direction: column; justify-content: center; }
.sub--tight { margin-top: 24px; }

/* title */
.title-wrap { flex: 1; display: flex; flex-direction: column; justify-content: center; }
.title-mark {
  width: 76px; height: 76px; border-radius: 20px; margin-bottom: 40px;
  background: linear-gradient(140deg, var(--cyan), var(--green));
  box-shadow: 0 0 0 1px rgba(255,255,255,0.14), 0 22px 60px -12px rgba(56,189,248,0.55);
  display: flex; align-items: center; justify-content: center;
  font-weight: 900; font-size: 38px; color: #04121c;
}
.title-head { font-size: 96px; line-height: 1.03; font-weight: 900; letter-spacing: -0.03em; white-space: pre-line; }
.badges { display: flex; gap: 14px; margin-top: 54px; }
.badge {
  font-size: 21px; font-weight: 600; padding: 13px 24px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--panel); color: var(--muted);
}
.badge.live { color: var(--green); border-color: rgba(52,211,153,0.45); background: rgba(52,211,153,0.09); }

/* stats */
.stats { display: flex; gap: 26px; margin-top: 66px; }
.stat {
  flex: 1; border: 1px solid var(--line); background: var(--panel);
  border-radius: 20px; padding: 30px 32px;
}
.stat .v { font-size: 44px; font-weight: 800; letter-spacing: -0.01em; color: var(--fg); }
.stat .v.accent { color: var(--green); }
.stat .l { margin-top: 10px; font-size: 21px; color: var(--muted); }

/* layers */
.cards { display: flex; gap: 26px; margin-top: 58px; }
.card {
  flex: 1; border: 1px solid var(--line); background: var(--panel);
  border-radius: 22px; padding: 36px 34px; display: flex; flex-direction: column;
}
.chip {
  align-self: flex-start; font-size: 19px; font-weight: 800; letter-spacing: 0.14em;
  padding: 8px 16px; border-radius: 9px; margin-bottom: 24px;
  background: rgba(56,189,248,0.13); color: var(--cyan); border: 1px solid rgba(56,189,248,0.32);
}
.chip.g { background: rgba(52,211,153,0.13); color: var(--green); border-color: rgba(52,211,153,0.32); }
.card h3 { font-size: 33px; font-weight: 700; margin-bottom: 16px; letter-spacing: -0.01em; }
.card p { font-size: 23px; line-height: 1.5; color: var(--muted); }

/* flow */
.flow { margin-top: 56px; }
.row { display: flex; align-items: center; gap: 20px; }
.node {
  border: 1px solid var(--line); background: var(--panel); border-radius: 18px;
  padding: 26px 30px; min-width: 330px;
}
.node .t { font-size: 26px; font-weight: 700; }
.node .s { font-size: 19px; color: var(--muted); margin-top: 7px; }
.node.hi { border-color: rgba(52,211,153,0.5); background: rgba(52,211,153,0.08); }
.arrow { color: var(--cyan); font-size: 34px; font-weight: 700; }
.edge { font-size: 18px; color: var(--muted); text-align: center; max-width: 230px; line-height: 1.35; }
.edge .mono { color: var(--fg); font-size: 17px; display: block; margin-top: 6px; }
.flow-note {
  margin-top: 44px; font-size: 23px; color: var(--muted); border-left: 4px solid var(--green);
  padding-left: 22px; line-height: 1.5;
}

/* code */
.code-grid { display: flex; gap: 46px; margin-top: 54px; align-items: flex-start; }
.code-panel {
  flex: 1.15; border: 1px solid var(--line); background: rgba(3,6,12,0.72);
  border-radius: 20px; overflow: hidden;
}
.code-bar {
  display: flex; align-items: center; gap: 10px; padding: 16px 22px;
  border-bottom: 1px solid var(--line); background: rgba(255,255,255,0.03);
  font-size: 20px; color: var(--muted);
}
.dot { width: 12px; height: 12px; border-radius: 50%; background: #2b3purple; }
.dot.r { background: #ff5f57; } .dot.y { background: #febc2e; } .dot.g { background: #28c840; }
pre { padding: 26px 30px; font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 24px; line-height: 1.62; }
pre .k { color: #c084fc; } pre .n { color: var(--amber); } pre .c { color: var(--muted); }
.notes { flex: 1; display: flex; flex-direction: column; gap: 24px; }
.note {
  border: 1px solid var(--line); background: var(--panel); border-radius: 18px;
  padding: 26px 28px; font-size: 23px; line-height: 1.5; color: var(--muted);
}
.note strong { color: var(--fg); font-weight: 700; }

/* steps */
.steps { display: flex; gap: 22px; margin-top: 58px; align-items: stretch; }
.step {
  flex: 1; border: 1px solid var(--line); background: var(--panel);
  border-radius: 20px; padding: 32px 30px; display: flex; flex-direction: column;
}
.step .n {
  font-family: "JetBrains Mono", monospace; font-size: 20px; font-weight: 700;
  color: var(--cyan); margin-bottom: 18px;
}
.step h3 { font-size: 28px; font-weight: 700; margin-bottom: 13px; letter-spacing: -0.01em; }
.step p { font-size: 22px; line-height: 1.48; color: var(--muted); }

/* metrics */
.metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; margin-top: 56px; }
.metric {
  border: 1px solid var(--line); background: var(--panel); border-radius: 22px; padding: 38px 40px;
}
.metric .v { font-size: 68px; font-weight: 800; letter-spacing: -0.025em; color: var(--green); }
.metric .l { margin-top: 12px; font-size: 23px; color: var(--muted); line-height: 1.4; }
.footnote { margin-top: 40px; font-size: 23px; color: var(--muted); }

/* chrome */
.chrome {
  position: absolute; left: 108px; right: 108px; bottom: 52px;
  display: flex; align-items: center; gap: 22px;
}
.chrome .brand { font-size: 20px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
.chrome .chapter { margin-left: auto; font-size: 20px; color: var(--muted); }
.bar { position: absolute; left: 0; right: 0; bottom: 0; height: 5px; background: rgba(255,255,255,0.07); }
.bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--cyan), var(--green)); }
.links { display: flex; gap: 18px; margin-top: 48px; }
.link {
  font-family: "JetBrains Mono", monospace; font-size: 24px; color: var(--fg);
  border: 1px solid var(--line); background: var(--panel); border-radius: 14px; padding: 20px 28px;
}
`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function chrome(scene, index, total) {
  const pct = Math.round(((index + 1) / total) * 100);
  return `<div class="chrome"><div class="brand">Safeguard</div><div class="chapter">${esc(
    scene.chapter,
  )} · ${index + 1} / ${total}</div></div><div class="bar"><i style="width:${pct}%"></i></div>`;
}

function slideBody(slide) {
  switch (slide.type) {
    case "title":
      return `<div class="title-wrap">
        <div class="title-mark">S</div>
        <div class="kicker">${esc(slide.kicker)}</div>
        <div class="title-head">${esc(slide.headline)}</div>
        <div class="sub">${esc(slide.sub)}</div>
        <div class="badges">${slide.badges
          .map(
            (b, i) =>
              `<div class="badge${i === 0 ? " live" : ""}">${esc(b)}</div>`,
          )
          .join("")}</div>
      </div>`;
    case "statement":
      return `<div class="body">
        <div class="kicker">${esc(slide.kicker)}</div>
        <h1 class="sm">${esc(slide.headline)}</h1>
        <div class="sub">${esc(slide.sub)}</div>
        <div class="stats">${slide.stats
          .map(
            ([v, l]) =>
              `<div class="stat"><div class="v${/^\d|^9|^24|^0|\//.test(v) ? " accent" : ""}">${esc(
                v,
              )}</div><div class="l">${esc(l)}</div></div>`,
          )
          .join("")}</div>
      </div>`;
    case "layers":
      return `<div class="body">
        <div class="kicker">${esc(slide.kicker)}</div>
        <h1 class="sm">${esc(slide.headline)}</h1>
        <div class="cards">${slide.cards
          .map(
            (c, i) =>
              `<div class="card"><div class="chip${i === 1 ? " g" : ""}">${esc(
                c.label,
              )}</div><h3>${esc(c.title)}</h3><p>${esc(c.body)}</p></div>`,
          )
          .join("")}</div>
      </div>`;
    case "flow":
      return `<div class="body">
        <div class="kicker">${esc(slide.kicker)}</div>
        <h1 class="sm">${esc(slide.headline)}</h1>
        <div class="sub sub--tight">${esc(slide.sub)}</div>
        <div class="flow">
          <div class="row">
            <div class="node"><div class="t">Confidential token</div><div class="s">holds balances, holds proofs</div></div>
            <div class="arrow">→</div>
            <div class="edge">before_register · before_deposit<br>before_transfer · before_withdraw<span class="mono">before_* hook</span></div>
            <div class="arrow">→</div>
            <div class="node hi"><div class="t">compliance-hooks</div><div class="s">ENFORCE · fails closed</div></div>
            <div class="arrow">→</div>
            <div class="edge">is_authorized(account, token)<span class="mono">one call, one boolean</span></div>
            <div class="arrow">→</div>
            <div class="node"><div class="t">safeguard-policy</div><div class="s">DEFINE · decides eligibility</div></div>
          </div>
          <div class="flow-note">The enforcement layer gates what it holds — its own configuration, bindings and freeze flags — and never learns how many rules exist or what they are. Reverting is free: a denial stops at the first failing gate, before any later party is screened.</div>
        </div>
      </div>`;
    case "code":
      return `<div class="body">
        <div class="kicker">${esc(slide.kicker)}</div>
        <h1 class="sm">${esc(slide.headline)}</h1>
        <div class="code-grid">
          <div class="code-panel">
            <div class="code-bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>${esc(
              slide.file,
            )}</div>
            <pre>${slide.code
              .map((line) => {
                const safe = esc(line);
                if (/^\s*\/\//.test(line)) return `<span class="c">${safe}</span>`;
                return safe
                  .replace(
                    /\b(pub enum|enum|pub|const|let|fn)\b/g,
                    '<span class="k">$1</span>',
                  )
                  .replace(/= (\d+)/g, '= <span class="n">$1</span>');
              })
              .join("\n")}</pre>
          </div>
          <div class="notes">${slide.notes
            .map((n) => `<div class="note">${esc(n)}</div>`)
            .join("")}</div>
        </div>
      </div>`;
    case "steps":
      return `<div class="body">
        <div class="kicker">${esc(slide.kicker)}</div>
        <h1 class="sm">${esc(slide.headline)}</h1>
        <div class="steps">${slide.steps
          .map(
            (s, i) =>
              `<div class="step"><div class="n">0${i + 1}</div><h3>${esc(
                s.title,
              )}</h3><p>${esc(s.body)}</p></div>`,
          )
          .join("")}</div>
        <div class="footnote">${esc(slide.footnote)}</div>
      </div>`;
    case "metrics":
      return `<div class="body">
        <div class="kicker">${esc(slide.kicker)}</div>
        <h1 class="sm">${esc(slide.headline)}</h1>
        <div class="metrics">${slide.metrics
          .map(
            ([v, l]) =>
              `<div class="metric"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`,
          )
          .join("")}</div>
        <div class="footnote">${esc(slide.footnote)}</div>
      </div>`;
    case "cta":
      return `<div class="body">
        <div class="kicker">${esc(slide.kicker)}</div>
        <h1>${esc(slide.headline)}</h1>
        <div class="sub">${esc(slide.sub)}</div>
        <div class="links">${slide.links
          .map((l) => `<div class="link">${esc(l)}</div>`)
          .join("")}</div>
      </div>`;
    default:
      throw new Error(`unknown slide type: ${slide.type}`);
  }
}

function html(slide, scene, index, total) {
  return `<!doctype html><html><head><meta charset="utf-8">${FONT_LINK}<style>${CSS}</style></head>
<body data-slide="${esc(scene.id)}">${slideBody(slide)}${chrome(scene, index, total)}</body></html>`;
}

const sceneOfSlide = (name) => plan.scenes.find((s) => s.frames.some((f) => f.asset === `slide:${name}`));

/**
 * The literal values a slide promises to put on screen: badges, stats, metrics
 * and card labels. These are the only strings that carry a *number*, and a
 * stale number on a slide is a false claim in a video that cannot be patched
 * after it is published — the first render of this video shipped a slide
 * reading 849 next to narration saying eight hundred and five.
 */
function onScreenValues(slide) {
  const values = [];
  for (const badge of slide.badges ?? []) values.push(String(badge));
  for (const row of slide.stats ?? []) values.push(...row.map(String));
  for (const row of slide.metrics ?? []) values.push(...row.map(String));
  for (const card of slide.cards ?? []) if (card.label !== undefined) values.push(String(card.label));
  return values;
}

// Rendering reflows text (`<br>`, wrapping) and inserts non-breaking spaces, so
// both sides of the comparison are normalised to single spaces.
const flatten = (text) => text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

async function buildSlides(page) {
  await mkdir(outSlides, { recursive: true });
  const names = Object.keys(plan.slides);
  const report = [];
  for (const name of names) {
    const slide = plan.slides[name];
    const scene = sceneOfSlide(name) ?? { id: name, chapter: slide.kicker ?? name };
    const index = plan.scenes.findIndex((s) => s.id === scene.id);
    const doc = html(slide, scene, index < 0 ? 0 : index, plan.scenes.length);
    await page.setContent(doc, { waitUntil: "networkidle" });
    // A template bug must fail the build rather than emit a blank frame.
    const text = (await page.evaluate(() => document.body.innerText)).trim();
    if (text.length < 40) {
      throw new Error(`slide ${name} rendered almost no text (${text.length} chars)`);
    }
    // The slide's own text is written beside the frame, so what a frame says is
    // auditable without OCR — this is what makes the number check above
    // meaningfully verifiable rather than a promise in a README.
    await writeFile(join(outSlides, `${name}.txt`), text + "\n");
    const rendered = flatten(text);
    const missing = onScreenValues(slide).filter((value) => !rendered.includes(flatten(value)));
    if (missing.length) {
      throw new Error(
        `slide ${name} does not show the values scenes.json declares: ${missing.join(", ")}`,
      );
    }
    const file = join(outSlides, `${name}.png`);
    await page.screenshot({ path: file });
    report.push({ name, text: text.length, values: onScreenValues(slide).length, file });
  }
  return report;
}

async function buildCaptures(browser) {
  await mkdir(outCaptures, { recursive: true });
  const report = [];
  for (const [name, spec] of Object.entries(plan.captures)) {
    const context = await browser.newContext({
      viewport: { width, height: spec.height ?? height },
      deviceScaleFactor: SCALE,
    });
    const page = await context.newPage();
    await page.goto(spec.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    try {
      await page.waitForLoadState("networkidle", { timeout: 15000 });
    } catch {
      // Long-polling pages never go idle; a settled DOM is enough.
    }
    // Dismiss a consent banner if one is present, so it does not cover the UI.
    for (const label of ["Accept", "Accept all", "I agree"]) {
      const button = page.getByRole("button", { name: label, exact: false });
      if (await button.count().catch(() => 0)) {
        await button.first().click({ timeout: 2000 }).catch(() => {});
        break;
      }
    }
    for (const action of spec.actions ?? []) {
      if (action.click) await page.click(action.click, { timeout: 10000 });
      if (action.wait) await page.waitForTimeout(action.wait);
    }
    await page.waitForTimeout(spec.wait ?? 1000);
    const text = (await page.evaluate(() => document.body.innerText)).trim();
    if (text.length < 100) {
      throw new Error(`capture ${name} produced too little text (${text.length} chars) — is ${spec.url} up?`);
    }
    const file = join(outCaptures, `${name}.png`);
    await page.screenshot({ path: file });
    report.push({ name, text: text.length, file, url: spec.url });
    await context.close();
  }
  return report;
}

const only = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: SCALE });
const slides = only === "captures" ? [] : await buildSlides(page);
const captures = only === "slides" ? [] : await buildCaptures(browser);
await browser.close();

await writeFile(
  join(here, "assets", "manifest.json"),
  JSON.stringify({ slides, captures }, null, 2) + "\n",
);
console.log(`slides:   ${slides.length}`);
console.log(`captures: ${captures.length}`);
for (const item of [...slides, ...captures]) {
  const values = item.values ? `, ${item.values} values verified` : "";
  console.log(`  ${item.name}  (${item.text} chars${values})`);
}
