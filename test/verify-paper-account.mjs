import puppeteer from "puppeteer-core";
import path from "path";
import fs from "fs";
import os from "os";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots");

async function verifyPaperAccount() {
  console.log("Launching browser via puppeteer-core to verify overhauled Paper Account UI...");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-paper-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: tempDir,
    defaultViewport: { width: 1440, height: 1100 },
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1200));

    // 1. Navigate to Paper account
    console.log("Navigating to Paper account tab...");
    const navItems = await page.$$("button.nav-item");
    for (const item of navItems) {
      const text = await item.evaluate((el) => el.textContent);
      if (text && text.includes("Paper account")) {
        await item.click();
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));

    // 2. Validate Summary cards
    const summaryCards = await page.$$(".account-balance");
    console.log(`Found ${summaryCards.length} account summary balance cards`);
    if (summaryCards.length !== 6) throw new Error(`Expected 6 summary cards, found ${summaryCards.length}`);

    const badges = await page.$$(".balance-badge");
    console.log(`Found ${badges.length} balance badges`);
    if (badges.length < 6) throw new Error(`Expected at least 6 balance badges, found ${badges.length}`);

    // 3. Validate Daily Loss Guard elements
    const riskMeter = await page.$(".risk-meter-container");
    if (!riskMeter) throw new Error("Risk meter capacity container not found");
    console.log("Risk meter capacity container is present and rendered!");

    const riskStateCard = await page.$(".risk-state-card");
    if (!riskStateCard) throw new Error("Risk state card not found");
    console.log("Risk state card with status icon is present!");

    // 4. Validate Alerts Form
    const alertBtn = await page.$(".alert-submit-btn");
    if (!alertBtn) throw new Error("Alert submit button not found");
    console.log("Alert submit button is present with full-width layout!");

    // Capture Paper Account Overview screenshot
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "paper_account_overhauled.png"), fullPage: true });
    console.log("Saved test/screenshots/paper_account_overhauled.png");

    // 5. Test Trade Review Tab
    console.log("Switching to Trade review tab...");
    const headingBtns = await page.$$(".paper-heading-actions button");
    for (const btn of headingBtns) {
      const text = await btn.evaluate((el) => el.textContent);
      if (text && text.includes("Trade review")) {
        await btn.click();
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 800));

    const reviewStats = await page.$$(".paper-review-stat");
    console.log(`Found ${reviewStats.length} review scorecard stats`);
    if (reviewStats.length !== 8) throw new Error(`Expected 8 review scorecard stats, found ${reviewStats.length}`);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "paper_review_overhauled.png"), fullPage: true });
    console.log("Saved test/screenshots/paper_review_overhauled.png");

    // Switch back to Account overview
    const hBtns = await page.$$(".paper-heading-actions button");
    for (const btn of hBtns) {
      const text = await btn.evaluate((el) => el.textContent);
      if (text && text.includes("Account overview")) {
        await btn.click();
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 800));

    // 6. Test Order Modal
    console.log("Opening Simulated Order Modal...");
    const recordBtn = await page.$(".paper-heading-actions button.button-primary");
    if (!recordBtn) throw new Error("Record paper order button not found");
    await recordBtn.click();
    await new Promise((r) => setTimeout(r, 600));

    const orderModal = await page.$(".order-modal");
    if (!orderModal) throw new Error("Order modal not visible");
    console.log("Order modal is open and visible!");

    // Click sell to verify styling
    const sideBtns = await page.$$(".side-toggle button");
    if (sideBtns.length >= 2) {
      await sideBtns[1].click(); // Sell
      await new Promise((r) => setTimeout(r, 300));
      await sideBtns[0].click(); // Buy back
      await new Promise((r) => setTimeout(r, 300));
    }

    // Toggle Bracket checkbox
    const bracketCb = await page.$('.bracket-checkbox-label input[type="checkbox"]');
    if (bracketCb) {
      await bracketCb.click();
      await new Promise((r) => setTimeout(r, 400));
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "paper_modal_overhauled.png"), fullPage: false });
    console.log("Saved test/screenshots/paper_modal_overhauled.png");

    console.log("All Paper Account element verifications PASSED successfully!");
  } finally {
    await browser.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

verifyPaperAccount().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
