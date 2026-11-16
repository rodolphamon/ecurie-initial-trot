-- ÉCURIE INITIAL — lancement automatique des alertes Push.
-- Exécution : une fois dans Supabase > SQL Editor, APRÈS l'installation SQL
-- et le déploiement des Edge Functions "notifications" et "push-dispatch".
--
-- AVANT DE LANCER :
--  1. Dans Supabase > Database > Vault, créer un secret :
--     Nom : ei_initial_push_job_secret
--     Valeur : la MEME valeur que PUSH_JOB_SECRET dans Edge Functions > Secrets.
--  2. Ne jamais mettre ici, dans GitHub ou dans ChatGPT la valeur du secret.
--  3. Vérifier que les extensions pg_cron, pg_net et Supabase Vault sont disponibles.
--
-- Ce script ne touche à aucune donnée d'associé, aucun cheval, aucun abonnement.
-- Il programme seulement un appel serveur sécurisé chaque minute.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

do $verify_vault$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'ei_initial_push_job_secret'
      and nullif(decrypted_secret, '') is not null
  ) then
    raise exception 'Secret Vault ei_initial_push_job_secret absent : ajouter d''abord la même valeur que PUSH_JOB_SECRET dans Database > Vault.';
  end if;
end
$verify_vault$;

-- La requête ne contient aucune clé secrète en clair.
-- La clé est lue à chaque appel depuis Supabase Vault.
select cron.schedule(
  'ei_initial_push_dispatch',
  '* * * * *',
  $push_job$
    select net.http_post(
      url := 'https://yeecwaaizmvrhwobukfa.supabase.co/functions/v1/push-dispatch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'ei_initial_push_job_secret'
          limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 15000
    ) as request_id;
  $push_job$
);

-- Confirmation : doit montrer une ligne avec jobname ei_initial_push_dispatch.
select jobid, jobname, schedule, active
from cron.job
where jobname = 'ei_initial_push_dispatch';
