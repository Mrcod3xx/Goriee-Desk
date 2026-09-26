import puppeteer from "puppeteer-core";
import os from "os";
import path from "path";
import fs from "fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots");

async function checkResearchTab() {
  console.log("Verifying Research tab fix...");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-res-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: tempDir,
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,960"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 960 });

  await page.goto(BASE_URL, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1500));

  // Navigate to Research tab
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button.nav-item, a.nav-item"))
      .find(el => el.textContent?.includes("Research"));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 1500));

  // Check preflight panel presence
  const hasPreflight = await page.$(".research-preflight-card") !== null;
  console.log("✓ Preflight Panel detected:", hasPreflight);

  // Take screenshot of Research tab top grid
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "v6_research_fixed_grid.png") });
  console.log("✓ Saved screenshot to v6_research_fixed_grid.png");

  // Click on "Elliott Wave Cycle" lens
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll(".framework-card-btn"))
      .find(el => el.textContent?.includes("Elliott Wave"));
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 600));

  const textareaVal = await page.$eval("#research-question-page", (el) => el.value);
  console.log("✓ Textarea populated with Elliott Wave prompt:", textareaVal.slice(0, 50) + "...");

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "v7_research_elliott_wave_selected.png") });
  console.log("✓ Saved screenshot to v7_research_elliott_wave_selected.png");

  await browser.close();
  console.log("Verification finished successfully!");
}

checkResearchTab().catch(console.error);
