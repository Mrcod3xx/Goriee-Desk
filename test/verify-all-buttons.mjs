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

  // 1. Capture Scanner action buttons (Image 1 from user)
  const navButtons = await page.$$('.nav-item');
  console.log(`Found ${navButtons.length} nav buttons`);
  
  // Click Market scanner (index 1)
  await navButtons[1].click();
  await page.waitForSelector('.scanner-row', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 600));

  const scannerActions = await page.$('.scanner-actions');
  if (scannerActions) {
    await scannerActions.screenshot({ path: path.join(SCREENSHOT_DIR, 'all_buttons_01_scanner_actions_normal.png') });
    console.log('Captured scanner actions normal');

    // Hover over "Desk" button
    const deskBtn = await page.$('.scanner-action-open');
    if (deskBtn) {
      await deskBtn.hover();
      await new Promise(r => setTimeout(r, 200));
      await scannerActions.screenshot({ path: path.join(SCREENSHOT_DIR, 'all_buttons_02_scanner_desk_hover.png') });
      console.log('Captured scanner Desk hover');
    }

    // Hover over "Brief" button
    const briefBtn = await page.$('.scanner-action-brief');
    if (briefBtn) {
      await briefBtn.hover();
      await new Promise(r => setTimeout(r, 200));
      await scannerActions.screenshot({ path: path.join(SCREENSHOT_DIR, 'all_buttons_03_scanner_brief_hover.png') });
      console.log('Captured scanner Brief hover');
    }

    // Hover over "Backtest" button
    const backtestBtn = await page.$('.scanner-action-backtest');
    if (backtestBtn) {
      await backtestBtn.hover();
      await new Promise(r => setTimeout(r, 200));
      await scannerActions.screenshot({ path: path.join(SCREENSHOT_DIR, 'all_buttons_04_scanner_backtest_hover.png') });
      console.log('Captured scanner Backtest hover');
    }

    // Hover over "+ Watch" button
    const watchBtn = await page.$('.scanner-action-add');
    if (watchBtn) {
      await watchBtn.hover();
      await new Promise(r => setTimeout(r, 200));
      await scannerActions.screenshot({ path: path.join(SCREENSHOT_DIR, 'all_buttons_05_scanner_watch_hover.png') });
      console.log('Captured scanner + Watch hover');
    }
  }

  // 2. Capture Research Workspace "Browse markets" (Image 2 from user)
  // Click Research (index 2)
  await navButtons[2].click();
  await page.waitForSelector('.research-controls', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 600));

  const researchControls = await page.$('.research-controls');
  if (researchControls) {
    await researchControls.screenshot({ path: path.join(SCREENSHOT_DIR, 'all_buttons_06_research_controls_normal.png') });
    console.log('Captured research controls normal');

    const browseBtn = await page.$('.research-controls .browse-markets-button');
    if (browseBtn) {
      await browseBtn.hover();
      await new Promise(r => setTimeout(r, 200));
      await researchControls.screenshot({ path: path.join(SCREENSHOT_DIR, 'all_buttons_07_research_browse_hover.png') });
      console.log('Captured research browse markets hover');
    }
  }

  // 3. Primary CTA button in Research
  const primaryBtn = await page.$('.research-form .button-primary');
  if (primaryBtn) {
    await primaryBtn.screenshot({ path: path.join(SCREENSHOT_DIR, 'all_buttons_08_primary_cta.png') });
    console.log('Captured primary CTA button');
  }

  // 4. Backtest Strategy Builder "Browse markets" and Compile CTA
  // Click Backtest (index 3)
  await navButtons[3].click();
  await page.waitForSelector('.strategy-builder-controls', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 600));

  const backtestControls = await page.$('.strategy-builder-controls');
  if (backtestControls) {
    await backtestControls.screenshot({ path: path.join(SCREENSHOT_DIR, 'all_buttons_09_backtest_controls.png') });
    console.log('Captured backtest controls');
  }

  await browser.close();
  console.log('All button screenshots captured successfully!');
}

run().catch(err => {
  console.error('Error during verification:', err);
  process.exit(1);
});
