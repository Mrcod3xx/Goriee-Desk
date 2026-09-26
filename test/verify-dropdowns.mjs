import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.resolve('test/screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function run() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,960']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 960 });

  console.log('Navigating to http://localhost:3000...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });

  const navButtons = await page.$$('.nav-item');
  console.log(`Found ${navButtons.length} nav buttons`);

  // 1. Paper Review controls (Nav 4 -> Click "Trade review")
  if (navButtons[4]) {
    await navButtons[4].click();
    await new Promise(r => setTimeout(r, 600));

    // Find and click "Trade review" button
    const reviewBtn = await page.$('.paper-heading-actions button');
    if (reviewBtn) {
      await reviewBtn.click();
      await page.waitForSelector('.paper-review-controls', { timeout: 10000 });
      await new Promise(r => setTimeout(r, 400));
      const paperReview = await page.$('.paper-review-controls');
      if (paperReview) {
        await paperReview.screenshot({ path: path.join(SCREENSHOT_DIR, 'dropdown_07_paper_review_normal.png') });
        console.log('Captured paper review dropdowns normal');
      }
    }
  }

  // 2. Settings (Nav 6)
  if (navButtons[6]) {
    await navButtons[6].click();
    await page.waitForSelector('#ai-provider', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 400));
    const providerField = await page.$('.provider-field');
    if (providerField) {
      await providerField.screenshot({ path: path.join(SCREENSHOT_DIR, 'dropdown_09_provider_settings_normal.png') });
      console.log('Captured AI provider dropdown normal');

      const providerSelect = await page.$('#ai-provider');
      if (providerSelect) {
        await providerSelect.hover();
        await new Promise(r => setTimeout(r, 200));
        await providerField.screenshot({ path: path.join(SCREENSHOT_DIR, 'dropdown_09_provider_settings_hover.png') });
        console.log('Captured AI provider dropdown hover');
      }
    }
  }

  // 3. Backtest + Monte Carlo panel (Nav 3)
  if (navButtons[3]) {
    await navButtons[3].click();
    await page.waitForSelector('.strategy-builder-controls', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 500));

    const runBtn = await page.$('.strategy-builder-footer .button-primary');
    if (runBtn) {
      console.log('Running backtest for Monte Carlo...');
      await runBtn.click();
      // Wait for .mc-jitter-selector to appear after backtest runs
      try {
        await page.waitForSelector('.mc-jitter-selector select', { timeout: 35000 });
        await new Promise(r => setTimeout(r, 500));
        const mcPanel = await page.$('.mc-jitter-selector');
        if (mcPanel) {
          await mcPanel.screenshot({ path: path.join(SCREENSHOT_DIR, 'dropdown_08_mc_jitter_normal.png') });
          console.log('Captured Monte Carlo jitter select normal');
        }
      } catch (err) {
        console.log('MC panel note:', err.message);
      }
    }
  }

  console.log('Targeted captures complete!');
  await browser.close();
}

run().catch(err => {
  console.error('Error running targeted dropdown verification:', err);
  process.exit(1);
});
