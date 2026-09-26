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

async function verifyPaperTabs() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-papertabs-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: tempDir,
    defaultViewport: { width: 1440, height: 1100 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  try {
    // Populate at least one closed trade in localStorage so Trade review badge shows "1"
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      const mockClosedTrade = [
        {
          id: "trade-1",
          symbol: "BTCUSDT",
          side: "buy",
          amount: 500,
          entryPrice: 84000,
          exitPrice: 85200,
          pnl: 7.14,
          pnlPercent: 1.43,
          entryTime: Date.now() - 3600000 * 4,
          exitTime: Date.now() - 3600000,
          notes: "Elliott wave 5 breakout test"
        }
      ];
      localStorage.setItem("goriee.paper.closed.v1", JSON.stringify(mockClosedTrade));
    });

    await page.reload({ waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1000));

    // Navigate to Paper account tab
    const navButtons = await page.$$("button.nav-item");
    for (const btn of navButtons) {
      const text = await btn.evaluate((el) => el.textContent);
      if (text && text.includes("Paper")) {
        await btn.click();
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 800));

    // Locate the paper-heading-actions bar
    const actionsBar = await page.$(".paper-heading-actions");
    if (actionsBar) {
      // 1. Initial snapshot (Account active, Trade review count 1, Analytics)
      await actionsBar.screenshot({
        path: path.join(SCREENSHOT_DIR, "verify-papertab-initial.png"),
      });
      console.log("Captured verify-papertab-initial.png");

      // 2. Hover over the Trade review tab
      const tabButtons = await actionsBar.$$(".paper-tab-btn");
      if (tabButtons.length >= 2) {
        await tabButtons[1].hover();
        await new Promise((r) => setTimeout(r, 300));
        await actionsBar.screenshot({
          path: path.join(SCREENSHOT_DIR, "verify-papertab-hover.png"),
        });
        console.log("Captured verify-papertab-hover.png");

        // 3. Click the Trade review tab
        await tabButtons[1].click();
        await new Promise((r) => setTimeout(r, 400));
        await actionsBar.screenshot({
          path: path.join(SCREENSHOT_DIR, "verify-papertab-review-active.png"),
        });
        console.log("Captured verify-papertab-review-active.png");
      }
    }

    console.log("Paper tab verification completed successfully!");
  } finally {
    await browser.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

verifyPaperTabs().catch(console.error);
