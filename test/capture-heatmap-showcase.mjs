import puppeteer from "puppeteer-core";
import os from "os";
import path from "path";
import fs from "fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots");

async function captureHeatmap() {
  console.log("=== Capturing Parameter Sensitivity Heatmap Showcase ===");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-hm-showcase-"));
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

  // Navigate to Backtests
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

  // Wait for the parameter heatmap panel
  console.log("Waiting for .parameter-heatmap-panel...");
  await page.waitForSelector(".parameter-heatmap-panel", { timeout: 35000 });
  console.log("✓ Parameter Heatmap Panel loaded!");

  await new Promise((r) => setTimeout(r, 1500));

  // Scroll into view
  await page.evaluate(() => {
    const el = document.querySelector(".parameter-heatmap-panel");
    if (el) el.scrollIntoView({ behavior: "instant", block: "center" });
  });
  await new Promise((r) => setTimeout(r, 800));

  // Screenshot 1: Default Net Return view
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, "04-parameter-heatmap-return.png"),
    fullPage: false,
  });
  console.log("✓ Saved: 04-parameter-heatmap-return.png");

  // Switch metric to Win Rate %
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(".metric-btn"));
    const winRateBtn = btns.find((b) => b.textContent?.includes("Win Rate"));
    if (winRateBtn) winRateBtn.click();
  });
  await new Promise((r) => setTimeout(r, 600));

  // Screenshot 2: Win Rate view
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, "04b-parameter-heatmap-winrate.png"),
    fullPage: false,
  });
  console.log("✓ Saved: 04b-parameter-heatmap-winrate.png");

  // Hover over one of the cells to show live tooltip
  await page.hover(".heatmap-cell");
  await new Promise((r) => setTimeout(r, 500));

  // Screenshot 3: Cell hover inspection
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, "04c-parameter-heatmap-cell-hover.png"),
    fullPage: false,
  });
  console.log("✓ Saved: 04c-parameter-heatmap-cell-hover.png");

  await browser.close();
  console.log("=== Showcase capture complete ===");
}

captureHeatmap();
