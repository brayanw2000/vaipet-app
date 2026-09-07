DO $$ 
BEGIN
    -- 1. Verifica se a tabela existe
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'walk_pickup_codes') THEN
        CREATE TABLE public.walk_pickup_codes (
            session_id uuid PRIMARY KEY REFERENCES public.walk_sessions(id) ON DELETE CASCADE,
            pin_hash text NOT NULL,
            attempts integer DEFAULT 0,
            expires_at timestamp with time zone DEFAULT (now() + interval '30 minutes'),
            created_at timestamp with time zone DEFAULT now()
        );
        GRANT ALL ON public.walk_pickup_codes TO service_role;
    ELSE
        -- 2. Se a tabela existe, renomeia a coluna se necessário (pickup_code -> pin_hash)
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'walk_pickup_codes' AND column_name = 'pickup_code') THEN
            ALTER TABLE public.walk_pickup_codes RENAME COLUMN pickup_code TO pin_hash;
        END IF;
        
        -- 3. Garante que pin_hash existe
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'walk_pickup_codes' AND column_name = 'pin_hash') THEN
            ALTER TABLE public.walk_pickup_codes ADD COLUMN pin_hash text;
            UPDATE public.walk_pickup_codes SET pin_hash = '' WHERE pin_hash IS NULL;
            ALTER TABLE public.walk_pickup_codes ALTER COLUMN pin_hash SET NOT NULL;
        END IF;
    END IF;
END $$;

-- Recarregar cache
NOTIFY pgrst, 'reload schema';