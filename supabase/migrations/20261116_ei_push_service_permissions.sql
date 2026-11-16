-- Écurie Initial : droits du moteur Push.
-- À exécuter uniquement APRÈS 20261115_ei_notifications.sql
-- et 20261116_ei_actualites_multimedia.sql.
-- Les données et les jetons Push restent interdits aux rôles anon/authenticated.
begin;
grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.ei_push_subscriptions,
  public.ei_push_races,
  public.ei_push_alerts,
  public.ei_push_deliveries
to service_role;
alter table public.ei_push_subscriptions enable row level security;
alter table public.ei_push_races enable row level security;
alter table public.ei_push_alerts enable row level security;
alter table public.ei_push_deliveries enable row level security;
revoke all on table
  public.ei_push_subscriptions,
  public.ei_push_races,
  public.ei_push_alerts,
  public.ei_push_deliveries
from anon, authenticated;
commit;
