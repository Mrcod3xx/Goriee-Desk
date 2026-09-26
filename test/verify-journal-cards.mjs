import puppeteer from "puppeteer-core";
import path from "path";
import fs from "fs";
import os from "os";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots");

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function verifyJournalCards() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-journal-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: tempDir,
    defaultViewport: { width: 1440, height: 1100 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  try {
    // Pre-populate realistic research history in localStorage
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      const mockBriefs = [
        {
          id: "brief-btc-1",
          question: "Analyze BTCUSDT on the 1H chart using Elliott Wave theory. Map the current impulse (waves 1-5) or corrective (A-B-C) structure, key Fibonacci retracement targets, and price levels that invalidate the count.",
          symbol: "BTCUSDT",
          interval: "1H",
          summary: "BTCUSDT trades at 84,033.43 on the 1H, below EMA20 (84,280). Wave 4 corrective consolidation retesting $84,200 resistance before final wave 5 extension towards $85,600.",
          regime: "Bearish structure",
          price: 84033.43,
          createdAt: Date.now() - 1000 * 60 * 30,
          bullCase: "Reclaim of EMA20 opens pathway to $85,200.",
          bearCase: "Rejection at $84,200 signals continuation to $83,100 support.",
          invalidation: "Hourly close above 84,500 invalidates short thesis."
        },
        {
          id: "brief-btc-2",
          question: "using a elliot wave strategy analyze the btc if there is a position",
          symbol: "BTCUSDT",
          interval: "1H",
          summary: "On the BTCUSDT 1H chart, price is 84,122.05, consolidating inside a descending wedge with positive RSI divergence at 42.4.",
          regime: "Bearish structure",
          price: 84122.05,
          createdAt: Date.now() - 1000 * 60 * 65,
          bullCase: "Breakout above wedge resistance targets 84,800.",
          bearCase: "Break below 83,800 accelerates sell-off.",
          invalidation: "Close below 83,750."
        },
        {
          id: "brief-btc-3",
          question: "Analyze BTCUSDT on the 15m chart. Show both sides and what would change the read.",
          symbol: "BTCUSDT",
          interval: "15m",
          summary: "BTCUSDT on the 15m is trading at 84,654.3 (+0.44%), maintaining higher lows above EMA50 with strong buyer volume absorption.",
          regime: "Bullish structure",
          price: 84654.30,
          createdAt: Date.now() - 1000 * 60 * 180,
          bullCase: "Continuous higher lows support push to 85,000.",
          bearCase: "Loss of 84,300 shelf invites retest of 83,900.",
          invalidation: "Breakdown under 84,200."
        },
        {
          id: "brief-eth-1",
          question: "Analyze ETHUSDT on the 4H chart for trend continuation.",
          symbol: "ETHUSDT",
          interval: "4H",
          summary: "ETHUSDT tests key range midpoint around $2,085 with neutral momentum and decreasing turnover.",
          regime: "Mixed structure",
          price: 2085.50,
          createdAt: Date.now() - 1000 * 60 * 300,
          bullCase: "Clear close above 2,120 confirms upward continuation.",
          bearCase: "Sellers cap upside at 2,100 EMA50 band.",
          invalidation: "Loss of 2,040 level."
        }
      ];
      localStorage.setItem("goriee.journal.v1", JSON.stringify(mockBriefs));
    });

    await page.reload({ waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1000));

    // Navigate to Journal tab
    const navButtons = await page.$$("button.nav-item");
    for (const btn of navButtons) {
      const text = await btn.evaluate((el) => el.textContent);
      if (text && text.includes("Journal")) {
        await btn.click();
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 800));

    // Capture initial journal state with cards rendered
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "verify-journal-cards-initial.png"),
      fullPage: false,
    });
    console.log("Captured verify-journal-cards-initial.png");

    // Click the second journal row to test active selection
    const rows = await page.$$(".journal-row");
    if (rows.length >= 2) {
      console.log(`Found ${rows.length} journal rows, clicking the second row...`);
      await rows[1].click();
      await new Promise((r) => setTimeout(r, 600));

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "verify-journal-cards-selected.png"),
        fullPage: false,
      });
      console.log("Captured verify-journal-cards-selected.png");
    }

    // Now test clicking "Full Modal" button on the first row
    const modalButtons = await page.$$(".journal-open");
    if (modalButtons.length > 0) {
      console.log("Clicking Full Modal button on first row...");
      await modalButtons[0].click();
      await new Promise((r) => setTimeout(r, 600));

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "verify-journal-modal.png"),
        fullPage: false,
      });
      console.log("Captured verify-journal-modal.png");
    }

    console.log("Journal cards verification successfully completed!");
  } finally {
    await browser.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

verifyJournalCards().catch(console.error);
