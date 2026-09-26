import puppeteer from "puppeteer-core";
import os from "os";
import path from "path";
import fs from "fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots");

async function checkSingleTradeMatrix() {
  console.log("Verifying Daily Realized P&L Matrix with exactly 1 single trade...");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-single-trade-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: tempDir,
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1560,1000"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1560, height: 1000 });

  await page.goto(BASE_URL, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1000));

  // Seed exactly 1 single trade (the user's scenario)
  await page.evaluate(() => {
    const now = Date.now();
    const sampleTrades = [
      { id: "p1-buy", symbol: "BTCUSDT", side: "buy", quantity: 0.1, price: 84000, createdAt: now - 3600000, feeBps: 10 },
      { id: "p1-sell", symbol: "BTCUSDT", side: "sell", quantity: 0.1, price: 85200, createdAt: now - 1800000, feeBps: 10 },
    ];
    window.localStorage.setItem("goriee.paper.v1", JSON.stringify(sampleTrades));
  });

  await page.reload({ waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1500));

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button.nav-item, a.nav-item"));
    const paperBtn = btns.find((b) => b.textContent?.includes("Paper account"));
    if (paperBtn) paperBtn.click();
  });
  await new Promise((r) => setTimeout(r, 1000));

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll(".paper-tab-btn"));
    const analyticsBtn = btns.find((b) => b.textContent?.includes("Analytics"));
    if (analyticsBtn) analyticsBtn.click();
  });
  await new Promise((r) => setTimeout(r, 1500));

  const section = await page.$("section[aria-label='Daily performance calendar heatmap']");
  if (!section) {
    throw new Error("Could not find calendar heatmap section");
  }

  const singlePath = path.join(SCREENSHOT_DIR, "verify-pnl-matrix-single-trade.png");
  await section.screenshot({ path: singlePath });
  console.log("✓ Saved single trade calendar screenshot to:", singlePath);

  await browser.close();
  console.log("Single trade test complete!");
}

checkSingleTradeMatrix().catch(console.error);
