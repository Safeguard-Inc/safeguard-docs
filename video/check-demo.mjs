import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto("https://safeguard-docs.vercel.app/demo", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(1500);
for (const [label, sel] of [["compliant", "#preset-clean"], ["sanctions", "#preset-sanctions"], ["frozen", "#preset-frozen"]]) {
  await p.click(sel);
  await p.waitForTimeout(400);
  const decision = (await p.textContent("#decision-pill")).trim();
  const reason = (await p.textContent("#reason-code")).trim();
  const json = (await p.textContent("#json")).trim().replace(/\s+/g, " ").slice(0, 120);
  console.log(`${label.padEnd(10)} decision=${decision.padEnd(9)} reason=${reason.padEnd(22)} json=${json}`);
}
await b.close();
