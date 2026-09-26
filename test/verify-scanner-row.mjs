import puppeteer from 'puppeteer-core';
import path from 'path';

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.resolve('test/screenshots');

async function run() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,960']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 960 });

  await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });
  const navButtons = await page.$$('.nav-item');
  await navButtons[1].click(); // Market scanner
  await page.waitForSelector('.scanner-row', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 600));

  const firstRow = await page.$('.scanner-row');
  if (firstRow) {
    await firstRow.screenshot({ path: path.join(SCREENSHOT_DIR, 'scanner_row_buttons_normal.png') });
    console.log('Captured full scanner row normal');

    const deskBtn = await firstRow.$('.scanner-action-open');
    if (deskBtn) {
      await deskBtn.hover();
      await new Promise(r => setTimeout(r, 200));
      await firstRow.screenshot({ path: path.join(SCREENSHOT_DIR, 'scanner_row_desk_hover.png') });
      console.log('Captured full scanner row Desk hover');
    }

    const backtestBtn = await firstRow.$('.scanner-action-backtest');
    if (backtestBtn) {
      await backtestBtn.hover();
      await new Promise(r => setTimeout(r, 200));
      await firstRow.screenshot({ path: path.join(SCREENSHOT_DIR, 'scanner_row_backtest_hover.png') });
      console.log('Captured full scanner row Backtest hover');
    }
  }

  await browser.close();
}

run().catch(console.error);
