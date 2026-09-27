import puppeteer from "puppeteer-core";
import assert from "node:assert";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3000";

async function main() {
  console.log("Starting AI Handout verification in headless Chrome...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
    defaultViewport: { width: 1440, height: 1100 },
  });

  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto(BASE, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 1000));

    // 1. Navigate to Settings tab
    console.log("Navigating to Settings tab...");
    const navButtons = await page.$$("button.nav-item");
    let settingsNavBtn = null;
    for (const btn of navButtons) {
      const text = await btn.evaluate((el) => el.textContent);
      if (text && text.toLowerCase().includes("settings")) {
        settingsNavBtn = btn;
        break;
      }
    }
    assert.ok(settingsNavBtn, "Settings nav button must exist");
    await settingsNavBtn.click();
    await new Promise((r) => setTimeout(r, 1500));

    // 2. Verify AI Handout section exists
    const handoutSection = await page.waitForSelector(".ai-handout-section", { timeout: 5000 });
    assert.ok(handoutSection, "AI Handout section must exist");
    console.log("✓ Found AI Handout section!");

    // 3. Verify quick-fill model cards
    const cards = await page.$$(".ai-handout-card");
    console.log(`✓ Found ${cards.length} quick-fill model cards`);
    assert.strictEqual(cards.length, 6, "Must render all 6 quick-fill model cards");

    // 4. Test clicking a quick-fill card (e.g. DeepSeek R1)
    console.log("Testing click on DeepSeek R1 card...");
    await cards[0].click();
    await new Promise((r) => setTimeout(r, 500));

    // Check that form input updated
    const modelInputVal = await page.$eval("#ai-model", (el) => el.value);
    console.log("✓ Form model input value after click:", modelInputVal);
    assert.strictEqual(modelInputVal, "deepseek/deepseek-r1", "Model input must update to deepseek/deepseek-r1");

    // 5. Test copy .env button
    const copyBtn = await page.$(".ai-handout-env-btn");
    assert.ok(copyBtn, "Copy .env button must exist");

    // 6. Capture screenshot
    await page.screenshot({ path: "test/screenshots/ai-handout-settings.png", fullPage: true });
    console.log("✓ Saved screenshot to test/screenshots/ai-handout-settings.png");

    console.log("✓ ALL AI HANDOUT TESTS PASSED!");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
