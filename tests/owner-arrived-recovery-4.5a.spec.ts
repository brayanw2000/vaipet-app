/**
 * PHASE 4.5A2.3 — OWNER ARRIVED RELOAD / REOPEN RECOVERY — TEST-ONLY RED PROOF
 *
 * Tests the NEXT lifecycle state after the CERTIFIED `searching` (4.5A1),
 * `accepted` (4.5A2.1) and `heading_to_pickup` (4.5A2.2) reload recoveries
 * (do NOT reopen): `arrived`.
 *
 * This test determines, with EVIDENCE, what the product restores when an
 * Owner reloads the app while the SAME real walk_session is exactly:
 *
 *   current_status = 'arrived'
 *
 * REAL JOURNEY (no manufactured state, no ?resume, no browser storage):
 *   Owner  → cria pedido real pela UI (create_walk_request)     → searching
 *   Scheduler → process_walk_matching real                      → offer pending
 *   Walker → aceita a MESMA oferta pela UI (accept_walk_request) → accepted
 *   Walker → clica "Iniciar deslocamento" pela UI REAL
 *            (petwalker_start_heading)                           → heading_to_pickup
 *   Walker → permanece no WalkDetails /petwalker/passeio/<id> e clica o
 *            botão REAL "Cheguei no Local" (mesmo padrão já certificado em
 *            tests/arrival-blocker-4.4.spec.ts) — o produto usa o GPS do
 *            browser (navigator.geolocation.getCurrentPosition) e invoca
 *            petwalker_arrive_pickup(_session_id, _lat, _lng, _accuracy)
 *                                                                → arrived
 *   Owner  → UI mostra a apresentação ARRIVED/PIN ANTES do reload
 *   THEN   → ownerPage.reload() e ZERO ações do usuário após o reload
 *
 * NOTA DE JORNADA REAL (reuso da chegada certificada 4.4):
 * Após "Iniciar deslocamento" o próprio produto navega o Walker para
 * /petwalker/passeio/<id> (WalkDetails). Nesta MESMA rota o botão REAL
 * "Cheguei no Local" (locator certificado 4.4) aciona o GPS do browser e a
 * petwalker_arrive_pickup — o teste NÃO volta ao /petwalker e NÃO usa o
 * ActiveWalkSheet para a chegada. NUNCA invocamos petwalker_arrive_pickup
 * por admin/test — apenas pela UI real, que usa o GPS do browser.
 *
 * POST-RELOAD (ZERO user actions): o teste apenas OBSERVA o que o produto
 * restaura automaticamente e exige a MESMA sessão arrived de volta na UI.
 * Se a UI arrived/PIN NÃO reaparecer sozinha (a descoberta automática
 * certificada cobre apenas searching/accepted/heading_to_pickup), é a prova
 * VERMELHA válida — NÃO corrigir aqui.
 *
 * IMPORTANTE — o marcador de UI data-testid="pickup-pin-input" (overlay de
 * confirmação de retirada/PIN do WalkInProgress, fase 'arrived') NÃO
 * identifica sozinho o estado arrived. Ele é válido apenas em combinação
 * com a asserção explícita de backend:
 *
 *   current_status === 'arrived'
 *
 * O backend é a autoridade do domínio.
 *
 * FAIL-CLOSED:
 *   - O teste NÃO injeta ?resume, NÃO usa history.pushState, NÃO usa
 *     setSearchParams, NÃO escreve sessionStorage/localStorage,
 *   - após ownerPage.reload() NÃO há clique, navegação manual, segundo
 *     SlideToConfirm nem handleSearch,
 *   - nenhuma chamada nova de create_walk_request / accept_walk_request /
 *     petwalker_start_heading / petwalker_arrive_pickup após o reload,
 *   - petwalker_arrive_pickup NUNCA é invocado por admin/test — apenas pela
 *     UI real do Walker ("Cheguei no Local" no WalkDetails, GPS do browser),
 *   - DB proofs via admin são auditorias factuais apenas,
 *   - cleanup fail-closed: qualquer erro de cleanup FALHA a suíte (zero
 *     resíduos).
 *
 * ARRIVAL REUSADO DA CERTIFICAÇÃO 4.4 (PATCH T2):
 *   - A chegada usa EXATAMENTE o padrão certificado em
 *     tests/arrival-blocker-4.4.spec.ts: sem preflight GPS experimental,
 *     sem volta ao /petwalker e sem ActiveWalkSheet para arrival — o Walker
 *     permanece em /petwalker/passeio/<sessionId> e clica "Cheguei no Local".
 *   - Fixture de geolocation = estratégia certificada 4.4 (context
 *     permissions: ['geolocation'] + geolocation WALKER_POS); accuracy: 10
 *     retido do T1 por ser inofensivo (o produto envia _accuracy à RPC).
 *   - Nenhum mock de navigator.geolocation, nenhum init script, nenhuma RPC
 *     manual — o ÚNICO caminho para arrived é o clique real do Walker.
 *   - Observabilidade mantida: observador de respostas RPC real
 *     (RPC_OBSERVED HTTP + body) para petwalker_arrive_pickup.
 *   - T3: observabilidade do clique REAL "Cheguei no Local" (somente leitura):
 *     fatos de UI pré-clique (pathname/texto/disabled), request observado,
 *     requestfailed, resposta factual, pageerror e console filtrado — sem
 *     headers/credenciais e sem alterar qualquer comportamento.
 * PATCH T3 — OBSERVABILIDADE DO CLIQUE DE CHEGADA (somente diagnóstico):
 * Em torno do clique REAL "Cheguei no Local" adicionamos fatos factuais e
 * SEGUROS (nenhum header, token ou chave é logado) para distinguir exatamente:
 *   A. handler do clique nunca executa
 *   B. handler executa e entra no estado arriving ("Processando...")
 *   C. request emitido (ARRIVE_REQUEST_SEEN)
 *   D. request falha antes da resposta (requestfailed)
 *   E. resposta com status != 200 / body false / erro
 *   F. erro JS da página (pageerror) ou console de erro relevante
 * São apenas OBSERVADORES: nenhum comportamento de ciclo de vida é alterado,
 * nenhuma GPS é mockada, nenhuma RPC é invocada manualmente e nenhuma
 * asserção de recuperação é modificada.
 *
 * PATCH T4 — OBSERVAÇÃO DO BODY DA CHEGADA SEM RACE (correção de
 * instrumentação): evidência externa mostrou response_status=200 com
 * body=BODY_READ_FAILED — dois consumidores (armRpcObserver → res.json() e o
 * observador T3 → res.text()) disputavam o mesmo body enquanto o produto
 * recarrega a página imediatamente após data === true. Agora existe UM leitor
 * canônico do body de petwalker_arrive_pickup: o observador dedicado aguarda
 * response.finished() e SÓ ENTÃO lê o body uma única vez, parseia JSON e
 * registra em rpcCalls (compatível com lastRpc/RPC_OBSERVED). O observador
 * genérico NÃO é mais armado para esta RPC. Diagnóstico de falha de leitura é
 * SEGURO (status + erro de finished + message apenas). Nenhuma asserção é
 * enfraquecida: HTTP 200 + body true + backend arrived permanecem obrigatórios.
 *
 * PATCH T5 — RETENÇÃO TEMPORÁRIA DO RELOAD DO PRODUTO (correção de race):
 * Evidência factual T4: response.finished() OK, mas res.text() falhou com
 * "Network.getResponseBody: No resource with given identifier found" — o
 * Chromium descarta o recurso durante a navegação disparada pelo
 * window.location.reload() do produto (imediatamente após data === true).
 * A correção: barreira de rotação TEMPORÁRIA e ULTRARRASEJADA apenas para o
 * próximo reload de DOCUMENTO da MESMA pathname do WalkDetails — o RPC real
 * do Supabase NUNCA é interceptado (viaja normal); o handler apenas RETÉM o
 * documento até o leitor canônico sinalizar arrivalBodyCaptureFinished
 * (fail-safe limitado, liberado no finally) e o libera com route.fallback().
 * O reload REAL do produto continua normalmente. Nada é mockado: nem GPS,
 * nem RPC, nem resposta — e a exigência factual HTTP 200 + body true +
 * backend arrived permanece inalterada.
 */

