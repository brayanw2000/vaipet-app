import { test, expect } from "@playwright/test";
import {
  blankSamples,
  expectNeverBlankAfterFirstPaint,
  sampleRender,
  seedSession,
} from "./utils/render-probe";

/**
 * Regression guard for the "tela toda branca" bug.
 *
 * The homepage used to fade its whole container to `opacity: 0` while it waited
 * for auth/profile/splash state to settle — so users saw a blank white screen
 * on first paint and again when navigating back from /search-walk.
 *
 * This spec samples the DOM continuously during the initial render and fails as
 * soon as a single sample looks blank.
 */

test.describe("Homepage — nunca fica em branco", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });


  test("the blank-screen probe actually detects a blank screen", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#root")).not.toBeEmpty({ timeout: 15_000 });

    // Sanity/mutation check: force the exact regression (container faded out)
    // and make sure the probe reports it. Without this the suite could pass
    // simply because it is blind.
    await page.addStyleTag({ content: "#root > * { opacity: 0 !important; }" });
    const blank = blankSamples(await sampleRender(page, 800, 80));
    expect(blank.length, "probe failed to detect an artificially blanked page").toBeGreaterThan(0);
  });



  test("initial render never shows a blank screen", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err)));

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // The app must mount something (login screen, splash or dashboard) quickly.
    await expect(page.locator("#root")).not.toBeEmpty({ timeout: 15_000 });

    const samples = await sampleRender(page, 6_000);
    expect(samples.length, "probe collected no samples").toBeGreaterThan(20);

    expectNeverBlankAfterFirstPaint(samples, "Initial homepage load");

    expect(
      consoleErrors.filter((e) => /Minified React error|is not defined|Cannot read/i.test(e)),
      "fatal runtime errors during homepage render",
    ).toHaveLength(0);
  });

  test("returning to the homepage after /search-walk stays visible", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#root")).not.toBeEmpty({ timeout: 15_000 });
    await page.waitForTimeout(1_500);

    await page.goto("/search-walk", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_500);

    await page.goBack({ waitUntil: "domcontentloaded" });

    const samples = await sampleRender(page, 5_000);
    expectNeverBlankAfterFirstPaint(samples, "Homepage after going back from /search-walk");
  });

  test("reloading the homepage repeatedly never blanks the screen", async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.locator("#root")).not.toBeEmpty({ timeout: 15_000 });

      const samples = await sampleRender(page, 2_500, 80);
      expectNeverBlankAfterFirstPaint(samples, `Reload #${i + 1}`);
    }
  });
});
