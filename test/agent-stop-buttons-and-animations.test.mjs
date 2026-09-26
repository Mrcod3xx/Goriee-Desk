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

test("Agent Stop Buttons & Animations: End-to-End Verification", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-stop-test-"));
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
    await t.test("1. Copilot Thinking Animation & Stop Button Verification", async () => {
      console.log("Navigating to", BASE_URL);
      await page.goto(BASE_URL, { waitUntil: "networkidle0", timeout: 25000 });

      // Open Strategy Copilot
      await page.waitForSelector(".desk-copilot-header-btn", { timeout: 10000 });
      await page.click(".desk-copilot-header-btn");
      await page.waitForSelector(".copilot-drawer", { timeout: 5000 });

      // Type a query in Copilot
      await page.type(".copilot-textarea", "Assess breakout vs false break on BTCUSDT");

      // Intercept /api/copilot/chat to simulate real latency and verify thinking animation
      let chatRequested = false;
      await page.setRequestInterception(true);
      const onIntercept = async (req) => {
        if (req.url().includes("/api/copilot/chat")) {
          chatRequested = true;
          // Hold request for 2 seconds to inspect thinking animation and stop button
          await new Promise((r) => setTimeout(r, 2000));
          req.respond({
            status: 200,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
            body: "BTCUSDT is currently testing the $67,500 resistance band. Volume is expanding.",
          });
        } else {
          req.continue();
        }
      };
      page.on("request", onIntercept);

      // Click Send button
      await page.click(".copilot-send-button");

      // Immediately verify the thinking state and animations are displayed
      await page.waitForSelector(".copilot-thinking-state", { timeout: 2000 });
      await page.waitForSelector(".thinking-shimmer-wave", { timeout: 2000 });
      await page.waitForSelector(".thinking-beacon", { timeout: 2000 });
      await page.waitForSelector(".thinking-pulse-ring", { timeout: 2000 });
      await page.waitForSelector(".thinking-dots-anim", { timeout: 2000 });

      // Verify the stop buttons are present:
      // a) Strip stop button in message bubble header
      await page.waitForSelector(".copilot-stop-strip-btn", { timeout: 2000 });
      const stripStopText = await page.$eval(".copilot-stop-strip-btn", (el) => el.textContent.trim());
      assert.ok(stripStopText.includes("Stop"), `Expected 'Stop', got '${stripStopText}'`);

      // b) Input bar active Stop button
      await page.waitForSelector(".copilot-stop-btn", { timeout: 2000 });
      const inputStopText = await page.$eval(".copilot-stop-btn", (el) => el.textContent.trim());
      assert.ok(inputStopText.includes("Stop"), `Expected 'Stop', got '${inputStopText}'`);

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "copilot_thinking_and_stop_active.png") });

      // Click the stop button to test stream abort
      await page.click(".copilot-stop-btn");

      // Verify streaming state resets cleanly: stop button disappears, textarea is enabled
      await page.waitForFunction(() => !document.querySelector(".copilot-stop-btn"), { timeout: 3000 });
      const textareaDisabled = await page.$eval(".copilot-textarea", (el) => el.disabled);
      assert.equal(textareaDisabled, false, "Textarea must be re-enabled after Stop");

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "copilot_stopped_cleanly.png") });

      // Remove request interception
      page.off("request", onIntercept);
      await page.setRequestInterception(false);

      // Close copilot drawer
      await page.click(".copilot-close-btn");
      await page.waitForSelector(".copilot-drawer", { hidden: true, timeout: 5000 });
    });

    await t.test("2. Market Desk 'Ask the Desk' Stop Agent Button Verification", async () => {
      // Ensure we are on Market Desk view
      await page.evaluate(() => {
        const deskNav = Array.from(document.querySelectorAll(".nav-item")).find((el) => el.textContent.includes("Market Desk"));
        if (deskNav) deskNav.click();
      });

      await page.waitForSelector(".research-form", { timeout: 5000 });

      // Intercept /api/research to hold it in loading state
      await page.setRequestInterception(true);
      let researchReqCount = 0;
      const onResearchIntercept = async (req) => {
        if (req.url().includes("/api/research")) {
          researchReqCount++;
          // Delay for 3 seconds
          await new Promise((r) => setTimeout(r, 3000));
          req.respond({
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              report: {
                id: "test-rep-" + Date.now(),
                question: "Analyze BTCUSDT",
                symbol: "BTCUSDT",
                interval: "1H",
                summary: "Bullish structure intact.",
                indicators: { regime: "Bullish structure" },
                market: { price: 67000, change24h: 1.5, high24h: 68000, low24h: 66000, volume24h: 12000, turnover24h: 800000000, asOf: Date.now() },
                bullCase: "Continuation above EMA 20.",
                bearCase: "Loss of 66k shelf.",
                invalidation: "Hourly close below 65.5k.",
                engine: "qwen-2.5",
                commentary: "Institutional liquidity accumulating.",
                newsContext: "",
                sources: [],
                webResearchIncluded: false,
                createdAt: Date.now(),
              },
            }),
          });
        } else {
          req.continue();
        }
      };
      page.on("request", onResearchIntercept);

      // Trigger research on Market Desk
      await page.click(".research-submit");

      // Verify Stop Agent button appears in loading action group
      await page.waitForSelector(".research-loading-actions .research-cancel-btn", { timeout: 3000 });
      const stopAgentText = await page.$eval(".research-loading-actions .research-cancel-btn", (el) => el.textContent.trim());
      assert.ok(stopAgentText.includes("Stop Agent"), `Expected Stop Agent text, got '${stopAgentText}'`);

      // Verify ResearchLoadingStatus has stop button
      await page.waitForSelector(".research-loading-card .research-stop-btn", { timeout: 3000 });

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "market_desk_stop_agent_active.png") });

      // Click Stop Agent button
      await page.click(".research-loading-actions .research-cancel-btn");

      // Verify loading state is cancelled immediately
      await page.waitForSelector(".research-loading-actions", { hidden: true, timeout: 3000 });
      const submitBtn = await page.$(".research-submit:not(.is-loading)");
      assert.ok(submitBtn !== null, "Submit button should return to normal active state");

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "market_desk_agent_stopped.png") });

      page.off("request", onResearchIntercept);
      await page.setRequestInterception(false);
    });

    await t.test("3. Research Tab & Backtest Tab Stop Buttons Verification", async () => {
      // Navigate to Research tab
      await page.evaluate(() => {
        const nav = Array.from(document.querySelectorAll(".nav-item")).find((el) => el.textContent.includes("Research"));
        if (nav) nav.click();
      });

      await page.waitForSelector(".research-submit-btn", { timeout: 5000 });

      // Intercept /api/research
      await page.setRequestInterception(true);
      const onResearchTabIntercept = async (req) => {
        if (req.url().includes("/api/research")) {
          await new Promise((r) => setTimeout(r, 3000));
          req.respond({
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
        } else {
          req.continue();
        }
      };
      page.on("request", onResearchTabIntercept);

      // Click Research button
      await page.click(".research-submit-btn");

      // Verify Stop Agent button on Research Tab
      await page.waitForSelector(".research-loading-actions .research-cancel-btn", { timeout: 3000 });
      await page.waitForSelector(".research-skeleton-card .research-stop-btn", { timeout: 3000 });

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "research_tab_stop_active.png") });

      // Click Stop Agent on Research skeleton card
      await page.click(".research-skeleton-card .research-stop-btn");
      await page.waitForSelector(".research-skeleton-card", { hidden: true, timeout: 3000 });

      page.off("request", onResearchTabIntercept);
      await page.setRequestInterception(false);

      // Navigate to Backtests tab
      await page.evaluate(() => {
        const nav = Array.from(document.querySelectorAll(".nav-item")).find((el) => el.textContent.includes("Backtests"));
        if (nav) nav.click();
      });

      await page.waitForSelector(".strategy-builder-footer", { timeout: 5000 });

      // Intercept /api/backtest
      await page.setRequestInterception(true);
      const onBacktestIntercept = async (req) => {
        if (req.url().includes("/api/backtest")) {
          await new Promise((r) => setTimeout(r, 3000));
          req.respond({
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
        } else {
          req.continue();
        }
      };
      page.on("request", onBacktestIntercept);

      // Click backtest submit
      await page.click(".strategy-builder-footer button[type='submit']");

      // Verify Stop Backtest button in footer and in BacktestLoadingStatus
      await page.waitForSelector(".backtest-loading-actions .research-cancel-btn", { timeout: 3000 });
      const backtestStopText = await page.$eval(".backtest-loading-actions .research-cancel-btn", (el) => el.textContent.trim());
      assert.ok(backtestStopText.includes("Stop Backtest"), `Expected 'Stop Backtest', got '${backtestStopText}'`);
      await page.waitForSelector(".backtest-loading-card .research-stop-btn", { timeout: 3000 });

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "backtest_stop_active.png") });

      // Click Stop Backtest
      await page.click(".backtest-loading-actions .research-cancel-btn");
      await page.waitForSelector(".backtest-loading-card", { hidden: true, timeout: 3000 });

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "backtest_stopped.png") });

      page.off("request", onBacktestIntercept);
      await page.setRequestInterception(false);
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
