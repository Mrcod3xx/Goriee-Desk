import puppeteer from "puppeteer-core";
import assert from "node:assert";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3000";

async function clickNavTab(page, label) {
  const buttons = await page.$$("button.nav-item");
  for (const btn of buttons) {
    const text = await btn.evaluate((el) => el.textContent);
    if (text && text.toLowerCase().includes(label.toLowerCase())) {
      await btn.click();
      return true;
    }
  }
  return false;
}

async function main() {
  console.log("Starting Historical Trade Replay handoff verification...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox"],
    defaultViewport: { width: 1440, height: 900 },
  });

  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    // Seed completed paper trade into localStorage
    const now = Date.now();
    const seedTrades = [
      {
        id: "seed-buy-1",
        symbol: "BTCUSDT",
        side: "buy",
        quantity: 0.05,
        price: 61250,
        createdAt: now - 3600000 * 8,
        feeBps: 10,
        playbookName: "Classic 20/50 Trend Following",
      },
      {
        id: "seed-sell-1",
        symbol: "BTCUSDT",
        side: "sell",
        quantity: 0.05,
        price: 64500,
        createdAt: now - 3600000 * 2,
        feeBps: 10,
        exitNote: "Take-Profit target reached at resistance band",
      },
    ];

    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.evaluate((trades) => {
      localStorage.setItem("goriee.paper.v1", JSON.stringify(trades));
    }, seedTrades);
    await page.reload({ waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 2000));

    // 1. Verify Paper Account -> Trade Review -> Trade Replay handoff
    console.log("Navigating to Paper account tab...");
    const clickedPaper = await clickNavTab(page, "Paper account");
    assert.ok(clickedPaper, "Should navigate to Paper account");
    await new Promise((r) => setTimeout(r, 1500));

    // Click Trade review tab inside paper account
    const headingButtons = await page.$$(".paper-heading-actions button");
    let reviewTabFound = false;
    for (const btn of headingButtons) {
      const text = await btn.evaluate((el) => el.textContent);
      if (text && text.includes("Trade review")) {
        await btn.click();
        reviewTabFound = true;
        break;
      }
    }
    assert.ok(reviewTabFound, "Should find and click Trade review tab");
    await new Promise((r) => setTimeout(r, 1200));

    // Verify paper trade card is rendered with Replay button
    const paperReplayBtn = await page.$(".paper-replay-quick-btn, .paper-replay-handoff-btn");
    assert.ok(paperReplayBtn, "Trade replay button should be rendered on completed paper trade item");
    console.log("✓ Found paper trade Replay button!");

    // Click Replay button to trigger handoff into Replay Studio
    console.log("Triggering Replay from Paper Trade...");
    await paperReplayBtn.click();
    await new Promise((r) => setTimeout(r, 2000));

    // Verify we are now in Replay view with Trade Review HUD
    const reviewHud = await page.waitForSelector(".replay-review-hud", { timeout: 5000 });
    assert.ok(reviewHud, "Trade Review HUD must appear in Replay Studio");

    const hudText = await reviewHud.evaluate((el) => el.textContent);
    console.log("✓ Review HUD text:", hudText);
    assert.ok(hudText.includes("Paper Review"), "HUD should indicate Paper Review origin");
    assert.ok(hudText.includes("BTCUSDT"), "HUD should indicate BTCUSDT symbol");
    assert.ok(hudText.includes("LONG"), "HUD should indicate LONG side");

    // Verify Jump buttons exist
    const setupBtn = await page.$(".replay-hud-action-btn");
    assert.ok(setupBtn, "Setup (-25b) jump button should exist");

    // Capture screenshot of Replay HUD and PriceChart target corridors
    await page.screenshot({ path: "test/screenshots/12-historical-trade-replay-hud.png" });
    console.log("✓ Saved screenshot to test/screenshots/12-historical-trade-replay-hud.png");

    // Test Return to Paper Review
    const returnBtn = await page.$(".replay-hud-exit-btn");
    assert.ok(returnBtn, "Return to Paper Review button should exist");
    const returnBtnText = await returnBtn.evaluate((el) => el.textContent);
    console.log("✓ Return button label:", returnBtnText.trim());
    assert.ok(returnBtnText.includes("Paper Review"), "Button label should point to Paper Review");

    await returnBtn.click();
    await new Promise((r) => setTimeout(r, 1500));

    // Verify we are back on Paper account
    const activeNav = await page.$eval("button.nav-item.active, button.nav-item[aria-current='page']", (el) => el.textContent);
    console.log("✓ Active nav tab after returning:", activeNav.trim());
    assert.ok(activeNav.includes("Paper"), "Must return to Paper account tab");

    assert.equal(errors.length, 0, `Expected 0 console errors, got: ${errors.join("; ")}`);
    console.log("✓ All Historical Trade Replay handoff and return tests passed with 0 console errors!");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
