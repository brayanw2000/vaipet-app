import { test, expect, Page } from "@playwright/test";

/**
 * End-to-end guard for the Search-Walk cycle:
 *   aguardando → aceito → passeio em andamento (e NUNCA de volta para aguardando).
 *
 * This is the browser-level counterpart of src/pages/SearchWalk.flow.test.tsx.
 * It runs against the real map/WebGL stack, so it only asserts on user-visible
 * text — never on internal state.
 */

const WAITING = /aguardando/i;

async function startWalkSearch(page: Page) {
  await page.goto("/search-walk");

  // Wizard: pet is auto-selected when the account has a single pet.
  for (let step = 0; step < 3; step++) {
    const next = page.getByRole("button", { name: "Continuar" });
    await expect(next).toBeEnabled({ timeout: 15_000 });
    await next.click();
  }

  // Slide-to-confirm: drag the knob across its track.
  const slider = page.locator('[data-testid="slide-to-confirm"]').first();
  await expect(slider).toBeVisible({ timeout: 10_000 });
  const box = await slider.boundingBox();
  if (!box) throw new Error("slide-to-confirm has no bounding box");
  await page.mouse.move(box.x + 24, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 12, box.y + box.height / 2, { steps: 20 });
  await page.mouse.up();
}

test.describe("Search-Walk — ciclo completo", () => {
  test("aguardando → aceito → passeio, sem voltar para aguardando", async ({ page }) => {
    const flickerLog: string[] = [];
    page.on("console", (msg) => {
      if (/recovery|timed out/i.test(msg.text())) flickerLog.push(msg.text());
    });

    await startWalkSearch(page);

    // The simulated search takes ~7s to reach the waiting phase.
    await expect(page.getByText(WAITING)).toBeVisible({ timeout: 30_000 });

    // Acceptance is simulated by the waiting component itself; once it happens
    // the walk UI must appear and stay.
    await expect(page.getByText(WAITING)).toBeHidden({ timeout: 60_000 });

    // Watch a full watchdog window (8s) plus margin: no bounce back.
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(2_000);
      await expect(page.getByText(WAITING)).toBeHidden();
    }

    expect(flickerLog, "recovery watchdog should not fire on the happy path").toEqual([]);
  });

  test("cancelar durante (aguardando) volta para a tela de busca", async ({ page }) => {
    await startWalkSearch(page);
    await expect(page.getByText(WAITING)).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /cancelar|fechar|close/i }).first().click();

    await expect(page.getByRole("button", { name: "Continuar" })).toBeVisible({
      timeout: 15_000,
    });
  });
});
