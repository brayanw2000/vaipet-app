# Plano de Estabilização Fase 3.1 - Unificação de Estados

Este plano descreve as alterações para unificar o estado das sessões de passeio (`walk_sessions`) usando exclusivamente `current_status` como fonte de verdade, mantendo a coluna `status` apenas como espelho de compatibilidade.

## 1. Auditoria e Backfill (Banco de Dados)
- Criar migration `20260813200000_phase3_1_status_unification.sql`.
- Backfill: Corrigir `current_status` nulos baseando-se no campo `status` legado.
- Mapeamento: `active` -> `in_progress`, `finished` -> `completed`.
- Configurar `current_status` como `NOT NULL` com default `searching`.
- Implementar trigger `BEFORE INSERT OR UPDATE` para garantir que `status` (text) sempre espelhe `current_status` (walk_status).

## 2. Revisão de RPCs
- Atualizar as seguintes RPCs para operar apenas sobre `current_status`:
    - `create_walk_request`
    - `accept_walk_request`
    - `decline_walk_offer`
    - `customer_cancel_search`
    - `cancel_walk_session`
    - `petwalker_start_heading`
    - `petwalker_arrive_pickup`
    - `petwalker_start_walk`
    - `customer_request_return`
    - `customer_confirm_arrival`
    - `petwalker_complete_walk`
- Garantir transições de estado lineares e seguras.

## 3. Frontend e Realtime
- Atualizar componentes para ler `current_status` em vez de `status`:
    - `ActiveWalkBanner.tsx`, `History.tsx`, `HomePasseio.tsx`, `MyPets.tsx`, `WalkDetailsModal.tsx`, `WalkInProgress.tsx`.
- Atualizar páginas:
    - `PetDetails.tsx`, `PetHistory.tsx`, `SearchWalk.tsx`, `WalkDetails.tsx`, `WalkHistory.tsx`, `petwalker/historico.tsx`.
- Criar tipo `WalkStatus` compartilhado em `src/types/walk.ts` (ou similar) derivado do Supabase.
- Ajustar listeners de Realtime para reagir a mudanças em `current_status`.

## 4. Validação
- Executar `npm run build` e `npx tsc --noEmit`.
- Verificar se não há novos erros de lint nos arquivos alterados.
- Testar fluxo completo de passeio (searching -> completed).

## Detalhes Técnicos
- O trigger impedirá divergências entre as colunas.
- A coluna `status` permanecerá como `text` para evitar quebras imediatas em filtros complexos do Supabase Client, mas seu valor será controlado pelo banco.
- Não haverá alteração em precificação, matching ou UX.
