## Objetivo

Criar cobertura de testes que trave a regressão do "flicker": a tela do Search-Walk que ia para `aceito` e voltava para `aguardando`.

## Estado atual verificado

- `tests/palette.spec.ts` já usa `@playwright/test` (dependência instalada), mas **não existe `playwright.config.ts`** no projeto — os testes hoje não têm runner configurado.
- `vitest@4` e `@testing-library/react` estão instalados, mas **não existe `vitest.config.ts` nem `src/test/setup.ts`**, e `package.json` não tem script `test`.
- `/search-walk` é rota pública em `src/App.tsx` (sem guard), mas a tela depende de Mapbox (WebGL), geolocalização e do backend para criar a `walk_session`.
- A transição hoje: `WaitingForAcceptance` chama `onAccepted()` após 12s → `handleAccepted` em `SearchWalk.tsx` guarda contra chamadas duplicadas, seta `walking`, cria a sessão, e um watchdog de 8s volta para `waiting` se a sessão não for criada.

## Estratégia

Duas camadas, porque o E2E puro no mapa é lento e frágil (WebGL + GPS + timers de 12s):

**Camada 1 — testes de integração (Vitest + Testing Library), rápidos e determinísticos**
Cobrem a máquina de estados, que é onde o bug morava:
- `WaitingForAcceptance` dispara `onAccepted` **exatamente uma vez** (fake timers avançando além dos 12s).
- Chamar `handleAccepted` duas vezes não reprocessa (guarda de estado).
- Com criação de sessão bem-sucedida, o estado permanece `walking` mesmo após passar o watchdog de 8s — **este é o teste anti-flicker**.
- Com falha na criação da sessão, o estado volta para `waiting` de forma controlada (recuperação), sem oscilar.
- Timer expirado renderiza "Expirado" em vez de piscar o contador.

**Camada 2 — E2E (Playwright) do fluxo visível**
- Navega para `/search-walk`, seleciona pet, avança pelos passos e confirma o passeio.
- Observa o pill de status ao longo do tempo e **grava a sequência de estados**, garantindo que "Aguardando" nunca reaparece depois que o passeio começa (assertion sobre a sequência, não só sobre o estado final).
- Falha o teste se houver erros de console durante a transição.

## Passos de implementação

1. **Configurar os runners**
   - `vitest.config.ts` (jsdom, globals, setup, `include: src/**/*.{test,spec}.{ts,tsx}`) e `src/test/setup.ts` com `@testing-library/jest-dom` + shim de `matchMedia`.
   - `playwright.config.ts` apontando para `http://localhost:8080`, `testDir: tests`, 1 retry, trace on failure.
   - Adicionar `"types": ["vitest/globals"]` em `tsconfig.app.json` e scripts `test` / `test:e2e` no `package.json`.

2. **Mocks compartilhados** em `src/test/mocks/`: `mapbox-gl` (mapa no-op com `on/once/off/remove`), `navigator.geolocation`, o cliente do backend (insert/update/select encadeáveis) e os loaders 3D (`preloadDog3DAsset`, `preloadCheckpointAsset`).

3. **`src/components/WaitingForAcceptance.test.tsx`** — dispara único de `onAccepted`, `onTimeout` na expiração, texto "Expirado", cleanup dos timers no unmount.

4. **`src/pages/SearchWalk.flow.test.tsx`** — renderiza a página com os mocks, força o estado de espera, avança os timers e assegura: `waiting → walking` uma única vez; permanência em `walking` após 8s+ quando a sessão é criada; retorno controlado a `waiting` quando o insert falha; nenhuma renderização intermediária de "Aguardando" após o início do passeio (spy no histórico de renders).

5. **`tests/search-walk-flow.spec.ts` (Playwright)** — percurso completo na UI real com amostragem periódica do texto do pill, assertando a sequência `Buscando → Encontrado → Aguardando → (passeio)` sem retorno a "Aguardando", com captura de screenshot em falha.

6. **Rodar as duas suítes** e ajustar seletores/timings até verde.

## Detalhes técnicos

- Vitest com `vi.useFakeTimers()` e `act()` para avançar os 12s de aceite e os 8s do watchdog sem espera real.
- Para o E2E, geolocalização é concedida via `context.grantPermissions(['geolocation'])` com coordenadas fixas, e o teste roda em Chromium headless com WebGL habilitado.
- Os testes não alteram a lógica de produção; se algum seletor estável faltar, adiciono apenas `data-testid` nos elementos de status.
