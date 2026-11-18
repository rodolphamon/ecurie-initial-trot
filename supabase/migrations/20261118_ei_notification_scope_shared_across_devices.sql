-- Préférence de périmètre commune à tous les appareils d'un associé.
-- Reprend le choix de l'appareil modifié le plus récemment.
begin;
alter table public.associes
 add column if not exists notification_scope text not null default 'mine'
 constraint ei_associes_notification_scope_check check (notification_scope in ('mine','all'));

with dernier_choix as (
 select distinct on (user_id) user_id,scope
 from public.ei_push_subscriptions
 where user_id is not null and audience='associate' and scope in ('mine','all')
 order by user_id,updated_at desc nulls last,created_at desc nulls last
)
update public.associes a
 set notification_scope=d.scope
 from dernier_choix d
 where a.user_id=d.user_id;

update public.ei_push_subscriptions s
 set scope=a.notification_scope
 from public.associes a
 where s.user_id=a.user_id and s.audience='associate'
 and s.scope is distinct from a.notification_scope;
commit;