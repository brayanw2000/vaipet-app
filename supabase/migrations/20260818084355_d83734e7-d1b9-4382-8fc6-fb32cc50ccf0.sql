-- PHASE 4.3 — TEST SETUP RECONCILIATION
-- O teste security-4.3 está falhando devido a uma restrição de CHECK ou TRIGGER na walk_sessions
-- que exige planned_duration_minutes múltiplo de 15.

DO $$
BEGIN
    -- Se existir o gatilho antigo que causava o erro P0001, vamos garantir que a migration 
    -- do PATCH 1 (canonical completion) o substitua ou o ignore.
    -- O erro P0001 no setup sugere que create_walk_request ou um trigger de INSERT está ativo.
    
    -- Ajuste preventivo para permitir durações menores no ambiente E2E se necessário,
    -- mas o teste deve apenas seguir a regra.
    NULL; 
END $$;
