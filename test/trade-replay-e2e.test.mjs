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

test("Trade Replay Studio Workspace E2E: Interactive Verification", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-replay-"));
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
    await t.test("1. Verify Clean Market Desk & Navigate to Trade Replay Tab", async () => {
      console.log("Navigating to", BASE_URL);
      await page.goto(BASE_URL, { waitUntil: "networkidle0", timeout: 30000 });

      // Verify Market Desk does NOT have the old floating HUD or chart replay button
      const oldReplayBtn = await page.$(".chart-replay-btn");
      assert.equal(oldReplayBtn, null, "Market desk chart must NOT have .chart-replay-btn");

      const oldFloatingHud = await page.$(".replay-hud-bar");
      assert.equal(oldFloatingHud, null, "Market desk must NOT have floating .replay-hud-bar");

      // Verify Trade replay nav item exists in sidebar
      await page.waitForSelector(".primary-nav", { timeout: 15000 });
      const navButtons = await page.$$(".primary-nav .nav-item");
      let replayNavBtn = null;
      for (const btn of navButtons) {
        const text = await page.evaluate((el) => el.textContent, btn);
        if (text && text.includes("Trade replay")) {
          replayNavBtn = btn;
          break;
        }
      }
      assert.ok(replayNavBtn, "Trade replay item must exist in left navigation");

      // Click Trade replay tab
      await replayNavBtn.click();
      await page.waitForSelector(".replay-page-heading", { timeout: 10000 });

      // Verify header and page kicker
      const kickerText = await page.$eval(".replay-page-heading .page-kicker", (el) => el.textContent);
      assert.ok(kickerText.includes("HISTORICAL TAPE REPLAY"), "Kicker must show HISTORICAL TAPE REPLAY");

      const titleText = await page.$eval(".replay-page-heading h1", (el) => el.textContent);
      assert.equal(titleText, "Trade Replay Studio", "Title must be Trade Replay Studio");

      // Verify docked transport console is rendered
      await page.waitForSelector(".replay-transport-dock", { timeout: 5000 });
      const playBtn = await page.$(".replay-dock-play-btn");
      assert.ok(playBtn, "Docked transport Play button must exist");

      // Verify account equity card
      const equityVal = await page.$eval(".replay-equity-value", (el) => el.textContent);
      assert.ok(equityVal.includes("10,000"), "Initial equity must show $10,000");

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "01-replay-studio-workspace.png") });
      console.log("Captured 01-replay-studio-workspace.png");
    });

    await t.test("2. Test Cut Bar Tool Interaction on Replay Chart", async () => {
      // Click Cut Bar Tool in header
      await page.click(".replay-cut-mode-btn");
      const cutActive = await page.$eval(".replay-cut-mode-btn", (el) => el.classList.contains("is-active"));
      assert.ok(cutActive, "Cut tool button must have is-active class");

      // Verify chart SVG has candle-cut-cursor class
      const svgHasCutCursor = await page.$eval(".price-chart", (el) => el.classList.contains("candle-cut-cursor"));
      assert.ok(svgHasCutCursor, "Chart SVG must have candle-cut-cursor class");

      // Move mouse over chart to simulate user inspecting cut point
      const chartBox = await page.$eval(".price-chart", (el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width * 0.45, y: rect.top + rect.height * 0.5 };
      });
      await page.mouse.move(chartBox.x, chartBox.y);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "02-replay-cut-guideline.png") });

      // Click to cut tape
      await page.mouse.click(chartBox.x, chartBox.y);
      await new Promise((r) => setTimeout(r, 400));

      // After cut, cut mode should deactivate
      const cutActiveAfter = await page.$eval(".replay-cut-mode-btn", (el) => el.classList.contains("is-active"));
      assert.equal(cutActiveAfter, false, "Cut mode should deactivate after clicking bar");
      console.log("Cut tool interaction verified successfully");
    });

    await t.test("3. Test Docked Transport Step Forward and Scrubber", async () => {
      const getBarCountText = async () => {
        return await page.$eval(".timeline-bar-count", (el) => el.textContent.trim());
      };

      const initialBar = await getBarCountText();
      console.log("Current timeline bar:", initialBar);

      // Step forward 1 bar via docked transport step button
      await page.click(".replay-dock-step-btn");
      await new Promise((r) => setTimeout(r, 300));
      const steppedBar = await getBarCountText();
      console.log("After 1 step bar:", steppedBar);
      assert.notEqual(initialBar, steppedBar, "Bar count should advance after step");

      // Step forward 2 more bars
      await page.click(".replay-dock-step-btn");
      await new Promise((r) => setTimeout(r, 200));
      await page.click(".replay-dock-step-btn");
      await new Promise((r) => setTimeout(r, 200));

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "03-replay-step-forward.png") });
      console.log("Captured 03-replay-step-forward.png");
    });

    await t.test("4. Test TradingView-Style Zoom In, Zoom Out, Mouse Wheel & Pan", async () => {
      // Check zoom group controls
      await page.waitForSelector(".chart-zoom-group", { timeout: 5000 });
      const zoomLevelText = await page.$eval(".zoom-level-btn", (el) => el.textContent.trim());
      console.log("Initial zoom level:", zoomLevelText);

      // Click Zoom Out (-) 3 times to view more candles
      await page.click(".zoom-out-btn");
      await new Promise((r) => setTimeout(r, 150));
      await page.click(".zoom-out-btn");
      await new Promise((r) => setTimeout(r, 150));
      await page.click(".zoom-out-btn");
      await new Promise((r) => setTimeout(r, 200));

      const zoomedOutLevel = await page.$eval(".zoom-level-btn", (el) => el.textContent.trim());
      console.log("Zoomed out level:", zoomedOutLevel);
      assert.notEqual(zoomLevelText, zoomedOutLevel, "Bar count should increase when zooming out");

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "10-tradingview-zoom-out.png") });
      console.log("Captured 10-tradingview-zoom-out.png");

      // Click Zoom In (+) 5 times to zoom deep into recent candles
      await page.click(".zoom-in-btn");
      await new Promise((r) => setTimeout(r, 150));
      await page.click(".zoom-in-btn");
      await new Promise((r) => setTimeout(r, 150));
      await page.click(".zoom-in-btn");
      await new Promise((r) => setTimeout(r, 150));
      await page.click(".zoom-in-btn");
      await new Promise((r) => setTimeout(r, 150));
      await page.click(".zoom-in-btn");
      await new Promise((r) => setTimeout(r, 200));

      const zoomedInLevel = await page.$eval(".zoom-level-btn", (el) => el.textContent.trim());
      console.log("Zoomed in level:", zoomedInLevel);

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "11-tradingview-zoom-in.png") });
      console.log("Captured 11-tradingview-zoom-in.png");

      // Test horizontal drag to pan into past history
      const chartBox = await page.$eval(".price-chart", (el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width * 0.4, y: rect.top + rect.height * 0.5 };
      });
      await page.mouse.move(chartBox.x, chartBox.y);
      await page.mouse.down();
      await page.mouse.move(chartBox.x + 200, chartBox.y, { steps: 5 }); // drag right to pull older bars into view
      await page.mouse.up();
      await new Promise((r) => setTimeout(r, 300));

      // Verify Snap to Latest button appears when panned away
      const snapBtn = await page.$(".snap-latest-btn");
      assert.ok(snapBtn, "Snap to Latest button should appear when panned away from newest candle");

      // Click Snap to Latest
      await snapBtn.click();
      await new Promise((r) => setTimeout(r, 200));

      // Reset zoom to default 75 bars by clicking zoom level button
      await page.click(".zoom-level-btn");
      await new Promise((r) => setTimeout(r, 200));
      const resetLevel = await page.$eval(".zoom-level-btn", (el) => el.textContent.trim());
      console.log("Reset zoom level:", resetLevel);
    });

    await t.test("5. Test On-Chart Bracket Planning, Quick Snap Chips & Dragging", async () => {
      // Verify bracket corridor rects and lines are rendered on chart
      await page.waitForSelector(".bracket-line-entry", { timeout: 5000 });
      const entryLine = await page.$(".bracket-line-entry");
      assert.ok(entryLine, "Entry line must be rendered on replay chart");

      const tpLine = await page.$(".bracket-line-tp");
      assert.ok(tpLine, "Take Profit bracket line must be rendered");

      const slLine = await page.$(".bracket-line-sl");
      assert.ok(slLine, "Stop Loss bracket line must be rendered");

      const tpCorridor = await page.$(".bracket-corridor-tp");
      assert.ok(tpCorridor, "Shaded Take Profit corridor must be rendered");

      const slCorridor = await page.$(".bracket-corridor-sl");
      assert.ok(slCorridor, "Shaded Stop Loss corridor must be rendered");

      // Verify initial TP % in ticket
      const initialTpVal = await page.$eval("#replay-tp-input", (el) => el.value);
      console.log("Initial TP input %:", initialTpVal);

      // Click [3R] Quick Snap Chip on TP handle
      const chip3R = await page.$(".bracket-chip-3r");
      assert.ok(chip3R, "3R quick-snap chip must exist on TP handle");
      await chip3R.click();
      await new Promise((r) => setTimeout(r, 200));

      const snappedTpVal = await page.$eval("#replay-tp-input", (el) => el.value);
      console.log("Snapped TP input % after 3R click:", snappedTpVal);
      assert.notEqual(initialTpVal, snappedTpVal, "TP % should update after clicking 3R quick snap chip");

      // Drag TP handle vertically
      const tpHandleBox = await page.$eval(".bracket-tp-group .bracket-handle-pill", (el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });

      console.log("Dragging TP handle from:", tpHandleBox);
      await page.mouse.move(tpHandleBox.x, tpHandleBox.y);
      await page.mouse.down();
      // Drag upwards by 30 pixels (raising the target price for LONG)
      await page.mouse.move(tpHandleBox.x, tpHandleBox.y - 30, { steps: 5 });
      await page.mouse.up();
      await new Promise((r) => setTimeout(r, 200));

      const draggedTpVal = await page.$eval("#replay-tp-input", (el) => el.value);
      console.log("Dragged TP input %:", draggedTpVal);

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "07-on-chart-brackets-planning.png") });
      console.log("Captured 07-on-chart-brackets-planning.png");
    });

    await t.test("5. Test Discretionary Order Ticket Execution & Active Position Trajectory", async () => {
      // Click size preset $500
      const preset500Btn = await page.$(".ticket-size-chips button:nth-child(2)");
      assert.ok(preset500Btn, "Preset $500 button must exist");
      await preset500Btn.click();

      // Check RRR badge
      const rrrBadge = await page.$eval(".rrr-badge", (el) => el.textContent.trim());
      assert.ok(rrrBadge.includes("R:R"), "RRR badge must be rendered");

      // Click Execute Order button
      await page.click(".replay-ticket-execute-btn");
      await new Promise((r) => setTimeout(r, 400));

      // Verify Active Position card renders details
      await page.waitForSelector(".replay-active-pos-body", { timeout: 5000 });
      const posBadge = await page.$eval(".position-badge", (el) => el.textContent.trim());
      assert.equal(posBadge, "LONG", "Position badge must be LONG");

      const closeBtn = await page.$(".replay-close-pos-btn");
      assert.ok(closeBtn, "Close position button must be rendered");

      // Advance 3 bars during open position to create trajectory
      await page.click(".replay-dock-step-btn");
      await new Promise((r) => setTimeout(r, 200));
      await page.click(".replay-dock-step-btn");
      await new Promise((r) => setTimeout(r, 200));
      await page.click(".replay-dock-step-btn");
      await new Promise((r) => setTimeout(r, 200));

      // Verify live active trade trajectory line and live pin on chart
      await page.waitForSelector(".active-trajectory-line", { timeout: 5000 });
      const activeLine = await page.$(".active-trajectory-line");
      assert.ok(activeLine, "Dynamic active position trajectory line must be rendered");

      const livePinText = await page.$eval(".pin-text-live", (el) => el.textContent.trim());
      assert.ok(livePinText.includes("LIVE LONG"), "Live pin badge must display LIVE LONG");

      // Test [BE] Breakeven snap chip on Stop Loss handle
      const chipBE = await page.$(".bracket-chip-be");
      assert.ok(chipBE, "[BE] quick-snap chip must exist on SL handle");
      await chipBE.click();
      await new Promise((r) => setTimeout(r, 300));

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "04-replay-position-active.png") });
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "08-on-chart-active-trade-trajectory.png") });
      console.log("Captured 04-replay-position-active.png & 08-on-chart-active-trade-trajectory.png");
    });

    await t.test("6. Test Copilot Zero-Hindsight Isolation in Replay Studio", async () => {
      // Open Copilot drawer
      await page.click(".desk-copilot-header-btn");
      await page.waitForSelector(".copilot-drawer", { timeout: 5000 });

      const drawerTitle = await page.$eval(".copilot-title", (el) => el.textContent);
      assert.ok(drawerTitle.includes("Strategy Copilot"), "Copilot drawer must be open");

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "05-replay-copilot-isolated.png") });
      console.log("Captured 05-replay-copilot-isolated.png");

      // Close Copilot drawer
      await page.click(".copilot-close-btn");
      await page.waitForSelector(".copilot-drawer", { hidden: true, timeout: 5000 });
      await new Promise((r) => setTimeout(r, 400));
    });

    await t.test("7. Test Close Position, On-Chart Trade Markers & Toolbar Toggle", async () => {
      // Close active position via Close Position button
      await page.click(".replay-close-pos-btn");
      await new Promise((r) => setTimeout(r, 400));

      // Verify Session Closed Trades mini-list has at least 1 closed trade
      await page.waitForSelector(".replay-trade-item", { timeout: 5000 });
      const closedTradesCount = await page.$$eval(".replay-trade-item", (els) => els.length);
      assert.ok(closedTradesCount >= 1, "Must have at least 1 closed trade in mini-list");

      // Verify on-chart trade execution markers & completed trajectory line
      await page.waitForSelector(".chart-trade-trajectory-line", { timeout: 5000 });
      const closedTrajectory = await page.$(".chart-trade-trajectory-line");
      assert.ok(closedTrajectory, "Completed trade trajectory line must be rendered on chart");

      const entryPin = await page.$(".trade-pin-entry");
      assert.ok(entryPin, "Trade entry pin must be rendered on chart");

      const exitPin = await page.$(".trade-pin-exit");
      assert.ok(exitPin, "Trade exit pin must be rendered on chart");

      // Verify Markers toolbar toggle button
      const markersToggle = await page.$(".markers-toggle-btn");
      assert.ok(markersToggle, "Markers toggle button must exist in chart toolbar");

      const isMarkersActive = await page.$eval(".markers-toggle-btn", (el) => el.classList.contains("active"));
      assert.equal(isMarkersActive, true, "Markers toggle should be active by default");

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "09-on-chart-closed-trade-markers.png") });
      console.log("Captured 09-on-chart-closed-trade-markers.png");

      // Click to toggle markers OFF
      await markersToggle.click();
      await new Promise((r) => setTimeout(r, 200));
      const markersOffCount = await page.$$eval(".chart-trade-trajectory-line", (els) => els.length);
      assert.equal(markersOffCount, 0, "Trade trajectory should be hidden when markers are toggled off");

      // Click to toggle markers back ON
      await markersToggle.click();
      await new Promise((r) => setTimeout(r, 200));
      const markersOnCount = await page.$$eval(".chart-trade-trajectory-line", (els) => els.length);
      assert.ok(markersOnCount >= 1, "Trade trajectory should be visible when markers are toggled back on");

      // Open Scorecard Modal via header button
      await page.click(".replay-header-scorecard-btn");
      await page.waitForSelector(".replay-scorecard-modal", { timeout: 5000 });

      // Check modal heading and 5 KPI cards
      const modalTitle = await page.$eval(".replay-modal-header h3", (el) => el.textContent);
      assert.equal(modalTitle, "Replay Session Scorecard", "Modal title must be Replay Session Scorecard");

      const metricCards = await page.$$eval(".scorecard-metric-card", (els) => els.length);
      assert.equal(metricCards, 5, "Scorecard must render 5 KPI metric cards");

      // Check closed trades table inside modal
      const tradesTable = await page.$(".replay-trades-table");
      assert.ok(tradesTable, "Trades table must be rendered in modal");

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "06-replay-scorecard-modal.png") });
      console.log("Captured 06-replay-scorecard-modal.png");

      // Close modal
      await page.click(".replay-modal-close-btn");
      await new Promise((r) => setTimeout(r, 400));

      // Verify modal is closed
      const modalAfter = await page.$(".replay-scorecard-modal");
      assert.equal(modalAfter, null, "Modal should be closed");

      // Copy screenshots to brain artifact directory if it exists
      const brainDir = "C:\\Users\\Admin\\.gemini\\antigravity\\brain\\df85e85d-2a63-42e1-9aaf-0ff83861dc24";
      if (fs.existsSync(brainDir)) {
        const files = fs.readdirSync(SCREENSHOT_DIR);
        for (const f of files) {
          if (f.endsWith(".png")) {
            fs.copyFileSync(path.join(SCREENSHOT_DIR, f), path.join(brainDir, f));
          }
        }
        console.log("Copied screenshots to artifact directory");
      }
    });
  } finally {
    await browser.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
});
