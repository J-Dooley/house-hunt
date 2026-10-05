-- Stage 4 foundation. Remains disabled until ingestion and real-email tests succeed.
alter table public.househunt_sources drop constraint if exists househunt_sources_adapter_check;
alter table public.househunt_sources add constraint househunt_sources_adapter_check
  check (adapter in ('reso','rentcast','alerts'));

create table if not exists public.househunt_alert_messages (
  message_id text primary key,
  source_id text not null references public.househunt_sources(id),
  received_at timestamptz not null,
  site text,
  listings integer not null default 0,
  quarantine text,
  created_at timestamptz not null default now()
);
alter table public.househunt_alert_messages enable row level security;
revoke all on public.househunt_alert_messages from public, anon, authenticated;
grant all on public.househunt_alert_messages to service_role;

insert into public.househunt_sources
 (id,name,adapter,enabled,required,authorization_confirmed,public_display_authorized,credential_env,config,notes)
values
 ('portal-alerts','Saved-search alert emails','alerts',false,false,false,false,
  'HOUSEHUNT_INBOUND_SECRET','{}',
  'Push source. Disabled until verified email parsing, relay and public-display approval.')
on conflict (id) do nothing;
