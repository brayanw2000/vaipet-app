CREATE OR REPLACE FUNCTION public.petwalker_confirm_pickup(walk_id uuid, input_pin text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_walker_id uuid;
    v_customer_id uuid;
    v_correct_pin text;
    v_attempts int;
    v_expires_at timestamptz;
BEGIN
    v_walker_id := auth.uid();
    IF v_walker_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Obter a sessão e travar para atualização
    SELECT walker_id, customer_id
    INTO v_walker_id, v_customer_id
    FROM public.walk_sessions
    WHERE id = walk_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Walk session not found';
    END IF;

    -- Obter o código PIN
    SELECT pin_code, attempts, expires_at
    INTO v_correct_pin, v_attempts, v_expires_at
    FROM public.walk_pickup_codes
    WHERE session_id = walk_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pickup code not generated';
    END IF;

    IF v_expires_at < now() THEN
        RAISE EXCEPTION 'Expired';
    END IF;

    IF v_attempts >= 5 THEN
        RAISE EXCEPTION 'Max attempts reached';
    END IF;

    IF v_correct_pin = input_pin THEN
        -- Sucesso: Atualizar status (start_time corrigido)
        UPDATE public.walk_sessions
        SET 
            status = 'in_progress',
            current_status = 'in_progress',
            start_time = now(),
            updated_at = now()
        WHERE id = walk_id;

        -- Limpar código
        DELETE FROM public.walk_pickup_codes WHERE session_id = walk_id;

        RETURN TRUE;
    ELSE
        -- Erro: Incrementar tentativas
        UPDATE public.walk_pickup_codes
        SET attempts = attempts + 1
        WHERE session_id = walk_id;

        RETURN FALSE;
    END IF;
END;
$function$;