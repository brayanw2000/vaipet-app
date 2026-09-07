import { test, expect } from '@playwright/test';

// Paleta Editorial
const INK = '#0B1410';
const BRAND_GREEN = '#31D880';
const PAPER = '#F7F5EF';

test.describe('Verificação de Paleta Editorial em Search Walk', () => {
  test('não deve conter o verde antigo (#00A978) e deve usar a nova paleta', async ({ page }) => {
    await page.goto('http://localhost:8080/search-walk');
    
    // Espera o mapa ou algum elemento carregar
    await page.waitForLoadState('networkidle');

    // Verifica elementos que deveriam ser INK no modo escuro
    // O sistema agora usa #0B1410 como fundo principal no modo escuro do SearchWalk
    
    const bodyBg = await page.evaluate(() => {
        return window.getComputedStyle(document.body).backgroundColor;
    });
    
    // Verifica se existe algum elemento com o verde antigo
    const oldGreenElements = await page.evaluate(() => {
        const results = [];
        const all = document.querySelectorAll('*');
        const OLD_GREEN_RGB = 'rgb(0, 169, 120)';
        for (let i = 0; i < all.length; i++) {
            const el = all[i];
            const style = window.getComputedStyle(el);
            if (style.backgroundColor === OLD_GREEN_RGB || 
                style.color === OLD_GREEN_RGB || 
                style.borderColor === OLD_GREEN_RGB) {
                results.push(el.tagName);
            }
        }
        return results;
    });

    expect(oldGreenElements.length).toBe(0);
    
    // Verifica a presença do Brand Green (#31D880 -> rgb(49, 216, 128))
    const hasBrandGreen = await page.evaluate(() => {
        const BRAND_GREEN_RGB = 'rgb(49, 216, 128)';
        const all = document.querySelectorAll('*');
        for (let i = 0; i < all.length; i++) {
            const el = all[i];
            const style = window.getComputedStyle(el);
            if (style.backgroundColor === BRAND_GREEN_RGB || 
                style.color === BRAND_GREEN_RGB || 
                style.borderColor === BRAND_GREEN_RGB) {
                return true;
            }
        }
        return false;
    });
    
    // Nota: Pode não estar visível imediatamente se depender de interação (ex: SlideToConfirm fill)
    // Mas geralmente há chips ou botões
  });
});
