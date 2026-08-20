-- Journal technique append-only des modifications de données.
-- Il complète journal_actions et capture aussi les appels directs à la Data API.

create table public.audit_row_changes (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  transaction_id bigint not null default txid_current(),
  table_name text not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  record_id text,
  old_data jsonb,
  new_data jsonb,
  actor_role text,
  actor_id uuid,
  request_ip text,
  user_agent text
);

create index audit_row_changes_date_idx
  on public.audit_row_changes (created_at desc);

create index audit_row_changes_record_idx
  on public.audit_row_changes (table_name, record_id, created_at desc);

create index audit_row_changes_transaction_idx
  on public.audit_row_changes (transaction_id);

alter table public.audit_row_changes enable row level security;

create policy "Lecture du journal technique ERP"
on public.audit_row_changes
for select
to anon, authenticated
using (true);

revoke all on table public.audit_row_changes from public, anon, authenticated;
grant select on table public.audit_row_changes to anon, authenticated;

create or replace function public.auditer_modification_ligne()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_headers jsonb := coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb,
    '{}'::jsonb
  );
begin
  if tg_op <> 'INSERT' then
    v_old := to_jsonb(old);
  end if;

  if tg_op <> 'DELETE' then
    v_new := to_jsonb(new);
  end if;

  insert into public.audit_row_changes (
    table_name,
    operation,
    record_id,
    old_data,
    new_data,
    actor_role,
    actor_id,
    request_ip,
    user_agent
  ) values (
    tg_table_name,
    tg_op,
    coalesce(v_new ->> 'id', v_old ->> 'id'),
    v_old,
    v_new,
    coalesce(auth.role(), current_user),
    auth.uid(),
    split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1),
    v_headers ->> 'user-agent'
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.auditer_modification_ligne() from public, anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'employes',
    'catalogue',
    'clients',
    'stocks',
    'recettes_craft',
    'transactions',
    'commandes',
    'lignes_commandes',
    'registre_tickets',
    'registre_tresorerie',
    'periodes_comptables',
    'archives_rh',
    'inscriptions_permis',
    'permis',
    'fabrications',
    'fabrications_ingredients',
    'commandes_journal',
    'client_permits'
  ]
  loop
    execute format(
      'create trigger audit_row_change after insert or update or delete on public.%I for each row execute function public.auditer_modification_ligne()',
      v_table
    );
  end loop;
end;
$$;

comment on table public.audit_row_changes is
  'Journal technique append-only des changements de lignes, destiné au diagnostic et à la récupération manuelle.';
