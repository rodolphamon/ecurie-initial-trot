-- Team Initial : permissions du service applicatif pour l'administration des droits.
-- Corrige l'erreur « Impossible de consulter les droits de ce membre ».
-- Les accès restent limités à service_role, sans grant pour anon/authenticated.
-- Les contrôles JWT + administrateur + liste fixe des 3 membres restent dans
-- supabase/functions/gerer-associes/index.ts.
BEGIN;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ei_contributeurs TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.ei_droits_photos_chevaux TO service_role;
COMMIT;
