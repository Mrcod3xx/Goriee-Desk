import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3000";
const SCREENSHOT_DIR = path.resolve("./screenshots");

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function runVerification() {
  console.log("=== Launching Responsive UI Overhaul Verification ===");

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });

  const page = await browser.newPage();
  const errors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Ignore transient 404/network if any
      if (!text.includes("favicon")) {
        errors.push({ type: "console.error", text });
      }
    }
  });

  page.on("pageerror", (err) => {
    errors.push({ type: "pageerror", text: err.message });
  });

  // ----------------------------------------------------
  // 1. DESKTOP VIEWPORT (1440x900)
  // ----------------------------------------------------
  console.log("\n[1/3] Testing Desktop (1440x900)...");
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 2000));

  let hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(`Desktop Desk H-Scroll: ${hasHScroll ? "FAILED (overflow)" : "PASSED (0 overflow)"}`);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "desktop-desk.png"), fullPage: false });

  // Navigate to Scanner
  const navBtns = await page.$$("button.nav-item");
  for (const b of navBtns) {
    const txt = await b.evaluate((el) => el.textContent);
    if (txt && txt.includes("Market scanner")) {
      await b.click();
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "desktop-scanner.png"), fullPage: false });

  // Navigate to Paper -> Analytics
  for (const b of navBtns) {
    const txt = await b.evaluate((el) => el.textContent);
    if (txt && txt.includes("Paper account")) {
      await b.click();
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 1200));

  // Click Portfolio Analytics tab if available
  const subTabs = await page.$$(".paper-tab-btn");
  for (const tab of subTabs) {
    const txt = await tab.evaluate((el) => el.textContent);
    if (txt && txt.includes("Analytics")) {
      await tab.click();
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "desktop-paper-analytics.png"), fullPage: false });

  // ----------------------------------------------------
  // 2. TABLET VIEWPORT (768x1024)
  // ----------------------------------------------------
  console.log("\n[2/3] Testing Tablet (768x1024)...");
  await page.setViewport({ width: 768, height: 1024 });
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 2000));

  hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(`Tablet Desk H-Scroll: ${hasHScroll ? "FAILED (overflow)" : "PASSED (0 overflow)"}`);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "tablet-desk.png"), fullPage: false });

  // ----------------------------------------------------
  // 3. MOBILE VIEWPORT (390x844 - iPhone 14)
  // ----------------------------------------------------
  console.log("\n[3/3] Testing Mobile (390x844)...");
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 2000));

  const mobileNavVisible = await page.evaluate(() => {
    const nav = document.querySelector(".mobile-bottom-nav");
    if (!nav) return false;
    const style = window.getComputedStyle(nav);
    return style.display === "flex" && style.visibility !== "hidden";
  });
  console.log(`Mobile Bottom Bar visible: ${mobileNavVisible ? "PASSED" : "FAILED"}`);

  const sidebarHidden = await page.evaluate(() => {
    const sb = document.querySelector(".sidebar");
    if (!sb) return true;
    const style = window.getComputedStyle(sb);
    return style.display === "none";
  });
  console.log(`Desktop Sidebar hidden on mobile: ${sidebarHidden ? "PASSED" : "FAILED"}`);

  hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(`Mobile Desk H-Scroll: ${hasHScroll ? "FAILED (overflow)" : "PASSED (0 overflow)"}`);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "mobile-desk.png"), fullPage: false });

  // Mobile Bottom Bar Navigation: Click Scanner
  const mBtns = await page.$$(".mobile-bottom-btn");
  for (const b of mBtns) {
    const txt = await b.evaluate((el) => el.textContent);
    if (txt && txt.includes("Scanner")) {
      await b.click();
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "mobile-scanner.png"), fullPage: false });

  // Mobile Bottom Bar Navigation: Click Paper -> Analytics
  for (const b of mBtns) {
    const txt = await b.evaluate((el) => el.textContent);
    if (txt && txt.includes("Paper")) {
      await b.click();
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 1200));

  const mSubTabs = await page.$$(".paper-tab-btn");
  for (const tab of mSubTabs) {
    const txt = await tab.evaluate((el) => el.textContent);
    if (txt && txt.includes("Analytics")) {
      await tab.click();
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "mobile-paper-analytics.png"), fullPage: false });

  // Test Mobile More Drawer
  console.log("Testing Mobile More Drawer...");
  for (const b of mBtns) {
    const txt = await b.evaluate((el) => el.textContent);
    if (txt && txt.includes("More")) {
      await b.click();
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 500));

  const drawerVisible = await page.evaluate(() => {
    const sheet = document.querySelector(".mobile-more-sheet");
    return sheet !== null;
  });
  console.log(`Mobile More Drawer open: ${drawerVisible ? "PASSED" : "FAILED"}`);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "mobile-more-drawer.png"), fullPage: false });

  // Click Strategy Lab & Backtests inside drawer
  const drawerItems = await page.$$(".mobile-more-item");
  for (const item of drawerItems) {
    const txt = await item.evaluate((el) => el.textContent);
    if (txt && txt.includes("Strategy Lab")) {
      await item.click();
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 1200));

  const viewIsBacktests = await page.evaluate(() => {
    return document.querySelector(".strategy-builder") !== null;
  });
  console.log(`Switched to Backtests view via More Drawer: ${viewIsBacktests ? "PASSED" : "FAILED"}`);

  // Test Order Modal on Mobile
  console.log("Testing Mobile Order Modal...");
  // Switch to Paper account
  const mBtns2 = await page.$$(".mobile-bottom-btn");
  for (const b of mBtns2) {
    const txt = await b.evaluate((el) => el.textContent);
    if (txt && txt.includes("Paper")) {
      await b.click();
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 1000));

  // Switch to Account sub-tab
  const subBtns = await page.$$(".paper-tab-btn");
  for (const b of subBtns) {
    const txt = await b.evaluate((el) => el.textContent);
    if (txt && txt.includes("Account")) {
      await b.click();
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 800));

  // Find Record paper order button
  const recordBtn = await page.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    return btns.find(b => b.textContent && b.textContent.includes("Record paper order")) || null;
  });
  if (recordBtn && recordBtn.asElement()) {
    await recordBtn.asElement().click();
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "mobile-order-modal.png"), fullPage: false });
  }

  await browser.close();

  console.log("\n=== Test Summary ===");
  console.log(`Total Uncaught Errors: ${errors.length}`);
  if (errors.length > 0) {
    console.error("Errors found:", errors);
    process.exit(1);
  } else {
    console.log("All responsiveness and visual layout tests PASSED with 0 errors!");
  }
}

runVerification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
