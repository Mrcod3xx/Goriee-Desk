import puppeteer from "puppeteer-core";
import path from "path";
import fs from "fs";
import os from "os";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots");

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function verifyDropdownChevrons() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-dropdown-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: tempDir,
    defaultViewport: { width: 1440, height: 1100 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1000));

    // 1. Navigate to Backtests view (matches user's screenshot)
    const navButtons = await page.$$("button.nav-item");
    for (const btn of navButtons) {
      const text = await btn.evaluate((el) => el.textContent);
      if (text && text.includes("Backtest")) {
        await btn.click();
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 800));

    // Locate the strategy builder controls
    const controls = await page.$(".strategy-builder-controls");
    if (controls) {
      await controls.screenshot({
        path: path.join(SCREENSHOT_DIR, "verify-backtest-dropdowns.png"),
      });
      console.log("Captured verify-backtest-dropdowns.png");

      // Hover over the interval select
      const intervalSelect = await controls.$(".interval-control select");
      if (intervalSelect) {
        await intervalSelect.hover();
        await new Promise((r) => setTimeout(r, 300));
        await controls.screenshot({
          path: path.join(SCREENSHOT_DIR, "verify-backtest-dropdowns-hover.png"),
        });
        console.log("Captured verify-backtest-dropdowns-hover.png");
      }
    }

    // 2. Navigate to Market scanner view
    for (const btn of navButtons) {
      const text = await btn.evaluate((el) => el.textContent);
      if (text && text.includes("scanner")) {
        await btn.click();
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 800));

    const scannerFilters = await page.$(".scanner-toolbar");
    if (scannerFilters) {
      await scannerFilters.screenshot({
        path: path.join(SCREENSHOT_DIR, "verify-scanner-dropdowns.png"),
      });
      console.log("Captured verify-scanner-dropdowns.png");
    }

    // 3. Navigate to Market Desk view to verify Chart interval dropdown
    for (const btn of navButtons) {
      const text = await btn.evaluate((el) => el.textContent);
      if (text && text.includes("Market desk")) {
        await btn.click();
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 800));

    const deskControls = await page.$(".desk-heading-controls");
    if (deskControls) {
      await deskControls.screenshot({
        path: path.join(SCREENSHOT_DIR, "verify-desk-dropdowns.png"),
      });
      console.log("Captured verify-desk-dropdowns.png");
    }

    console.log("All dropdown chevron verification screenshots captured successfully!");
  } finally {
    await browser.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

verifyDropdownChevrons().catch(console.error);
