import puppeteer from "puppeteer-core";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3000";

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: true,
  args: ["--no-sandbox"],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
await page.goto(BASE, { waitUntil: "networkidle0" });
await new Promise(r => setTimeout(r, 2000));

const info = await page.evaluate(() => {
  const sb = document.querySelector(".sidebar");
  const shell = document.querySelector(".app-shell");
  const body = document.body;
  const html = document.documentElement;

  const sbRect = sb ? sb.getBoundingClientRect() : null;
  const sbStyle = sb ? window.getComputedStyle(sb) : null;
  const shellRect = shell ? shell.getBoundingClientRect() : null;

  return {
    windowHeight: window.innerHeight,
    scrollY: window.scrollY,
    sbRect: sbRect ? { top: sbRect.top, bottom: sbRect.bottom, height: sbRect.height } : null,
    sbMaxHeight: sbStyle ? sbStyle.maxHeight : null,
    sbMinHeight: sbStyle ? sbStyle.minHeight : null,
    sbPosition: sbStyle ? sbStyle.position : null,
    shellHeight: shellRect ? shellRect.height : null,
    scrollHeight: html.scrollHeight,
  };
});

console.log("Initial state:", info);

// Now scroll down 600px
await page.evaluate(() => window.scrollTo(0, 600));
await new Promise(r => setTimeout(r, 500));

const scrolledInfo = await page.evaluate(() => {
  const sb = document.querySelector(".sidebar");
  const sbRect = sb ? sb.getBoundingClientRect() : null;
  return {
    scrollY: window.scrollY,
    sbRect: sbRect ? { top: sbRect.top, bottom: sbRect.bottom, height: sbRect.height } : null,
  };
});

console.log("Scrolled state:", scrolledInfo);

await browser.close();
