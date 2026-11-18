-- Préférence distincte pour les annonces générales de l'Écurie Initial.
-- Les appareils inscrits reçoivent ces annonces par défaut et peuvent désactiver cette catégorie.
begin;
alter table public.ei_push_subscriptions
 add column if not exists general_news boolean not null default true;
update public.ei_push_subscriptions
 set general_news=true
 where audience='associate';
commit;
