-- Fase 2: Precificação centralizada e ajustes no perfil operacional

-- 1. Tabela de configurações de preço
CREATE TABLE public.walk_pricing_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    price_per_minute_cents integer NOT NULL,
    minimum_duration_minutes integer NOT NULL,
    duration_step_minutes integer NOT NULL,
    now_surcharge_cents integer DEFAULT 0,
    scheduled_surcharge_cents integer DEFAULT 0,
    version integer DEFAULT 1,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

INSERT INTO public.walk_pricing_settings (price_per_minute_cents, minimum_duration_minutes, duration_step_minutes, now_surcharge_cents, scheduled_surcharge_cents, version, is_active)
VALUES (150, 15, 15, 0, 0, 1, true);

-- RLS para configuração de preço
ALTER TABLE public.walk_pricing_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.walk_pricing_settings TO authenticated;
GRANT ALL ON public.walk_pricing_settings TO service_role;
CREATE POLICY "Admins manage settings" ON public.walk_pricing_settings FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated view active settings" ON public.walk_pricing_settings FOR SELECT USING (is_active = true);

-- 2. Enum da modalidade
CREATE TYPE public.walk_request_mode AS ENUM ('now', 'scheduled');

-- 3. RPC de orçamento (Segura e definida no servidor)
CREATE OR REPLACE FUNCTION public.get_walk_quote(
  _duration_minutes integer,
  _request_mode public.walk_request_mode
)
RETURNS jsonb AS $$
DECLARE
  v_settings public.walk_pricing_settings;
  v_surcharge_cents integer;
  v_total_price_cents integer;
BEGIN
  -- Validar auth
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authorized'; END IF;

  SELECT * INTO v_settings FROM public.walk_pricing_settings WHERE is_active = true LIMIT 1;
  IF v_settings IS NULL THEN RAISE EXCEPTION 'No active pricing settings'; END IF;

  -- Validações de duração
  IF _duration_minutes < v_settings.minimum_duration_minutes THEN RAISE EXCEPTION 'Duração mínima é % minutos', v_settings.minimum_duration_minutes; END IF;
  IF _duration_minutes % v_settings.duration_step_minutes != 0 THEN RAISE EXCEPTION 'Duração deve ser múltiplo de % minutos', v_settings.duration_step_minutes; END IF;

  -- Calcular
  v_surcharge_cents := CASE WHEN _request_mode = 'now' THEN v_settings.now_surcharge_cents ELSE v_settings.scheduled_surcharge_cents END;
  v_total_price_cents := (_duration_minutes * v_settings.price_per_minute_cents) + v_surcharge_cents;

  RETURN jsonb_build_object(
    'duration_minutes', _duration_minutes,
    'request_mode', _request_mode,
    'price_per_minute_cents', v_settings.price_per_minute_cents,
    'surcharge_cents', v_surcharge_cents,
    'total_price_cents', v_total_price_cents,
    'pricing_version', v_settings.version
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.get_walk_quote(integer, public.walk_request_mode) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_walk_quote(integer, public.walk_request_mode) TO authenticated, service_role;

-- 4. Alterações em walk_sessions
ALTER TABLE public.walk_sessions ADD COLUMN IF NOT EXISTS request_mode public.walk_request_mode;
ALTER TABLE public.walk_sessions ADD COLUMN IF NOT EXISTS scheduled_for timestamp with time zone;
ALTER TABLE public.walk_sessions ADD COLUMN IF NOT EXISTS price_per_minute_cents integer;
ALTER TABLE public.walk_sessions ADD COLUMN IF NOT EXISTS pricing_surcharge_cents integer;
ALTER TABLE public.walk_sessions ADD COLUMN IF NOT EXISTS total_price_cents integer;
ALTER TABLE public.walk_sessions ADD COLUMN IF NOT EXISTS pricing_version integer;

-- Proteção: Usuário não altera preço (TRIGGER)
CREATE OR REPLACE FUNCTION public.protect_walk_pricing()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.total_price_cents IS NOT NULL AND NEW.total_price_cents != OLD.total_price_cents THEN
      RAISE EXCEPTION 'Não é permitido alterar o preço de um passeio confirmado';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_walk_pricing ON public.walk_sessions;
CREATE TRIGGER trg_protect_walk_pricing
BEFORE UPDATE ON public.walk_sessions
FOR EACH ROW EXECUTE FUNCTION public.protect_walk_pricing();

-- 5. Atualização da RPC de perfil operacional (Remoção da sobrecarga)
DROP FUNCTION IF EXISTS public.update_petwalker_operational_profile(text, integer, numeric, integer);
CREATE OR REPLACE FUNCTION public.update_petwalker_operational_profile(
  _public_bio text,
  _experience_years integer
)
RETURNS void AS $$
DECLARE
  v_approval_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'petwalker') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  
  SELECT approval_status INTO v_approval_status FROM public.petwalker_profiles WHERE user_id = auth.uid();
  IF v_approval_status != 'approved' THEN RAISE EXCEPTION 'Perfil não aprovado'; END IF;

  IF _experience_years < 0 OR _experience_years > 50 THEN RAISE EXCEPTION 'Invalid experience'; END IF;

  UPDATE public.petwalker_profiles
  SET public_bio = _public_bio, 
      experience_years = _experience_years, 
      profile_completed = true,
      updated_at = now()
  WHERE user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.update_petwalker_operational_profile(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_petwalker_operational_profile(text, integer) TO authenticated, service_role;
