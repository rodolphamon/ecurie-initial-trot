-- Écurie Initial : invitations dès maintenant, préouverture réservée à quatre testeurs.
-- À appliquer AVANT tout nouvel envoi d'invitations.
-- Ouverture automatique : 1er décembre 2026 à 00:00, heure de Paris.
-- Aucun compte, e-mail ou rattachement n'est supprimé.
-- À exécuter dans Supabase SQL Editor (rôle postgres).
BEGIN;

-- Les quatre identités de test sont figées par user_id et ne dépendent
-- plus du nom affiché après l'installation.
CREATE TABLE IF NOT EXISTS public.ei_lancement_pilotes (
 user_id uuid PRIMARY KEY REFERENCES public.associes(user_id) ON DELETE CASCADE
);
ALTER TABLE public.ei_lancement_pilotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ei_lancement_pilotes FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.ei_lancement_pilotes TO service_role;

-- Une seule personne administratrice et exactement trois testeurs identifiés.
-- Ne jamais ouvrir un cinquième compte par une ressemblance de prénom.
DO $$
DECLARE admins integer;
DECLARE matches integer;
BEGIN
 SELECT count(*) INTO admins FROM public.associes WHERE actif AND administrateur;
 IF admins <> 1 THEN
   RAISE EXCEPTION 'Préouverture suspendue : il faut exactement un compte administrateur actif (% trouvés).', admins;
 END IF;
 WITH names AS (
   SELECT
     regexp_replace(
       translate(lower(trim(nom_affiche)), 'àâäáéèêëîïíôöóùûüúçñ', 'aaaaeeeeiiiooouuuucn'),
       '[[:space:]]+', ' ', 'g'
     ) AS normalized
   FROM public.associes WHERE actif AND NOT administrateur
 )
 SELECT count(*) INTO matches
 FROM names WHERE normalized IN ('adrien delgery','nicolas barre','eric schott');
 IF matches <> 3 THEN
   RAISE EXCEPTION 'Préouverture suspendue : les trois comptes Adrien Delgery, Nicolas Barré et Éric Schott doivent être actifs et identifiés de façon unique (% trouvés).', matches;
 END IF;
END $$;

INSERT INTO public.ei_lancement_pilotes(user_id)
SELECT user_id
FROM public.associes
WHERE actif AND (
 administrateur OR
 regexp_replace(
   translate(lower(trim(nom_affiche)), 'àâäáéèêëîïíôöóùûüúçñ', 'aaaaeeeeiiiooouuuucn'),
   '[[:space:]]+', ' ', 'g'
 ) IN ('adrien delgery','nicolas barre','eric schott')
)
ON CONFLICT (user_id) DO NOTHING;

DO $$
BEGIN
 IF (SELECT count(*) FROM public.ei_lancement_pilotes) <> 4 THEN
   RAISE EXCEPTION 'Préouverture annulée : la liste de test doit contenir exactement quatre comptes.';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ei_lancement_ouvert()
RETURNS boolean LANGUAGE sql STABLE
SET search_path = '' AS $$
 SELECT (now() AT TIME ZONE 'Europe/Paris') >= timestamp '2026-12-01 00:00:00';
$$;

CREATE OR REPLACE FUNCTION public.ei_lancement_autorise()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.associes a
  WHERE a.user_id = (SELECT auth.uid()) AND a.actif
    AND (
      public.ei_lancement_ouvert()
      OR EXISTS (SELECT 1 FROM public.ei_lancement_pilotes p WHERE p.user_id = a.user_id)
    )
 );
$$;

CREATE OR REPLACE FUNCTION public.est_associe_actif()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT public.ei_lancement_autorise();
$$;

CREATE OR REPLACE FUNCTION public.est_administrateur()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT public.ei_lancement_autorise()
 AND EXISTS (
  SELECT 1 FROM public.associes a
  WHERE a.user_id = (SELECT auth.uid()) AND a.administrateur
 );
$$;

-- Réponse limitée au compte connecté, sans révélation des quatre identités.
CREATE OR REPLACE FUNCTION public.ei_etat_lancement()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT jsonb_build_object(
   'inscrit', EXISTS (SELECT 1 FROM public.associes a WHERE a.user_id = (SELECT auth.uid())),
   'actif', EXISTS (SELECT 1 FROM public.associes a WHERE a.user_id = (SELECT auth.uid()) AND a.actif),
   'testeur', EXISTS (SELECT 1 FROM public.ei_lancement_pilotes p WHERE p.user_id = (SELECT auth.uid())),
   'ouvert', public.ei_lancement_ouvert(),
   'autorise', public.ei_lancement_autorise(),
   'date_ouverture', '2026-12-01T00:00:00+01:00'
 );
$$;
REVOKE ALL ON FUNCTION public.ei_etat_lancement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ei_etat_lancement() TO authenticated;

-- Le service d'invitations refuse d'envoyer tant que cette migration
-- ne s'est pas déroulée intégralement.
CREATE OR REPLACE FUNCTION public.ei_lancement_pret()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT (SELECT count(*) FROM public.ei_lancement_pilotes) = 4;
$$;
REVOKE ALL ON FUNCTION public.ei_lancement_pret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ei_lancement_pret() TO service_role;

-- Les politiques qui vérifiaient seulement a.actif doivent aussi
-- respecter la date d'ouverture et la liste de test.
-- Les noms des politiques actuellement en production sont différents
-- de ceux prévus dans les schémas de référence. Supprimer impérativement
-- les politiques historiques : Postgres combine les politiques SELECT en OR.
DROP POLICY IF EXISTS "Mes participations" ON public.participations_chevaux;
DROP POLICY IF EXISTS "associe lit ses participations" ON public.participations_chevaux;
CREATE POLICY "associe lit ses participations"
ON public.participations_chevaux FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) AND public.est_associe_actif());

DROP POLICY IF EXISTS "Actualites de mes chevaux" ON public.actualites_chevaux_privees;
DROP POLICY IF EXISTS "associe lit actualites de ses chevaux" ON public.actualites_chevaux_privees;
CREATE POLICY "associe lit actualites de ses chevaux"
ON public.actualites_chevaux_privees FOR SELECT TO authenticated
USING (
  public.est_associe_actif() AND EXISTS (
    SELECT 1 FROM public.participations_chevaux p
    WHERE p.cheval_slug = actualites_chevaux_privees.cheval_slug
      AND p.user_id = (SELECT auth.uid())
  )
);

-- Vérifier que la politique historique permissive ne subsiste pas.
DO $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname='public'
    AND (
      (tablename='participations_chevaux' AND cmd='SELECT' AND policyname<>'associe lit ses participations')
      OR
      (tablename='actualites_chevaux_privees' AND cmd='SELECT' AND policyname NOT IN ('associe lit actualites de ses chevaux','admin voit toutes les actualites privees'))
    )
 ) THEN
   RAISE EXCEPTION 'Préouverture annulée : une politique de lecture privée inattendue reste active.';
 END IF;
END $$;

COMMIT;

-- Contrôle final : doit retourner 4, sans exposer les identités.
SELECT count(*) AS nb_testeurs_autorises FROM public.ei_lancement_pilotes;
