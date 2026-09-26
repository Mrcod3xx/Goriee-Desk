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
await new Promise(r => setTimeout(r, 2000));

// Click 4-Chart Matrix toggle
const matrixBtn = await page.waitForSelector('button:has-text("4-Chart Matrix"), button:text-matches("Matrix", "i")');
if (matrixBtn) {
  await matrixBtn.click();
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(OUT, "tab_desk_matrix.png"), fullPage: true });
  console.log("Matrix screenshot captured");
}

await browser.close();
