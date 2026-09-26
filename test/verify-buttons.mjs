import puppeteer from "puppeteer-core";
import path from "path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots");

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1440,960"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 960 });

  await page.goto(BASE_URL, { waitUntil: "networkidle0", timeout: 25000 });
  await page.waitForSelector(".desk-view-toggle", { timeout: 10000 });
  await page.waitForSelector(".desk-tab-header", { timeout: 10000 });

  // 1. Screenshot normal initial state of header controls
  const toggleEl = await page.$(".desk-heading-controls");
  if (toggleEl) {
    await toggleEl.screenshot({ path: path.join(SCREENSHOT_DIR, "button_fix_01_toggle_normal.png") });
  }

  // Hover over the inactive toggle button (4-Chart Matrix)
  const matrixBtn = (await page.$$(".view-mode-btn"))[1];
  if (matrixBtn) {
    await matrixBtn.hover();
    await new Promise((r) => setTimeout(r, 200));
    await toggleEl?.screenshot({ path: path.join(SCREENSHOT_DIR, "button_fix_02_toggle_hover.png") });
  }

  // 2. Screenshot subtab header in normal state
  const tabHeaderEl = await page.$(".desk-tab-header");
  if (tabHeaderEl) {
    await tabHeaderEl.screenshot({ path: path.join(SCREENSHOT_DIR, "button_fix_03_subtabs_normal.png") });
  }

  // Hover over the inactive subtab button (L2 Order Book & Depth)
  const l2SubtabBtn = (await page.$$(".desk-subtab-btn"))[1];
  if (l2SubtabBtn) {
    await l2SubtabBtn.hover();
    await new Promise((r) => setTimeout(r, 200));
    await tabHeaderEl?.screenshot({ path: path.join(SCREENSHOT_DIR, "button_fix_04_subtabs_hover.png") });
  }

  // Click L2 Order Book & Depth to see active state
  if (l2SubtabBtn) {
    await l2SubtabBtn.click();
    await new Promise((r) => setTimeout(r, 500));
    await tabHeaderEl?.screenshot({ path: path.join(SCREENSHOT_DIR, "button_fix_05_subtabs_l2_active.png") });
  }

  await browser.close();
  console.log("Screenshots captured successfully!");
}

main().catch(console.error);
