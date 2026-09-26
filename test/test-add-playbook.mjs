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

// Click Playbooks tab
const btns = await page.$$("button.nav-item");
for (const b of btns) {
  const txt = await b.evaluate(el => el.textContent);
  if (txt && txt.includes("Playbooks")) {
    await b.click();
    break;
  }
}
await new Promise(r => setTimeout(r, 1500));

// Click "+ Add to Library" on the first starter card
const allAddBtns = await page.$$("button");
let clicked = false;
for (const b of allAddBtns) {
  const txt = await b.evaluate(el => el.textContent);
  if (txt && txt.includes("Add to Library")) {
    await b.click();
    clicked = true;
    break;
  }
}
console.log("Clicked + Add to Library:", clicked);

await new Promise(r => setTimeout(r, 1500));
const fp = path.join(OUT, "tab_playbooks_after_add.png");
await page.screenshot({ path: fp, fullPage: true });
console.log("Captured after add:", fp);

await browser.close();
