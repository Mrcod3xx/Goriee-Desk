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

async function verifyRiskLimitField() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-risk-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: tempDir,
    defaultViewport: { width: 1440, height: 1100 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle2" });
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
    await new Promise((r) => setTimeout(r, 1000));

    // Locate the paper-risk-panel element
    const riskPanel = await page.$(".paper-risk-panel");
    if (!riskPanel) {
      throw new Error(".paper-risk-panel not found on paper account view");
    }

    // Scroll risk panel into view
    await riskPanel.evaluate((el) => el.scrollIntoView({ behavior: "instant", block: "center" }));
    await new Promise((r) => setTimeout(r, 500));

    // Take snapshot of the risk panel before focus
    await riskPanel.screenshot({
      path: path.join(SCREENSHOT_DIR, "verify-risk-limit-normal.png"),
    });
    console.log("Captured verify-risk-limit-normal.png");

    // Click into input#paper-loss-limit to test focus-within glow
    const input = await page.$("#paper-loss-limit");
    if (input) {
      await input.focus();
      await new Promise((r) => setTimeout(r, 300));
      await riskPanel.screenshot({
        path: path.join(SCREENSHOT_DIR, "verify-risk-limit-focused.png"),
      });
      console.log("Captured verify-risk-limit-focused.png");
    }

    console.log("Risk limit field verification completed successfully!");
  } finally {
    await browser.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

verifyRiskLimitField().catch(console.error);
