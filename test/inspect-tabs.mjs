import puppeteer from "puppeteer-core";
import path from "path";
import fs from "fs";
import os from "os";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots");

async function inspectTabs() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-inspect-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: tempDir,
    defaultViewport: { width: 1440, height: 950 },
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage();
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1200));

    async function clickNav(name) {
      const navItems = await page.$$("button.nav-item");
      for (const item of navItems) {
        const text = await item.evaluate((el) => el.textContent);
        if (text && text.includes(name)) {
          await item.click();
          await new Promise((r) => setTimeout(r, 800));
          return true;
        }
      }
      return false;
    }

    // 1. Research tab (overhauled)
    await clickNav("Research");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "inspect_research_overhauled.png") });
    console.log("Saved inspect_research_overhauled.png");

    // 2. Journal tab (empty overhauled)
    await clickNav("Journal");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "inspect_journal_empty_overhauled.png") });
    console.log("Saved inspect_journal_empty_overhauled.png");

    // 3. Populate a mock journal item to test master-detail view
    await page.evaluate(() => {
      const mockBrief = {
        id: "mock-brief-1",
        question: "Analyze BTCUSDT on the 1H chart. Show both sides and what would change the read.",
        symbol: "BTCUSDT",
        interval: "1H",
        summary: "BTCUSDT maintains short-term bullish market structure above the 20 EMA with expanding volume shelves.",
        bullCase: "Strong bid defense at $84,100 support; EMA 20 holding positive slope.",
        bearCase: "Volume taper on recent push towards $85,200 resistance; potential exhaustion pinbar.",
        invalidation: "A 1-hour candle close below $83,750 invalidates short-term bullish momentum.",
        price: 84650.50,
        regime: "Bullish structure",
        createdAt: Date.now() - 3600000,
        indicators: {
          ema20: 84420.10,
          ema50: 84150.80,
          rsi14: 58.4,
          support: 83950.00,
          resistance: 85200.00,
          rangePct: 1.48,
          regime: "Bullish structure"
        }
      };
      window.localStorage.setItem("goriee.journal.v1", JSON.stringify([mockBrief]));
    });

    // Refresh page to load localStorage
    await page.reload({ waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 800));

    // 4. Journal tab (populated master-detail overhauled)
    await clickNav("Journal");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "inspect_journal_master_detail_overhauled.png") });
    console.log("Saved inspect_journal_master_detail_overhauled.png");

    // 5. Research tab with recent brief in sidebar
    await clickNav("Research");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "inspect_research_with_brief_overhauled.png") });
    console.log("Saved inspect_research_with_brief_overhauled.png");

    // 6. Settings tab (overhauled with preset cards and ping button)
    await clickNav("Settings");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "inspect_settings_overhauled.png") });
    console.log("Saved inspect_settings_overhauled.png");

    // 7. Backtests tab (overhauled with strategy templates)
    await clickNav("Backtests");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "inspect_backtests_overhauled.png") });
    console.log("Saved inspect_backtests_overhauled.png");

  } finally {
    await browser.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

inspectTabs().catch(console.error);
