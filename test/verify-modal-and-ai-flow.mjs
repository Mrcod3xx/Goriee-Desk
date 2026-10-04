import puppeteer from "puppeteer-core";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots");

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function run() {
  console.log("Starting Demo Notice Modal and AI Provider Verification...");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-modal-test-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: tempDir,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1440,960",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 960 });

    console.log("1. Navigating to", BASE_URL);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 20000 });

    // Step 1: Verify modal is present and visible
    console.log("2. Verifying modal presence...");
    const modalEl = await page.waitForSelector(".demo-notice-modal", { timeout: 10000 });
    assert.ok(modalEl, "Demo notice modal should be rendered on initial load");

    // Check modal contents
    const modalText = await page.$eval(".demo-notice-modal", (el) => el.textContent);
    console.log("Modal text excerpt:", modalText.substring(0, 150));

    assert.ok(modalText.includes("Welcome to Goriee AI Desk"), "Title should greet user");
    assert.ok(modalText.includes("Locally Developed Demo App"), "Must disclose demo app locally developed by owner");
    assert.ok(modalText.includes("Run Locally to Unlock Full Potential"), "Must state app must be run locally for full potential");
    assert.ok(modalText.includes("Use Your Own AI Provider"), "Must state users should use own AI provider for accurate readings");
    assert.ok(modalText.includes("Unrestricted Access with Your Own Key"), "Must explain restrictions due to funding and own key unlocks full access");

    // Step 2: Attempt dismissal via Escape key - must NOT close
    console.log("3. Testing Escape key prevention...");
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 500));
    const stillPresentAfterEsc = await page.$(".demo-notice-modal");
    assert.ok(stillPresentAfterEsc, "Modal must NOT close on Escape key");

    // Step 3: Attempt dismissal via backdrop click - must NOT close
    console.log("4. Testing backdrop click prevention...");
    await page.mouse.click(10, 10);
    await new Promise((r) => setTimeout(r, 500));
    const stillPresentAfterBackdrop = await page.$(".demo-notice-modal");
    assert.ok(stillPresentAfterBackdrop, "Modal must NOT close on backdrop click");

    // Capture screenshot of open modal
    const modalScreenshotPath = path.join(SCREENSHOT_DIR, "demo_notice_modal_verified.png");
    await page.screenshot({ path: modalScreenshotPath });
    console.log("Saved screenshot:", modalScreenshotPath);

    // Step 4: Click "I Understand, Continue" button
    console.log("5. Clicking 'I Understand, Continue'...");
    const continueBtn = await page.waitForSelector("#demo-notice-continue-btn", { timeout: 5000 });
    const btnText = await page.$eval("#demo-notice-continue-btn", (el) => el.textContent.trim());
    assert.ok(btnText.includes("I Understand, Continue"), "Button text must be 'I Understand, Continue'");

    await continueBtn.click();

    // Verify modal dismissed
    await page.waitForFunction(() => !document.querySelector(".demo-notice-modal"), { timeout: 5000 });
    console.log("Modal successfully dismissed!");

    // Step 5: Verify main desk is now interactive
    await page.waitForSelector(".brand-name", { timeout: 5000 });
    console.log("Main desk is active.");

    // Step 6: Verify Settings view allows entering custom AI provider without restrictions
    console.log("6. Testing AI Provider Settings...");
    // Find and click the Settings item in the primary nav
    await page.evaluate(() => {
      const navButtons = Array.from(document.querySelectorAll(".primary-nav button"));
      const settingsBtn = navButtons.find((btn) => btn.textContent && btn.textContent.includes("Settings"));
      if (settingsBtn) {
        settingsBtn.click();
      } else {
        throw new Error("Settings button not found in primary-nav");
      }
    });

    await page.waitForSelector(".provider-form", { timeout: 5000 });
    
    // Check fields are editable
    const isModelDisabled = await page.$eval("#ai-model", (el) => el.disabled);
    assert.strictEqual(isModelDisabled, false, "Model input must not be disabled");

    const isApiKeyDisabled = await page.$eval("#ai-api-key", (el) => el.disabled);
    assert.strictEqual(isApiKeyDisabled, false, "API Key input must not be disabled");

    const isBaseUrlDisabled = await page.$eval("#ai-base-url", (el) => el.disabled);
    assert.strictEqual(isBaseUrlDisabled, false, "Base URL input must not be disabled");

    // Fill in custom provider details to test client-side persistence and lack of limitation
    await page.focus("#ai-base-url");
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.type("#ai-base-url", "https://api.openai.com/v1");

    await page.focus("#ai-model");
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.type("#ai-model", "gpt-4o-mini");

    await page.focus("#ai-api-key");
    await page.type("#ai-api-key", "sk-custom-test-key-12345");

    // Click Save settings
    await page.click(".provider-form button[type='submit']");
    await new Promise((r) => setTimeout(r, 1000));

    // Verify localStorage has custom credentials stored
    const storedCustomLlm = await page.evaluate(() => window.localStorage.getItem("goriee.custom-llm.v1"));
    assert.ok(storedCustomLlm, "Custom LLM config must be stored in localStorage");
    const parsedCustom = JSON.parse(storedCustomLlm);
    assert.equal(parsedCustom.baseUrl, "https://api.openai.com/v1");
    assert.equal(parsedCustom.model, "gpt-4o-mini");

    // Verify custom provider active banner is rendered
    await page.waitForSelector(".provider-custom-banner", { timeout: 5000 });
    const bannerText = await page.$eval(".provider-custom-banner", (el) => el.textContent);
    assert.ok(bannerText.includes("Custom Provider Active"), "Banner must announce active custom provider");

    const settingsScreenshotPath = path.join(SCREENSHOT_DIR, "provider_settings_unrestricted.png");
    await page.screenshot({ path: settingsScreenshotPath });
    console.log("Saved settings screenshot:", settingsScreenshotPath);

    console.log("ALL MODAL & AI FLOW CHECKS PASSED!");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
