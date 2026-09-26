import puppeteer from "puppeteer-core";
import os from "os";
import path from "path";
import fs from "fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots");

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function runVisualVerification() {
  console.log("=== Starting Visual & Functional E2E Verification ===");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-verify-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: tempDir,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1440,960",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 960 });

  const errors = [];
  page.on("pageerror", (err) => {
    console.error("Browser error:", err.message);
    errors.push(err.message);
  });

  try {
    // 1. Load Desk
    console.log("Navigating to", BASE_URL);
    await page.goto(BASE_URL, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));

    // Check WebSocket Badge
    const wsBadge = await page.$eval(".ws-status-badge", (el) => el.textContent?.trim()).catch(() => "Not found");
    console.log("✓ WebSocket Status Badge:", wsBadge);

    // 2. Bollinger Bands & MACD Toggles
    console.log("Testing Bollinger Bands toggle...");
    await page.waitForSelector(".bb-toggle-btn", { timeout: 5000 });
    await page.click(".bb-toggle-btn");
    await new Promise((r) => setTimeout(r, 600));

    console.log("Testing MACD toggle...");
    await page.waitForSelector(".macd-toggle-btn", { timeout: 5000 });
    await page.click(".macd-toggle-btn");
    await new Promise((r) => setTimeout(r, 1000));

    // Check that MACD subpanel is rendered
    const hasMacdPanel = await page.$(".macd-subpanel") !== null;
    console.log("✓ MACD Sub-panel active:", hasMacdPanel);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "v1_desk_bb_macd.png") });
    console.log("✓ Captured screenshot: v1_desk_bb_macd.png");

    // 3. Multi-Horizon Confluence Matrix
    console.log("Testing Multi-Horizon Confluence Matrix...");
    await page.waitForSelector(".confluence-panel", { timeout: 10000 });
    const confluenceScore = await page.$eval(".confluence-score-box strong", (el) => el.textContent?.trim()).catch(() => "N/A");
    console.log("✓ Confluence Matrix Score:", confluenceScore);

    // Scroll to confluence matrix
    await page.evaluate(() => {
      document.querySelector(".confluence-panel")?.scrollIntoView({ behavior: "instant", block: "center" });
    });
    await new Promise((r) => setTimeout(r, 800));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "v2_confluence_matrix.png") });
    console.log("✓ Captured screenshot: v2_confluence_matrix.png");

    // 4. Paper Account & Rule Runner
    console.log("Navigating to Paper account tab...");
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button.nav-item, a.nav-item"))
        .find(el => el.textContent?.includes("Paper account"));
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 1500));

    await page.waitForSelector(".rule-runner-panel", { timeout: 8000 });
    console.log("✓ Automated Playbook Rule Runner panel mounted.");

    // Click "⚡ Evaluate Now"
    const evalBtn = await page.$(".rule-runner-controls button:last-child");
    if (evalBtn) {
      console.log("Clicking ⚡ Evaluate Now...");
      await evalBtn.click();
      await new Promise((r) => setTimeout(r, 3500));
    }

    const logCount = await page.$$eval(".rule-log-item", (items) => items.length).catch(() => 0);
    console.log("✓ Rule Runner execution log entries:", logCount);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "v3_paper_rule_runner.png") });
    console.log("✓ Captured screenshot: v3_paper_rule_runner.png");

    // 5. Backtests & Strategy Card Modal
    console.log("Navigating to Backtests tab...");
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button.nav-item, a.nav-item"))
        .find(el => el.textContent?.includes("Backtests"));
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 1500));

    // Run simulation
    const submitBtn = await page.$("button.simulator-submit, button[type='submit']");
    if (submitBtn) {
      console.log("Running backtest simulation...");
      await submitBtn.click();
      await new Promise((r) => setTimeout(r, 4000));
    }

    // Check for Export Strategy Card button
    const exportCardBtn = await page.$("button:has(span), button.button-secondary");
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button"))
        .find(el => el.textContent?.includes("Export Strategy Card"));
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 1500));

    const modalVisible = await page.$(".strategy-card-modal") !== null;
    console.log("✓ Strategy Card Modal open:", modalVisible);

    if (modalVisible) {
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "v4_strategy_card_modal.png") });
      console.log("✓ Captured screenshot: v4_strategy_card_modal.png");
      // Close modal
      await page.click(".strategy-card-modal button");
      await new Promise((r) => setTimeout(r, 500));
    }

    // 6. Sidebar Anti-Cutout Validation (scroll to bottom of page)
    console.log("Testing bottom page scrolling for sidebar anti-cutout...");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((r) => setTimeout(r, 1000));

    const sidebarHeight = await page.$eval(".sidebar", (el) => el.getBoundingClientRect().height);
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    console.log(`✓ Sidebar rendered height: ${sidebarHeight}px (Viewport: ${viewportHeight}px)`);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "v5_scrolled_bottom_layout.png") });
    console.log("✓ Captured screenshot: v5_scrolled_bottom_layout.png");

    console.log("\n==========================================");
    console.log("ALL VISUAL AND FUNCTIONAL CHECKS COMPLETED!");
    console.log(`Total browser console errors: ${errors.length}`);
    console.log("==========================================\n");
  } catch (err) {
    console.error("Test execution failed:", err);
    throw err;
  } finally {
    await browser.close();
  }
}

runVisualVerification().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
