-- Écurie Initial — photos de la Tribune des supporters (21 novembre 2026).
-- Photos privées : seuls les membres autorisés à lire la Tribune peuvent les consulter.
-- Un auteur peut publier une photo seule ou avec texte, sans modification des droits existants.
begin;

alter table public.publications
  add column if not exists photo_path text;

alter table public.publications
  drop constraint if exists publications_contenu_check;

alter table public.publications
  add constraint publications_contenu_check
  check (
    char_length(contenu) <= 5000
    and (char_length(btrim(contenu)) >= 1 or photo_path is not null)
  );

alter table public.publications
  add constraint publications_photo_path_check
  check (
    photo_path is null or (
      photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
      and split_part(photo_path, '/', 1) = auteur_id::text
    )
  );

insert into storage.buckets
  (id, name, public, file_size_limit, allowed_mime_types)
values
  ('ei-tribune-photos', 'ei-tribune-photos', false, 4194304, array['image/jpeg']::text[])
on conflict (id) do nothing;

create policy "tribune photos lecture membres"
on storage.objects
for select to authenticated
using (
  bucket_id = 'ei-tribune-photos'
  and (
    public.est_membre_tribune()
    or (public.ei_est_observateur() and public.ei_lancement_autorise())
  )
);

create policy "tribune photos ajout auteur"
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'ei-tribune-photos'
  and public.est_membre_tribune()
  and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f-]{36}\.jpg$')
);

-- Suppression uniquement de ses propres fichiers (retour arrière si la publication échoue).
create policy "tribune photos suppression auteur"
on storage.objects
for delete to authenticated
using (
  bucket_id = 'ei-tribune-photos'
  and public.est_membre_tribune()
  and owner_id = (select auth.uid())::text
);

commit;