import { test, expect, type BrowserContext, type ConsoleMessage, type Page, type Request, type Response, type Route } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { failClosedCleanup } from './helpers/cleanup';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  throw new Error('Missing required Supabase E2E environment variables');
}

const PASSWORD = 'VaiPet@2026';

// GPS do OWNER (browser) = ponto de encontro = home_location esperada.
const MEETING = { lng: -46.7, lat: -23.6 };
// GPS do WALKER (browser) ~14m do ponto de encontro — dentro do raio de
// matching ST_DWithin E do raio de chegada da petwalker_arrive_pickup
// (150m + LEAST(_accuracy, 50)) — fixture consistente com os testes
// certificados 4.4.
const WALKER_POS = { lng: -46.7001, lat: -23.6001 };

// Estados ativos (não terminais) do domínio.
const ACTIVE_STATUSES = ['searching', 'accepted', 'heading_to_pickup', 'arrived', 'in_progress', 'returning'];

// T3: filtro estrito de console — apenas erros relevantes ao caminho de
// chegada. NUNCA dumpa objetos arbitrários (podem conter segredos): apenas a
// mensagem de texto do erro.
const ARRIVE_CONSOLE_FILTER = /arriv|pickup|GPS|geolocation|supabase|fetch/i;

const log = (msg: string) =>
  console.log(`[${new Date().toISOString()}] [4.5a2-owner-arrived-recovery] ${msg}`);

const admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function provisionUser(runId: string, kind: 'pet_owner' | 'petwalker') {
  const email = `e2e.${kind}.${runId}.${Math.random().toString(36).slice(2, 6)}@e2e.vaipet.invalid`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `E2E ${kind}`, signup_intent: kind, e2e_test: true, e2e_run_id: runId },
  });
  if (error) throw new Error(`user_creation_failed: ${error.message}`);
  const id = data.user!.id;

  const { error: profErr } = await admin.from('profiles').upsert({
    id,
    full_name: `E2E ${kind}`,
    onboarding_completed: true,
    phone: '(11) 96666-6666',
    age: 32,
    // FIXTURE GAP (Blocker Patch A1): handle_new_user() não copia
    // signup_intent para profiles. Sem isto o PetwalkerGpsProvider mantém
    // isPetwalker=false e o Painel nunca fica online.
    signup_intent: kind,
  });
  if (profErr) throw new Error(`profile_upsert_failed: ${JSON.stringify(profErr)}`);

  // PREFLIGHT FACTUAL (fail-closed): provar que profiles.signup_intent === kind
  // foi realmente persistido — sem isto o teste falha cedo, não no aceite.
  const { data: pf, error: pfErr } = await admin
    .from('profiles')
    .select('signup_intent')
    .eq('id', id)
    .single();
  if (pfErr) throw new Error(`profile_preflight_failed: ${JSON.stringify(pfErr)}`);
  if (pf!.signup_intent !== kind) {
    throw new Error(`profile_signup_intent_mismatch: esperado ${kind}, obtido ${pf!.signup_intent}`);
  }

  if (kind === 'petwalker') {
    const { error: roleErr } = await admin.from('user_roles').insert({ user_id: id, role: 'petwalker' });
    if (roleErr) throw new Error(`role_insert_failed: ${JSON.stringify(roleErr)}`);

    const { error: wpErr } = await admin.from('petwalker_profiles').upsert({
      user_id: id,
      approval_status: 'approved',
      profile_completed: true,
      availability_status: 'available',
      is_accepting_requests: true,
      price_30_minutes: 2250,
      experience_years: 2,
      service_radius_km: 10,
      // Próximo ao ponto de encontro para o matching ST_DWithin.
      last_known_location: `SRID=4326;POINT(${WALKER_POS.lng} ${WALKER_POS.lat})`,
    });
    if (wpErr) throw new Error(`walker_profile_failed: ${JSON.stringify(wpErr)}`);

    const { data: roles, error: rolesErr } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', id);
    if (rolesErr) throw new Error(`roles_preflight_failed: ${JSON.stringify(rolesErr)}`);
    if (!roles!.some((r) => r.role === 'petwalker')) {
      throw new Error('walker_role_missing: user_roles sem petwalker');
    }

    const { data: wp, error: wpChkErr } = await admin
      .from('petwalker_profiles')
      .select('approval_status, availability_status, is_accepting_requests')
      .eq('user_id', id)
      .single();
    if (wpChkErr) throw new Error(`walker_profile_preflight_failed: ${JSON.stringify(wpChkErr)}`);
    if (
      wp!.approval_status !== 'approved' ||
      wp!.availability_status !== 'available' ||
      wp!.is_accepting_requests !== true
    ) {
      throw new Error(
        'walker_profile_preflight_mismatch: esperado approved/available/accepting, obtido ' +
          JSON.stringify(wp)
      );
    }
  }
  return { id, email };
}

