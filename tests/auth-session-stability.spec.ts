import { test, expect, Page } from "@playwright/test";
import {
  expectNeverBlankAfterFirstPaint,
  sampleRender,
  seedSession,
} from "./utils/render-probe";

/**
 * Session-stability guard.
 *
 * Two regressions are covered here:
 *
 * 1. Refreshing while authenticated must keep the user on the same route with a
 *    live session — never bouncing to /auth and never blanking.
 * 2. Moving between routes must stay *client side*: React Router should swap the
 *    page subtree without reloading the document, re-running the splash screen,
 *    or re-mounting the React root (all of which show up as a visible flash).
 */

const NAV = [
  { label: "Passeio", path: "/search-walk" },
  { label: "Rede", path: "/rede-pet" },
  { label: "Shop", path: "/petshop" },
  { label: "Home", path: "/inicio" },
];

/**
 * Installed before any app script runs. It counts document initialisations and
 * React-root teardowns, so a route change that secretly reloads the page (or
 * unmounts and re-creates the whole tree) is observable from the test.
 */
const DOC_INITS_KEY = "__e2e_doc_inits";

async function instrument(page: Page) {
  await page.addInitScript((key: string) => {
    const w = window as unknown as {
      __rootTeardowns: number;
      __splashMounts: number;
    };
    // sessionStorage (not a window global) so the counter survives a document
    // reload — that is exactly the event we need to be able to observe.
    const prev = Number(sessionStorage.getItem(key) || "0");
    sessionStorage.setItem(key, String(prev + 1));

    w.__rootTeardowns = 0;
    w.__splashMounts = 0;

    const attach = () => {
      const root = document.getElementById("root");
      if (!root) return void requestAnimationFrame(attach);

      new MutationObserver((records) => {
        for (const r of records) {
          // The React root emptying out = the whole app was unmounted.
          for (const removed of Array.from(r.removedNodes)) {
            if (removed.nodeType === 1 && root.childElementCount === 0) w.__rootTeardowns++;
          }
          for (const added of Array.from(r.addedNodes)) {
            if (
              added.nodeType === 1 &&
              (added as HTMLElement).querySelector?.('[data-testid="splash-screen"]')
            ) {
              w.__splashMounts++;
            }
          }
        }
      }).observe(root, { childList: true, subtree: true });
    };

    attach();
  }, DOC_INITS_KEY);
}

const readCounters = (page: Page) =>
  page.evaluate(
    (key) => ({
      docInits: Number(sessionStorage.getItem(key) || "0"),
      rootTeardowns: (window as unknown as { __rootTeardowns: number }).__rootTeardowns ?? 0,
      splashMounts: (window as unknown as { __splashMounts: number }).__splashMounts ?? 0,
    }),
    DOC_INITS_KEY,
  );


/** Heavy views (map, 3D) may take a beat to mount on a client-side route change. */
const ROUTE_PAINT_BUDGET_MS = 1_200;

async function bootHome(page: Page) {
  await page.goto("/inicio", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#root")).not.toBeEmpty({ timeout: 15_000 });
  // Let the splash / auth hydration settle before measuring anything.
  await page.waitForTimeout(3_000);
}

/** Clicks a bottom-nav entry. Returns false when the bar isn't rendered here. */
async function navigateTo(page: Page, label: string) {
  const button = page.getByRole("button", { name: label, exact: true }).first();
  if (!(await button.count())) return false;
  await button.click();
  return true;
}

/** Goes back to /inicio client side, so every leg starts from the same place. */
async function returnHome(page: Page) {
  if (new URL(page.url()).pathname === "/inicio") return;
  if (!(await navigateTo(page, "Home"))) await page.goBack();
  await page.waitForTimeout(1_000);
}


test.describe("Sessão autenticada — refresh e troca de rota sem remount/flash", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
    await instrument(page);
  });

  test("refreshing while authenticated keeps the route and the session", async ({ page }) => {
    const authenticated = Boolean(process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY);
    await bootHome(page);

    const before = await page.evaluate(
      (key) => (key ? window.localStorage.getItem(key) !== null : null),
      process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY ?? "",
    );

    for (let i = 1; i <= 3; i++) {
      await page.reload({ waitUntil: "domcontentloaded" });
      const samples = await sampleRender(page, 3_500);
      expectNeverBlankAfterFirstPaint(samples, `Refresh #${i} on /inicio`);

      expect(new URL(page.url()).pathname, `Refresh #${i} changed the route`).toBe("/inicio");

      if (authenticated) {
        const stillSignedIn = await page.evaluate(
          (key) => window.localStorage.getItem(key) !== null,
          process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY!,
        );
        expect(stillSignedIn, `Refresh #${i} dropped the stored session`).toBe(true);
        expect(before).toBe(true);
      }
    }
  });

  test("route changes are client side — no document reload, no root remount", async ({ page }) => {
    await bootHome(page);

    const start = await readCounters(page);
    expect(start.docInits, "instrumentation did not run").toBeGreaterThan(0);

    const visited: string[] = [];
    for (const item of NAV) {
      if (!(await navigateTo(page, item.label))) continue;
      await page.waitForTimeout(1_200);
      visited.push(new URL(page.url()).pathname);

      const now = await readCounters(page);
      expect(
        now.docInits,
        `Navigating to ${item.path} triggered a full document reload (SPA routing broken)`,
      ).toBe(start.docInits);
      expect(
        now.rootTeardowns,
        `Navigating to ${item.path} unmounted the whole React root (remount flash)`,
      ).toBe(0);
      expect(
        now.splashMounts,
        `Navigating to ${item.path} replayed the splash screen`,
      ).toBe(0);

      await returnHome(page);
    }

    expect(visited.length, "no bottom-navigation buttons were reachable").toBeGreaterThan(1);
    expect(new Set(visited).size, "navigation never actually changed route").toBeGreaterThan(1);
  });

  test("nothing flashes blank while moving between routes", async ({ page }) => {
    await bootHome(page);

    let navigations = 0;
    for (const item of NAV) {
      if (!(await navigateTo(page, item.label))) continue;
      navigations++;

      const samples = await sampleRender(page, 2_000, 60);
      // A client-side route change may need a moment to mount heavy views
      // (maps, 3D), but it must never blank once the new page has painted.
      expectNeverBlankAfterFirstPaint(samples, `Navigating to ${item.path}`, ROUTE_PAINT_BUDGET_MS);

      await returnHome(page);
    }

    expect(navigations, "no bottom-navigation buttons were reachable").toBeGreaterThan(1);
  });


  test("browser back/forward stays client side and painted", async ({ page }) => {
    await bootHome(page);
    const start = await readCounters(page);

    const walk = page.getByRole("button", { name: "Passeio", exact: true }).first();
    test.skip(!(await walk.count()), "bottom navigation not rendered for this session");

    await walk.click();
    await page.waitForTimeout(1_200);

    await page.goBack();
    expectNeverBlankAfterFirstPaint(await sampleRender(page, 2_000, 60), "history back", ROUTE_PAINT_BUDGET_MS);

    await page.goForward();
    expectNeverBlankAfterFirstPaint(await sampleRender(page, 2_000, 60), "history forward", ROUTE_PAINT_BUDGET_MS);

    const end = await readCounters(page);
    expect(end.docInits, "history navigation reloaded the document").toBe(start.docInits);
    expect(end.rootTeardowns, "history navigation re-mounted the React root").toBe(0);
  });
});
