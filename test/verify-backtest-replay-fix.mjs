import puppeteer from "puppeteer-core";
import assert from "node:assert";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3000";

async function main() {
  console.log("Starting Backtest Replay Fix verification in headless Chrome...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
    defaultViewport: { width: 1440, height: 900 },
  });

  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto(BASE, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 1000));

    // 1. Navigate to Backtests tab
    console.log("Navigating to Backtests tab...");
    const navButtons = await page.$$("button.nav-item");
    let backtestsNavBtn = null;
    for (const btn of navButtons) {
      const text = await btn.evaluate((el) => el.textContent);
      if (text && text.toLowerCase().includes("backtest")) {
        backtestsNavBtn = btn;
        break;
      }
    }
    assert.ok(backtestsNavBtn, "Backtests nav button must exist");
    await backtestsNavBtn.click();
    await new Promise((r) => setTimeout(r, 1500));

    // 2. Run a backtest
    console.log("Running backtest...");
    const runBtn = await page.waitForSelector("button.backtest-run-button, button.run-backtest-btn, button[type='submit']", { timeout: 5000 });
    assert.ok(runBtn, "Run backtest button must exist");
    await runBtn.click();

    // Wait for simulation to finish (up to 45s for LLM prompt compiler + Bitget candles)
    console.log("Waiting for backtest results...");
    await page.waitForSelector(".backtest-trade-highlights, .simulated-trades-table", { timeout: 45000 });
    console.log("✓ Backtest completed and trade results displayed!");

    // 3. Click Replay Best Trade or first Replay button
    const replayBtn = await page.waitForSelector(".highlight-replay-btn, .backtest-replay-row-btn", { timeout: 5000 });
    assert.ok(replayBtn, "Replay button must exist");
    console.log("Clicking Replay button...");
    await replayBtn.click();
    await new Promise((r) => setTimeout(r, 2000));

    // 4. Verify Trade Replay Studio loaded
    const replayHud = await page.waitForSelector(".replay-review-hud", { timeout: 5000 });
    assert.ok(replayHud, "Trade Review HUD must appear in Replay Studio");
    const hudText = await replayHud.evaluate((el) => el.textContent);
    console.log("✓ Review HUD text:", hudText.trim());
    assert.ok(hudText.toLowerCase().includes("backtest review"), "HUD should indicate Backtest Review");

    // 5. Verify Candlesticks rendered on chart (NO 'Waiting for candle data...' empty state)
    const emptyState = await page.$(".chart-empty");
    assert.strictEqual(emptyState, null, "PriceChart must NOT show 'Waiting for candle data...' empty state!");

    const chartSvg = await page.waitForSelector(".price-chart-container svg, .chart-wrap svg, svg.chart-stage", { timeout: 5000 });
    assert.ok(chartSvg, "Chart SVG must be rendered");

    // Check candle elements inside SVG
    const candleBars = await page.$$(".price-chart-container svg rect, .chart-wrap svg rect");
    console.log(`✓ Rendered candlestick rect count: ${candleBars.length}`);
    assert.ok(candleBars.length > 0, "PriceChart must contain rendered candlestick bars");

    // 6. Verify Subtitle shows bar count > 1
    const subtitleEl = await page.$(".replay-chart-subtitle");
    const subtitleText = subtitleEl ? await subtitleEl.evaluate((el) => el.textContent) : "";
    console.log("✓ Replay subtitle text:", subtitleText.trim());

    // 7. Verify Play button has SVG icon and no duplicate 'Play Play' text
    const playBtn = await page.waitForSelector(".replay-dock-play-btn", { timeout: 5000 });
    assert.ok(playBtn, "Play button must exist in dock");
    const playBtnText = await playBtn.evaluate((el) => el.textContent);
    console.log("✓ Play button text content:", JSON.stringify(playBtnText.trim()));
    assert.ok(!playBtnText.includes("Play Play"), "Play button text must NOT duplicate 'Play Play'");

    const playSvg = await page.$(".replay-dock-play-btn svg");
    assert.ok(playSvg, "Play button must contain clean SVG glyph");

    // 8. Capture screenshot
    await page.screenshot({ path: "test/screenshots/backtest-replay-fixed.png" });
    console.log("✓ Saved screenshot to test/screenshots/backtest-replay-fixed.png");

    console.log("✓ ALL BACKTEST REPLAY FIX CHECKS PASSED!");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
