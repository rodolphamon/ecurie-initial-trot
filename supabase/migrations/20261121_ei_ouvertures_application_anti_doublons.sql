-- Écurie Initial — journal fiable des ouvertures de l'application (21/11/2026)
-- Préserver toutes les lignes historiques : le dédoublonnage de l'affichage
-- se fait dans gerer-associes et n'efface aucun événement brut.
-- Une ouverture acceptée par compte et par période glissante de cinq minutes.
-- Verrou PostgreSQL transactionnel : protection des onglets et appareils concurrents.
-- Horodatage fixé par le serveur, indépendamment de l'horloge du téléphone.

begin;

create schema if not exists ei_internal;
revoke all on schema ei_internal from public, anon, authenticated;

create or replace function ei_internal.filtrer_ouverture_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  maintenant timestamptz;
begin
  maintenant := pg_catalog.clock_timestamp();
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 20261121)
  );

  -- Une nouvelle visite n'est acceptée qu'après cinq minutes réelles.
  -- Les écritures simultanées attendent le même verrou et sont donc dédoublonnées.
  if exists (
    select 1
    from public.ei_ouvertures_application as precedent
    where precedent.user_id = new.user_id
      and precedent.ouvert_le > maintenant - interval '5 minutes'
  ) then
    return null;
  end if;

  new.ouvert_le := maintenant;
  return new;
end;
$$;

revoke all on function ei_internal.filtrer_ouverture_application()
  from public, anon, authenticated;

drop trigger if exists ei_filtrer_ouvertures_rapprochees
  on public.ei_ouvertures_application;

create trigger ei_filtrer_ouvertures_rapprochees
before insert on public.ei_ouvertures_application
for each row execute function ei_internal.filtrer_ouverture_application();

commit;