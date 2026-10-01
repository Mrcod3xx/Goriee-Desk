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

test("E2E Browser: Comprehensive UI and Workflow Validation", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-e2e-"));
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
  page.on("pageerror", (err) => console.log("BROWSER ERROR:", err.message));

  try {
    // ---------------------------------------------------------
    // 1. Desk View: Load & Header Verification
    // ---------------------------------------------------------
    await t.test("Desk: Load and Header Elements", async () => {
      console.log("Navigating to", BASE_URL);
      await page.goto(BASE_URL, { waitUntil: "networkidle0", timeout: 25000 });
      const title = await page.title();
      assert.ok(title.includes("Goriee AI Desk"), `Title expected to contain 'Goriee AI Desk', got: ${title}`);

      // Check header brand
      const brandText = await page.$eval(".brand-name", (el) => el.textContent);
      assert.ok(brandText.includes("goriee"), "Brand must display goriee");

      // Verify watchlist rows are rendered
      await page.waitForSelector(".watch-row", { timeout: 10000 });
      const watchRows = await page.$$(".watch-row");
      assert.ok(watchRows.length >= 3, `Expected at least 3 watchlist rows, found ${watchRows.length}`);
      
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "01_desk_initial.png") });
    });

    // ---------------------------------------------------------
    // 2. Desk View: Candlestick Chart, Controls & Crosshair
    // ---------------------------------------------------------
    await t.test("Desk: Candlestick Chart, Mode Toggle & Crosshair Inspection", async () => {
      // Ensure interactive price chart SVG is present
      await page.waitForSelector("svg.interactive-price-chart", { timeout: 15000 });
      const candleBars = await page.$$("rect.candle-body");
      assert.ok(candleBars.length > 20, `Expected candlestick bodies in chart, found ${candleBars.length}`);

      // Check volume bars
      const volBars = await page.$$("rect.chart-vol-up, rect.chart-vol-down");
      assert.ok(volBars.length > 20, `Expected volume bars in chart, found ${volBars.length}`);

      // Check Chart Mode toggle (Candles vs Line)
      const pillButtons = await page.$$(".chart-pill-btn");
      assert.ok(pillButtons.length >= 2, "Expected chart pill buttons");

      // Click Line mode
      const lineBtn = (await Promise.all(
        pillButtons.map(async (btn) => {
          const text = await btn.evaluate((el) => el.textContent?.trim());
          return text === "Line" ? btn : null;
        })
      )).find(Boolean);

      assert.ok(lineBtn, "Line button must exist");
      await lineBtn.click();
      await page.waitForSelector("path.chart-line", { timeout: 5000 });
      const lineExists = await page.$("path.chart-line");
      assert.ok(lineExists !== null, "Line chart path should exist in Line mode");

      // Switch back to Candles mode
      const candlesBtn = (await Promise.all(
        pillButtons.map(async (btn) => {
          const text = await btn.evaluate((el) => el.textContent?.trim());
          return text === "Candles" ? btn : null;
        })
      )).find(Boolean);

      assert.ok(candlesBtn, "Candles button must exist");
      await candlesBtn.click();
      await page.waitForSelector("rect.candle-body", { timeout: 5000 });

      // Test Crosshair hover on SVG
      const chartBox = await page.$eval("svg.interactive-price-chart", (el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width * 0.65, y: rect.y + rect.height * 0.5 };
      });
      await page.mouse.move(chartBox.x, chartBox.y);
      await new Promise((r) => setTimeout(r, 200));

      const hoverPillText = await page.$eval(".chart-hover-pill", (el) => el.textContent);
      assert.ok(hoverPillText.includes("O:"), `Inspection bar should have Open price, got: ${hoverPillText}`);
      assert.ok(hoverPillText.includes("H:"), `Inspection bar should have High price, got: ${hoverPillText}`);
      assert.ok(hoverPillText.includes("C:"), `Inspection bar should have Close price, got: ${hoverPillText}`);
      assert.ok(hoverPillText.includes("Vol:"), `Inspection bar should have Volume, got: ${hoverPillText}`);

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "02_chart_crosshair.png") });
    });

    // ---------------------------------------------------------
    // 3. Desk View: Market Reading Technical Signals
    // ---------------------------------------------------------
    await t.test("Desk: Market Reading Technical Signals", async () => {
      await page.waitForSelector(".market-reading", { timeout: 5000 });
      const readingText = await page.$eval(".market-reading", (el) => el.textContent);
      assert.ok(readingText.includes("Market reading"), "Market reading heading must exist");
      assert.ok(readingText.includes("Last price"), "Last price must exist in reading");
      assert.ok(readingText.includes("24h move"), "24h move must exist in reading");
    });

    // ---------------------------------------------------------
    // 4. Scanner View: Table, Search & Quick Action Route
    // ---------------------------------------------------------
    await t.test("Scanner: Table Rendering, Filter & Route to Backtest", async () => {
      // Find navigation button for "Market scanner"
      const navButtons = await page.$$(".primary-nav .nav-item");
      await navButtons[1].click(); // Market scanner is item index 1
      await new Promise((r) => setTimeout(r, 600));

      // Wait for scanner rows
      await page.waitForSelector(".scanner-results, .scanner-workspace", { timeout: 15000 });
      await page.waitForSelector(".scanner-row", { timeout: 15000 });
      const rows = await page.$$(".scanner-row");
      assert.ok(rows.length >= 10, `Expected at least 10 scanner rows, found ${rows.length}`);

      // Test Search Filter input
      const searchInput = await page.$(".scanner-search-field input");
      if (searchInput) {
        await searchInput.type("SOL");
        await new Promise((r) => setTimeout(r, 400));
        const filteredRows = await page.$$(".scanner-row");
        assert.ok(filteredRows.length > 0, "Should have matching rows for SOL");
      }

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "03_scanner_filtered.png") });

      // Click "Backtest" quick-action button in the row
      const backtestBtn = await page.$(".scanner-action-button.scanner-action-backtest");
      if (backtestBtn) {
        await backtestBtn.click();
        await new Promise((r) => setTimeout(r, 800));

        // Verify active view switched to backtests and symbol is selected
        const selectedSymbol = await page.$eval("#backtest-symbol", (el) => el.value);
        assert.ok(selectedSymbol.includes("SOL"), `Expected backtest symbol to be prefilled with SOL, got ${selectedSymbol}`);
      }
    });

    // ---------------------------------------------------------
    // 5. Backtest View: Dual Curve & Credibility Scorecard
    // ---------------------------------------------------------
    await t.test("Backtests: Run Simulation, Dual Curve & Scorecard Verification", async () => {
      // Navigate to Backtests tab (index 3) if not already there
      const navButtons = await page.$$(".primary-nav .nav-item");
      await navButtons[3].click();
      await new Promise((r) => setTimeout(r, 500));

      // Pin the market for this subtest instead of inheriting whatever the Scanner
      // subtest left selected. Its "SOL" search matches tokenized assets first
      // (e.g. RSOLSUSDT), and those thin listings produce a single completed trade
      // over 30d at 1H. MonteCarloPanel needs >=2 completed trades, so it renders
      // its empty state under the same `.monte-carlo-panel` class and the verdict
      // banner never appears. BTCUSDT is in DEFAULT_WATCHLIST, so it is always an
      // option in the select and yields ~7 trades on the default EMA 20/50 prompt.
      await page.select("#backtest-symbol", "BTCUSDT");
      await new Promise((r) => setTimeout(r, 300));
      const pinnedSymbol = await page.$eval("#backtest-symbol", (el) => el.value);
      assert.equal(pinnedSymbol, "BTCUSDT", "Backtest subtest must control its own market");

      // Submit backtest form
      const submitBtn = await page.waitForSelector(".strategy-builder button[type='submit']", { timeout: 5000 });
      assert.ok(submitBtn !== null, "Submit backtest button should exist");
      await submitBtn.click();

      // Wait for backtest result to arrive (timeout 60s for AI model response)
      await page.waitForSelector(".backtest-credibility-panel", { timeout: 60000 });

      // Verify Dual Equity Chart exists
      const dualChart = await page.$("svg.equity-chart");
      assert.ok(dualChart !== null, "Dual Equity Chart SVG must be present");

      // Verify Strategy Alpha pill in legend
      const alphaPill = await page.$(".alpha-pill");
      assert.ok(alphaPill !== null, "Strategy Alpha indicator pill must be visible");
      const alphaText = await page.$eval(".alpha-pill", (el) => el.textContent);
      assert.ok(alphaText.includes("Alpha:"), `Alpha pill should display Alpha, got: ${alphaText}`);

      // Verify Institutional Credibility Scorecard
      const scorecard = await page.$(".backtest-credibility-panel");
      assert.ok(scorecard !== null, "Institutional Credibility Scorecard must be rendered");

      const ratingPill = await page.$(".rating-pill");
      assert.ok(ratingPill !== null, "Rating pill must exist");
      const ratingText = await page.$eval(".rating-pill", (el) => el.textContent);
      assert.ok(
        ratingText.includes("Positive sample checks") ||
        ratingText.includes("Mixed sample checks") ||
        ratingText.includes("Limited or weak sample") ||
        ratingText.includes("Institutional Quality") ||
        ratingText.includes("Reasonable Stability") ||
        ratingText.includes("Overfit"),
        `Scorecard must display a valid Robustness Rating tier, got: ${ratingText}`
      );

      const scorecardText = await page.$eval(".backtest-credibility-panel", (el) => el.textContent);
      assert.ok(scorecardText.includes("Strategy Alpha"), "Scorecard must display Strategy Alpha");
      assert.ok(scorecardText.includes("Breakeven Cost Ceiling") || scorecardText.includes("Breakeven"), "Scorecard must display Breakeven");

      // Verify Monte Carlo Stress Testing Panel
      const monteCarloPanel = await page.waitForSelector(".monte-carlo-panel", { timeout: 8000 });
      assert.ok(monteCarloPanel !== null, "Monte Carlo Stress Testing Panel should be rendered");
      const mcVerdict = await page.$(".mc-verdict-banner");
      assert.ok(mcVerdict !== null, "Monte Carlo verdict banner should be visible");
      const mcFan = await page.$("svg.mc-fan-svg");
      assert.ok(mcFan !== null, "Monte Carlo confidence cone SVG fan chart should be present");

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "04_backtest_results.png") });
    });

    // ---------------------------------------------------------
    // 6. Paper Desk View: Sizing Presets, Order Execution & CSV
    // ---------------------------------------------------------
    await t.test("Paper Desk: Sizing Presets, Execution & Cumulative Curve", async () => {
      // Switch to Paper Desk tab
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll(".primary-nav .nav-item")).find((b) => b.textContent.includes("Paper account"));
        btn?.click();
      });
      await new Promise((r) => setTimeout(r, 600));

      // Check Portfolio Summary stats
      const cashText = await page.$eval(".account-balance strong", (el) => el.textContent);
      assert.ok(cashText.includes("$"), `Cash balance should have $, got: ${cashText}`);

      // Click "Record paper order" button to open modal
      const recordBtn = await page.waitForSelector(".paper-heading-actions button.button-primary", { timeout: 5000 });
      await recordBtn.click();
      await new Promise((r) => setTimeout(r, 400));

      // Verify Order Modal is open
      await page.waitForSelector(".order-modal", { timeout: 5000 });

      // Verify Sizing Preset Buttons (25%, 50%, 75%, Max)
      const sizingButtons = await page.$$(".sizing-presets button.sizing-btn");
      assert.equal(sizingButtons.length, 4, `Expected 4 sizing preset buttons, got ${sizingButtons.length}`);

      // Click 50% preset
      await sizingButtons[1].click(); // 50%
      await new Promise((r) => setTimeout(r, 200));

      // Verify concentration alert appears (>25% allocation)
      const concentrationWarning = await page.$("p.concentration-warning");
      assert.ok(concentrationWarning !== null, "Concentration notice should appear when allocation exceeds 25%");

      // Test Escape key closes modal
      await page.keyboard.press("Escape");
      await new Promise((r) => setTimeout(r, 400));
      const modalClosed = await page.$(".order-modal");
      assert.equal(modalClosed, null, "Escape key should close the order modal");

      // Re-open modal and submit order
      await recordBtn.click();
      await page.waitForSelector(".order-modal", { timeout: 5000 });
      const sizingBtn25 = (await page.$$(".sizing-presets button.sizing-btn"))[0];
      await sizingBtn25.click(); // 25%

      const submitOrderBtn = await page.waitForSelector("button.modal-submit", { timeout: 5000 });
      await submitOrderBtn.click();
      await new Promise((r) => setTimeout(r, 800));

      // Verify order appears in paper order history
      const ordersTable = await page.$(".orders-panel table tbody tr");
      assert.ok(ordersTable !== null, "Paper order history should show the newly recorded fill");

      // Switch to "Trade review" tab
      const reviewTabToggle = await page.$(".paper-heading-actions button.button-secondary");
      if (reviewTabToggle) {
        await reviewTabToggle.click();
        await new Promise((r) => setTimeout(r, 500));

        const reviewControls = await page.$(".paper-review-controls");
        assert.ok(reviewControls !== null, "Trade review controls should be visible");
      }

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "05_paper_desk.png") });
    });

    // ---------------------------------------------------------
    // 6. Institutional Features: L2 Depth Ladder, 4-Chart Matrix & Brackets
    // ---------------------------------------------------------
    await t.test("Institutional Desk: L2 Depth Ladder, 4-Chart Matrix & Bracket Orders", async () => {
      // 1. Navigate back to Market Desk and select liquid market from Watchlist
      const navButtons = await page.$$(".primary-nav .nav-item");
      await navButtons[0].click();
      await page.waitForSelector(".desk-heading", { timeout: 10000 });

      // Ensure active depth by selecting first item in Watchlist (BTCUSDT)
      const firstWatchRow = await page.waitForSelector(".watch-row", { timeout: 5000 });
      await firstWatchRow.click();
      await new Promise((r) => setTimeout(r, 600));

      // 2. Test L2 Order Book Subtab
      const l2TabBtn = await page.waitForSelector(".desk-subtab-btn:nth-child(2)", { timeout: 5000 });
      assert.ok(l2TabBtn, "L2 Depth Ladder subtab button should exist");
      await l2TabBtn.click();
      await new Promise((r) => setTimeout(r, 800));

      const orderbookPanel = await page.waitForSelector(".orderbook-panel", { timeout: 8000 });
      assert.ok(orderbookPanel, "OrderBookPanel should be displayed");

      const obiGauge = await page.waitForSelector(".obi-gauge-container", { timeout: 8000 });
      assert.ok(obiGauge !== null, "Order Book Imbalance (OBI) gauge must be rendered");

      // Check ladder rows (allow live stream fetch to resolve)
      await page.waitForSelector(".ladder-row", { timeout: 15000 });
      const ladderRows = await page.$$(".ladder-row");
      assert.ok(ladderRows.length >= 6, `Expected at least 6 order book ladder levels, got ${ladderRows.length}`);

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "06_l2_depth_ladder.png") });

      // 3. Test 4-Chart Matrix Grid Toggle
      const matrixToggleBtn = await page.waitForSelector(".desk-view-toggle button:nth-child(2)", { timeout: 5000 });
      assert.ok(matrixToggleBtn, "4-Chart Matrix toggle button should exist");
      await matrixToggleBtn.click();
      await new Promise((r) => setTimeout(r, 1000));

      const multiGrid = await page.waitForSelector(".multi-chart-grid", { timeout: 8000 });
      assert.ok(multiGrid, "Multi-Chart Grid should be active");

      const miniTerminals = await page.$$(".mini-terminal-card");
      assert.equal(miniTerminals.length, 4, "Matrix Grid must display exactly 4 mini terminals");

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "07_matrix_grid.png") });

      // Switch back to Single Terminal
      const singleToggleBtn = await page.waitForSelector(".desk-view-toggle button:nth-child(1)", { timeout: 5000 });
      await singleToggleBtn.click();
      await new Promise((r) => setTimeout(r, 800));

      // 4. Test Paper Bracket Orders
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll(".primary-nav .nav-item")).find((b) => b.textContent.includes("Paper account"));
        btn?.click();
      });
      await page.waitForSelector(".paper-heading", { timeout: 8000 });

      // If in review mode, switch back to account overview
      const accountOverviewBtn = await page.$(".paper-heading-actions button.button-secondary");
      const btnText = await accountOverviewBtn?.evaluate((el) => el.textContent);
      if (btnText && btnText.includes("Account overview")) {
        await accountOverviewBtn.click();
        await new Promise((r) => setTimeout(r, 500));
      }

      const recordOrderBtn = await page.waitForSelector(".paper-heading-actions button.button-primary", { timeout: 5000 });
      await recordOrderBtn.click();
      await page.waitForSelector(".order-modal", { timeout: 5000 });

      const bracketCheckbox = await page.waitForSelector(".bracket-checkbox-label input[type='checkbox']", { timeout: 5000 });
      assert.ok(bracketCheckbox, "Bracket order toggle checkbox should exist");
      await bracketCheckbox.click();
      await new Promise((r) => setTimeout(r, 300));

      const bracketFields = await page.$(".bracket-fields-grid");
      assert.ok(bracketFields !== null, "Bracket inputs (TP, SL, Trail) should be visible when attached");

      const rrrBadge = await page.$(".bracket-preview-badge");
      assert.ok(rrrBadge !== null, "Risk-to-Reward Ratio preview badge should be calculated");

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "08_bracket_order_form.png") });

      // Close modal
      await page.keyboard.press("Escape");
    });

  } finally {
    await browser.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
});
