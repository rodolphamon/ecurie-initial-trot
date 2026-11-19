-- Écurie Initial — correction de l'échec des annonces publiques du 19/11/2026.
-- La catégorie public_news est émise par ei_notify_public_news(), mais elle
-- manquait dans la contrainte ei_push_alerts_categorie_check.
-- Appliquée sur le projet Supabase de production via la migration
-- allow_public_news_push_category_20261119.
begin;
alter table public.ei_push_alerts
  drop constraint if exists ei_push_alerts_categorie_check;
alter table public.ei_push_alerts
  add constraint ei_push_alerts_categorie_check
  check (categorie in (
    'confirmed', 'daily', 'before15', 'results', 'withdrawn',
    'private_news', 'preflight_warning', 'general_news', 'public_news'
  ));
commit;
