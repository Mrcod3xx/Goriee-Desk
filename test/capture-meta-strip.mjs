import puppeteer from "puppeteer-core";
import os from "os";
import path from "path";
import fs from "fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots");

async function captureMetaStrip() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-meta-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: tempDir,
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,1200"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });

  await page.goto(BASE_URL, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1500));

  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button.nav-item, a.nav-item"))
      .find((el) => el.textContent?.includes("Backtests"));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 1000));

  await page.evaluate(() => {
    const btn = document.querySelector('form.strategy-builder button[type="submit"]');
    if (btn) btn.click();
  });

  await page.waitForSelector(".backtest-meta-strip", { timeout: 35000 });
  await new Promise((r) => setTimeout(r, 1000));

  // Scroll to workflow-handoff so backtest-meta-strip is right in the center
  await page.evaluate(() => {
    const el = document.querySelector(".workflow-handoff");
    if (el) el.scrollIntoView({ behavior: "instant", block: "start" });
  });
  await new Promise((r) => setTimeout(r, 500));

  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, "12-backtest-meta-strip.png"),
    fullPage: false,
  });
  console.log("✓ Saved: 12-backtest-meta-strip.png");

  await browser.close();
}

captureMetaStrip();
