-- Écurie Initial : ouverture anticipée aux comptes Presse (23 novembre 2026).
-- Copie versionnée de la correction appliquée en production le 23/11/2026.
-- Script idempotent de restauration : ne crée aucun compte et ne modifie aucune politique RLS.
-- Les comptes presse restent exclus des droits "associe" et "observateur" pour les données privées.
-- L'ouverture générale reste fixée au 1er décembre 2026.
CREATE OR REPLACE FUNCTION public.ei_lancement_autorise()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.associes a
    WHERE a.user_id = (SELECT auth.uid())
      AND a.actif
      AND (
        public.ei_lancement_ouvert()
        OR a.type_compte IN ('observateur', 'presse')
        OR EXISTS (
          SELECT 1 FROM public.ei_lancement_pilotes p
          WHERE p.user_id = a.user_id
        )
        OR EXISTS (
          SELECT 1 FROM public.ei_contributeurs c
          WHERE c.user_id = a.user_id
            AND c.actif
            AND c.acces_avant_ouverture
        )
      )
  );
$function$;
