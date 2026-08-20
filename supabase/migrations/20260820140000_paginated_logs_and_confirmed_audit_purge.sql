create or replace function public.lister_journal_actions(
  p_page integer default 1,
  p_page_size integer default 25,
  p_recherche text default '',
  p_employe text default '',
  p_type text default '',
  p_action text default '',
  p_depuis date default null,
  p_jusqu_a date default null
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with filtered as (
    select action.*, client.nom_prenom as client_nom
    from public.journal_actions action
    left join public.clients client on client.id = action.client_id
    where (nullif(trim(p_recherche), '') is null or concat_ws(
      ' ', action.libelle, action.element, action.entite_id, client.nom_prenom
    ) ilike '%' || trim(p_recherche) || '%')
      and (nullif(p_employe, '') is null or action.employe_nom = p_employe)
      and (nullif(p_type, '') is null or action.entite_type = p_type)
      and (nullif(p_action, '') is null or action.action = p_action)
      and (p_depuis is null or action.created_at >= p_depuis::timestamptz)
      and (p_jusqu_a is null or action.created_at < (p_jusqu_a + 1)::timestamptz)
  ),
  page as (
    select filtered.*
    from filtered
    order by created_at desc, id desc
    limit least(greatest(p_page_size, 1), 100)
    offset (greatest(p_page, 1) - 1) * least(greatest(p_page_size, 1), 100)
  )
  select jsonb_build_object(
    'entries', coalesce((
      select jsonb_agg(
        (to_jsonb(page) - 'client_nom') || jsonb_build_object(
          'clients', case when page.client_nom is null then null else jsonb_build_object('nom_prenom', page.client_nom) end
        ) order by page.created_at desc, page.id desc
      )
      from page
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'employees', coalesce((select jsonb_agg(value order by value) from (select distinct employe_nom value from public.journal_actions where employe_nom is not null) distinct_values), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(value order by value) from (select distinct action value from public.journal_actions where action is not null) distinct_values), '[]'::jsonb),
    'entity_types', coalesce((select jsonb_agg(value order by value) from (select distinct entite_type value from public.journal_actions where entite_type is not null) distinct_values), '[]'::jsonb)
  );
$$;

revoke all on function public.lister_journal_actions(integer, integer, text, text, text, text, date, date) from public;
grant execute on function public.lister_journal_actions(integer, integer, text, text, text, text, date, date) to anon, authenticated;

create or replace function public.cloturer_periode_avec_audit(
  p_employe_id bigint,
  p_date_fin date default current_date,
  p_remunerations jsonb default '[]'::jsonb,
  p_purger_audit boolean default false,
  p_sauvegarde_confirmee boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limite timestamptz := statement_timestamp();
  v_periode_id bigint;
  v_lignes_supprimees bigint := 0;
begin
  if not exists (
    select 1 from public.employes
    where id = p_employe_id and actif and grade in ('Patron', 'Co-Patron')
  ) then
    raise exception 'Seule la Direction peut clôturer une période';
  end if;

  if p_purger_audit and not p_sauvegarde_confirmee then
    raise exception 'Confirmez la sauvegarde avant de purger le journal technique';
  end if;

  if p_purger_audit then
    delete from public.audit_row_changes where created_at < v_limite;
    get diagnostics v_lignes_supprimees = row_count;
  end if;

  v_periode_id := public.cloturer_periode(p_date_fin, p_remunerations);

  if p_purger_audit then
    perform public.ecrire_journal_action(
      p_employe_id,
      'purge_audit',
      'periode_comptable',
      v_periode_id::text,
      'Purge du journal technique après sauvegarde confirmée',
      null,
      jsonb_build_object('lignes_supprimees', v_lignes_supprimees),
      jsonb_build_object('sauvegarde_confirmee', true)
    );
  end if;

  return jsonb_build_object(
    'periode_id', v_periode_id,
    'audit_rows_deleted', v_lignes_supprimees
  );
end;
$$;

revoke all on function public.cloturer_periode_avec_audit(bigint, date, jsonb, boolean, boolean) from public;
grant execute on function public.cloturer_periode_avec_audit(bigint, date, jsonb, boolean, boolean) to anon, authenticated;
