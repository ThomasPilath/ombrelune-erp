alter table public.commandes drop constraint if exists commandes_statut_livraison_check;
alter table public.commandes drop constraint if exists commandes_statut_avant_annulation_check;

update public.commandes
set statut_livraison = case statut_livraison
  when 'En préparation' then 'En attente'
  when 'Livré' then 'Vendu'
  else statut_livraison
end,
statut_avant_annulation = case statut_avant_annulation
  when 'En préparation' then 'En attente'
  else statut_avant_annulation
end;

alter table public.commandes alter column statut_livraison set default 'En attente';
alter table public.commandes add constraint commandes_statut_livraison_check
  check (statut_livraison in ('En attente', 'Prêt', 'Vendu', 'Annulée'));
alter table public.commandes add constraint commandes_statut_avant_annulation_check
  check (statut_avant_annulation in ('En attente', 'Prêt'));

alter table public.commandes_journal drop constraint if exists commandes_journal_action_check;
alter table public.commandes_journal add constraint commandes_journal_action_check
  check (action in (
    'Annulation', 'Restauration', 'Retour arrière', 'Suppression',
    'Préparation terminée', 'Finalisation vente', 'Livraison'
  ));

create or replace view public.commandes_en_cours
with (security_invoker = true) as
select * from public.commandes where statut_livraison <> 'Vendu';

