import puppeteer from "puppeteer-core";
import os from "os";
import path from "path";
import fs from "fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots");

async function checkScopeCard() {
  console.log("Verifying Data Fed to AI card...");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-scope-"));
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

  const scopeCard = await page.$(".research-scope-card");
  if (!scopeCard) {
    throw new Error("Could not find .research-scope-card element");
  }

  const outPath = path.join(SCREENSHOT_DIR, "verify-scope-card.png");
  await scopeCard.screenshot({ path: outPath });
  console.log("✓ Saved scope card screenshot to:", outPath);

  // Also take full sidebar screenshot
  const sidebar = await page.$(".research-context-sidebar");
  if (sidebar) {
    const sidebarPath = path.join(SCREENSHOT_DIR, "verify-research-sidebar.png");
    await sidebar.screenshot({ path: sidebarPath });
    console.log("✓ Saved sidebar screenshot to:", sidebarPath);
  }

  await browser.close();
  console.log("Scope card verification finished!");
}

checkScopeCard().catch(console.error);
