
-- 1. Hardening walk_pricing_settings
DROP INDEX IF EXISTS unique_active_pricing;
CREATE UNIQUE INDEX unique_active_pricing ON public.walk_pricing_settings (is_active) WHERE (is_active = true);

ALTER TABLE public.walk_pricing_settings
DROP CONSTRAINT IF EXISTS price_positive,
DROP CONSTRAINT IF EXISTS min_duration_positive,
DROP CONSTRAINT IF EXISTS step_positive,
DROP CONSTRAINT IF EXISTS surcharges_non_negative,
DROP CONSTRAINT IF EXISTS version_positive;

ALTER TABLE public.walk_pricing_settings
ADD CONSTRAINT price_positive CHECK (price_per_minute_cents > 0),
ADD CONSTRAINT min_duration_positive CHECK (minimum_duration_minutes > 0),
ADD CONSTRAINT step_positive CHECK (duration_step_minutes > 0),
ADD CONSTRAINT surcharges_non_negative CHECK (now_surcharge_cents >= 0 AND scheduled_surcharge_cents >= 0),
ADD CONSTRAINT version_positive CHECK (version > 0);

REVOKE ALL ON public.walk_pricing_settings FROM PUBLIC;
REVOKE ALL ON public.walk_pricing_settings FROM anon;
REVOKE ALL ON public.walk_pricing_settings FROM authenticated;
GRANT SELECT ON public.walk_pricing_settings TO service_role;

-- 2. Correct get_walk_quote RPC
-- Use the exact types from the hint or current schema
DROP FUNCTION IF EXISTS public.get_walk_quote(integer, public.walk_request_mode);
DROP FUNCTION IF EXISTS public.get_walk_quote(integer, text);

