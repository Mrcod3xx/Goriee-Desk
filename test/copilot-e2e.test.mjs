import test from "node:test";
import assert from "node:assert/strict";
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

test("Copilot E2E: Interactive Verification of Strategy Copilot Drawer", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-copilot-"));
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
  const browserErrors = [];
  page.on("pageerror", (err) => {
    console.log("BROWSER ERROR:", err.message);
    browserErrors.push(err.message);
  });

  try {
    await t.test("Copilot: Button Triggers & Drawer Open/Close via Click and Hotkey", async () => {
      console.log("Navigating to", BASE_URL);
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 25000 });

      // Acknowledge notice modal if present
      const continueBtn = await page.waitForSelector("#demo-notice-continue-btn", { timeout: 8000 }).catch(() => null);
      if (continueBtn) {
        await continueBtn.click();
        await page.waitForFunction(() => !document.querySelector(".demo-notice-modal"), { timeout: 5000 });
      }

      // Verify header button and floating button exist
      await page.waitForSelector(".desk-copilot-header-btn", { timeout: 10000 });
      await page.waitForSelector(".floating-copilot-trigger", { timeout: 10000 });

      const headerBtnText = await page.$eval(".desk-copilot-header-btn", (el) => el.textContent);
      assert.ok(headerBtnText.includes("AI Copilot"), "Header button must display 'AI Copilot'");
      assert.ok(headerBtnText.includes("Ctrl+J"), "Header button must indicate Ctrl+J hotkey");

      // Drawer should not be visible initially
      let drawer = await page.$(".copilot-drawer");
      assert.equal(drawer, null, "Copilot drawer should initially be closed");

      // 1. Open drawer via topbar button click
      await page.click(".desk-copilot-header-btn");
      await page.waitForSelector(".copilot-drawer", { timeout: 5000 });

      // Verify drawer header and components
      const title = await page.$eval(".copilot-title", (el) => el.textContent);
      assert.ok(title.includes("Strategy Copilot"), `Title expected 'Strategy Copilot', got: ${title}`);

      // Verify context pills are rendered
      await page.waitForSelector(".copilot-context-pills-bar", { timeout: 5000 });
      const pills = await page.$$(".context-pill");
      assert.equal(pills.length, 3, "Expected 3 toggleable context pills");

      // Verify prompt starters are rendered
      const starters = await page.$$(".starter-chip");
      assert.equal(starters.length, 4, "Expected 4 prompt starter buttons");

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "copilot_drawer_open.png") });

      // 2. Close drawer via Escape key
      await page.keyboard.press("Escape");
      await page.waitForSelector(".copilot-drawer", { hidden: true, timeout: 5000 });

      // 3. Open drawer via Ctrl+J hotkey
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyJ");
      await page.keyboard.up("Control");
      await page.waitForSelector(".copilot-drawer", { timeout: 5000 });

      // Verify textarea exists and is focusable
      const textarea = await page.$(".copilot-textarea");
      assert.ok(textarea !== null, "Copilot input textarea must exist");

      // Type a message in textarea
      await page.type(".copilot-textarea", "What is the key resistance level for BTC right now?");
      const inputVal = await page.$eval(".copilot-textarea", (el) => el.value);
      assert.ok(inputVal.includes("key resistance"), "Textarea should contain typed prompt");

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "copilot_input_typed.png") });

      // Close drawer via close icon button
      await page.click(".copilot-close-btn");
      await page.waitForSelector(".copilot-drawer", { hidden: true, timeout: 5000 });
    });

    await t.test("Copilot: Mobile Viewport (390px) Bottom Sheet Reflow", async () => {
      await page.setViewport({ width: 390, height: 844 });
      await new Promise((r) => setTimeout(r, 200));
      await page.waitForSelector(".floating-copilot-trigger", { timeout: 5000 });

      // Open drawer on mobile via floating trigger
      await page.evaluate(() => {
        const btn = document.querySelector(".floating-copilot-trigger");
        if (btn) btn.click();
      });
      await page.waitForSelector(".copilot-drawer", { timeout: 5000 });

      // Verify no horizontal document overflow
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const innerWidth = await page.evaluate(() => window.innerWidth);
      assert.ok(scrollWidth <= innerWidth + 1, `Mobile view has horizontal overflow: ${scrollWidth} > ${innerWidth}`);

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "copilot_mobile_sheet.png") });

      // Close mobile drawer
      await page.click(".copilot-close-btn");
      await page.waitForSelector(".copilot-drawer", { hidden: true, timeout: 5000 });
    });

    await t.test("Copilot: 1-Click Action Card Execution into Order Ticket", async () => {
      await page.setViewport({ width: 1440, height: 960 });

      // Seed localStorage with an action card session
      const seedSession = [{
        id: "seed_session_1",
        title: "BTC Long Setup",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        symbol: "BTCUSDT",
        messages: [
          {
            id: "msg_u1",
            role: "user",
            content: "Recommend a trade setup for BTC",
            timestamp: Date.now() - 5000,
          },
          {
            id: "msg_a1",
            role: "assistant",
            content: "Based on 1H compression, here is the recommended long setup:",
            timestamp: Date.now() - 1000,
            actions: [
              {
                type: "order",
                symbol: "BTCUSDT",
                side: "buy",
                amount: 350,
                takeProfitPrice: 88000,
                stopLossPrice: 82000,
                kellySizePercent: 3.5,
                reason: "Coiling into volatility expansion with 2.8:1 reward-to-risk ratio",
              },
            ],
          },
        ],
      }];

      await page.evaluate((data) => {
        window.localStorage.setItem("goriee_copilot_sessions_v1", JSON.stringify(data));
        window.localStorage.setItem("goriee.demo-disclaimer-acknowledged.v1", "true");
      }, seedSession);

      // Reload page to pick up seeded localStorage
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 25000 });

      // Open Copilot drawer
      await page.click(".desk-copilot-header-btn");
      await page.waitForSelector(".copilot-drawer", { timeout: 5000 });

      // Verify Action Card is rendered
      await page.waitForSelector(".copilot-action-card", { timeout: 5000 });
      const cardTag = await page.$eval(".copilot-card-tag", (el) => el.textContent);
      assert.ok(cardTag.includes("PROPOSED LONG"), `Expected action card tag PROPOSED LONG, got: ${cardTag}`);
      const cardSym = await page.$eval(".copilot-card-sym", (el) => el.textContent);
      assert.equal(cardSym, "BTCUSDT");

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "copilot_action_card_rendered.png") });

      // Click "Load into Order Ticket" button
      await page.waitForSelector(".copilot-execute-btn", { timeout: 5000 });
      await page.click(".copilot-execute-btn");

      // Verify the native Order Modal opened with the loaded parameters
      await page.waitForSelector(".order-modal", { timeout: 5000 });
      const orderAmountVal = await page.$eval("#order-amount", (el) => el.value);
      assert.equal(orderAmountVal, "350", `Expected order amount 350, got: ${orderAmountVal}`);

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "copilot_order_modal_loaded.png") });
    });

    assert.equal(browserErrors.length, 0, `Browser errors detected: ${browserErrors.join("; ")}`);
  } finally {
    await browser.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore temp dir cleanup errors
    }
  }
});
