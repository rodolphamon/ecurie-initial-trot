-- Métadonnées privées de l'inscription effectivement utilisée par le navigateur.
-- Les choix de notification, les jetons et les règles d'accès restent inchangés.
set lock_timeout = '3s';
alter table public.ei_push_subscriptions
  add column if not exists last_seen_at timestamptz,
  add column if not exists client_info jsonb not null default '{}'::jsonb;
