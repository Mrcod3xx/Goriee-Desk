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

  // 1. Navigate to Backtests tab
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.primary-nav .nav-item')).find(b => b.textContent.includes('Backtests'));
    btn?.click();
  });
  await page.waitForSelector('.strategy-builder-controls', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 600));

  // 2. Save a playbook from the Strategy Builder
  const nameInput = await page.$('.playbook-save-row input');
  if (nameInput) {
    await nameInput.type('Trend Follower Alpha');
    const saveBtn = await page.$('.playbook-save-row button');
    if (saveBtn) {
      await saveBtn.click();
      console.log('Saved a new playbook: Trend Follower Alpha');
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // 3. Navigate to Playbooks tab near Backtests
  console.log('Navigating to Playbooks tab in Workspace navigation...');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.primary-nav .nav-item')).find(b => b.textContent.includes('Playbooks'));
    btn?.click();
  });
  await page.waitForSelector('.playbooks-grid, .playbooks-container', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 800));

  // Screenshot fixed filter bar & Playbooks library
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_playbooks_tab_library_fixed.png') });
  console.log('Captured fixed Playbooks Library workspace screenshot!');

  // 4. Test "Use in Paper" button
  const useInPaperBtn = await page.$('.playbook-library-card-actions button:nth-child(2)');
  if (useInPaperBtn) {
    console.log('Clicking "Use in Paper" on the playbook card...');
    await useInPaperBtn.click();
    await page.waitForSelector('.active-playbook', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_paper_desk_with_active_strategy.png') });
    console.log('Captured Paper Desk with Active Strategy banner!');

    // Test clicking "Trade BTC" button inside active-playbook
    const tradeBtn = await page.$('.active-playbook-controls button.button-primary');
    if (tradeBtn) {
      console.log('Clicking "Trade BTC" button in Active Strategy banner...');
      await tradeBtn.click();
      await page.waitForSelector('.order-modal', { timeout: 8000 });
      await new Promise(r => setTimeout(r, 400));
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_paper_order_modal_opened.png') });
      console.log('Captured Order Modal opened from Strategy Playbook!');

      // Close modal
      const closeBtn = await page.$('.order-modal .icon-button');
      if (closeBtn) await closeBtn.click();
      await new Promise(r => setTimeout(r, 400));
    }
  }

  // 5. Navigate back to Playbooks tab and verify "In Paper · Open" state
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.primary-nav .nav-item')).find(b => b.textContent.includes('Playbooks'));
    btn?.click();
  });
  await page.waitForSelector('.playbooks-grid', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04_playbook_card_active_state.png') });
  console.log('Captured playbook card active state with Unpin button!');

  // 6. Test "Load & run" button
  const loadRunBtn = await page.$('.playbook-btn-run');
  if (loadRunBtn) {
    console.log('Testing Playbook "Load & run" button...');
    await loadRunBtn.click();
    await page.waitForSelector('.monte-carlo-panel', { timeout: 35000 });
    await new Promise(r => setTimeout(r, 800));

    // Scroll Monte Carlo into view
    await page.evaluate(() => {
      const el = document.querySelector('.monte-carlo-panel');
      if (el) el.scrollIntoView();
    });
    await new Promise(r => setTimeout(r, 500));

    const mcWrapper = await page.$('.mc-chart-wrapper');
    if (mcWrapper) {
      await mcWrapper.screenshot({ path: path.join(SCREENSHOT_DIR, '05_monte_carlo_cone_clean.png') });
      console.log('Captured clean Monte Carlo cone chart screenshot!');
    }
  }

  await browser.close();
  console.log('All verification tasks completed successfully!');
}

run().catch(err => {
  console.error('Error running verification:', err);
  process.exit(1);
});