async function loginViaUi(page: Page, email: string) {
  await page.goto('/auth');
  await page.getByPlaceholder('E-mail').fill(email);
  await page.getByPlaceholder('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: /^Entrar$/i }).click();
  // Login REAL validado: sair da tela de auth = sucesso.
  await expect(page).not.toHaveURL(/\/auth/, { timeout: 45000 });
}

test.describe('Phase 4.5A2.3: Owner arrived reload recovery (red proof)', () => {
  test.describe.configure({ mode: 'serial', retries: 0, timeout: 420_000 });

  let runId = '';
  let ownerId = '';
  let walkerId = '';
  let petId = '';
  let sessionId = '';
  let ownerEmail = '';
  let walkerEmail = '';
  let ownerCtx: BrowserContext | null = null;
  let walkerCtx: BrowserContext | null = null;
  let ownerPage: Page | null = null;
  let walkerPage: Page | null = null;
  let acceptCountBeforeReload = 0;
  let startHeadingCountBeforeReload = 0;
  let arriveCountBeforeReload = 0;

  // Observador factual das respostas RPC reais da página (HTTP + body).
  const rpcCalls: Record<string, Array<{ status: number; body: unknown }>> = {};

  const armRpcObserver = (page: Page, rpcName: string) => {
    page.on('response', (res) => {
      if (!res.url().includes(`/rest/v1/rpc/${rpcName}`)) return;
      res
        .json()
        .then((body) => {
          rpcCalls[rpcName] = rpcCalls[rpcName] || [];
          rpcCalls[rpcName].push({ status: res.status(), body });
          log(`RPC_OBSERVED ${rpcName} HTTP ${res.status()} body=${JSON.stringify(body)}`);
        })
        .catch(() => {
          rpcCalls[rpcName] = rpcCalls[rpcName] || [];
          rpcCalls[rpcName].push({ status: res.status(), body: 'NON_JSON' });
        });
    });
  };

  const lastRpc = (rpcName: string) => {
    const calls = rpcCalls[rpcName] || [];
    return calls[calls.length - 1];
  };

  // ——— T3: observabilidade factual e SEGURA do caminho de chegada ———
  // Escopo restrito a /rest/v1/rpc/petwalker_arrive_pickup. Nada de headers,
  // authorization ou chaves é capturado/logado.
  let detachArriveObservers: () => void = () => {};
  // T5: sinal de captura do body REAL da chegada — resolvido pelo ÚNICO leitor
  // canônico (no finally) para liberar a barreira temporária do reload do
  // produto. Nunca bloqueia para sempre: fail-safe no teste.
  let arrivalBodyCaptureFinished: (() => void) | null = null;
  const arrivalBodyCaptureFinishedPromise = new Promise<void>((resolve) => {
    arrivalBodyCaptureFinished = resolve;
  });
  // T5: barreira temporária de sincronização em torno do ÚNICO reload de
  // DOCUMENTO SAME-WalkDetails disparado pelo PRÓPRIO produto
  // (window.location.reload() após data === true). A URL-predicate deixa
  // chegar ao handler APENAS requisições do pathname do WalkDetails; o
  // handler ainda exige isNavigationRequest + resourceType 'document' +
  // pathname idêntico + clique de chegada já realizado. Nada é interceptado,
  // mockado, fulfillado ou substituído — o handler apenas RETÉM o documento
  // (sem responder) até a captura factual do body REAL da RPC e então o
  // libera com route.fallback(). O RPC do Supabase viaja normalmente.
  const HOLD_FAILSAFE_MS = 10_000;
  let reloadHoldArmed = false;
  let holdPathname = '';
  let productReloadHeldNotify: (() => void) | null = null;
  const walkerReloadHoldPredicate = (url: URL) =>
    reloadHoldArmed && !!holdPathname && url.pathname === holdPathname;
  const reloadHoldHandler = async (route: Route) => {
    const req = route.request();
    const isSameDocReload =
      req.isNavigationRequest() &&
      req.resourceType() === 'document' &&
      new URL(req.url()).pathname === holdPathname;
    if (!isSameDocReload) {
      // Defesa em profundidade: nada além do reload do documento passa por
      // aqui (incluindo qualquer fetch/XHR/API — seguem imediatamente).
      await route.fallback().catch(() => {});
      return;
    }
    arriveObs.productReloadObserved = true;
    arriveObs.productReloadHeld = true;
    log('ARRIVE_PRODUCT_RELOAD_HELD=true (reload REAL do produto retido até a captura do body)');
    productReloadHeldNotify?.();
    // Espera limitada pela captura factual — nunca um deadlock: se o leitor
    // único falhar/sinalizar, a barreira cai; se nada sinalizar, o fail-safe
    // libera o documento após HOLD_FAILSAFE_MS.
    await Promise.race([
      arrivalBodyCaptureFinishedPromise,
      new Promise((r) => setTimeout(r, HOLD_FAILSAFE_MS)),
    ]);
    log('ARRIVE_PRODUCT_RELOAD_FALLBACK=true (reload REAL do produto prossegue)');
    await route.fallback().catch(() => {
      log('ARRIVE_PRODUCT_RELOAD_FALLBACK_FAILED (contexto pode ter encerrado a navegação)');
    });
  };
  /** Libera a barreira T5 e remove o handler — idempotente e com fail-safe
   * limitado; chamada no finally do passo de chegada e no cleanup. */
  const releaseProductReloadHold = async () => {
    if (!reloadHoldArmed) return;
    reloadHoldArmed = false;
    await Promise.race([
      arrivalBodyCaptureFinishedPromise,
      new Promise((r) => setTimeout(r, HOLD_FAILSAFE_MS)),
    ]);
    productReloadHeldNotify = null;
    arriveObs.productReloadReleased = true;
    log('ARRIVE_PRODUCT_RELOAD_RELEASED=true');
    try {
      await walkerPage!.unroute(walkerReloadHoldPredicate, reloadHoldHandler);
      log('T5: barreira de reload removida (unroute)');
    } catch {
      /* página/contexto já encerrados em falha anterior */
    }
  };
  const arriveObs = {
    requestSeen: false,
    requestFailed: null as string | null,
    responseStatus: null as number | null,
    responseBody: null as unknown,
    handlerEntryObserved: false,
    pageErrors: [] as string[],
    consoleErrors: [] as string[],
    // T5: fatos factuais sobre o reload do PRÓPRIO produto (sem headers).
    productReloadObserved: false,
    productReloadHeld: false,
    productReloadReleased: false,
  };

  /** Instala os observadores T3 na página do Walker: request, requestfailed,
   * resposta factual, pageerror e console de erro filtrado — escopo restrito à
   * RPC de chegada, sem capturar headers/credenciais. */
  const armArriveObservers = (page: Page) => {
    // 1) request emitido: apenas método + pathname da URL (sem headers).
    const onRequest = (req: Request) => {
      if (!new URL(req.url()).pathname.includes('/rest/v1/rpc/petwalker_arrive_pickup')) return;
      arriveObs.requestSeen = true;
      log(`ARRIVE_REQUEST_SEEN=true method=${req.method()} path=/rest/v1/rpc/petwalker_arrive_pickup`);
    };
    // 2) falha ANTES da resposta (rede/abort/CORS).
    const onRequestFailed = (req: Request) => {
      if (!new URL(req.url()).pathname.includes('/rest/v1/rpc/petwalker_arrive_pickup')) return;
      arriveObs.requestFailed = req.failure()?.errorText ?? 'unknown';
      log(`ARRIVE_REQUESTFAILED: ${arriveObs.requestFailed}`);
    };
    // 3) resposta factual da RPC de chegada — ÚNICO leitor canônico do body
    // (PATCH T5): o produto executa window.location.reload() imediatamente
    // quando data === true, e o Chromium pode descartar o recurso da resposta
    // durante a navegação ("Network.getResponseBody: No resource with given
    // identifier found") — por isso a espera por response.finished() NÃO
    // resolve (T4 factual). Agora: lê o body DIRETAMENTE (o reload do produto
    // está temporariamente retido pela barreira de sincronização T5), parseia
    // JSON e registra em rpcCalls — mantendo lastRpc() e todas as asserções.
    // Continua sendo o ÚNICO leitor; falha de leitura NUNCA vira false.
    const onResponse = (res: Response) => {
      if (!new URL(res.url()).pathname.includes('/rest/v1/rpc/petwalker_arrive_pickup')) return;
      arriveObs.responseStatus = res.status();
      void (async () => {
        try {
          // Leitura direta e única do body real (sem esperar finished():
          // a navegação do produto está retida até a captura terminar).
          const t = await res.text();
          let body: unknown;
          try {
            body = JSON.parse(t);
          } catch {
            body = 'NON_JSON';
          }
          arriveObs.responseBody = body;
          rpcCalls['petwalker_arrive_pickup'] = rpcCalls['petwalker_arrive_pickup'] || [];
          rpcCalls['petwalker_arrive_pickup'].push({ status: res.status(), body });
          // Registro canônico compatível com RPC_OBSERVED (status verbatim —
          // as asserções continuam exigindo HTTP 200 + body true).
          log(`RPC_OBSERVED petwalker_arrive_pickup HTTP ${res.status()} body=${JSON.stringify(body)}`);
        } catch (e) {
          // Diagnóstico SEGURO (status + message apenas) — sem headers/
          // authorization/apikey/cookies. NUNCA converte silenciosamente em
          // false e NUNCA registra como chamada bem-sucedida.
          const readErrMsg = e instanceof Error ? e.message : String(e);
          const diag = `BODY_READ_FAILED: read=${readErrMsg}`;
          arriveObs.responseBody = diag;
          log(`ARRIVE_RPC_BODY_READ_FAILED HTTP ${res.status()} ${diag}`);
        } finally {
          // Sinaliza a captura (sucesso OU falha factual): libera a barreira
          // T5 para que o reload REAL do produto prossiga.
          try {
            arrivalBodyCaptureFinished?.();
          } catch {
            /* idempotente */
          }
        }
      })();
    };
    // 6/F) erro JS da página (apenas a mensagem).
    const onPageError = (err: Error) => {
      arriveObs.pageErrors.push(err.message);
      log(`ARRIVE_PAGEERROR: ${err.message}`);
    };
    // Console de erro filtrado (apenas texto da mensagem).
    const onConsole = (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (!ARRIVE_CONSOLE_FILTER.test(text)) return;
      arriveObs.consoleErrors.push(text);
      log(`WALKER_CONSOLE_ERROR: ${text}`);
    };
    page.on('request', onRequest);
    page.on('requestfailed', onRequestFailed);
    page.on('response', onResponse);
    page.on('pageerror', onPageError);
    page.on('console', onConsole);
    detachArriveObservers = () => {
      page.off('request', onRequest);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
      page.off('pageerror', onPageError);
      page.off('console', onConsole);
      detachArriveObservers = () => {};
    };
  };

  /** Relatório factual de timeout do RPC de chegada: SOMENTE fatos seguros
   * (pathname, texto e estado do botão, handler-entry, rede, resposta,
   * pageerror/console filtrados). Sem credenciais/headers. */
  const arriveRpcTimeoutDiagnostic = (pre: {
    pathname: string;
    buttonText: string;
    buttonDisabled: boolean;
  }) =>
    [
      `petwalker_arrive_pickup não observado (HTTP 200 + true) via UI real`,
      `pathname_before_click=${pre.pathname}`,
      `button_text_before_click=${JSON.stringify(pre.buttonText)}`,
      `button_disabled_before_click=${pre.buttonDisabled}`,
      `handler_entry_processando_observed=${arriveObs.handlerEntryObserved}`,
      `ARRIVE_REQUEST_SEEN=${arriveObs.requestSeen}`,
      `requestfailed=${arriveObs.requestFailed ?? 'none'}`,
      `response_status=${arriveObs.responseStatus ?? 'none'}`,
      `response_body=${arriveObs.responseBody === null ? 'none' : JSON.stringify(arriveObs.responseBody)}`,
      `pageerrors=${arriveObs.pageErrors.length ? JSON.stringify(arriveObs.pageErrors) : 'none'}`,
      `console_errors=${arriveObs.consoleErrors.length ? JSON.stringify(arriveObs.consoleErrors) : 'none'}`,
      `product_reload_observed=${arriveObs.productReloadObserved}`,
      `product_reload_held=${arriveObs.productReloadHeld}`,
      `product_reload_released=${arriveObs.productReloadReleased}`,
    ].join(' | ');

  async function auditSession(id: string) {
    const { data, error } = await admin.from('walk_sessions').select('*').eq('id', id).single();
    if (error) throw new Error(`audit_session_failed: ${JSON.stringify(error)}`);
    return data;
  }

  async function activeOwnerSessionCount() {
    const { data, error } = await admin
      .from('walk_sessions')
      .select('id')
      .eq('customer_id', ownerId)
      .in('current_status', ACTIVE_STATUSES);
    if (error) throw new Error(`active_owner_sessions_failed: ${JSON.stringify(error)}`);
    return data || [];
  }

  async function activePetSessionCount() {
    const { data, error } = await admin
      .from('walk_sessions')
      .select('id')
      .eq('pet_id', petId)
      .in('current_status', ACTIVE_STATUSES);
    if (error) throw new Error(`active_pet_sessions_failed: ${JSON.stringify(error)}`);
    return data || [];
  }

  test('Owner arrived: reload /search-walk NÃO perde a MESMA sessão sem nenhuma ação', async ({ browser }) => {
    runId = `4.5a2.3_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const petName = 'PetArrived45A2';

    try {
      await test.step('setup: Owner + Walker E2E determinísticos + 1 pet real', async () => {
        const owner = await provisionUser(runId, 'pet_owner');
        const walker = await provisionUser(runId, 'petwalker');
        ownerId = owner.id;
        walkerId = walker.id;
        ownerEmail = owner.email;
        walkerEmail = walker.email;
        log(`owner_id: ${ownerId}`);
        log(`walker_id: ${walkerId}`);

        const { data: pet, error: petErr } = await admin
          .from('pets')
          .insert({
            owner_id: ownerId,
            name: petName,
            breed: 'SRD',
            is_active: true,
            e2e_test: true,
            e2e_run_id: runId,
          })
          .select('id')
          .single();
        if (petErr) throw new Error(`pet_creation_failed: ${JSON.stringify(petErr)}`);
        petId = pet!.id;
        log(`pet_id: ${petId}`);
      });

      await test.step('login real via /auth (owner + walker) + observadores RPC', async () => {
        walkerCtx = await browser.newContext({
          viewport: { width: 430, height: 900 },
          locale: 'pt-BR',
          permissions: ['geolocation'],
          // Fixture = estratégia certificada 4.4 (mesma do
          // arrival-blocker-4.4.spec.ts): posição real do Walker. accuracy: 10
          // retido do T1 por ser inofensivo — o produto envia _accuracy à
          // petwalker_arrive_pickup.
          geolocation: { longitude: WALKER_POS.lng, latitude: WALKER_POS.lat, accuracy: 10 },
        });
        ownerCtx = await browser.newContext({
          viewport: { width: 430, height: 900 },
          locale: 'pt-BR',
          permissions: ['geolocation'],
          geolocation: { longitude: MEETING.lng, latitude: MEETING.lat },
        });
        walkerPage = await walkerCtx.newPage();
        ownerPage = await ownerCtx.newPage();
        await loginViaUi(ownerPage, ownerEmail);
        await loginViaUi(walkerPage, walkerEmail);
        armRpcObserver(ownerPage, 'create_walk_request');
        armRpcObserver(walkerPage, 'accept_walk_request');
        armRpcObserver(walkerPage, 'petwalker_start_heading');
        // T4: o observador genérico NÃO lê mais o body de
        // petwalker_arrive_pickup — o leitor canônico ÚNICO é o observador
        // dedicado de chegada (armArriveObservers), que aguarda
        // response.finished() antes de ler e registra em rpcCalls (compatível
        // com lastRpc e todas as asserções existentes).
        armArriveObservers(walkerPage); // T3/T4: observabilidade factual do clique de chegada
      });

      await test.step('owner: criar pedido pela UI REAL (create_walk_request) → searching', async () => {
        await ownerPage!.goto('/inicio');
        await expect(ownerPage!).toHaveURL(/\/inicio/, { timeout: 10000 });
        await expect(ownerPage!.locator('#tour-start-walk')).toBeVisible({ timeout: 10000 });
        await ownerPage!.locator('#tour-start-walk').click();

        const bottomSheet = ownerPage!.locator('h2, div').filter({ hasText: /INICIAR O PASSEIO/i }).first();
        await expect(bottomSheet).toBeVisible({ timeout: 15000 });

        // Selecionar pet (único pet do dono).
        const petLabel = ownerPage!.getByText(petName).first();
        await expect(petLabel).toBeVisible({ timeout: 15000 });
        const continueBtn = ownerPage!.locator('button').filter({ hasText: /Selecione|Continuar/i }).last();
        await expect
          .poll(
            async () => {
              const targets = ownerPage!.locator('div, button, span, p').filter({ hasText: petName });
              const count = await targets.count();
              for (let i = 0; i < count; i++) {
                await targets.nth(i).click().catch(() => {});
              }
              const text = await continueBtn.innerText();
              return text.includes('Continuar') && !text.includes('Selecione');
            },
            { timeout: 30000, message: 'Pet selecionado' }
          )
          .toBeTruthy();

        const contBtn = ownerPage!.locator('button').filter({ hasText: /^Continuar$/ }).last();
        await expect(contBtn).toBeEnabled({ timeout: 10000 });
        await contBtn.click();

        // Tipo de passeio: livre.
        const walkTypeBtn = ownerPage!.locator('button').filter({ hasText: /Livre|Coletivo/i }).first();
        await expect(walkTypeBtn).toBeVisible({ timeout: 15000 });
        await walkTypeBtn.click();
        await ownerPage!.locator('button').filter({ hasText: /^Continuar$/ }).last().click();

        // Duração (default 30 min).
        await expect(ownerPage!.locator('button').filter({ hasText: /^Continuar$/ }).last()).toBeVisible({
          timeout: 10000,
        });
        await ownerPage!.locator('button').filter({ hasText: /^Continuar$/ }).last().click();

        // Quote + SlideToConfirm real.
        await expect(ownerPage!.locator('span').filter({ hasText: /R\$/ }).first()).toBeVisible({
          timeout: 20000,
        });
        const track = ownerPage!.locator('[data-testid-track="slide-to-confirm-track"]');
        const handle = ownerPage!.locator('[data-testid-handle="slide-to-confirm-handle"]');
        await expect(track).toBeVisible({ timeout: 15000 });
        await expect(handle).toBeVisible({ timeout: 15000 });
        const handleBox = await handle.boundingBox();
        const trackBox = await track.boundingBox();
        if (!handleBox || !trackBox) throw new Error('Slider elements not found');
        await ownerPage!.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
        await ownerPage!.mouse.down();
        await ownerPage!.mouse.move(trackBox.x + trackBox.width - 5, trackBox.y + trackBox.height / 2, {
          steps: 50,
        });
        await ownerPage!.mouse.up();

        // Sessão criada pela UI REAL no banco.
        await expect
          .poll(
            async () => {
              const { data } = await admin
                .from('walk_sessions')
                .select('id')
                .eq('customer_id', ownerId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              return data?.id || '';
            },
            { timeout: 20000, message: 'walk_session no banco após slide' }
          )
          .toBeTruthy();

        const { data: created, error: cErr } = await admin
          .from('walk_sessions')
          .select('id')
          .eq('customer_id', ownerId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cErr || !created) throw new Error('session_not_found_after_ui_creation');
        sessionId = created.id;
        log(`session_id criado pela UI: ${sessionId}`);

        // Higiene de cleanup: tag e2e (NÃO toca status/lifecycle).
        const { error: tagErr } = await admin
          .from('walk_sessions')
          .update({ e2e_test: true, e2e_run_id: runId })
          .eq('id', sessionId);
        if (tagErr) throw new Error(`session_tag_failed: ${JSON.stringify(tagErr)}`);
      });

      await test.step('auditoria: searching + MESMA sessão + dono/pet corretos', async () => {
        const s = await auditSession(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.pet_id).toBe(petId);
        expect(s.status).toBe('searching');
        expect(s.current_status).toBe('searching');

        const ownerActive = await activeOwnerSessionCount();
        expect(ownerActive).toHaveLength(1);
        expect(ownerActive[0].id).toBe(sessionId);
        const petActive = await activePetSessionCount();
        expect(petActive).toHaveLength(1);
        expect(petActive[0].id).toBe(sessionId);
      });

      await test.step('matching job: oferta real via process_walk_matching', async () => {
        const { data: prof, error: profErr } = await admin
          .from('petwalker_profiles')
          .select('approval_status, availability_status, is_accepting_requests, current_walk_id')
          .eq('user_id', walkerId)
          .single();
        if (profErr) throw new Error(`walker_eligibility_failed: ${JSON.stringify(profErr)}`);
        expect(prof.approval_status).toBe('approved');
        expect(prof.availability_status).toBe('available');
        expect(prof.is_accepting_requests).toBe(true);
        expect(prof.current_walk_id).toBeNull();

        // Scheduler simulado — NÃO insere oferta manualmente.
        const { error: matchErr } = await admin.rpc('process_walk_matching');
        if (matchErr) throw new Error(`matching_failed: ${matchErr.message}`);

        await expect
          .poll(
            async () => {
              const { data } = await admin
                .from('walk_offers')
                .select('offer_status')
                .eq('session_id', sessionId)
                .eq('walker_id', walkerId);
              return Array.isArray(data) && data.length > 0 && data[0].offer_status === 'pending';
            },
            { timeout: 20000, message: 'Oferta real via process_walk_matching' }
          )
          .toBeTruthy();
        log('oferta pending real criada pelo process_walk_matching');
      });

      await test.step('walker: oferta visível + aceite pela UI (accept_walk_request)', async () => {
        await walkerPage!.goto('/petwalker');
        const onlineBtn = walkerPage!.getByRole('button', { name: /Ficar Online/i });
        const acceptBtn = walkerPage!.locator('[data-testid="walker-accept-button"]');
        await expect
          .poll(
            async () => {
              if (await acceptBtn.isVisible()) return true;
              if (await onlineBtn.isVisible()) {
                await onlineBtn.click().catch(() => {});
                await walkerPage!.waitForTimeout(2000);
              }
              return await acceptBtn.isVisible();
            },
            { timeout: 45000, message: 'Oferta visível no PetWalker' }
          )
          .toBeTruthy();

        await acceptBtn.click();

        // Resposta REAL do accept_walk_request: HTTP 200 + body true.
        await expect
          .poll(
            () => {
              const rpc = lastRpc('accept_walk_request');
              return !!(rpc && rpc.status === 200 && rpc.body === true);
            },
            { timeout: 20000, message: 'accept_walk_request HTTP 200 + true' }
          )
          .toBeTruthy();
        log('aceite real confirmado (accept_walk_request HTTP 200 + true)');
      });

      await test.step('walker: PROVA accepted + "Iniciar deslocamento" pela UI REAL (petwalker_start_heading) → heading_to_pickup', async () => {
        // Backend: MESMA sessão, status accepted, MESMO Walker.
        await expect
          .poll(
            async () => {
              const { data } = await admin
                .from('walk_sessions')
                .select('current_status, walker_id')
                .eq('id', sessionId)
                .single();
              return data?.current_status === 'accepted' && data.walker_id === walkerId;
            },
            { timeout: 20000, message: 'accepted + walker_id no banco' }
          )
          .toBeTruthy();

        // Botão real do ActiveWalkSheet no Painel do Walker (status accepted):
        // "Iniciar deslocamento" → supabase.rpc('petwalker_start_heading').
        // NUNCA invocamos a RPC por admin/test — apenas pela UI real.
        const startBtn = walkerPage!.getByRole('button', { name: /Iniciar deslocamento/i });
        await expect(startBtn).toBeVisible({ timeout: 45000 });
        await startBtn.click();

        // Resposta REAL do petwalker_start_heading: HTTP 200 + body true
        // (a RPC retorna boolean: TRUE quando o UPDATE promoveu a sessão).
        await expect
          .poll(
            () => {
              const rpc = lastRpc('petwalker_start_heading');
              return !!(rpc && rpc.status === 200 && rpc.body === true);
            },
            { timeout: 20000, message: 'petwalker_start_heading HTTP 200 + true (via UI)' }
          )
          .toBeTruthy();
        log('petwalker_start_heading real observado (HTTP 200, via UI "Iniciar deslocamento")');

        // Backend: MESMA sessão agora heading_to_pickup, MESMO Walker.
        await expect
          .poll(
            async () => {
              const { data } = await admin
                .from('walk_sessions')
                .select('current_status, walker_id')
                .eq('id', sessionId)
                .single();
              return data?.current_status === 'heading_to_pickup' && data.walker_id === walkerId;
            },
            { timeout: 20000, message: 'current_status heading_to_pickup no banco' }
          )
          .toBeTruthy();
        log('backend heading_to_pickup confirmado após "Iniciar deslocamento"');

        // Navegação canônica (certificada 4.4): o próprio produto navega o
        // Walker para o WalkDetails da MESMA sessão. O teste NÃO executa
        // walkerPage.goto('/petwalker') para a chegada.
        await expect(walkerPage!).toHaveURL(new RegExp(`/petwalker/passeio/${sessionId}`), {
          timeout: 20000,
        });
        log(`Walker no WalkDetails da mesma sessão: /petwalker/passeio/${sessionId}`);
      });

      await test.step('walker: heading_to_pickup → arrived via "Cheguei no Local" no WalkDetails (padrão certificado 4.4)', async () => {
        // PADRÃO CERTIFICADO 4.4 (tests/arrival-blocker-4.4.spec.ts): sem
        // preflight GPS experimental e sem volta ao /petwalker. O Walker
        // permanece no WalkDetails /petwalker/passeio/<sessionId> (para onde
        // o próprio produto navegou após "Iniciar deslocamento") e clica o
        // botão REAL "Cheguei no Local", que usa o GPS do browser
        // (navigator.geolocation.getCurrentPosition) e chama:
        //   petwalker_arrive_pickup(_session_id, _lat, _lng, _accuracy)
        //
        // T3: imediatamente ANTES do clique, registramos fatos de UI SEGUROS
        // (pathname, texto do botão, disabled) — sem inspecionar internals de
        // React e sem expor tokens/headers.
        const arriveBtn = walkerPage!.getByRole('button', { name: /Cheguei no Local/i });
        await expect(arriveBtn).toBeVisible({ timeout: 30000 });

        const preClickPathname = new URL(walkerPage!.url()).pathname;
        expect(preClickPathname).toBe(`/petwalker/passeio/${sessionId}`);
        const preClickButtonText = (await arriveBtn.innerText()).trim();
        expect(preClickButtonText).toMatch(/Cheguei no Local/i);
        const preClickButtonDisabled = await arriveBtn.isDisabled();
        expect(preClickButtonDisabled).toBe(false);
        const preClickFacts = {
          pathname: preClickPathname,
          buttonText: preClickButtonText,
          buttonDisabled: preClickButtonDisabled,
        };
        log(
          `pré-clique: pathname=${preClickFacts.pathname} text=${JSON.stringify(preClickFacts.buttonText)} disabled=${preClickFacts.buttonDisabled}`
        );

        // Handler-entry (B): WalkDetails faz setArriving(true) ANTES de aguardar
        // a RPC — o botão passa a "Processando..." (o NOME acessível muda, então
        // observamos pelo novo nome, não filtrando o locator antigo).
        // Observação race-safe e limitada: nunca falha por si só.
        const processandoProbe = (async () => {
          try {
            await walkerPage!
              .getByRole('button', { name: /Processando/i })
              .waitFor({ state: 'visible', timeout: 4000 });
            arriveObs.handlerEntryObserved = true;
            log('handler-entry observado: botão em "Processando..." (setArriving(true))');
          } catch {
            log('handler-entry: "Processando..." não observado em 4s (fato factual, não falha)');
          }
        })();

        // T5: registra o pathname EXATO do WalkDetails ANTES do clique e arma a
        // barreira temporária APENAS para o próximo reload de DOCUMENTO desta
        // MESMA pathname (window.location.reload() do produto). O RPC do
        // Supabase NUNCA é interceptado; o handler usa fallback() — nada é
        // mockado, fulfillado ou abortado.
        holdPathname = new URL(walkerPage!.url()).pathname;
        expect(holdPathname).toBe(`/petwalker/passeio/${sessionId}`);
        reloadHoldArmed = true;
        arriveObs.productReloadObserved = false;
        arriveObs.productReloadHeld = false;
        arriveObs.productReloadReleased = false;
        productReloadHeldNotify = () => {};
        let resolveHeld: (() => void) | null = null;
        const heldSignal = new Promise<void>((r) => {
          resolveHeld = r;
        });
        productReloadHeldNotify = () => resolveHeld?.();
        await walkerPage!.route(walkerReloadHoldPredicate, reloadHoldHandler);
        log(`T5: barreira de reload armada para ${holdPathname} (documento same-WalkDetails apenas)`);

        try {
          // UMA única ação real de usuário: o clique no botão do produto.
          await arriveBtn.click();
          await Promise.race([processandoProbe, heldSignal, new Promise((r) => setTimeout(r, 4000))]);
          if (!arriveObs.productReloadHeld) {
            // Sem reload retido ainda: aguardamos o fechamento factual do
            // probe de handler-entry ("Processando..." observado ou não).
            await processandoProbe;
          }

          // Resposta REAL do petwalker_arrive_pickup: HTTP 200 + body true
          // (a RPC retorna boolean: TRUE quando o UPDATE promoveu a sessão).
          try {
            await expect
              .poll(
                () => {
                  const rpc = lastRpc('petwalker_arrive_pickup');
                  return !!(rpc && rpc.status === 200 && rpc.body === true);
                },
                { timeout: 20000, intervals: [250, 500, 1000] }
              )
              .toBeTruthy();
          } catch (err) {
            // T3/T4/T5: falha factual com o relatório completo e SEGURO do
            // caminho de chegada (sem credenciais/headers).
            throw new Error(
              `${arriveRpcTimeoutDiagnostic(preClickFacts)} | underlying=${err instanceof Error ? err.message : String(err)}`
            );
          }
          log('petwalker_arrive_pickup real observado (HTTP 200 + true, via UI "Cheguei no Local")');
        } finally {
          // T5 fail-safe: a barreira é SEMPRE liberada — o reload REAL do
          // produto prossegue mesmo se a captura/asserção falhar.
          await releaseProductReloadHold();
        }

        // O reload REAL do produto (window.location.reload()) prossegue
        // normalmente; o teste apenas OBSERVA (e a espera abaixo é factual —
        // o reload de fato aconteceu quando a barreira observou o documento).
        if (arriveObs.productReloadObserved) {
          log('reload REAL do produto do WalkDetails executado após a chegada');
        }

        // Backend: MESMA sessão agora arrived, MESMO Walker.
        await expect
          .poll(
            async () => {
              const { data } = await admin
                .from('walk_sessions')
                .select('current_status, walker_id')
                .eq('id', sessionId)
                .single();
              return data?.current_status === 'arrived' && data.walker_id === walkerId;
            },
            { timeout: 20000, message: 'current_status arrived no banco' }
          )
          .toBeTruthy();
        log('backend arrived confirmado após "Cheguei no Local"');
      });

      await test.step('PROVA arrived ANTES do reload (backend + UI do Owner)', async () => {
        // Backend: MESMA sessão, current_status arrived, MESMO Walker.
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.pet_id).toBe(petId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.current_status).toBe('arrived');

        // Exatamente UMA sessão ativa (não terminal) do Owner.
        const ownerActive = await activeOwnerSessionCount();
        expect(ownerActive).toHaveLength(1);
        expect(ownerActive[0].id).toBe(sessionId);

        // Exatamente UMA sessão ativa do pet envolvido.
        const petActive = await activePetSessionCount();
        expect(petActive).toHaveLength(1);
        expect(petActive[0].id).toBe(sessionId);

        // Exatamente UMA chamada real de petwalker_arrive_pickup, através da
        // UI do Walker (HTTP 200 + true) — nunca por admin/test.
        const arriveCalls = rpcCalls['petwalker_arrive_pickup'] || [];
        expect(arriveCalls).toHaveLength(1);
        expect(arriveCalls[0].status).toBe(200);
        expect(arriveCalls[0].body).toBe(true);

        // UI do Owner: a apresentação ARRIVED/PIN do WalkInProgress (fase
        // 'arrived') — overlay de confirmação de retirada com entrada de PIN
        // de 6 dígitos (data-testid="pickup-pin-input") + botão de envio
        // (data-testid="pickup-pin-submit") + o título "{walkerName} chegou!".
        // IMPORTANTE: o marcador por si só NÃO identifica arrived; ele é
        // válido apenas combinado com a asserção de backend
        // current_status === 'arrived' (autoridade do domínio).
        await expect(ownerPage!.getByTestId('pickup-pin-input').first()).toBeVisible({ timeout: 120000 });
        await expect(ownerPage!.getByTestId('pickup-pin-submit')).toBeVisible({ timeout: 15000 });
        log('UI do Owner: overlay arrived/PIN visível ANTES do reload (pickup-pin-input + backend arrived)');
      });

      await test.step('AÇÃO DE RESILIÊNCIA: reload da MESMA página /search-walk', async () => {
        // Fatos de URL pré-reload: a rota normal pode conter query params
        // legítimos pré-existentes (ex.: ?petId=<uuid> colocado pelo produto
        // ao navegar de /inicio). O teste NÃO injeta ?resume — a regra é que
        // o TESTE não fabrica estado de recuperação.
        const preReloadPath = new URL(ownerPage!.url()).pathname;
        expect(preReloadPath).toBe('/search-walk');
        log(`pré-reload: ${ownerPage!.url()}`);

        // Zerar contadores: nenhuma chamada nova de create_walk_request é
        // permitida como consequência do reload. Registramos as contagens
        // atuais de accept_walk_request, petwalker_start_heading e
        // petwalker_arrive_pickup — nenhuma chamada nova pode ocorrer após o
        // reload do Owner.
        rpcCalls['create_walk_request'] = [];
        acceptCountBeforeReload = (rpcCalls['accept_walk_request'] || []).length;
        startHeadingCountBeforeReload = (rpcCalls['petwalker_start_heading'] || []).length;
        arriveCountBeforeReload = (rpcCalls['petwalker_arrive_pickup'] || []).length;

        await ownerPage!.reload({ waitUntil: 'domcontentloaded' });

        // Apenas o PATHNAME da rota é verificado — o reload preserva query
        // params legítimos (?petId), e o produto pode adicionar/alterar
        // parâmetros na própria recuperação sem quebrar este teste.
        await expect
          .poll(() => new URL(ownerPage!.url()).pathname, {
            timeout: 15000,
            message: 'pathname permanece /search-walk após reload',
          })
          .toBe('/search-walk');
        log(`reloaded: ${ownerPage!.url()}`);
      });

      await test.step('VERDADE PÓS-RELOAD (ZERO ações do usuário): backend íntegro, sem novas chamadas', async () => {
        // Nenhuma chamada nova de create_walk_request pode ocorrer como
        // consequência do reload/recuperação.
        expect(rpcCalls['create_walk_request']).toHaveLength(0);

        // Nenhuma segunda aceitação pode ocorrer após o reload.
        const acceptCountAfterReload = (rpcCalls['accept_walk_request'] || []).length;
        expect(acceptCountAfterReload).toBe(acceptCountBeforeReload);

        // Nenhuma nova petwalker_start_heading pode ocorrer após o reload do
        // Owner (o Walker não executa nenhuma ação; e a recuperação do Owner
        // não pode disparar uma nova partida de deslocamento).
        const startHeadingCountAfterReload = (rpcCalls['petwalker_start_heading'] || []).length;
        expect(startHeadingCountAfterReload).toBe(startHeadingCountBeforeReload);

        // Nenhuma nova petwalker_arrive_pickup pode ocorrer após o reload do
        // Owner (o Walker não executa nenhuma ação; e a recuperação do Owner
        // não pode disparar uma nova chegada).
        const arriveCountAfterReload = (rpcCalls['petwalker_arrive_pickup'] || []).length;
        expect(arriveCountAfterReload).toBe(arriveCountBeforeReload);

        // Verdade autoritativa: MESMA sessão, ainda arrived, MESMO Owner,
        // MESMO Walker, MESMO Pet.
        const s = await auditSession(sessionId);
        expect(s.id).toBe(sessionId);
        expect(s.customer_id).toBe(ownerId);
        expect(s.pet_id).toBe(petId);
        expect(s.walker_id).toBe(walkerId);
        expect(s.current_status).toBe('arrived');

        // Exatamente UMA sessão ativa (não terminal) do Owner.
        const ownerActive = await activeOwnerSessionCount();
        expect(ownerActive).toHaveLength(1);
        expect(ownerActive[0].id).toBe(sessionId);

        // Exatamente UMA sessão ativa do pet envolvido.
        const petActive = await activePetSessionCount();
        expect(petActive).toHaveLength(1);
        expect(petActive[0].id).toBe(sessionId);

        // Exatamente UMA oferta (nenhuma segunda aceitação criou outra).
        const { data: offers, error: offersErr } = await admin
          .from('walk_offers')
          .select('id')
          .eq('session_id', sessionId)
          .eq('walker_id', walkerId);
        if (offersErr) throw new Error(`offers_audit_failed: ${JSON.stringify(offersErr)}`);
        expect(offers || []).toHaveLength(1);
        log('pós-reload: banco íntegro (same session/owner/walker/pet, arrived, 1 sessão ativa por dono e por pet, zero novas RPCs)');
      });

      await test.step('RECUPERAÇÃO AUTOMÁTICA esperada (RED até o produto restaurar arrived)', async () => {
        // COMPORTAMENTO DESEJADO: após o reload, com ZERO ações do usuário, a
        // MESMA sessão arrived deve restaurar automaticamente a UI arrived/PIN
        // (overlay pickup-pin-input). O produto hoje NÃO restaura arrived (a
        // descoberta automática certificada cobre apenas searching + accepted
        // + heading_to_pickup; ?resume não aceita arrived) — este passo é a
        // prova VERMELHA esperada. NÃO corrigir o produto nesta tarefa.
        await expect(ownerPage!.getByTestId('pickup-pin-input').first()).toBeVisible({ timeout: 20000 });
        log('RECUPERAÇÃO AUTOMÁTICA CONFIRMADA (verde): mesma sessão arrived restaurada sem ação');
      });
    } finally {
      await test.step('cleanup fail-closed: ZERO resíduos', async () => {
        // T5: libera (idempotente) a barreira de reload, se ainda armada.
        await releaseProductReloadHold().catch(() => {});
        // T3: desinstala os observadores de chegada (higiene de listeners).
        if (walkerPage) detachArriveObservers();
        if (walkerCtx) await walkerCtx.close().catch(() => {});
        if (ownerCtx) await ownerCtx.close().catch(() => {});
        // Sessão criada pela UI: remoção direta fail-closed (filhos → sessão),
        // cobrindo inclusive o caso de falha antes da tag e2e_run_id.
        if (sessionId) {
          const children = [
            { table: 'walk_pickup_codes', col: 'session_id' },
            { table: 'walker_tracking', col: 'walk_session_id' },
            { table: 'walk_offers', col: 'session_id' },
            { table: 'petwalker_earnings', col: 'walk_session_id' },
          ] as const;
          for (const child of children) {
            const { error: delErr } = await admin.from(child.table).delete().eq(child.col, sessionId);
            if (delErr) throw new Error(`cleanup_child_failed ${child.table}: ${JSON.stringify(delErr)}`);
          }
          const { error: sessDelErr } = await admin.from('walk_sessions').delete().eq('id', sessionId);
          if (sessDelErr) throw new Error(`cleanup_session_failed: ${JSON.stringify(sessDelErr)}`);
        }
        // Usuários/perfis/pet: helper certificado (valida metadata E2E do run).
        if (runId && ownerId && walkerId) {
          await failClosedCleanup(admin, [ownerId, walkerId], runId);
        }
        log('cleanup concluído — zero resíduos');
      });
    }
  });
});