CREATE OR REPLACE FUNCTION public.get_walk_quote(
  _duration_minutes integer,
  _request_mode public.walk_request_mode
)
RETURNS TABLE (
  duration_minutes integer,
  price_per_minute_cents integer,
  request_surcharge_cents integer,
  total_price_cents integer,
  pricing_version integer,
  request_mode public.walk_request_mode
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings RECORD;
  v_surcharge integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_settings FROM public.walk_pricing_settings WHERE is_active = true LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active pricing settings found';
  END IF;

  IF _duration_minutes < v_settings.minimum_duration_minutes THEN
    RAISE EXCEPTION 'Duração mínima é de % minutos', v_settings.minimum_duration_minutes;
  END IF;

  IF (_duration_minutes % v_settings.duration_step_minutes) != 0 THEN
    RAISE EXCEPTION 'Duração deve ser múltipla de % minutos', v_settings.duration_step_minutes;
  END IF;

  IF _request_mode = 'now' THEN
    v_surcharge := v_settings.now_surcharge_cents;
  ELSIF _request_mode = 'scheduled' THEN
    v_surcharge := v_settings.scheduled_surcharge_cents;
  ELSE
    RAISE EXCEPTION 'Modo de solicitação inválido';
  END IF;

  RETURN QUERY
  SELECT 
    _duration_minutes,
    v_settings.price_per_minute_cents,
    v_surcharge,
    (_duration_minutes * v_settings.price_per_minute_cents) + v_surcharge,
    v_settings.version,
    _request_mode;
END;
$$;

REVOKE ALL ON FUNCTION public.get_walk_quote(integer, public.walk_request_mode) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_walk_quote(integer, public.walk_request_mode) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_walk_quote(integer, public.walk_request_mode) TO authenticated, service_role;

-- 3. Financial Snapshot Trigger for walk_sessions
CREATE OR REPLACE FUNCTION public.fn_process_walk_session_pricing()
RETURNS TRIGGER AS $$
DECLARE
  v_settings RECORD;
  v_surcharge integer;
  v_calculated_total integer;
BEGIN
  SELECT * INTO v_settings FROM public.walk_pricing_settings WHERE is_active = true LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active pricing settings found';
  END IF;

  IF NEW.planned_duration_minutes < v_settings.minimum_duration_minutes THEN
    RAISE EXCEPTION 'Duração mínima de % minutos não respeitada', v_settings.minimum_duration_minutes;
  END IF;

  IF (NEW.planned_duration_minutes % v_settings.duration_step_minutes) != 0 THEN
    RAISE EXCEPTION 'Duração deve ser em incrementos de % minutos', v_settings.duration_step_minutes;
  END IF;

  IF NEW.request_mode = 'now' THEN
    IF NEW.scheduled_for IS NOT NULL THEN
      RAISE EXCEPTION 'Modo "now" não permite agendamento';
    END IF;
    v_surcharge := v_settings.now_surcharge_cents;
  ELSIF NEW.request_mode = 'scheduled' THEN
    IF NEW.scheduled_for IS NULL THEN
      RAISE EXCEPTION 'Modo agendado exige uma data e hora';
    END IF;
    IF NEW.scheduled_for <= now() THEN
      RAISE EXCEPTION 'Agendamento deve ser para o futuro';
    END IF;
    v_surcharge := v_settings.scheduled_surcharge_cents;
  END IF;

  IF NEW.pricing_version IS NOT NULL AND NEW.pricing_version != v_settings.version THEN
    RAISE EXCEPTION 'Budget expired';
  END IF;

  v_calculated_total := (NEW.planned_duration_minutes * v_settings.price_per_minute_cents) + v_surcharge;

  NEW.price_per_minute_cents := v_settings.price_per_minute_cents;
  NEW.request_surcharge_cents := v_surcharge;
  NEW.total_price_cents := v_calculated_total;
  NEW.pricing_version := v_settings.version;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_walk_session_pricing ON public.walk_sessions;
CREATE TRIGGER trg_walk_session_pricing
BEFORE INSERT ON public.walk_sessions
FOR EACH ROW EXECUTE FUNCTION public.fn_process_walk_session_pricing();

-- 4. Immutable Pricing Protection
CREATE OR REPLACE FUNCTION public.fn_protect_walk_immutable_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.planned_duration_minutes IS DISTINCT FROM NEW.planned_duration_minutes OR
      OLD.request_mode IS DISTINCT FROM NEW.request_mode OR
      OLD.scheduled_for IS DISTINCT FROM NEW.scheduled_for OR
      OLD.price_per_minute_cents IS DISTINCT FROM NEW.price_per_minute_cents OR
      OLD.request_surcharge_cents IS DISTINCT FROM NEW.request_surcharge_cents OR
      OLD.total_price_cents IS DISTINCT FROM NEW.total_price_cents OR
      OLD.pricing_version IS DISTINCT FROM NEW.pricing_version) 
  THEN
    RAISE EXCEPTION 'Financial snapshot and request configuration are immutable after creation';
  END IF;

  IF NEW.total_price_cents IS NULL THEN
    RAISE EXCEPTION 'Total price cannot be null';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_protect_walk_pricing ON public.walk_sessions;
CREATE TRIGGER trg_protect_walk_pricing
BEFORE UPDATE ON public.walk_sessions
FOR EACH ROW EXECUTE FUNCTION public.fn_protect_walk_immutable_fields();

-- 5. Hardened update_petwalker_operational_profile
DROP FUNCTION IF EXISTS public.update_petwalker_operational_profile(text, integer);

CREATE OR REPLACE FUNCTION public.update_petwalker_operational_profile(
  _public_bio text,
  _experience_years integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.has_role(auth.uid(), 'petwalker') THEN
    RAISE EXCEPTION 'Not a petwalker';
  END IF;

  IF length(_public_bio) < 20 THEN
    RAISE EXCEPTION 'Bio muito curta (mínimo 20 caracteres)';
  END IF;
  
  IF _experience_years < 0 OR _experience_years > 50 THEN
    RAISE EXCEPTION 'Experiência inválida';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.petwalker_profiles 
    WHERE user_id = auth.uid() AND approval_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'PetWalker não aprovado ou perfil não encontrado';
  END IF;

  UPDATE public.petwalker_profiles
  SET 
    public_bio = _public_bio,
    experience_years = _experience_years,
    profile_completed = true,
    updated_at = now()
  WHERE user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nenhum perfil atualizado';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_petwalker_operational_profile(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_petwalker_operational_profile(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_petwalker_operational_profile(text, integer) TO authenticated, service_role;
