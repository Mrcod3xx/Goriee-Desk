import puppeteer from "puppeteer-core";
import os from "os";
import path from "path";
import fs from "fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots");

async function debugBacktest() {
  console.log("=== Debugging Backtest Execution & Heatmap Render ===");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-btdebug-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: tempDir,
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,1200"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });

  page.on("console", (msg) => {
    console.log(`[Browser ${msg.type()}]:`, msg.text());
  });

  page.on("requestfailed", (req) => {
    console.log(`[Request Failed]: ${req.url()} - ${req.failure()?.errorText}`);
  });

  page.on("response", (res) => {
    if (res.url().includes("/api/")) {
      console.log(`[API Response]: ${res.url()} -> ${res.status()}`);
    }
  });

  await page.goto(BASE_URL, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 2000));

  // Navigate to Backtests tab
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button.nav-item, a.nav-item"))
      .find((el) => el.textContent?.includes("Backtests"));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 1000));

  // Check submit button state
  const btnState = await page.evaluate(() => {
    const btn = document.querySelector('form.strategy-builder button[type="submit"]');
    return {
      exists: !!btn,
      text: btn?.textContent,
      disabled: btn?.disabled,
      classes: btn?.className,
    };
  });
  console.log("Submit button state before click:", btnState);

  // Click submit button
  await page.evaluate(() => {
    const btn = document.querySelector('form.strategy-builder button[type="submit"]');
    if (btn) btn.click();
  });

  console.log("Waiting up to 45s, polling every 3s...");
  for (let i = 1; i <= 15; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const status = await page.evaluate(() => {
      const btn = document.querySelector('form.strategy-builder button[type="submit"]');
      const heatmap = document.querySelector(".parameter-heatmap-card");
      const errBanner = document.querySelector(".error-banner");
      const validationGrid = document.querySelector(".validation-cards-grid");
      return {
        btnText: btn?.textContent,
        btnDisabled: btn?.disabled,
        heatmapFound: !!heatmap,
        errBanner: errBanner?.textContent,
        validationGridFound: !!validationGrid,
      };
    });
    console.log(`[Poll ${i * 3}s]:`, status);
    if (status.heatmapFound) {
      console.log("✓ Heatmap found! Taking screenshot...");
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "04-parameter-heatmap-success.png"),
        fullPage: false,
      });
      break;
    }
  }

  await browser.close();
  console.log("=== Debug complete ===");
}

debugBacktest();
