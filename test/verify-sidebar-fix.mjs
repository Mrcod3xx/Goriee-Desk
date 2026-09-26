import puppeteer from "puppeteer-core";
import path from "path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3000";
const OUT = path.join(process.cwd(), "test", "screenshots");

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ["--no-sandbox"],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
await page.goto(BASE, { waitUntil: "networkidle0" });
await new Promise(r => setTimeout(r, 1500));

// Scroll down 500px
await page.evaluate(() => window.scrollTo(0, 500));
await new Promise(r => setTimeout(r, 500));

// Take a normal viewport screenshot (NOT fullPage) to see what the user actually sees on screen
const fp = path.join(OUT, "viewport_scrolled_sidebar_fixed.png");
await page.screenshot({ path: fp, fullPage: false });
console.log("Captured viewport scrolled screenshot:", fp);

const sbInfo = await page.evaluate(() => {
  const sb = document.querySelector(".sidebar");
  const rect = sb.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, height: rect.height, windowH: window.innerHeight };
});
console.log("Sidebar rect:", sbInfo);

await browser.close();
