import puppeteer from "puppeteer-core";
import os from "os";
import path from "path";
import fs from "fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";

async function evalMatrix() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-eval-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: tempDir,
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,1200"],
  });

  const page = await browser.newPage();
  await page.goto(BASE_URL, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 2000));

  // Check market on the page
  const marketInfo = await page.evaluate(async () => {
    const res = await fetch("/api/market?symbol=BTCUSDT&interval=1H");
    const json = await res.json();
    return {
      hasMarket: !!json.market,
      candleCount: json.market?.candles?.length,
      sampleCandle: json.market?.candles?.[0],
    };
  });
  console.log("Market API inspection:", marketInfo);

  // Navigate to backtests and run
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button.nav-item, a.nav-item"))
      .find((el) => el.textContent?.includes("Backtests"));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 1000));

  await page.evaluate(() => {
    const btn = document.querySelector('form.strategy-builder button[type="submit"]');
    if (btn) btn.click();
  });

  // Wait for validation cards grid
  await page.waitForSelector(".validation-cards-grid", { timeout: 35000 });
  console.log("✓ Validation cards grid visible");

  // Inspect the DOM around MonteCarloPanel
  const domInfo = await page.evaluate(() => {
    const monte = document.querySelector(".monte-carlo-panel");
    const nextSibling = monte?.nextElementSibling;
    const allPanels = Array.from(document.querySelectorAll("section.panel, div.panel")).map(p => p.className);
    return {
      monteFound: !!monte,
      nextSiblingClass: nextSibling?.className,
      nextSiblingTag: nextSibling?.tagName,
      nextSiblingHtml: nextSibling?.outerHTML?.slice(0, 300),
      allPanels,
    };
  });
  console.log("DOM around Monte Carlo:", domInfo);

  await browser.close();
}

evalMatrix();
