import puppeteer from "puppeteer-core";
import os from "os";
import path from "path";
import fs from "fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(process.cwd(), "test", "screenshots", "audit");

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function runAudit() {
  console.log("=== STARTING COMPREHENSIVE WEBAPP BUG AUDIT ===");
  const issues = [];
  const consoleErrors = [];
  const consoleWarns = [];
  const networkErrors = [];

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puppeteer-audit-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: tempDir,
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1600,1000"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  page.on("pageerror", (err) => {
    console.error("[PAGE_ERROR]", err.message);
    issues.push({ type: "uncaught_exception", message: err.message, stack: err.stack });
  });

  page.on("console", (msg) => {
    const text = msg.text();
    const type = msg.type();
    if (type === "error") {
      consoleErrors.push(text);
      // Filter out expected network aborts if any
      if (!text.includes("favicon") && !text.includes("ERR_BLOCKED_BY_CLIENT")) {
        issues.push({ type: "console_error", message: text });
      }
    } else if (type === "warning") {
      consoleWarns.push(text);
    }
  });

  page.on("response", (res) => {
    if (res.status() >= 400) {
      const url = res.url();
      if (!url.includes("favicon.ico")) {
        networkErrors.push({ url, status: res.status() });
        issues.push({ type: "http_error", url, status: res.status() });
      }
    }
  });

  // Helper to check for NaN, undefined, or broken text in DOM
  async function checkDomArtifacts(viewName) {
    const anomalies = await page.evaluate((view) => {
      const results = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const parentTag = node.parentElement?.tagName;
        if (parentTag === "SCRIPT" || parentTag === "STYLE" || parentTag === "NOSCRIPT") continue;
        const txt = node.textContent?.trim() || "";
        if (!txt) continue;
        // Check for NaN in numerical displays (excluding words like 'Banana' or 'NAND')
        if (/\bNaN\b|\$NaN|NaN%/.test(txt)) {
          results.push({ anomaly: "NaN", text: txt, parentTag: node.parentElement?.tagName, className: node.parentElement?.className });
        }
        if (/\bundefined\b/.test(txt)) {
          results.push({ anomaly: "undefined", text: txt, parentTag: node.parentElement?.tagName, className: node.parentElement?.className });
        }
        if (txt.includes("[object Object]")) {
          results.push({ anomaly: "object_stringified", text: txt, parentTag: node.parentElement?.tagName, className: node.parentElement?.className });
        }
      }
      return results;
    }, viewName);

    if (anomalies.length > 0) {
      console.warn(`[DOM_ANOMALY] in ${viewName}:`, anomalies);
      anomalies.forEach((a) => {
        issues.push({ type: "dom_anomaly", view: viewName, ...a });
      });
    }
  }

  // 1. Load Desk View
  console.log("--> Auditing Desk view...");
  await page.goto(BASE_URL, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1500));
  await checkDomArtifacts("desk");
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "01_desk.png") });

  // Test Desk Interval Changing
  console.log("--> Testing Desk intervals...");
  const intervalBtns = await page.$$(".timeframe-pill-btn, .interval-btn, .chart-interval-btn");
  for (const btn of intervalBtns.slice(0, 3)) {
    await btn.click().catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
  }
  await checkDomArtifacts("desk-intervals");

  // Test Quick Order Modal
  console.log("--> Testing Quick Order Modal & Edge Cases...");
  const quickOrderBtn = await page.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    return btns.find((b) => b.textContent?.includes("Quick order") || b.textContent?.includes("Order"));
  });
  if (quickOrderBtn.asElement()) {
    await quickOrderBtn.asElement().click();
    await new Promise((r) => setTimeout(r, 600));

    // Check modal presence
    const modal = await page.$(".order-modal, .modal-dialog");
    if (!modal) {
      issues.push({ type: "functional_bug", message: "Quick order modal did not open on button click" });
    } else {
      console.log("   Quick Order modal opened successfully.");
      await checkDomArtifacts("order-modal");

      // Test Escape key close
      await page.keyboard.press("Escape");
      await new Promise((r) => setTimeout(r, 400));
      const modalClosed = await page.$eval(".order-modal, .modal-dialog", (el) => el === null).catch(() => true);
      if (!modalClosed) {
        issues.push({ type: "a11y_bug", message: "Order modal cannot be dismissed with Escape key" });
      } else {
        console.log("   Order modal closed cleanly via Escape.");
      }
    }
  }

  // Test Command Palette (Ctrl+K / Cmd+K)
  console.log("--> Testing Command Palette (Ctrl+K)...");
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyK");
  await page.keyboard.up("Control");
  await new Promise((r) => setTimeout(r, 500));
  const palette = await page.$(".cmd-palette-modal, .cmd-palette-backdrop, [aria-label='Command palette']");
  if (palette) {
    console.log("   Command Palette opened via Ctrl+K.");
    await checkDomArtifacts("command-palette");
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 300));
  } else {
    issues.push({ type: "functional_bug", message: "Command Palette did not open on Ctrl+K" });
  }

  // Helper to switch view
  async function switchView(targetName, navIndex) {
    console.log(`--> Auditing View: ${targetName}...`);
    await page.evaluate((name) => {
      const items = Array.from(document.querySelectorAll(".nav-item, button.nav-item, a.nav-item"));
      const target = items.find((i) => i.textContent?.toLowerCase().includes(name.toLowerCase()));
      if (target) target.click();
    }, targetName);
    await new Promise((r) => setTimeout(r, 1200));
    await checkDomArtifacts(targetName);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `view_${targetName}.png`) });
  }

  // 2. Scanner View
  await switchView("scanner");

  // 3. Research View
  await switchView("research");

  // 4. Backtests View
  await switchView("backtests");

  // 5. Trade Replay View
  await switchView("Trade replay");

  // 6. Playbooks View
  await switchView("playbooks");

  // 6. Paper Account View & Subtabs
  console.log("--> Auditing Paper Account & all subtabs...");
  await switchView("paper");

  const paperSubtabs = ["Account", "Orders", "Review", "Analytics"];
  for (const sub of paperSubtabs) {
    console.log(`   Switching to Paper subtab: ${sub}...`);
    await page.evaluate((subName) => {
      const tabBtns = Array.from(document.querySelectorAll(".paper-tab-btn, .subtab-btn"));
      const btn = tabBtns.find((b) => b.textContent?.includes(subName));
      if (btn) btn.click();
    }, sub);
    await new Promise((r) => setTimeout(r, 1000));
    await checkDomArtifacts(`paper-${sub.toLowerCase()}`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `paper_${sub.toLowerCase()}.png`) });
  }

  // 7. Journal View
  await switchView("journal");

  // 8. Settings View
  await switchView("settings");

  await browser.close();

  console.log("\n=== AUDIT RESULTS SUMMARY ===");
  console.log(`Total Issues Found: ${issues.length}`);
  console.log(`Console Errors: ${consoleErrors.length}`);
  console.log(`Console Warnings: ${consoleWarns.length}`);
  console.log(`Network Errors: ${networkErrors.length}`);

  if (issues.length > 0) {
    console.log("\nDiscovered Issues Details:");
    console.log(JSON.stringify(issues, null, 2));
  } else {
    console.log("\n✓ No runtime exceptions, console errors, DOM anomalies, or network errors detected across all views!");
  }

  return issues;
}

runAudit().catch(console.error);
