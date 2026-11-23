-- Parcours exceptionnel d'activation presse sans lien Supabase consommé par un robot.
-- Les jetons sont à usage unique, hachés et stockés uniquement côté serveur.
CREATE TABLE IF NOT EXISTS public.ei_press_password_setup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_sha256 text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
ALTER TABLE public.ei_press_password_setup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ei_press_password_setup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ei_press_password_setup TO service_role;
CREATE INDEX IF NOT EXISTS ei_press_password_setup_expiry_idx
ON public.ei_press_password_setup(expires_at)
WHERE consumed_at IS NULL;
-- Aucune policy RLS ouverte : seul le code serveur avec service_role y accède.
