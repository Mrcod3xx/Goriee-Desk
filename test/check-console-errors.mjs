// check-console-errors.mjs — navigate to each tab and collect console errors
import puppeteer from "puppeteer-core";
import path from "path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3000";

const TABS = [
  { nav: "Market desk", file: "desk" },
  { nav: "Market scanner", file: "scanner" },
  { nav: "Research", file: "research" },
  { nav: "Backtests", file: "backtests" },
  { nav: "Trade replay", file: "replay" },
  { nav: "Playbooks", file: "playbooks" },
  { nav: "Paper account", file: "paper" },
  { nav: "Journal", file: "journal" },
  { nav: "Settings", file: "settings" },
];

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ["--no-sandbox"],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();

const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") {
    errors.push({ tab: "?", text: msg.text() });
  }
});
page.on("pageerror", (err) => {
  errors.push({ tab: "?", text: `PAGE ERROR: ${err.message}` });
});

await page.goto(BASE, { waitUntil: "networkidle0" });
await new Promise(r => setTimeout(r, 2500));

let currentTab = "initial";
for (const tab of TABS) {
  currentTab = tab.file;
  const btns = await page.$$("button.nav-item");
  for (const b of btns) {
    const txt = await b.evaluate(el => el.textContent);
    if (txt && txt.includes(tab.nav)) {
      await b.click();
      break;
    }
  }
  await new Promise(r => setTimeout(r, 1500));
  // Mark recent errors with tab name
  for (const e of errors) {
    if (e.tab === "?") e.tab = currentTab;
  }
}

await browser.close();

if (errors.length === 0) {
  console.log("✅ No console errors across any tab.");
} else {
  console.log(`⚠ Found ${errors.length} console errors:`);
  for (const e of errors) {
    console.log(`  [${e.tab}] ${e.text}`);
  }
}
