UPDATE public.profiles SET role = 'petwalker', onboarding_completed = true WHERE email = 'vizepay@gmail.com';
INSERT INTO public.user_roles (user_id, role) 
SELECT id, 'petwalker' FROM public.profiles WHERE email = 'vizepay@gmail.com'
ON CONFLICT DO NOTHING;
