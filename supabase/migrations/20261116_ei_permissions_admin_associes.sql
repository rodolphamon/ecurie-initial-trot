-- Écurie Initial — correction des droits 42501 dans gerer-associes
-- À exécuter une fois dans Supabase > SQL Editor, avec le rôle postgres.
-- Ne crée/supprime aucun associé, cheval ou rattachement.
-- Autorise seulement l'API serveur service_role; aucun nouveau droit pour anon.
-- Les associés ordinaires restent limités aux lignes prévues par leurs règles RLS.

begin;

-- L'Edge Function utilise SUPABASE_SERVICE_ROLE_KEY.
grant usage on schema public to service_role;

-- Consultation, création et retrait des participations depuis l'administration.
grant select, insert, delete on table public.participations_chevaux to service_role;

-- Vérification du statut, invitation et suspension depuis l'administration.
grant select, insert, update on table public.associes to service_role;

-- L'id automatique de participations_chevaux peut nécessiter cette autorisation.
grant usage, select on sequence public.participations_chevaux_id_seq to service_role;

-- Préserver la protection ligne par ligne des comptes non administrateurs.
alter table public.participations_chevaux enable row level security;
alter table public.associes enable row level security;

commit;

-- Vérification sans divulguer de noms, d'emails ou de participations :
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('participations_chevaux', 'associes')
  and grantee = 'service_role'
order by table_name, privilege_type;
