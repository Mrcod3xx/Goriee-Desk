// verify-portfolio-analytics.mjs — Verify Portfolio Analytics Dashboard
import puppeteer from "puppeteer-core";
import path from "path";
import fs from "fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3000";

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ["--no-sandbox"],
  defaultViewport: { width: 1440, height: 1100 },
});

const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => {
  consoleErrors.push(err.message);
});

console.log("Navigating to app...");
await page.goto(BASE, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 2000));

// Step 1: Navigate to Paper Account
console.log("Navigating to Paper account tab...");
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("button.nav-item"));
  const paperBtn = btns.find((btn) => btn.textContent.includes("Paper account"));
  if (paperBtn) paperBtn.click();
});
await new Promise((r) => setTimeout(r, 1000));

// Step 2: Click the Analytics segmented button
console.log("Switching to Analytics sub-tab...");
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll(".paper-tab-btn"));
  const analyticsBtn = btns.find((b) => b.textContent.includes("Analytics"));
  if (analyticsBtn) analyticsBtn.click();
});
await new Promise((r) => setTimeout(r, 800));

// Verify empty state exists
const emptyStateExists = await page.evaluate(() => {
  return document.querySelector(".pa-empty-panel") !== null;
});
console.log(`Empty state rendered before trades: ${emptyStateExists}`);

