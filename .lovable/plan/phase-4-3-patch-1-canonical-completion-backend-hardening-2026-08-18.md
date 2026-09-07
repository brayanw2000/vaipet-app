# Phase 4.3 — Patch 1 — Canonical Completion Backend Hardening

Endurecer o fluxo de encerramento do passeio no backend, garantindo que a autoridade final seja do Tutor e que os cálculos de duração e distância sejam realizados de forma segura no servidor.

## User Review Required

> [!IMPORTANT]
> Este patch foca exclusivamente no **backend** (RPCs e Migrations) e na criação de uma suíte de **testes de segurança**. Não haverá alterações visíveis na interface do usuário (frontend) neste momento.

- **Fluxo de Encerramento**: Apenas o Tutor pode solicitar o retorno (`customer_request_return`) e confirmar a chegada (`customer_confirm_arrival`).
- **Bloqueio do Walker**: O PetWalker não poderá mais finalizar o passeio unilateralmente através da RPC `petwalker_complete_walk`.
- **Cálculos no Servidor**: A duração real e a distância percorrida serão calculadas atomicamente no banco de dados durante a confirmação da chegada, utilizando os dados de geolocalização capturados.

## Technical Details

### 1. Migrations e RPCs
- Criar a migration `20260818083700_phase43_canonical_completion_hardening.sql`.
- **`customer_request_return`**:
    - `SECURITY DEFINER`.
    - Bloqueio via `FOR UPDATE`.
    - Validação estrita de `customer_id`.
    - Transição `in_progress` -> `returning`.
- **`customer_confirm_arrival`**:
    - `SECURITY DEFINER`.
    - Cálculo de `actual_duration_minutes` (mínimo 1 minuto).
    - Cálculo de `distance_km` via PostGIS (`ST_Length` sobre `ST_MakeLine` dos pontos em `walker_tracking`).
    - Liberação do walker (`current_walk_id = NULL`).
    - Transição `returning` -> `completed`.
- **`petwalker_complete_walk`**:
    - `REVOKE EXECUTE` para `authenticated` e `anon`.
    - Acesso restrito a `service_role`.

### 2. State Machine e Validações
- Garantir que `in_progress` não possa ir direto para `completed`.
- Manter sincronismo entre `status` e `current_status`.

### 3. Testes Automatizados
- Criar `tests/completion-security-4.3.spec.ts`.
- Adicionar script `test:e2e:phase43:security` ao `package.json`.
- Validar matriz de permissões, replays, concorrência e integridade dos cálculos pós-conclusão.

### 4. Limitações
- Zero alterações em `src/`.
- Zero alterações em migrations anteriores.
- Zero impacto nas Phases 3.1, 4.1 e 4.2 já certificadas.
