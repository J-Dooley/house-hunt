-- Local stand-ins for the Supabase pieces the migrations reference. Test use only; never run on the real project.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema vault; create schema cron; create schema net;
create table vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, secret text);
create view vault.decrypted_secrets as select id,name,secret as decrypted_secret from vault.secrets;
create function vault.create_secret(s text,n text,d text default '') returns uuid language sql as $$ insert into vault.secrets(name,secret) values(n,s) returning id $$;
create function cron.schedule(n text,s text,c text) returns bigint language sql as $$ select 1::bigint $$;
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
create schema if not exists public;
create table public.househunt_inventory(property_id text primary key, details jsonb not null default '{}', last_edited timestamptz default now());
create table public.property_preferences(id bigint generated always as identity primary key, user_id uuid, property_id text, favorite boolean, hidden boolean);
create function public.rls_auto_enable() returns void language sql as $$ select 1 $$;
grant usage on schema public to anon,authenticated,service_role;
