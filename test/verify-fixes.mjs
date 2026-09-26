import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3000";
const SCREENSHOT_DIR = path.resolve("./screenshots");

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function run() {
  console.log("=== Verifying Fixes for Search Bar, Sticky Sidebar, and Journal Clusters ===");

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("favicon")) {
      errors.push({ type: "console.error", text: msg.text() });
    }
  });
  page.on("pageerror", (err) => {
    errors.push({ type: "pageerror", text: err.message });
  });

  await page.goto(BASE, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 2000));

  // 1. Verify Search Bar
  console.log("\n[1/3] Capturing Clean Search Bar...");
  const searchInput = await page.$(".desk-market-search-field input");
  if (searchInput) {
    await searchInput.focus();
    await new Promise((r) => setTimeout(r, 300));
  }
  const searchBarEl = await page.$(".desk-market-search");
  if (searchBarEl) {
    await searchBarEl.screenshot({ path: path.join(SCREENSHOT_DIR, "fix-search-bar.png") });
  }

  // 2. Verify Sticky Sidebar when scrolling down on Research Tab
  console.log("\n[2/3] Testing Sidebar Sticky Behavior on Long Scroll...");
  const navBtns = await page.$$("button.nav-item");
  for (const b of navBtns) {
    const txt = await b.evaluate((el) => el.textContent);
    if (txt && txt.includes("Research")) {
      await b.click();
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 1500));

  // Scroll down 1200px
  await page.evaluate(() => window.scrollTo(0, 1200));
  await new Promise((r) => setTimeout(r, 800));

  // Verify sidebar top position relative to viewport
  const sidebarRect = await page.evaluate(() => {
    const sb = document.querySelector(".sidebar");
    if (!sb) return null;
    const rect = sb.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height, windowHeight: window.innerHeight };
  });
  console.log("Sidebar rect after 1200px scroll:", sidebarRect);
  const isSticky = sidebarRect && Math.abs(sidebarRect.top) <= 5 && sidebarRect.bottom >= (sidebarRect.windowHeight - 5);
  console.log(`Sidebar sticky check: ${isSticky ? "PASSED (0 cutout)" : "FAILED"}`);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "fix-sidebar-sticky.png"), fullPage: false });

  // 3. Verify Journal Clusters & Token Filter Pills
  console.log("\n[3/3] Testing Journal Clusters & Token Pills...");

  // Inject mock journal items
  await page.evaluate(() => {
    const mockBriefs = [
      {
        id: "brief-btc-1",
        symbol: "BTCUSDT",
        interval: "1H",
        regime: "Bearish structure",
        question: "Analyze BTCUSDT on the 1H chart using Elliott Wave theory.",
        summary: "Wave 4 consolidation retesting $84,200 resistance before final impulse wave 5 lower.",
        bullCase: "Break above $84,950 invalidates wave count.",
        bearCase: "Rejection at 50 EMA targets $82,800 demand shelf.",
        invalidation: "Hourly close above $85,000",
        engine: "DeepSeek R1",
        price: 84033.43,
        asOf: Date.now() - 3600000,
        createdAt: Date.now() - 3600000,
      },
      {
        id: "brief-btc-2",
        symbol: "BTCUSDT",
        interval: "1H",
        regime: "Bearish structure",
        question: "Using an Elliott wave strategy analyze the BTC if there is a position.",
        summary: "Short entry near $84,120 with stop above wave 2 high.",
        bullCase: "Immediate reclaiming of $84,500.",
        bearCase: "Break of $83,300 accelerates downside.",
        invalidation: "Hourly close above $84,600",
        engine: "DeepSeek R1",
        price: 84122.05,
        asOf: Date.now() - 7200000,
        createdAt: Date.now() - 7200000,
      },
      {
        id: "brief-btc-3",
        symbol: "BTCUSDT",
        interval: "15m",
        regime: "Bullish structure",
        question: "Analyze BTCUSDT on the 15m chart. Show both sides and what would change the read.",
        summary: "Short-term relief rally bouncing off 15m order block.",
        bullCase: "Higher highs above $84,600.",
        bearCase: "Failure to hold $84,200 leads to retest of daily open.",
        invalidation: "Drop below $83,900",
        engine: "DeepSeek R1",
        price: 84654.30,
        asOf: Date.now() - 25000000,
        createdAt: Date.now() - 25000000,
      },
      {
        id: "brief-rspy-1",
        symbol: "RSPYUSDT",
        interval: "1H",
        regime: "Mixed structure",
        question: "Analyze RSPYUSDT on the 1H chart. Show both sides and what would change the read.",
        summary: "RSPYUSDT trades at 766.93, up 0.17% over 24h in mid-range compression.",
        bullCase: "Expansion toward $775 on institutional volume.",
        bearCase: "Loss of $762 support.",
        invalidation: "Break below $760",
        engine: "DeepSeek R1",
        price: 766.93,
        asOf: Date.now() - 14400000,
        createdAt: Date.now() - 14400000,
      },
      {
        id: "brief-rspy-2",
        symbol: "RSPYUSDT",
        interval: "4H",
        regime: "Bullish structure",
        question: "Evaluate multi-horizon trend and macro liquidity sweep on RSPYUSDT.",
        summary: "Tokenized equity consolidation above 50 EMA.",
        bullCase: "Continuation to new highs.",
        bearCase: "Mean reversion back to $755.",
        invalidation: "4H close below $758",
        engine: "DeepSeek R1",
        price: 765.20,
        asOf: Date.now() - 50000000,
        createdAt: Date.now() - 50000000,
      }
    ];
    window.localStorage.setItem("goriee.journal.v1", JSON.stringify(mockBriefs));
  });

  // Reload to read localStorage
  await page.reload({ waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 1200));

  const navBtns2 = await page.$$("button.nav-item");
  for (const b of navBtns2) {
    const txt = await b.evaluate((el) => el.textContent);
    if (txt && txt.includes("Journal")) {
      await b.click();
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 1500));

  // Check if clusters and filter pills rendered
  const clusterCount = await page.evaluate(() => {
    return document.querySelectorAll(".journal-cluster-block").length;
  });
  const pillsCount = await page.evaluate(() => {
    return document.querySelectorAll(".journal-filter-pill").length;
  });
  console.log(`Journal Token Clusters: ${clusterCount} rendered`);
  console.log(`Journal Token Filter Pills: ${pillsCount} rendered`);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "fix-journal-clusters.png"), fullPage: false });

  // Test collapsing a cluster
  const firstHeader = await page.$(".journal-cluster-header");
  if (firstHeader) {
    await firstHeader.click();
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "fix-journal-clusters-collapsed.png"), fullPage: false });
  }

  await browser.close();

  console.log("\n=== Result ===");
  console.log(`Total errors: ${errors.length}`);
  if (errors.length > 0) {
    console.error("Errors:", errors);
    process.exit(1);
  }
  console.log("Verification finished successfully!");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
