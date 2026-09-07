DO $$ 
BEGIN
    -- DROP promote_user_to_petwalker
    IF to_regprocedure('public.promote_user_to_petwalker(text)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.promote_user_to_petwalker(text) FROM PUBLIC, anon, authenticated;
        DROP FUNCTION public.promote_user_to_petwalker(text);
    END IF;

    -- DROP check_user_is_petwalker
    IF to_regprocedure('public.check_user_is_petwalker(text)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.check_user_is_petwalker(text) FROM PUBLIC, anon, authenticated;
        DROP FUNCTION public.check_user_is_petwalker(text);
    END IF;

    -- DROP confirm_and_promote_user_by_email
    IF to_regprocedure('public.confirm_and_promote_user_by_email(text, text)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.confirm_and_promote_user_by_email(text, text) FROM PUBLIC, anon, authenticated;
        DROP FUNCTION public.confirm_and_promote_user_by_email(text, text);
    END IF;
END $$;
