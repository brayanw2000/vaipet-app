import { test, expect, Browser } from '@playwright/test';

/**
 * Cria um contexto autenticado seguindo o fluxo real da UI.
 * Não aceita /onboarding como sucesso operacional.
 */
export async function createAuthedContext(browser: Browser, email: string, pass: string, expectedPath?: string) {
  const context = await browser.newContext({
    geolocation: { latitude: -23.5505, longitude: -46.6333 },
    permissions: ['geolocation']
  });
  const page = await context.newPage();

  console.log(`[AUTH] Iniciando login para ${email}`);
  await page.goto('/auth');
  
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', pass);
  await page.click('button[type="submit"]');

  // Espera o carregamento e redirecionamento inicial
  await page.waitForURL(/.*(inicio|petwalker|onboarding|auth)/, { timeout: 30000 });
  
  const finalUrl = page.url();
  console.log(`[AUTH] Destino inicial: ${finalUrl}`);

  // Bloqueio: /onboarding ou /auth NÃO são sucessos para testes operacionais
  if (finalUrl.includes('/onboarding') || finalUrl.includes('/auth')) {
    throw new Error(`[FAIL-AUTH] Usuário ${email} bloqueado em rota não operacional: ${finalUrl}. Provisionamento E2E falhou.`);
  }

  // Validação opcional de rota específica
  if (expectedPath) {
    await expect(page).toHaveURL(new RegExp(expectedPath), { timeout: 15000 });
  }
  
  return { context, page };
}

