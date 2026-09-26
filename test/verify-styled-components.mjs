import puppeteer from "puppeteer-core";
import os from "os";
import path from "path";
import fs from "fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots");

async function verifyStyling() {
  console.log("=== Verifying Upgraded Styling for Topbar & Backtest Cards ===");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-style-"));
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

  // Screenshot 1: Topbar with newly styled Ctrl+K button
  console.log("1. Capturing Topbar Ctrl+K button...");
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, "10-topbar-styled-cmdk.png"),
    clip: { x: 0, y: 0, width: 1440, height: 80 },
  });
  console.log("✓ Saved: 10-topbar-styled-cmdk.png");

  // Navigate to Backtests tab
  console.log("2. Navigating to Backtests...");
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button.nav-item, a.nav-item"))
      .find((el) => el.textContent?.includes("Backtests"));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 1000));

  // Run backtest
  await page.evaluate(() => {
    const btn = document.querySelector('form.strategy-builder button[type="submit"]');
    if (btn) btn.click();
  });

  console.log("Waiting for backtest results...");
  await page.waitForSelector(".backtest-meta-strip, .coverage-report, .strategy-summary", { timeout: 35000 });
  console.log("✓ Styled Backtest cards loaded!");

  await new Promise((r) => setTimeout(r, 1200));

  // Scroll to Backtest meta, coverage, and strategy summary
  await page.evaluate(() => {
    const meta = document.querySelector(".backtest-meta-strip");
    if (meta) meta.scrollIntoView({ behavior: "instant", block: "start" });
  });
  await new Promise((r) => setTimeout(r, 600));

  // Screenshot 2: Backtest metadata strip, coverage audit, and compiled rule
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, "11-backtest-styled-coverage-rule.png"),
    fullPage: false,
  });
  console.log("✓ Saved: 11-backtest-styled-coverage-rule.png");

  await browser.close();
  console.log("=== Verification complete ===");
}

verifyStyling();