create or replace function public.changer_statut_commande(p_commande_id bigint, p_nouveau_statut text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  statut_actuel text;
begin
  select statut_livraison into statut_actuel
  from public.commandes where id = p_commande_id for update;
  if statut_actuel is null then raise exception 'Commande introuvable'; end if;
  if statut_actuel <> 'En attente' or p_nouveau_statut <> 'Prêt' then
    raise exception 'Transition de commande invalide';
  end if;
  update public.commandes
  set statut_livraison = 'Prêt', date_pret = current_date
  where id = p_commande_id;
end;
$$;

create or replace function public.gerer_commande(
  p_commande_id bigint,
  p_employe_id bigint,
  p_action text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  commande public.commandes%rowtype;
  employe_nom text;
  prochain_statut text;
  snapshot jsonb;
begin
  select nom_prenom into employe_nom
  from public.employes where id = p_employe_id and actif;
  if employe_nom is null then raise exception 'Employé introuvable ou inactif'; end if;

  select * into commande from public.commandes where id = p_commande_id for update;
  if not found then raise exception 'Commande introuvable'; end if;

  snapshot := to_jsonb(commande) || jsonb_build_object(
    'lignes', coalesce((select jsonb_agg(to_jsonb(ligne) order by ligne.id)
      from public.lignes_commandes ligne where ligne.commande_id = commande.id), '[]'::jsonb)
  );

  if p_action = 'Préparation terminée' then
    if commande.statut_livraison <> 'En attente' then raise exception 'Transition de commande invalide'; end if;
    prochain_statut := 'Prêt';
    update public.commandes set statut_livraison = prochain_statut, date_pret = current_date where id = commande.id;
  elsif p_action = 'Finalisation vente' then
    if commande.statut_livraison <> 'Prêt' then raise exception 'Seule une commande prête peut être vendue'; end if;
    prochain_statut := 'Vendu';
    update public.commandes set statut_livraison = prochain_statut, statut_paiement = 'Payé' where id = commande.id;
  elsif p_action = 'Annulation' then
    if commande.statut_livraison in ('Vendu', 'Annulée') then raise exception 'Cette commande ne peut plus être annulée'; end if;
    prochain_statut := 'Annulée';
    update public.commandes set statut_avant_annulation = commande.statut_livraison,
      statut_livraison = prochain_statut where id = commande.id;
  elsif p_action = 'Restauration' then
    if commande.statut_livraison <> 'Annulée' then raise exception 'Seule une commande annulée peut être restaurée'; end if;
    prochain_statut := coalesce(commande.statut_avant_annulation, 'En attente');
    update public.commandes set statut_livraison = prochain_statut,
      statut_avant_annulation = null where id = commande.id;
  elsif p_action = 'Retour arrière' then
    if commande.statut_livraison <> 'Prêt' then raise exception 'Aucun état précédent disponible'; end if;
    prochain_statut := 'En attente';
    update public.commandes set statut_livraison = prochain_statut, date_pret = null where id = commande.id;
  elsif p_action = 'Suppression' then
    if commande.statut_livraison <> 'Annulée' then raise exception 'Une commande doit être annulée avant sa suppression'; end if;
    prochain_statut := null;
  else
    raise exception 'Action de commande invalide';
  end if;

  insert into public.commandes_journal (
    commande_id, commande_reference, employe_id, employe_nom, action,
    statut_avant, statut_apres, commande_snapshot
  ) values (
    commande.id, commande.id, p_employe_id, employe_nom, p_action,
    commande.statut_livraison, prochain_statut, snapshot
  );

  if p_action = 'Suppression' then delete from public.commandes where id = commande.id; end if;
end;
$$;

create or replace function public.enregistrer_panier_commandes(
  p_vendeur_id bigint,
  p_lignes jsonb,
  p_client_ticket_id bigint default null,
  p_retraits_permis jsonb default '[]'::jsonb,
  p_commande_ids jsonb default '[]'::jsonb
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  commande_id bigint;
  total numeric;
begin
  if jsonb_typeof(p_commande_ids) <> 'array' then
    raise exception 'La liste des commandes est invalide';
  end if;
  if (select count(*) from jsonb_array_elements_text(p_commande_ids)) <>
     (select count(distinct value) from jsonb_array_elements_text(p_commande_ids)) then
    raise exception 'Une commande ne peut être ajoutée qu’une fois au panier';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_commande_ids) element
    left join public.commandes commande on commande.id = element.value::bigint
    where commande.id is null or commande.statut_livraison <> 'Prêt'
  ) then
    raise exception 'Une commande du panier n’est plus prête à être vendue';
  end if;
  if exists (
    select 1
    from (
      select ligne.article_id, sum(ligne.quantite)::integer quantite
      from jsonb_array_elements_text(p_commande_ids) element
      join public.lignes_commandes ligne on ligne.commande_id = element.value::bigint
      group by ligne.article_id
    ) requis
    left join (
      select (element->>'article_id')::bigint article_id,
        sum((element->>'quantite')::integer)::integer quantite
      from jsonb_array_elements(p_lignes) element
      group by (element->>'article_id')::bigint
    ) panier using (article_id)
    where coalesce(panier.quantite, 0) < requis.quantite
  ) then
    raise exception 'Le panier ne contient pas toutes les lignes des commandes sélectionnées';
  end if;

  total := public.enregistrer_panier(p_vendeur_id, p_lignes, p_client_ticket_id, p_retraits_permis);

  for commande_id in select value::bigint from jsonb_array_elements_text(p_commande_ids)
  loop
    perform public.gerer_commande(commande_id, p_vendeur_id, 'Finalisation vente');
  end loop;
  return total;
end;
$$;

grant execute on function public.enregistrer_panier_commandes(bigint, jsonb, bigint, jsonb, jsonb) to anon, authenticated;

create or replace function public.normaliser_action_journal(p_action text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case trim(p_action)
    when 'Fabrication confirmée' then 'craft_confirmed'
    when 'Vente confirmée' then 'sale_confirmed'
    when 'Achat employé confirmé' then 'employee_purchase_confirmed'
    when 'Rachat confirmé' then 'purchase_confirmed'
    when 'Frais enregistré' then 'expense_recorded'
    when 'Transaction enregistrée' then 'transaction_recorded'
    when 'Préparation terminée de commande' then 'order_prepared'
    when 'Finalisation vente de commande' then 'order_sold'
    when 'Livraison de commande' then 'order_delivered'
    when 'Annulation de commande' then 'order_cancelled'
    when 'Restauration de commande' then 'order_restored'
    when 'Retour arrière de commande' then 'order_reverted'
    when 'Suppression de commande' then 'order_deleted'
    when 'Retrait de permis confirmé' then 'permit_withdrawn'
    when 'Validation de permis' then 'permit_validated'
    when 'Interdiction de permis' then 'permit_banned'
    when 'Modification de permis' then 'permit_updated'
    when 'Purge du journal technique après sauvegarde confirmée' then 'technical_log_purged'
    else trim(p_action)
  end;
$$;
