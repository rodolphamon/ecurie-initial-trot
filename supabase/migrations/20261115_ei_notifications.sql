-- Écurie Initial — notifications Push (préparation ; à appliquer dans Supabase SQL Editor).
-- Tables privées : ne pas exposer les jetons Push, les clefs ou les préférences.
create table if not exists public.ei_push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 endpoint text not null unique,
 p256dh text not null,
 auth_secret text not null,
 token_hash text not null,
 user_id uuid references auth.users(id) on delete set null,
 audience text not null check(audience in ('visitor','associate')),
 scope text not null default 'all' check(scope in ('mine','all')),
 confirmed boolean not null default false,
 daily boolean not null default true,
 before15 boolean not null default false,
 results boolean not null default true,
 withdrawn boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 last_error text
);
create index if not exists ei_push_subscriptions_user on public.ei_push_subscriptions(user_id);

create table if not exists public.ei_push_races (
 event_key text primary key,
 cheval_slug text not null,
 cheval_nom text not null,
 date_course date not null,
 hippodrome text not null,
 course text,
 statut text not null,
 depart timestamptz,
 updated_at timestamptz not null default now()
);
create index if not exists ei_push_races_date on public.ei_push_races(date_course);

create table if not exists public.ei_push_alerts (
 id text primary key,
 categorie text not null check(categorie in ('confirmed','daily','before15','results','withdrawn')),
 cheval_slug text,
 payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null
);
create index if not exists ei_push_alerts_expiry on public.ei_push_alerts(expires_at);

create table if not exists public.ei_push_deliveries (
 alert_id text not null references public.ei_push_alerts(id) on delete cascade,
 subscription_id uuid not null references public.ei_push_subscriptions(id) on delete cascade,
 state text not null default 'sending' check(state in ('sending','sent','failed','gone')),
 attempts integer not null default 1,
 updated_at timestamptz not null default now(),
 primary key(alert_id,subscription_id)
);

alter table public.ei_push_subscriptions enable row level security;
alter table public.ei_push_races enable row level security;
alter table public.ei_push_alerts enable row level security;
alter table public.ei_push_deliveries enable row level security;
revoke all on public.ei_push_subscriptions from anon, authenticated;
revoke all on public.ei_push_races from anon, authenticated;
revoke all on public.ei_push_alerts from anon, authenticated;
revoke all on public.ei_push_deliveries from anon, authenticated;
-- Seule l'Edge Function utilisant service_role lit/écrit ces tables.
-- Les RLS existantes des participations et actualités ne sont pas modifiées.
