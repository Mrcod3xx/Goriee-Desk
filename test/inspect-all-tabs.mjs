// inspect-all-tabs.mjs — take full-page screenshots of all 8 nav tabs
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync } from "fs";
import path from "path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3000";
const OUT = path.join(process.cwd(), "test", "screenshots");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const TABS = [
  { nav: "Market desk", file: "tab_desk" },
  { nav: "Market scanner", file: "tab_scanner" },
  { nav: "Research", file: "tab_research" },
  { nav: "Backtests", file: "tab_backtests" },
  { nav: "Playbooks", file: "tab_playbooks" },
  { nav: "Paper account", file: "tab_paper" },
  { nav: "Journal", file: "tab_journal" },
  { nav: "Settings", file: "tab_settings" },
];

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
console.log("Navigating to", BASE);
await page.goto(BASE, { waitUntil: "networkidle0" });
await new Promise(r => setTimeout(r, 2500));

for (const tab of TABS) {
  const btns = await page.$$("button.nav-item");
  for (const b of btns) {
    const txt = await b.evaluate(el => el.textContent);
    if (txt && txt.includes(tab.nav)) {
      await b.click();
      break;
    }
  }
  await new Promise(r => setTimeout(r, 1500));
  const fp = path.join(OUT, `${tab.file}.png`);
  await page.screenshot({ path: fp, fullPage: true });
  console.log(`  ✔ ${tab.nav} → ${tab.file}.png`);
}

await browser.close();
console.log("Done — all tabs captured.");
