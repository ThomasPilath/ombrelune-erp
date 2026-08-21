alter table public.inscriptions_permis
  add column if not exists client_id bigint references public.clients(id) on delete set null;

alter table public.client_permits
  add column if not exists passage_date date,
  add column if not exists attempts integer not null default 1 check (attempts >= 1),
  add column if not exists notes text not null default '';

create index if not exists inscriptions_permis_client_idx
  on public.inscriptions_permis (client_id);

create or replace function public.enregistrer_passage_permis_dossier(
  p_client_id bigint,
  p_type text,
  p_date_passage date,
  p_resultat text,
  p_tentatives integer,
  p_notes text,
  p_employe_id bigint
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  permit public.client_permits%rowtype;
  permit_id bigint;
  next_status text;
  before_state jsonb;
begin
  if p_type not in ('broomstick', 'motorcycle', 'car') then raise exception 'Type de permis invalide'; end if;
  if p_resultat not in ('success', 'failure') then raise exception 'Résultat invalide'; end if;
  if p_tentatives < 1 then raise exception 'Le nombre de tentatives doit être supérieur à zéro'; end if;
  if not exists (select 1 from public.clients where id = p_client_id and actif) then raise exception 'Client introuvable ou archivé'; end if;
  if not exists (select 1 from public.employes where id = p_employe_id and actif) then raise exception 'Employé introuvable ou inactif'; end if;

  next_status := case when p_resultat = 'success' then 'accepted' else 'pending' end;
  select * into permit from public.client_permits
    where client_id = p_client_id and type = p_type for update;

  if found then
    if permit.status = 'sold' then raise exception 'Un permis vendu ne peut pas être modifié'; end if;
    before_state := to_jsonb(permit);
    update public.client_permits set
      status = next_status,
      passage_date = p_date_passage,
      attempts = p_tentatives,
      notes = coalesce(trim(p_notes), '')
    where id = permit.id returning id into permit_id;
    perform public.journaliser_action_client(p_employe_id, 'update_status', 'client_permit', permit_id::text,
      'permit_' || p_type, p_client_id, before_state,
      jsonb_build_object('status', next_status, 'passage_date', p_date_passage, 'attempts', p_tentatives, 'notes', coalesce(trim(p_notes), '')));
  else
    insert into public.client_permits (client_id, type, status, passage_date, attempts, notes)
    values (p_client_id, p_type, next_status, p_date_passage, p_tentatives, coalesce(trim(p_notes), ''))
    returning id into permit_id;
    perform public.journaliser_action_client(p_employe_id, 'create', 'client_permit', permit_id::text,
      'permit_' || p_type, p_client_id, null,
      jsonb_build_object('status', next_status, 'passage_date', p_date_passage, 'attempts', p_tentatives, 'notes', coalesce(trim(p_notes), '')));
  end if;
  return permit_id;
end;
$$;

revoke all on function public.enregistrer_passage_permis_dossier(bigint, text, date, text, integer, text, bigint) from public;
grant execute on function public.enregistrer_passage_permis_dossier(bigint, text, date, text, integer, text, bigint) to anon, authenticated;
