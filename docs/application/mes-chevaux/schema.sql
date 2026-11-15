-- Écurie Initial : schéma proposé, à installer manuellement dans Supabase.
-- La publication de ce fichier sur GitHub n'active pas ces tables.
create table if not exists public.participations_chevaux (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 cheval_slug text not null,
 cheval_nom text not null,
 pourcentage numeric(6,3) check(pourcentage > 0 and pourcentage <= 100),
 unique(user_id,cheval_slug)
);
create table if not exists public.actualites_chevaux_privees (
 id bigint generated always as identity primary key,
 cheval_slug text not null,
 titre text not null,
 contenu text not null,
 created_at timestamptz not null default now()
);
create index if not exists idx_participations_user on public.participations_chevaux(user_id);
create index if not exists idx_actualites_cheval on public.actualites_chevaux_privees(cheval_slug,created_at desc);
alter table public.participations_chevaux enable row level security;
alter table public.actualites_chevaux_privees enable row level security;
revoke all on public.participations_chevaux from anon;
revoke all on public.actualites_chevaux_privees from anon;
grant select on public.participations_chevaux to authenticated;
grant select on public.actualites_chevaux_privees to authenticated;
drop policy if exists "associe lit ses participations" on public.participations_chevaux;
create policy "associe lit ses participations" on public.participations_chevaux
for select to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.associes a where a.user_id=(select auth.uid()) and a.actif=true));
drop policy if exists "associe lit actualites de ses chevaux" on public.actualites_chevaux_privees;
create policy "associe lit actualites de ses chevaux" on public.actualites_chevaux_privees
for select to authenticated using(exists(select 1 from public.participations_chevaux p where p.cheval_slug=actualites_chevaux_privees.cheval_slug and p.user_id=(select auth.uid()) and exists(select 1 from public.associes a where a.user_id=(select auth.uid()) and a.actif=true)));
-- Aucune écriture autorisée par les comptes des associés.
-- Enregistrer les participations côté administration sécurisée, jamais dans les fichiers publics.
