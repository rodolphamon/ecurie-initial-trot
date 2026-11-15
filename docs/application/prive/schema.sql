-- Écurie Initial : modèle de données privé pour Supabase (projet à créer)
-- À exécuter uniquement après configuration de l'authentification et revue des règles.
create table if not exists public.associes (
 user_id uuid primary key references auth.users(id) on delete cascade,
 nom_affiche text not null,
 actif boolean not null default false,
 administrateur boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists public.publications (
 id uuid primary key default gen_random_uuid(),
 auteur_id uuid not null references public.associes(user_id),
 contenu text not null check (char_length(contenu) between 1 and 5000),
 created_at timestamptz not null default now()
);
create table if not exists public.commentaires (
 id uuid primary key default gen_random_uuid(),
 publication_id uuid not null references public.publications(id) on delete cascade,
 auteur_id uuid not null references public.associes(user_id),
 contenu text not null check (char_length(contenu) between 1 and 1500),
 created_at timestamptz not null default now()
);
create or replace function public.est_associe_actif()
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.associes a where a.user_id = (select auth.uid()) and a.actif);
$$;
create or replace function public.est_administrateur()
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.associes a where a.user_id = (select auth.uid()) and a.actif and a.administrateur);
$$;
alter table public.associes enable row level security;
alter table public.publications enable row level security;
alter table public.commentaires enable row level security;
create policy "associes visibles par associes" on public.associes for select to authenticated using (public.est_associe_actif());
create policy "publications visibles par associes" on public.publications for select to authenticated using (public.est_associe_actif());
create policy "publication par auteur actif" on public.publications for insert to authenticated with check (public.est_associe_actif() and auteur_id = (select auth.uid()));
create policy "suppression publication auteur ou admin" on public.publications for delete to authenticated using (public.est_associe_actif() and (auteur_id = (select auth.uid()) or public.est_administrateur()));
create policy "commentaires visibles par associes" on public.commentaires for select to authenticated using (public.est_associe_actif());
create policy "commentaire par auteur actif" on public.commentaires for insert to authenticated with check (public.est_associe_actif() and auteur_id = (select auth.uid()));
create policy "suppression commentaire auteur ou admin" on public.commentaires for delete to authenticated using (public.est_associe_actif() and (auteur_id = (select auth.uid()) or public.est_administrateur()));
-- Aucun droit client INSERT/UPDATE/DELETE sur associes.
-- Invitations, activation, suspension et changement de rôle : uniquement via un serveur sécurisé avec clé service_role.
-- Les pièces jointes et documents financiers nécessitent des buckets PRIVÉS et des politiques distinctes.
