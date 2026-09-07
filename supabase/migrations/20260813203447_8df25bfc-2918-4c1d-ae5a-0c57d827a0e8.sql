CREATE OR REPLACE FUNCTION public.fn_process_walk_session_pricing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  ELSE
    v_surcharge := 0;
  END IF;

  IF NEW.pricing_version IS NOT NULL AND NEW.pricing_version != v_settings.version THEN
    RAISE EXCEPTION 'Budget expired';
  END IF;

  v_calculated_total := (NEW.planned_duration_minutes * v_settings.price_per_minute_cents) + v_surcharge;

  NEW.price_per_minute_cents := v_settings.price_per_minute_cents;
  NEW.pricing_surcharge_cents := v_surcharge;
  NEW.total_price_cents := v_calculated_total;
  NEW.pricing_version := v_settings.version;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_protect_walk_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.planned_duration_minutes IS DISTINCT FROM NEW.planned_duration_minutes OR
      OLD.request_mode IS DISTINCT FROM NEW.request_mode OR
      OLD.scheduled_for IS DISTINCT FROM NEW.scheduled_for OR
      OLD.price_per_minute_cents IS DISTINCT FROM NEW.price_per_minute_cents OR
      OLD.pricing_surcharge_cents IS DISTINCT FROM NEW.pricing_surcharge_cents OR
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
$$;