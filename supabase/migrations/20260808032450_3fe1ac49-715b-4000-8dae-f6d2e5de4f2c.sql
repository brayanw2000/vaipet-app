
GRANT UPDATE (onboarding_completed) ON public.profiles TO authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'profiles' 
        AND schemaname = 'public' 
        AND policyname = 'Users can update own profile'
    ) THEN
        CREATE POLICY "Users can update own profile" ON public.profiles
            FOR UPDATE
            TO authenticated
            USING (auth.uid() = id)
            WITH CHECK (auth.uid() = id);
    END IF;
END
$$;
