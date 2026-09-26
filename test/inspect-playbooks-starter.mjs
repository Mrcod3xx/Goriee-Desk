import puppeteer from "puppeteer-core";
import path from "path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3000";
const OUT = path.join(process.cwd(), "test", "screenshots");

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ["--no-sandbox"],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
await page.goto(BASE, { waitUntil: "networkidle0" });
await new Promise(r => setTimeout(r, 2000));

// Clear playbooks in localStorage to see fresh empty state with starter templates
await page.evaluate(() => {
  window.localStorage.removeItem("goriee.playbooks.v1");
});

// Click Playbooks tab
const btns = await page.$$("button.nav-item");
for (const b of btns) {
  const txt = await b.evaluate(el => el.textContent);
  if (txt && txt.includes("Playbooks")) {
    await b.click();
    break;
  }
}

await new Promise(r => setTimeout(r, 2000));
const fp = path.join(OUT, "tab_playbooks_starters_overhauled.png");
await page.screenshot({ path: fp, fullPage: true });
console.log("Playbooks starter overhaul captured:", fp);

await browser.close();
