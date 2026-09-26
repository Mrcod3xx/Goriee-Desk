import puppeteer from "puppeteer-core";
import path from "path";
import fs from "fs";
import os from "os";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots");

async function verifyResearchReport() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-report-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: tempDir,
    defaultViewport: { width: 1440, height: 1200 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1000));

    // Navigate to Research tab
    const navItems = await page.$$("button.nav-item");
    for (const item of navItems) {
      const text = await item.evaluate((el) => el.textContent);
      if (text && text.includes("Research")) {
        await item.click();
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 800));

    // Click "Research BTCUSDT (1H)" button
    const submitBtn = await page.$(".research-submit-btn");
    if (submitBtn) {
      console.log("Submitting research query...");
      await submitBtn.click();
      // Wait for report panel to appear (up to 35 seconds for AI call or fallback)
      await page.waitForSelector(".report-panel", { timeout: 45000 });
      await new Promise((r) => setTimeout(r, 1000));
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "research_report_fullwidth_verified.png"), fullPage: true });
      console.log("Saved research_report_fullwidth_verified.png!");
    }
  } finally {
    await browser.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

verifyResearchReport().catch(console.error);
