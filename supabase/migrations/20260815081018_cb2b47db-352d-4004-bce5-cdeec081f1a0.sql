DO $$
DECLARE
    affected_rows int;
    user_id_val uuid := '8258cffe-9808-41b5-a2ae-29af6b4371a1';
    target_email text := 'petwalker@gmail.com';
    initial_hash text;
    final_hash text;
BEGIN
    -- 1. Pre-validation & Hash
    -- Using a row-to-text conversion that works for hashing
    SELECT md5(t::text) FROM (SELECT * FROM auth.users WHERE id = user_id_val) t INTO initial_hash;
    
    IF initial_hash IS NULL THEN
        RAISE NOTICE 'Target user not present; skipping remediation';
    ELSE

    -- 2. Update
    UPDATE auth.users
    SET email_change = ''
    WHERE id = user_id_val
      AND email = target_email
      AND email_change IS NULL;

    GET DIAGNOSTICS affected_rows = ROW_COUNT;

    IF affected_rows != 1 THEN
        RAISE EXCEPTION 'Expected 1 row to be affected, got %', affected_rows;
    END IF;
    
    -- 3. Validation
    RAISE NOTICE 'Remediation completed successfully. Rows affected: %', affected_rows;
    END IF;
END $$;