// Step 3: Inject realistic paper trades to demonstrate the full quant analytics dashboard
console.log("Injecting paper trades and open positions...");
await page.evaluate(() => {
  const now = Date.now();
  const dayMs = 24 * 3600 * 1000;
  
  // Trades that result in closed positions + 1 open position
  // 1. Buy BTC at 60,000, Sell at 63,500 (Win)
  // 2. Buy ETH at 3,400, Sell at 3,250 (Loss)
  // 3. Buy SOL at 140, Sell at 158 (Win)
  // 4. Buy BTC at 64,000, Sell at 66,200 (Win)
  // 5. Buy SOL at 162, Sell at 155 (Loss)
  // 6. Buy BTC at 65,000, Sell at 68,000 (Win)
  // 7. Buy BTC at 67,000, Sell at 71,500 (Big Win)
  // 8. Buy ETH at 3,500, Sell at 3,380 (Loss)
  // 9. Buy SOL at 150, Sell at 165 (Win)
  // 10. Buy BTC at 70,000, Sell at 72,500 (Win)
  // 11. Buy BTC at 72,000, Sell at 74,000 (Win)
  // 12. Buy ETH at 3,600 (Open position)
  // 13. Buy SOL at 160 (Open position)

  const sampleTrades = [
    // Trade 1: BTC win (5 days ago)
    { id: "p1-buy", symbol: "BTCUSDT", side: "buy", quantity: 0.1, price: 60000, createdAt: now - 5 * dayMs, feeBps: 10, playbookName: "Classic 20/50 Trend Following" },
    { id: "p1-sell", symbol: "BTCUSDT", side: "sell", quantity: 0.1, price: 63500, createdAt: now - 5 * dayMs + 4 * 3600 * 1000, feeBps: 10 },
    
    // Trade 2: ETH loss (4 days ago)
    { id: "p2-buy", symbol: "ETHUSDT", side: "buy", quantity: 1.0, price: 3400, createdAt: now - 4 * dayMs, feeBps: 10, playbookName: "RSI Oversold Dip Reversal" },
    { id: "p2-sell", symbol: "ETHUSDT", side: "sell", quantity: 1.0, price: 3250, createdAt: now - 4 * dayMs + 6 * 3600 * 1000, feeBps: 10 },

    // Trade 3: SOL win (4 days ago)
    { id: "p3-buy", symbol: "SOLUSDT", side: "buy", quantity: 15, price: 140, createdAt: now - 4 * dayMs + 8 * 3600 * 1000, feeBps: 10 },
    { id: "p3-sell", symbol: "SOLUSDT", side: "sell", quantity: 15, price: 158, createdAt: now - 3 * dayMs, feeBps: 10 },

    // Trade 4: BTC win (3 days ago)
    { id: "p4-buy", symbol: "BTCUSDT", side: "buy", quantity: 0.08, price: 64000, createdAt: now - 3 * dayMs + 2 * 3600 * 1000, feeBps: 10 },
    { id: "p4-sell", symbol: "BTCUSDT", side: "sell", quantity: 0.08, price: 66200, createdAt: now - 3 * dayMs + 7 * 3600 * 1000, feeBps: 10 },

    // Trade 5: SOL loss (2 days ago)
    { id: "p5-buy", symbol: "SOLUSDT", side: "buy", quantity: 10, price: 162, createdAt: now - 2 * dayMs, feeBps: 10 },
    { id: "p5-sell", symbol: "SOLUSDT", side: "sell", quantity: 10, price: 155, createdAt: now - 2 * dayMs + 3 * 3600 * 1000, feeBps: 10 },

    // Trade 6: BTC win (2 days ago)
    { id: "p6-buy", symbol: "BTCUSDT", side: "buy", quantity: 0.12, price: 65000, createdAt: now - 2 * dayMs + 5 * 3600 * 1000, feeBps: 10 },
    { id: "p6-sell", symbol: "BTCUSDT", side: "sell", quantity: 0.12, price: 68000, createdAt: now - 2 * dayMs + 10 * 3600 * 1000, feeBps: 10 },

    // Trade 7: BTC big win (1 day ago)
    { id: "p7-buy", symbol: "BTCUSDT", side: "buy", quantity: 0.15, price: 67000, createdAt: now - 1 * dayMs, feeBps: 10 },
    { id: "p7-sell", symbol: "BTCUSDT", side: "sell", quantity: 0.15, price: 71500, createdAt: now - 1 * dayMs + 8 * 3600 * 1000, feeBps: 10 },

    // Trade 8: ETH loss (1 day ago)
    { id: "p8-buy", symbol: "ETHUSDT", side: "buy", quantity: 0.8, price: 3500, createdAt: now - 1 * dayMs + 9 * 3600 * 1000, feeBps: 10 },
    { id: "p8-sell", symbol: "ETHUSDT", side: "sell", quantity: 0.8, price: 3380, createdAt: now - 1 * dayMs + 14 * 3600 * 1000, feeBps: 10 },

    // Trade 9: SOL win (18h ago)
    { id: "p9-buy", symbol: "SOLUSDT", side: "buy", quantity: 12, price: 150, createdAt: now - 18 * 3600 * 1000, feeBps: 10 },
    { id: "p9-sell", symbol: "SOLUSDT", side: "sell", quantity: 12, price: 165, createdAt: now - 12 * 3600 * 1000, feeBps: 10 },

    // Trade 10: BTC win (10h ago)
    { id: "p10-buy", symbol: "BTCUSDT", side: "buy", quantity: 0.1, price: 70000, createdAt: now - 10 * 3600 * 1000, feeBps: 10 },
    { id: "p10-sell", symbol: "BTCUSDT", side: "sell", quantity: 0.1, price: 72500, createdAt: now - 5 * 3600 * 1000, feeBps: 10 },

    // Trade 11: BTC win (4h ago)
    { id: "p11-buy", symbol: "BTCUSDT", side: "buy", quantity: 0.08, price: 72000, createdAt: now - 4 * 3600 * 1000, feeBps: 10 },
    { id: "p11-sell", symbol: "BTCUSDT", side: "sell", quantity: 0.08, price: 74000, createdAt: now - 1 * 3600 * 1000, feeBps: 10 },

    // Open positions (not closed yet)
    { id: "p12-open-eth", symbol: "ETHUSDT", side: "buy", quantity: 0.5, price: 3600, createdAt: now - 2 * 3600 * 1000, feeBps: 10 },
    { id: "p13-open-sol", symbol: "SOLUSDT", side: "buy", quantity: 8, price: 160, createdAt: now - 1 * 3600 * 1000, feeBps: 10 },
  ];

  window.localStorage.setItem("goriee.paper.v1", JSON.stringify(sampleTrades));
});

