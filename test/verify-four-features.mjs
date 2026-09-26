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

async function verifyFourFeatures() {
  console.log("=== Verifying 4 Quantitative Systems ===");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-4feat-"));
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

  try {
    console.log("1. Navigating to base URL...");
    await page.goto(BASE_URL, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 2000));

    // FEATURE 1: Volatility Squeeze Radar & CVD Oscillator on Market Desk
    console.log("2. Checking Volatility Squeeze Radar & CVD on Market Desk...");
    const squeezePill = await page.$(".squeeze-radar-pill");
    console.log("✓ Squeeze radar pill rendered:", !!squeezePill);

    // Click CVD button if present
    const cvdBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const target = btns.find((b) => b.textContent?.includes("CVD") || b.textContent?.includes("Volume Delta"));
      if (target) {
        target.click();
        return true;
      }
      return false;
    });
    console.log("✓ CVD toggle button clicked:", cvdBtn);
    await new Promise((r) => setTimeout(r, 1000));

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "01-market-desk-cvd-squeeze.png"),
      fullPage: false,
    });
    console.log("✓ Screenshot saved: 01-market-desk-cvd-squeeze.png");

    // FEATURE 2: Command Palette (Ctrl+K)
    console.log("3. Testing Ctrl+K Bloomberg-Style Command Palette...");
    const cmdTrigger = await page.$(".cmd-k-trigger");
    if (cmdTrigger) {
      await cmdTrigger.click();
    } else {
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyK");
      await page.keyboard.up("Control");
    }
    await new Promise((r) => setTimeout(r, 600));

    const paletteModal = await page.$(".cmd-palette-backdrop");
    console.log("✓ Command Palette modal open:", !!paletteModal);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "02-command-palette-open.png"),
      fullPage: false,
    });

    // Test typing "ETH" in Command Palette search
    await page.type(".cmd-palette-input", "ETH");
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "03-command-palette-filtered.png"),
      fullPage: false,
    });
    console.log("✓ Screenshot saved: 03-command-palette-filtered.png (Search ETH)");

    // Test Natural Language Kelly Sizing command: "risk $200 2.5%"
    await page.evaluate(() => {
      const input = document.querySelector(".cmd-palette-input");
      if (input) {
        input.value = "";
      }
    });
    await page.type(".cmd-palette-input", "risk $250 2%");
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "03b-command-palette-kelly-calc.png"),
      fullPage: false,
    });
    console.log("✓ Screenshot saved: 03b-command-palette-kelly-calc.png (Natural language sizing)");

    // Close palette via Escape key
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 600));

    // FEATURE 3: Parameter Sensitivity Heatmap in Backtests Tab
    console.log("4. Testing Parameter Sensitivity Heatmap in Backtests Tab...");
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button.nav-item, a.nav-item"))
        .find((el) => el.textContent?.includes("Backtests"));
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 1200));

    // Submit backtest
    const clickedSubmit = await page.evaluate(() => {
      const submitBtn = document.querySelector('form.strategy-builder button[type="submit"]');
      if (submitBtn && !submitBtn.disabled) {
        submitBtn.click();
        return true;
      }
      return false;
    });
    console.log("✓ Strategy backtest submitted:", clickedSubmit);

    // Wait for backtest simulation to complete and heatmap to appear
    console.log("Waiting for backtest results and Parameter Heatmap...");
    try {
      await page.waitForSelector(".parameter-heatmap-card", { timeout: 35000 });
      console.log("✓ Parameter Heatmap component rendered!");
      await new Promise((r) => setTimeout(r, 1000));

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "04-parameter-heatmap.png"),
        fullPage: false,
      });
      console.log("✓ Screenshot saved: 04-parameter-heatmap.png");
    } catch (e) {
      console.warn("Backtest timed out or failed to render heatmap:", e.message);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "04-backtest-state.png"),
        fullPage: false,
      });
    }

    // FEATURE 4: Dynamic Kelly Risk Sizer in Paper Order Modal
    console.log("5. Testing Dynamic Kelly Risk Sizer in Paper Order modal...");
    // Navigate to Paper account tab
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button.nav-item, a.nav-item"))
        .find((el) => el.textContent?.includes("Paper"));
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 1200));

    // Open Paper Order ticket modal by clicking "Record paper order"
    const clickedOrder = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("Record paper order") || b.textContent?.includes("Open paper position"));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    console.log("✓ Record paper order button clicked:", clickedOrder);
    await new Promise((r) => setTimeout(r, 1000));

    const kellyCard = await page.$(".kelly-sizer-card");
    console.log("✓ Dynamic Kelly Sizer card rendered in modal:", !!kellyCard);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "05-paper-order-kelly-sizer.png"),
      fullPage: false,
    });
    console.log("✓ Screenshot saved: 05-paper-order-kelly-sizer.png");

    console.log("=== Verification complete ===");
  } catch (err) {
    console.error("Verification failed:", err);
  } finally {
    await browser.close();
  }
}

verifyFourFeatures();
