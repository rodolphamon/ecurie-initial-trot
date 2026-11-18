-- Membres extérieurs : Tribune commune, fiches et messages privés réservés aux associés.
-- Comptes existants inchangés (type_compte='associe').
begin;
alter table public.associes
  add column if not exists type_compte text not null default 'associe';
do $$
begin
  if not exists (select 1 from pg_constraint where conname='ei_associes_type_compte_chk') then
    alter table public.associes add constraint ei_associes_type_compte_chk
      check (type_compte in ('associe','exterieur') and (type_compte <> 'exterieur' or not administrateur));
  end if;
end $$;

-- Les protections préexistantes sur les participations, actualités privées et
-- messages généraux continuent d'appeler est_associe_actif().
create or replace function public.est_associe_actif()
returns boolean language sql stable security definer set search_path = ''
as $fn$
  select public.ei_lancement_autorise() and exists (
    select 1 from public.associes a
    where a.user_id=(select auth.uid()) and a.actif and a.type_compte='associe'
  );
$fn$;

create or replace function public.est_membre_tribune()
returns boolean language sql stable security definer set search_path = ''
as $fn$
  select public.ei_lancement_autorise() and exists (
    select 1 from public.associes a
    where a.user_id=(select auth.uid()) and a.actif
      and a.type_compte in ('associe','exterieur')
  );
$fn$;
revoke all on function public.est_membre_tribune() from public, anon;
grant execute on function public.est_membre_tribune() to authenticated;

-- Un extérieur peut lire uniquement sa propre identité. Les associés
-- conservent leurs droits antérieurs de consultation du répertoire.
drop policy if exists "associes visibles par associes" on public.associes;
create policy "associes visibles par associes" on public.associes
for select to authenticated using (
  public.est_associe_actif()
  or (user_id=(select auth.uid()) and public.est_membre_tribune())
);

-- Tribune : lecture et publication réservées à un compte activé, quel que
-- soit son rattachement à un cheval.
drop policy if exists "publications visibles par associes" on public.publications;
create policy "publications visibles par membres" on public.publications
for select to authenticated using (public.est_membre_tribune());
drop policy if exists "publication par auteur actif" on public.publications;
create policy "publication par membre actif" on public.publications
for insert to authenticated with check (
  public.est_membre_tribune() and auteur_id=(select auth.uid())
);
drop policy if exists "suppression publication auteur ou admin" on public.publications;
create policy "suppression publication auteur ou admin" on public.publications
for delete to authenticated using (
  public.est_membre_tribune()
  and (auteur_id=(select auth.uid()) or public.est_administrateur())
);

drop policy if exists "commentaires visibles par associes" on public.commentaires;
create policy "commentaires visibles par membres" on public.commentaires
for select to authenticated using (public.est_membre_tribune());
drop policy if exists "commentaire par auteur actif" on public.commentaires;
create policy "commentaire par membre actif" on public.commentaires
for insert to authenticated with check (
  public.est_membre_tribune() and auteur_id=(select auth.uid())
);
drop policy if exists "suppression commentaire auteur ou admin" on public.commentaires;
create policy "suppression commentaire auteur ou admin" on public.commentaires
for delete to authenticated using (
  public.est_membre_tribune()
  and (auteur_id=(select auth.uid()) or public.est_administrateur())
);

-- Un extérieur ne doit jamais voir l'ensemble des comptes via la table
-- associes. Ce RPC ne révèle que les noms nécessaires à l'affichage des auteurs.
create or replace function public.ei_tribune_membres()
returns table(user_id uuid, nom_affiche text)
language plpgsql stable security definer set search_path = ''
as $fn$
begin
  if not public.est_membre_tribune() then return; end if;
  return query select a.user_id,a.nom_affiche from public.associes a;
end;
$fn$;
revoke all on function public.ei_tribune_membres() from public,anon;
grant execute on function public.ei_tribune_membres() to authenticated;
commit;