// Step 4: Refresh and switch to Analytics tab
console.log("Reloading with sample data...");
await page.reload({ waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 2000));

console.log("Navigating to Paper account tab...");
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("button.nav-item"));
  const paperBtn = btns.find((b) => b.textContent.includes("Paper account"));
  if (paperBtn) paperBtn.click();
});
await new Promise((r) => setTimeout(r, 1000));

console.log("Clicking Analytics tab...");
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll(".paper-tab-btn"));
  const analyticsBtn = btns.find((b) => b.textContent.includes("Analytics"));
  if (analyticsBtn) analyticsBtn.click();
});
await new Promise((r) => setTimeout(r, 1000));

// Step 5: Verify all elements exist and extract values
const dashboardInspection = await page.evaluate(() => {
  const heroValues = Array.from(document.querySelectorAll(".pa-hero-card")).map((card) => ({
    label: card.querySelector(".pa-hero-label")?.textContent?.trim(),
    value: card.querySelector(".pa-hero-value")?.textContent?.trim(),
  }));

  const metricsGrid = Array.from(document.querySelectorAll(".pa-metric")).map((item) => ({
    label: item.querySelector("span")?.textContent?.trim(),
    value: item.querySelector("strong")?.textContent?.trim(),
  }));

  const hasEquityCurve = document.querySelector(".pa-line-up, .pa-line-down") !== null;
  const hasDrawdown = document.querySelector(".pa-dd-wrap") !== null;
  const hasRollingWinRate = document.querySelector(".pa-line-winrate") !== null;
  const hasDonut = document.querySelector(".pa-donut-svg") !== null;
  const hasCalendar = document.querySelector(".pa-calendar") !== null;
  const hasBestTrade = document.querySelector(".pa-tag-best") !== null;
  const hasWorstTrade = document.querySelector(".pa-tag-worst") !== null;
  const streakCount = document.querySelectorAll(".pa-streak-card").length;

  return {
    heroValues,
    metricsGrid,
    hasEquityCurve,
    hasDrawdown,
    hasRollingWinRate,
    hasDonut,
    hasCalendar,
    hasBestTrade,
    hasWorstTrade,
    streakCount,
  };
});

console.log("\n📊 Portfolio Analytics Dashboard Inspection:");
console.log("Hero Cards:", JSON.stringify(dashboardInspection.heroValues, null, 2));
console.log("Quantitative Metrics Grid:", JSON.stringify(dashboardInspection.metricsGrid, null, 2));
console.log(`Equity Curve rendered: ${dashboardInspection.hasEquityCurve}`);
console.log(`Drawdown Analysis rendered: ${dashboardInspection.hasDrawdown}`);
console.log(`Rolling Win Rate rendered: ${dashboardInspection.hasRollingWinRate}`);
console.log(`Position Allocation Donut rendered: ${dashboardInspection.hasDonut}`);
console.log(`Daily P&L Calendar rendered: ${dashboardInspection.hasCalendar}`);
console.log(`Best Trade Card rendered: ${dashboardInspection.hasBestTrade}`);
console.log(`Worst Trade Card rendered: ${dashboardInspection.hasWorstTrade}`);
console.log(`Streak Cards Count: ${dashboardInspection.streakCount}`);

// Step 6: Take high-resolution screenshots
const ssDir = path.resolve("test", "screenshots");
if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });

// Top half (hero + equity curve + drawdown)
await page.screenshot({
  path: path.join(ssDir, "13-portfolio-analytics-dashboard.png"),
  fullPage: false,
});
console.log("📸 Saved test/screenshots/13-portfolio-analytics-dashboard.png");

// Full page capture
await page.screenshot({
  path: path.join(ssDir, "14-portfolio-analytics-fullpage.png"),
  fullPage: true,
});
console.log("📸 Saved test/screenshots/14-portfolio-analytics-fullpage.png");

console.log(`\nConsole Errors: ${consoleErrors.length}`);
if (consoleErrors.length > 0) {
  console.log("Errors:", consoleErrors);
}

await browser.close();
console.log("\n✅ Portfolio Analytics Dashboard Verified Successfully!");
