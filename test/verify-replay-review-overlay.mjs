// Trade Replay review-overlay verification.
//
// Scenario A drives the deterministic backtest flow end to end and proves the
// spoiler-free reveal machinery: nothing is drawn before the tape reaches the
// entry bar, the entry level plus the OPEN pin appear while the position runs,
// and the exit line, outcome banner and realized figures only land on the
// closing bar. Backtest trades carry no bracket, so the details must honestly
// read "Not recorded" / "Not derivable".
//
// Scenario B seeds a bracketed paper trade fixture (built from real Bitget
// candles served by /api/market) into the ephemeral headless profile's
// localStorage, replays it from the Paper review journal, and proves the
// Take Profit / Stop Loss lines, corridors, rail tags and R multiple render
// with the recorded values.
import puppeteer from "puppeteer-core";
import assert from "node:assert";
import fs from "node:fs";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:3000";
const SHOTS = "test/screenshots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  console.log("Starting Trade Replay review-overlay verification in headless Chrome...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
    defaultViewport: { width: 1600, height: 1000 },
  });

  try {
    const page = await browser.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // ── helpers ────────────────────────────────────────────────────────────
    const exists = async (sel) => (await page.$(sel)) !== null;

    // NOTE: always read classes with getAttribute("class"), never `.className`.
    // Chart markings such as `.target-trade-pin` are SVG nodes, where
    // `.className` is an SVGAnimatedString object (it serializes to `{}` across
    // the puppeteer boundary) rather than a plain string.
    const classOf = (n) => n.getAttribute("class") || "";

    const phase = async () => {
      const el = await page.waitForSelector(".replay-review-phase", { timeout: 5000 });
      const cls = await el.evaluate(classOf);
      const match = cls.match(/phase-(pre-entry|in-trade|closed)/);
      assert.ok(match, `phase badge must carry a phase class, got "${cls}"`);
      return match[1];
    };

    const detailRows = async () =>
      page.$$eval(".review-detail-row", (rows) =>
        rows.map((row) => ({
          label: row.querySelector(".review-detail-label")?.textContent?.trim() ?? "",
          value: row.querySelector(".review-detail-value")?.textContent?.trim() ?? "",
          cls: row.getAttribute("class") || "",
        }))
      );

    const rowValue = async (label) => {
      const rows = await detailRows();
      const row = rows.find((r) => r.label.toLowerCase() === label.toLowerCase());
      assert.ok(row, `detail row "${label}" must exist (have: ${rows.map((r) => r.label).join(", ")})`);
      return row;
    };

    const scrubTo = async (idx) => {
      await page.evaluate((value) => {
        const el = document.querySelector(".replay-dock-scrubber");
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(el, String(value));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, idx);
      await sleep(500);
    };

    const hudClick = async (label) => {
      const buttons = await page.$$(".replay-review-hud-actions button");
      for (const button of buttons) {
        const text = await button.evaluate((n) => n.textContent || "");
        if (text.toLowerCase().includes(label.toLowerCase())) {
          await button.click();
          await sleep(500);
          return;
        }
      }
      assert.fail(`HUD action button containing "${label}" not found`);
    };

    // Chrome re-serializes the inline calc() expression (setting
    // "calc(7.5px + 0.42 * (100% - 15px))" reads back as "calc(42% + 1.2px)"),
    // so parsing the style string is unreliable. Measure the rendered geometry
    // instead: each tick is absolutely positioned (and centred via translate)
    // inside the range input's thumb travel, inset 7.5px at both ends.
    const markerFrac = async (sel) =>
      page.$eval(sel, (el) => {
        const track = el.closest(".replay-dock-scrubber-track");
        if (!track) return null;
        const t = track.getBoundingClientRect();
        const m = el.getBoundingClientRect();
        const inset = 7.5;
        const travel = t.width - inset * 2;
        if (travel <= 0) return null;
        const frac = (m.left + m.width / 2 - t.left - inset) / travel;
        return Number.isFinite(frac) ? frac : null;
      });

    const clickNav = async (needle) => {
      const buttons = await page.$$("button.nav-item");
      for (const button of buttons) {
        const text = await button.evaluate((n) => n.textContent || "");
        if (text.toLowerCase().includes(needle.toLowerCase())) {
          await button.click();
          await sleep(1000);
          return;
        }
      }
      assert.fail(`nav item containing "${needle}" not found`);
    };

    await page.goto(BASE, { waitUntil: "networkidle0" });
    await sleep(1200);

    // ══ Scenario A — backtest trade review (no bracket, honest fallbacks) ══
    console.log("[A] Running backtest and opening Replay Studio...");
    await clickNav("backtest");
    const runBtn = await page.waitForSelector(
      "button.backtest-run-button, button.run-backtest-btn, button[type='submit']",
      { timeout: 5000 }
    );
    await runBtn.click();
    await page.waitForSelector(".backtest-trade-highlights, .simulated-trades-table", { timeout: 60000 });
    const replayBtn = await page.waitForSelector(".highlight-replay-btn, .backtest-replay-row-btn", { timeout: 5000 });
    await replayBtn.click();
    await page.waitForSelector(".replay-review-hud", { timeout: 8000 });
    await page.waitForSelector(".replay-dock-scrubber", { timeout: 8000 });
    const hudTag = await page.$eval(".replay-review-tag", (n) => n.textContent || "");
    assert.ok(hudTag.includes("Backtest Review"), `HUD must say Backtest Review, got "${hudTag.trim()}"`);

    // A1 — playhead before the entry bar: the chart must reveal nothing.
    await scrubTo(0);
    assert.strictEqual(await phase(), "pre-entry");
    for (const sel of [
      ".target-trade-line-entry",
      ".target-trade-line-tp",
      ".target-trade-line-sl",
      ".target-trade-line-exit",
      ".target-trade-pin",
      ".rail-tag-review",
      ".review-outcome-banner",
    ]) {
      assert.ok(!(await exists(sel)), `pre-entry phase must NOT render ${sel} (no hindsight)`);
    }
    const entryRowA1 = await rowValue("Entry price");
    assert.strictEqual(entryRowA1.value, "Awaiting fill");
    assert.match(entryRowA1.cls, /tone-pending/);
    assert.match((await rowValue("Exit price")).value, /still open/i);
    assert.ok(await exists(".replay-review-metric.is-pending"), "HUD must show a pending entry metric");
    const hintA1 = await page.$eval(".review-hint", (n) => n.textContent || "");
    assert.ok(hintA1.toLowerCase().includes("entry bar"), "hint must explain the pending reveal");
    await page.screenshot({ path: `${SHOTS}/replay-review-1-pre-entry.png` });
    console.log("[A1] pre-entry: zero spoilers, pending readouts OK");

    // A2 — tape reaches the entry bar: entry level + OPEN pin, exit withheld.
    await hudClick("Entry Bar");
    assert.strictEqual(await phase(), "in-trade");
    for (const sel of [
      ".target-trade-line-entry",
      ".target-trade-pin.pin-entry",
      ".target-trade-event-line.event-entry",
      ".target-trade-trajectory",
      ".rail-tag-review.tone-entry",
      ".target-trade-pin.pin-live",
      ".scrubber-marker.marker-entry",
      ".scrubber-marker.marker-exit",
    ]) {
      assert.ok(await exists(sel), `in-trade phase must render ${sel}`);
    }
    const entryCaption = await page.$eval(".target-trade-caption.caption-entry", (n) => n.textContent || "");
    assert.ok(entryCaption.startsWith("ENTRY $"), `entry caption must read "ENTRY $...", got "${entryCaption}"`);
    const liveCaption = await page.$eval(".target-trade-caption.caption-live", (n) => (n.textContent || "").trim());
    assert.strictEqual(liveCaption, "OPEN");
    assert.ok(!(await exists(".target-trade-line-exit")), "exit line must stay hidden while open");
    assert.ok(!(await exists(".pin-exit")), "exit pin must stay hidden while open");
    assert.ok(!(await exists(".review-outcome-banner")), "outcome banner must stay hidden while open");
    assert.strictEqual((await rowValue("Entry price")).value.startsWith("$"), true);
    assert.strictEqual((await rowValue("Stop Loss")).value, "Not recorded");
    assert.strictEqual((await rowValue("Take Profit")).value, "Not recorded");
    assert.strictEqual((await rowValue("Planned R:R")).value, "Not derivable");
    assert.match((await rowValue("Exit price")).value, /still open/i);
    assert.match((await rowValue("Bars held so far")).value, /^\d+$/);
    const hudOpen = await page.$eval(".replay-review-hud-left", (n) => n.textContent || "");
    assert.ok(hudOpen.includes("Open P/L"), "HUD must offer an Open P/L slot while in trade");
    // Timeline ticks must map back onto real bar indices.
    const scrubberMax = await page.$eval(".replay-dock-scrubber", (el) => Number(el.max));
    const entryFrac = await markerFrac(".scrubber-marker.marker-entry");
    const exitFrac = await markerFrac(".scrubber-marker.marker-exit");
    assert.ok(entryFrac !== null && exitFrac !== null, "scrubber markers must carry timeline fractions");
    assert.ok(entryFrac >= 0 && entryFrac <= 1, `ENTRY tick must sit inside the timeline, got ${entryFrac}`);
    assert.ok(exitFrac >= 0 && exitFrac <= 1, `EXIT tick must sit inside the timeline, got ${exitFrac}`);
    assert.ok(Math.round(exitFrac * scrubberMax) > Math.round(entryFrac * scrubberMax), "EXIT tick must sit after ENTRY tick");
    await page.screenshot({ path: `${SHOTS}/replay-review-2-in-trade.png` });
    // Keyboard stepping on the focused scrubber advances the tape.
    await page.$eval(".replay-dock-scrubber", (el) => el.focus());
    const barBefore = await page.$eval(".timeline-bar-count", (n) => n.textContent || "");
    await page.keyboard.press("ArrowRight");
    await sleep(400);
    const barAfter = await page.$eval(".timeline-bar-count", (n) => n.textContent || "");
    assert.notStrictEqual(barBefore, barAfter, "ArrowRight on the scrubber must step the tape one bar");
    assert.ok(["in-trade", "closed"].includes(await phase()), "stepping forward keeps a valid phase");
    console.log("[A2] in-trade: entry line, OPEN pin, honest 'Not recorded' brackets OK");

    // A3 — tape reaches the closing bar: exit line, banner, realized values.
    await hudClick("Exit Bar");
    assert.strictEqual(await phase(), "closed");
    assert.ok(await exists(".target-trade-line-exit"), "closed phase must render the exit line");
    assert.ok(await exists(".target-trade-line-exit.is-hit"), "exit line must carry hit emphasis");
    assert.ok(await exists(".target-trade-event-line.event-exit"), "exit event line must render");
    const exitPinCls = await page.$eval(".target-trade-pin.pin-exit", classOf);
    assert.match(exitPinCls, /is-win|is-loss/, "exit pin must carry a win/loss tone");
    const exitCaption = await page.$eval(".target-trade-caption.caption-exit", (n) => n.textContent || "");
    assert.ok(exitCaption.startsWith("EXIT $"), `exit caption must read "EXIT $...", got "${exitCaption}"`);
    assert.ok(!(await exists(".target-trade-pin.pin-live")), "OPEN pin must disappear after close");
    const bannerCls = await page.$eval(".review-outcome-banner", classOf);
    assert.match(bannerCls, /outcome-(signal_exit|end_of_data|unknown)/, "backtest outcome class");
    assert.match(bannerCls, /is-win|is-loss/, "banner win/loss state");
    const bannerLabel = await page.$eval(".review-outcome-label", (n) => (n.textContent || "").trim());
    assert.ok(bannerLabel.length > 3, "outcome label must be populated");
    assert.match(await page.$eval(".review-outcome-pnl", (n) => n.textContent || ""), /\$/, "banner P&L");
    assert.strictEqual((await rowValue("Exit price")).value.startsWith("$"), true);
    assert.match((await rowValue("Bars held")).value, /^\d+$/);
    assert.strictEqual((await rowValue("Result (R multiple)")).value, "Not derivable");
    const railExit = await page.$$(".rail-tag-review");
    assert.ok(railExit.length >= 2, "rail must stack ENTRY plus EXIT tags after close");
    const hintA3 = await page.$eval(".review-hint", (n) => n.textContent || "");
    assert.ok(hintA3.includes("ENTRY and EXIT ticks"), "closed hint must point at the timeline ticks");
    await page.screenshot({ path: `${SHOTS}/replay-review-3-closed.png` });
    console.log(`[A3] closed: exit emphasis, "${bannerLabel}" banner, realized rows OK`);

    // ══ Scenario B — bracketed paper trade review (real TP/SL rendering) ══
    console.log("[B] Building bracketed paper fixture from live /api/market candles...");
    const marketRes = await fetch(`${BASE}/api/market?symbol=BTCUSDT&interval=1H&limit=300`);
    assert.ok(marketRes.ok, `/api/market must respond, got ${marketRes.status}`);
    const marketJson = await marketRes.json();
    const candles = marketJson?.market?.candles ?? [];
    assert.ok(candles.length >= 120, `fixture needs >=120 candles, got ${candles.length}`);
    const entryBar = candles[candles.length - 60];
    const exitBar = candles[candles.length - 12];
    const round2 = (v) => Math.round(v * 100) / 100;
    const entryPrice = round2(entryBar.close);
    const tpPrice = round2(entryPrice * 1.012);
    const slPrice = round2(entryPrice * 0.988);
    const quantity = 0.005;
    const seed = [
      {
        id: "seed-review-buy",
        symbol: "BTCUSDT",
        side: "buy",
        quantity,
        price: entryPrice,
        createdAt: entryBar.time,
        feeBps: 10,
      },
      {
        id: "seed-review-sell",
        symbol: "BTCUSDT",
        side: "sell",
        quantity,
        price: tpPrice,
        createdAt: exitBar.time,
        feeBps: 10,
        exitReason: "take_profit",
        bracketSnapshot: { takeProfitPrice: tpPrice, stopLossPrice: slPrice },
        exitNote: `Take-Profit hit at $${tpPrice.toFixed(2)}`,
      },
    ];
    await page.evaluateOnNewDocument((rows) => {
      window.localStorage.setItem("goriee.paper.v1", JSON.stringify(rows));
    }, seed);
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector(".price-chart-container svg rect, .chart-wrap svg rect", { timeout: 30000 });

    await clickNav("paper");
    const tabs = await page.$$(".paper-tab-btn");
    let reviewTab = null;
    for (const tab of tabs) {
      const text = await tab.evaluate((n) => n.textContent || "");
      if (text.toLowerCase().includes("trade review")) {
        reviewTab = tab;
        break;
      }
    }
    assert.ok(reviewTab, "Paper 'Trade review' tab must exist");
    await reviewTab.click();
    await sleep(700);
    await page.waitForSelector(".paper-review-entry", { timeout: 5000 });
    await page.click(".paper-review-entry .paper-replay-quick-btn");
    await page.waitForSelector(".replay-review-hud", { timeout: 8000 });
    await page.waitForSelector(".replay-dock-scrubber", { timeout: 15000 });
    const hudTagB = await page.$eval(".replay-review-tag", (n) => n.textContent || "");
    assert.ok(hudTagB.includes("Paper Review"), `HUD must say Paper Review, got "${hudTagB.trim()}"`);

    // B1 — rewind: brackets must stay hidden before the entry bar.
    await scrubTo(0);
    assert.strictEqual(await phase(), "pre-entry");
    assert.ok(!(await exists(".target-trade-line-entry")), "entry line hidden pre-entry");
    assert.ok(!(await exists(".target-trade-line-tp")), "take profit hidden pre-entry");
    assert.ok(!(await exists(".target-trade-line-sl")), "stop loss hidden pre-entry");
    await page.screenshot({ path: `${SHOTS}/replay-review-4-paper-pre-entry.png` });

    // B2 — entry bar: full bracket reveal with price captions and rail tags.
    await hudClick("Entry Bar");
    assert.strictEqual(await phase(), "in-trade");
    for (const sel of [
      ".target-trade-line-entry",
      ".target-trade-line-tp",
      ".target-trade-line-sl",
      ".rail-tag-review.tone-entry",
      ".rail-tag-review.tone-tp",
      ".rail-tag-review.tone-sl",
      ".target-trade-pin.pin-live",
    ]) {
      assert.ok(await exists(sel), `paper in-trade phase must render ${sel}`);
    }
    // The shaded corridors span entry -> playhead, so on the entry bar itself
    // they enclose zero width and are deliberately not drawn.
    assert.ok(
      !(await exists(".target-trade-corridor")),
      "corridors must have no area on the entry bar itself (nothing has elapsed yet)"
    );
    const tpCaption = await page.$eval(".target-trade-caption.caption-tp", (n) => n.textContent || "");
    assert.ok(tpCaption.startsWith("TAKE PROFIT $"), `TP caption, got "${tpCaption}"`);
    const slCaption = await page.$eval(".target-trade-caption.caption-sl", (n) => n.textContent || "");
    assert.ok(slCaption.startsWith("STOP LOSS $"), `SL caption, got "${slCaption}"`);
    assert.ok(!(await exists(".target-trade-line-exit")), "exit line hidden while open");
    assert.ok(!(await exists(".review-outcome-banner")), "banner hidden while open");
    const slRow = await rowValue("Stop Loss");
    assert.ok(slRow.value.startsWith("$"), "SL row value");
    assert.strictEqual(Number(slRow.value.replace(/[$,]/g, "")).toFixed(2), slPrice.toFixed(2), "SL row must match the recorded bracket");
    const tpRow = await rowValue("Take Profit");
    assert.strictEqual(Number(tpRow.value.replace(/[$,]/g, "")).toFixed(2), tpPrice.toFixed(2), "TP row must match the recorded bracket");
    assert.strictEqual((await rowValue("Planned R:R")).value, "1.00 : 1");
    assert.match((await rowValue("Exit price")).value, /still open/i);
    assert.ok(await rowValue("Open P/L"), "floating P&L row must appear while open");
    const hudOpenB = await page.$eval(".replay-review-pnl", (n) => n.textContent || "");
    assert.ok(hudOpenB.startsWith("Open:"), `HUD floating P&L, got "${hudOpenB.trim()}"`);
    await page.screenshot({ path: `${SHOTS}/replay-review-5-paper-brackets.png` });
    console.log("[B2] paper in-trade: entry/TP/SL lines, rail tags, honest brackets, floating P&L OK");

    // B2b — advance the tape: the risk/reward corridors fill in behind the
    // playhead and keep growing, which is what makes the bracket legible.
    const corridorWidth = async (sel) =>
      page.$eval(sel, (el) => Number(el.getAttribute("width")));
    const barIndex = async () => {
      const text = await page.$eval(".timeline-bar-count", (n) => n.textContent || "");
      const match = text.match(/Bar\s*(\d+)\s*of/i);
      assert.ok(match, `must be able to read the bar counter, got "${text.trim()}"`);
      return Number(match[1]) - 1;
    };

    await scrubTo((await barIndex()) + 6);
    assert.strictEqual(await phase(), "in-trade", "a few bars past entry the position must still be open");
    assert.ok(
      await exists(".target-trade-corridor.corridor-reward"),
      "reward corridor must fill in once the tape moves past the entry bar"
    );
    assert.ok(
      await exists(".target-trade-corridor.corridor-risk"),
      "risk corridor must fill in once the tape moves past the entry bar"
    );
    const rewardW1 = await corridorWidth(".target-trade-corridor.corridor-reward");
    const riskW1 = await corridorWidth(".target-trade-corridor.corridor-risk");
    assert.ok(rewardW1 > 0 && riskW1 > 0, `corridors must have positive width, got reward=${rewardW1} risk=${riskW1}`);

    await scrubTo((await barIndex()) + 6);
    assert.strictEqual(await phase(), "in-trade", "still open a few bars later");
    const rewardW2 = await corridorWidth(".target-trade-corridor.corridor-reward");
    assert.ok(rewardW2 > rewardW1, `reward corridor must grow with the tape (${rewardW1} -> ${rewardW2})`);
    assert.ok(
      !(await exists(".target-trade-line-exit")),
      "exit line must stay hidden while the position is still open"
    );
    await page.screenshot({ path: `${SHOTS}/replay-review-5b-paper-corridors.png` });
    console.log(`[B2b] corridors grow with the tape OK (reward ${rewardW1.toFixed(1)}px -> ${rewardW2.toFixed(1)}px)`);

    // B3 — exit bar: take-profit attribution with hit emphasis.
    await hudClick("Exit Bar");
    assert.strictEqual(await phase(), "closed");
    assert.ok(await exists(".target-trade-line-tp.is-hit"), "TP line must carry hit emphasis");
    assert.ok(await exists(".target-trade-pin.pin-exit.is-win"), "winning exit pin");
    assert.ok(await exists(".rail-tag-review.tone-tp.is-hit"), "rail TP tag hit state");
    assert.ok(await exists(".rail-tag-review.tone-win"), "rail EXIT tag with win tone");
    const tpCaptionHit = await page.$eval(".target-trade-caption.caption-tp", (n) => n.textContent || "");
    assert.ok(tpCaptionHit.startsWith("TP HIT $"), `caption must flip to TP HIT, got "${tpCaptionHit}"`);
    const bannerClsB = await page.$eval(".review-outcome-banner", classOf);
    assert.match(bannerClsB, /outcome-take_profit/);
    assert.match(bannerClsB, /is-win/);
    assert.strictEqual((await page.$eval(".review-outcome-label", (n) => (n.textContent || "").trim())), "Take Profit hit");
    const bannerPnlB = await page.$eval(".review-outcome-pnl", (n) => n.textContent || "");
    assert.ok(bannerPnlB.trim().startsWith("+"), `banner P&L must be a positive realized figure, got "${bannerPnlB.trim()}"`);
    assert.strictEqual(Number((await rowValue("Exit price")).value.replace(/[$,]/g, "")).toFixed(2), tpPrice.toFixed(2));
    assert.strictEqual((await rowValue("Result (R multiple)")).value, "+1.00R");
    const barsHeld = Number((await rowValue("Bars held")).value);
    assert.ok(barsHeld >= 40 && barsHeld <= 56, `bars held should be ~48 for the fixture, got ${barsHeld}`);
    await page.screenshot({ path: `${SHOTS}/replay-review-6-paper-tp-hit.png` });
    console.log("[B3] paper closed: TP-hit emphasis, +1.00R, Take Profit banner OK");

    assert.deepStrictEqual(pageErrors, [], `page must not throw uncaught errors: ${pageErrors.join(" | ")}`);
    if (consoleErrors.length) {
      console.log(`Note: ${consoleErrors.length} console error(s) observed (non-fatal), first: ${consoleErrors[0].slice(0, 200)}`);
    }
    console.log("ALL TRADE REPLAY REVIEW OVERLAY CHECKS PASSED");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
