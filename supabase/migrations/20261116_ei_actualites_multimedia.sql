-- Écurie Initial - actualités privées avec photos / vidéos et notification ciblée.
-- À exécuter dans Supabase SQL Editor APRÈS:
--   docs/application/prive/schema.sql
--   docs/application/mes-chevaux/schema.sql
--   supabase/migrations/20261115_ei_notifications.sql
-- Ceci ne crée aucun fichier public. Les médias sont dans un bucket privé.

alter table public.actualites_chevaux_privees
  add column if not exists media_path text,
  add column if not exists media_type text,
  add column if not exists notifier_associes boolean not null default false;

alter table public.actualites_chevaux_privees
  drop constraint if exists actualites_chevaux_privees_media_check;
alter table public.actualites_chevaux_privees
  add constraint actualites_chevaux_privees_media_check
  check (
    (media_path is null and media_type is null)
    or (
      media_path is not null and media_type in ('image','video')
      and media_path like cheval_slug || '/%'
    )
  );

-- Le groupe ne doit pas voir les publications privées d'un autre cheval.
-- L'ancienne politique SELECT "associe lit actualites de ses chevaux" reste intacte.
drop policy if exists "admin voit toutes les actualites privees" on public.actualites_chevaux_privees;
create policy "admin voit toutes les actualites privees"
on public.actualites_chevaux_privees for select to authenticated
using (public.est_administrateur());

drop policy if exists "admin publie actualite cheval" on public.actualites_chevaux_privees;
create policy "admin publie actualite cheval"
on public.actualites_chevaux_privees for insert to authenticated
with check (
  public.est_administrateur()
  and cheval_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  and char_length(titre) between 1 and 160
  and char_length(contenu) <= 6000
);

-- Pas d'UPDATE/DELETE client : on préserve l'historique des publications.
grant select, insert on public.actualites_chevaux_privees to authenticated;
-- L'insertion utilise l'identité bigint ; autoriser l'accès à la séquence associée.
grant usage, select on sequence public.actualites_chevaux_privees_id_seq to authenticated;

-- Stockage privé (pas de lien public persistant).
insert into storage.buckets (
 id, name, public, file_size_limit, allowed_mime_types
) values (
 'ei-chevaux-prives', 'ei-chevaux-prives', false, 47185920,
 array['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']
)
on conflict (id) do update set
 public = false,
 file_size_limit = excluded.file_size_limit,
 allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "ei media upload admin" on storage.objects;
create policy "ei media upload admin" on storage.objects for insert to authenticated
with check (
 bucket_id = 'ei-chevaux-prives'
 and public.est_administrateur()
 and name ~ '^[a-z0-9]+(-[a-z0-9]+)*/[0-9a-f-]{36}\.(jpg|png|webp|mp4|webm|mov)$'
);

drop policy if exists "ei media lecture proprietaires" on storage.objects;
create policy "ei media lecture proprietaires" on storage.objects for select to authenticated
using (
 bucket_id = 'ei-chevaux-prives'
 and (
   public.est_administrateur()
   or (
     public.est_associe_actif()
     and exists (
       select 1 from public.participations_chevaux p
       where p.user_id = (select auth.uid())
         and p.cheval_slug = split_part(storage.objects.name,'/',1)
     )
   )
 )
);

-- La nouvelle catégorie n'est NI publique NI soumise à "Tous les chevaux".
-- Seuls les associés ayant une participation au cheval peuvent la recevoir.
alter table public.ei_push_alerts
 drop constraint if exists ei_push_alerts_categorie_check;
alter table public.ei_push_alerts
 add constraint ei_push_alerts_categorie_check
 check (categorie in ('confirmed','daily','before15','results','withdrawn','private_news'));

-- Désactivée par défaut pour les appareils déjà abonnés : les associés
-- l'activent volontairement dans leurs réglages.
alter table public.ei_push_subscriptions
 add column if not exists private_news boolean not null default false;

-- L'option "Envoyer une notification" crée une alerte privée au moment
-- de la publication. Le service d'envoi doit être déployé séparément.
create or replace function public.ei_notify_private_news()
returns trigger language plpgsql security definer
set search_path = '' as $$
declare horse_name text;
begin
 if not new.notifier_associes then return new; end if;
 select p.cheval_nom into horse_name
 from public.participations_chevaux p
 where p.cheval_slug = new.cheval_slug
 order by p.cheval_nom limit 1;
 insert into public.ei_push_alerts (id,categorie,cheval_slug,payload,expires_at)
 values (
   'private_news:'||new.id::text,
   'private_news',
   new.cheval_slug,
   jsonb_build_object(
      'nom',coalesce(horse_name,upper(replace(new.cheval_slug,'-',' '))),
      'id',new.id
   ),
   now() + interval '48 hours'
 )
 on conflict (id) do nothing;
 return new;
end;
$$;
revoke all on function public.ei_notify_private_news() from public, anon, authenticated;
drop trigger if exists ei_notify_private_news_after_insert on public.actualites_chevaux_privees;
create trigger ei_notify_private_news_after_insert
after insert on public.actualites_chevaux_privees
for each row execute function public.ei_notify_private_news();

-- Les données de publication demeurent soumises aux RLS de l'application.
