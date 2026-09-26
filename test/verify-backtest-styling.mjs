import puppeteer from "puppeteer-core";
import os from "os";
import path from "path";
import fs from "fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots");

async function verifyBacktestStyling() {
  console.log("Verifying Backtests tab styling overhaul...");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-bt-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: tempDir,
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,1100"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.error("Browser Console Error:", msg.text());
    }
  });

  await page.goto(BASE_URL, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1500));

  // Navigate to Backtests tab
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button.nav-item, a.nav-item"))
      .find(el => el.textContent?.includes("Backtests"));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 1200));

  // Check if strategy template card is present and click it
  const templateLoaded = await page.evaluate(() => {
    const card = document.querySelector(".strategy-template-card");
    if (card) {
      card.click();
      return true;
    }
    return false;
  });
  console.log("✓ Strategy template card clicked:", templateLoaded);
  await new Promise((r) => setTimeout(r, 800));

  // Check the textarea content
  const promptVal = await page.$eval(".strategy-builder textarea", (el) => el.value);
  console.log("✓ Strategy prompt populated:", promptVal.slice(0, 60) + "...");

  // Click submit button
  const submitBtnExists = await page.evaluate(() => {
    const btn = document.querySelector('form.strategy-builder button[type="submit"]');
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
    return false;
  });
  console.log("✓ Submit button clicked:", submitBtnExists);

  // Wait for backtest results (up to 45s for LLM + Bitget data)
  console.log("Waiting for backtest compilation and candle simulation...");
  try {
    await page.waitForSelector(".validation-cards-grid, .simulated-trades-table", { timeout: 45000 });
    console.log("✓ Backtest results appeared on screen!");
    await new Promise((r) => setTimeout(r, 2000));

    // Check for newly added elements
    const metrics = await page.evaluate(() => {
      const holdoutCards = document.querySelectorAll(".validation-card").length;
      const tradesCount = document.querySelectorAll(".simulated-trades-table tbody tr").length;
      const summaryChips = document.querySelectorAll(".trade-chip").length;
      const tableWidth = document.querySelector(".simulated-trades-table")?.getBoundingClientRect().width;
      const panelWidth = document.querySelector(".panel.trade-log")?.getBoundingClientRect().width;
      return { holdoutCards, tradesCount, summaryChips, tableWidth, panelWidth };
    });

    console.log("✓ Verification metrics:", metrics);

    // Scroll to holdout and simulated trades
    await page.evaluate(() => {
      const el = document.querySelector(".validation-panel");
      if (el) el.scrollIntoView({ behavior: "instant", block: "start" });
    });
    await new Promise((r) => setTimeout(r, 800));

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "v8_backtest_styled_holdout_and_trades.png") });
    console.log("✓ Saved screenshot to test/screenshots/v8_backtest_styled_holdout_and_trades.png");

    // Scroll specifically to the simulated trades table to capture the full table styling
    await page.evaluate(() => {
      const el = document.querySelector(".panel.trade-log");
      if (el) el.scrollIntoView({ behavior: "instant", block: "start" });
    });
    await new Promise((r) => setTimeout(r, 800));

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "v9_backtest_simulated_trades_table.png") });
    console.log("✓ Saved screenshot to test/screenshots/v9_backtest_simulated_trades_table.png");
  } catch (err) {
    console.error("Backtest wait failed or timed out:", err.message);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "bt_timeout_debug.png") });
  }

  await browser.close();
  console.log("Script completed.");
}

verifyBacktestStyling().catch(console.error);
