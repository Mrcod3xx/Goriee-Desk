import puppeteer from "puppeteer-core";
import os from "os";
import path from "path";
import fs from "fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots");

async function checkPnlMatrix() {
  console.log("Verifying Daily Realized P&L Matrix...");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-pnl-matrix-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: tempDir,
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1800,1000"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1800, height: 1000 });

  await page.goto(BASE_URL, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1500));

  // Seed realistic paper trades across several days into localStorage
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 24 * 3600 * 1000;

    const sampleTrades = [
      // Trade 1: BTC win (5 days ago)
      { id: "p1-buy", symbol: "BTCUSDT", side: "buy", quantity: 0.1, price: 60000, createdAt: now - 5 * dayMs, feeBps: 10 },
      { id: "p1-sell", symbol: "BTCUSDT", side: "sell", quantity: 0.1, price: 63500, createdAt: now - 5 * dayMs + 4 * 3600 * 1000, feeBps: 10 },

      // Trade 2: ETH loss (4 days ago)
      { id: "p2-buy", symbol: "ETHUSDT", side: "buy", quantity: 1.0, price: 3400, createdAt: now - 4 * dayMs, feeBps: 10 },
      { id: "p2-sell", symbol: "ETHUSDT", side: "sell", quantity: 1.0, price: 3250, createdAt: now - 4 * dayMs + 6 * 3600 * 1000, feeBps: 10 },

      // Trade 3: SOL win (4 days ago)
      { id: "p3-buy", symbol: "SOLUSDT", side: "buy", quantity: 15, price: 140, createdAt: now - 4 * dayMs + 8 * 3600 * 1000, feeBps: 10 },
      { id: "p3-sell", symbol: "SOLUSDT", side: "sell", quantity: 15, price: 158, createdAt: now - 3 * dayMs, feeBps: 10 },

      // Trade 4: BTC win (2 days ago)
      { id: "p4-buy", symbol: "BTCUSDT", side: "buy", quantity: 0.12, price: 65000, createdAt: now - 2 * dayMs, feeBps: 10 },
      { id: "p4-sell", symbol: "BTCUSDT", side: "sell", quantity: 0.12, price: 68000, createdAt: now - 2 * dayMs + 10 * 3600 * 1000, feeBps: 10 },

      // Trade 5: BTC big win (today)
      { id: "p5-buy", symbol: "BTCUSDT", side: "buy", quantity: 0.15, price: 67000, createdAt: now - 6 * 3600 * 1000, feeBps: 10 },
      { id: "p5-sell", symbol: "BTCUSDT", side: "sell", quantity: 0.15, price: 71500, createdAt: now - 1 * 3600 * 1000, feeBps: 10 },
    ];

    window.localStorage.setItem("goriee.paper.v1", JSON.stringify(sampleTrades));
  });

  // Reload to populate state
  await page.reload({ waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1500));

  // Navigate to Paper account tab
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button.nav-item, a.nav-item"));
    const paperBtn = btns.find((b) => b.textContent?.includes("Paper account"));
    if (paperBtn) paperBtn.click();
  });
  await new Promise((r) => setTimeout(r, 1200));

  // Click on Analytics subtab
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(".paper-tab-btn"));
    const analyticsBtn = btns.find((b) => b.textContent?.includes("Analytics"));
    if (analyticsBtn) analyticsBtn.click();
  });
  await new Promise((r) => setTimeout(r, 1500));

  // Locate the calendar section
  const section = await page.$("section[aria-label='Daily performance calendar heatmap']");
  if (!section) {
    throw new Error("Could not find calendar heatmap section");
  }

  const debugMetrics = await page.evaluate(() => {
    const col = document.querySelector(".pa-matrix-calendar-col");
    const scrollWrap = document.querySelector(".pa-calendar-scroll-wrap");
    const body = document.querySelector(".pa-calendar-body");
    const grid = document.querySelector(".pa-calendar-grid");
    const weeks = document.querySelectorAll(".pa-calendar-week");
    const firstCell = document.querySelector(".pa-cal-cell");
    const section = document.querySelector("section[aria-label='Daily performance calendar heatmap']");
    const kpiBar = document.querySelector(".pa-calendar-kpi-bar");
    const layout = document.querySelector(".pa-matrix-main-layout");
    const side = document.querySelector(".pa-matrix-side-panel");
    return {
      sectionWidth: section?.getBoundingClientRect().width,
      kpiBarWidth: kpiBar?.getBoundingClientRect().width,
      layoutWidth: layout?.getBoundingClientRect().width,
      colWidth: col?.getBoundingClientRect().width,
      sideWidth: side?.getBoundingClientRect().width,
      rightGap: side && col ? (side.getBoundingClientRect().left - col.getBoundingClientRect().right) : null,
      scrollWrapScrollWidth: scrollWrap?.scrollWidth,
      scrollWrapClientWidth: scrollWrap?.clientWidth,
      bodyWidth: body?.getBoundingClientRect().width,
      gridWidth: grid?.getBoundingClientRect().width,
      weeksCount: weeks.length,
      cellWidth: firstCell?.getBoundingClientRect().width,
      cellHeight: firstCell?.getBoundingClientRect().height,
    };
  });
  console.log("Calendar Debug Metrics:", debugMetrics);

  // Screenshot normal state
  const normalPath = path.join(SCREENSHOT_DIR, "verify-pnl-matrix-normal.png");
  await section.screenshot({ path: normalPath });
  console.log("✓ Saved calendar normal screenshot to:", normalPath);

  // Hover over an active profit cell
  const upCell = await page.$(".pa-cal-cell[class*='pa-cal-up']");
  if (upCell) {
    await upCell.hover();
    await new Promise((r) => setTimeout(r, 400));
    const hoverPath = path.join(SCREENSHOT_DIR, "verify-pnl-matrix-hover.png");
    await section.screenshot({ path: hoverPath });
    console.log("✓ Saved calendar hover tooltip screenshot to:", hoverPath);
  }

  await browser.close();
  console.log("P&L Matrix verification finished successfully!");
}

checkPnlMatrix().catch(console.error);
