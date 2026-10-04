import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const LIVE_URL = "https://goriee-ai-desk.vercel.app";
const SCREENSHOT_PATH = path.join(process.cwd(), "test", "screenshots", "live_vercel_modal.png");

async function checkLive() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,960"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 960 });

    console.log("Navigating to live URL:", LIVE_URL);
    await page.goto(LIVE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

    console.log("Waiting for modal selector...");
    await page.waitForSelector(".demo-notice-modal", { timeout: 15000 });
    console.log("Demo notice modal found on live site!");

    const text = await page.$eval(".demo-notice-modal", (el) => el.textContent);
    console.log("Modal title/kicker excerpt:", text.substring(0, 120));

    await page.screenshot({ path: SCREENSHOT_PATH });
    console.log("Saved live screenshot to:", SCREENSHOT_PATH);

    const btn = await page.waitForSelector("#demo-notice-continue-btn", { timeout: 5000 });
    await btn.click();
    await page.waitForFunction(() => !document.querySelector(".demo-notice-modal"), { timeout: 5000 });
    console.log("Successfully dismissed modal on live site!");
  } finally {
    await browser.close();
  }
}

checkLive().catch((e) => {
  console.error("Live check failed:", e);
  process.exit(1);
});
