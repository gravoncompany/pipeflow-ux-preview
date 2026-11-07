
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  company text not null default '',
  whatsapp text not null default '',
  email text not null default '',
  source text not null default '',
  service text not null default '',
  potential_value numeric not null default 0,
  owner text not null default '',
  entry_date date not null default current_date,
  next_action text not null default '',
  next_action_date date,
  status text not null default '',
  stage text not null default 'lead-novo',
  tags jsonb not null default '[]'::jsonb,
  notes text not null default '',
  last_conversation text not null default '',
  next_steps text not null default '',
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leads enable row level security;

create policy "leads_public_select" on public.leads for select using (true);
create policy "leads_public_insert" on public.leads for insert with check (true);
create policy "leads_public_update" on public.leads for update using (true) with check (true);
create policy "leads_public_delete" on public.leads for delete using (true);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger leads_set_updated_at before update on public.leads
for each row execute function public.set_updated_at();

create table public.crm_settings (
  id int primary key default 1,
  zapier_webhook_url text,
  updated_at timestamptz not null default now(),
  constraint crm_settings_singleton check (id = 1)
);

alter table public.crm_settings enable row level security;

create policy "crm_settings_public_select" on public.crm_settings for select using (true);
create policy "crm_settings_public_insert" on public.crm_settings for insert with check (true);
create policy "crm_settings_public_update" on public.crm_settings for update using (true) with check (true);

insert into public.crm_settings (id) values (1) on conflict do nothing;
