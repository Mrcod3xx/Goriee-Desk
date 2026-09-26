import puppeteer from "puppeteer-core";
import os from "os";
import path from "path";
import fs from "fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots");

async function verifyHeatmap() {
  console.log("=== Verifying Parameter Sensitivity Heatmap ===");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-hm-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: tempDir,
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,1200"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.error("Browser Console Error:", msg.text());
    }
  });

  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1500));

    // Navigate to Backtests tab
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button.nav-item, a.nav-item"))
        .find((el) => el.textContent?.includes("Backtests"));
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 1200));

    // Check if backtest button is ready
    console.log("Submitting strategy backtest with 60s timeout...");
    await page.evaluate(() => {
      const submitBtn = document.querySelector('form.strategy-builder button[type="submit"]');
      if (submitBtn && !submitBtn.disabled) {
        submitBtn.click();
      }
    });

    console.log("Waiting for parameter heatmap to appear...");
    await page.waitForSelector(".parameter-heatmap-card", { timeout: 65000 });
    console.log("✓ Parameter Heatmap successfully rendered!");

    await new Promise((r) => setTimeout(r, 1500));

    // Scroll heatmap into view
    await page.evaluate(() => {
      const el = document.querySelector(".parameter-heatmap-card");
      if (el) el.scrollIntoView({ behavior: "instant", block: "center" });
    });
    await new Promise((r) => setTimeout(r, 800));

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "04-parameter-heatmap-verified.png"),
      fullPage: false,
    });
    console.log("✓ Saved screenshot: 04-parameter-heatmap-verified.png");

    // Click on a cell or metric button (e.g. Win Rate)
    const clickedMetric = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll(".metric-btn"))
        .find((b) => b.textContent?.includes("Win Rate"));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    console.log("✓ Clicked Win Rate metric filter:", clickedMetric);
    await new Promise((r) => setTimeout(r, 800));

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "04b-parameter-heatmap-winrate.png"),
      fullPage: false,
    });
    console.log("✓ Saved screenshot: 04b-parameter-heatmap-winrate.png");
  } catch (err) {
    console.error("Heatmap test failed:", err);
  } finally {
    await browser.close();
  }
}

verifyHeatmap();
