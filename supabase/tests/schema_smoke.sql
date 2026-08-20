begin;
select '1..1';
set local role anon;

do $$
<<schema_smoke>>
declare
  employe_id bigint;
  article_id bigint;
  client_id bigint;
  stock_avant integer;
  stock_apres integer;
  total_vente numeric;
  ca_calcule numeric;
  commande_id bigint;
  total_commande numeric;
  periode_cloturee_id bigint;
  transactions_avant integer;
  transactions_apres integer;
  commandes_avant integer;
  commandes_apres integer;
  nom_instantane text;
  produit_craft_id bigint;
  stock_produit_avant integer;
  quantite_fabriquee integer;
  permit_client_id bigint;
  permit_id bigint;
  erreur_attendue boolean := false;
begin
  assert public.session_jeu('2026-08-19 12:59:59+00'::timestamptz) = '2026-08-18'::date,
    'Avant 15 h à Madrid, le quota appartient à la session de la veille';
  assert public.session_jeu('2026-08-19 13:00:00+00'::timestamptz) = '2026-08-19'::date,
    'À 15 h à Madrid, une nouvelle session de tickets commence';
  assert (select count(*) from public.client_permits) = 3,
    'Le référentiel local ne contient que les trois permis balais attendus';
  assert exists (
    select 1 from public.client_permits permis join public.clients client on client.id = permis.client_id
    where client.hibou = '1110' and permis.type = 'broomstick' and permis.status = 'pending'
  ), 'Filian Dinwiddy possède un permis balais non validé';
  assert exists (
    select 1 from public.client_permits permis join public.clients client on client.id = permis.client_id
    where client.hibou = '31863' and permis.type = 'broomstick' and permis.status = 'accepted'
  ), 'Aurélia Ambrosia possède un permis balais validé';
  assert exists (
    select 1 from public.client_permits permis join public.clients client on client.id = permis.client_id
    where client.hibou = '62771' and lower(client.nom_prenom) = 'elias moonwhisper'
      and permis.type = 'broomstick' and permis.status = 'sold'
  ), 'Elias Moonwhisper possède un permis balais validé et retiré';

  select id into employe_id from public.employes order by id limit 1;
  select catalogue.id into article_id
  from public.catalogue catalogue
  join public.stocks stock on stock.article_id = catalogue.id
  where catalogue.prix_vente > 0
  order by catalogue.id
  limit 1;
  select id into client_id from public.clients order by id limit 1;
  select client.id into permit_client_id from public.clients client
  where not exists (select 1 from public.client_permits permit where permit.client_id = client.id)
  order by client.id limit 1;

  permit_id := public.enregistrer_client_permit(null, permit_client_id, 'broomstick', 'pending', employe_id);
  assert (select status from public.client_permits where id = permit_id) = 'pending',
    'La création d’un dossier doit enregistrer son état courant';
  perform public.enregistrer_client_permit(permit_id, permit_client_id, 'broomstick', 'accepted', employe_id);
  assert (select status from public.client_permits where id = permit_id) = 'accepted',
    'La modification d’un dossier doit remplacer son état courant';
  assert exists (
    select 1 from public.journal_actions journal
    where journal.entite_type = 'client_permit' and journal.entite_id = permit_id::text
      and journal.client_id = permit_client_id and journal.element = 'permit_broomstick'
  ), 'Les actions de permis doivent conserver l’élément et le client';
  select stock.quantite into stock_avant
  from public.stocks stock where stock.article_id = schema_smoke.article_id;

  begin
    perform public.decrementer_stock(article_id, stock_avant + 1);
  exception when others then
    erreur_attendue := true;
  end;
  assert erreur_attendue, 'Un stock insuffisant doit être refusé';
  select stock.quantite into stock_apres
  from public.stocks stock where stock.article_id = schema_smoke.article_id;
  assert stock_apres = stock_avant, 'Un refus de stock ne doit rien modifier';

  total_vente := public.enregistrer_vente(
    employe_id,
    jsonb_build_array(jsonb_build_object('article_id', article_id, 'quantite', 1))
  );
  select stock.quantite into stock_apres
  from public.stocks stock where stock.article_id = schema_smoke.article_id;
  assert stock_apres = stock_avant - 1, 'La vente doit décrémenter le stock';
  select ca_realise into ca_calcule
  from public.performances_employes where performances_employes.employe_id = schema_smoke.employe_id;
  assert ca_calcule = total_vente, 'Le CA doit être calculé depuis les transactions';
  select transaction.vendeur_nom into nom_instantane
  from public.transactions transaction order by transaction.id desc limit 1;
  assert nom_instantane is not null, 'Le nom du vendeur doit être instantané dans la transaction';

  select recette.produit_id into produit_craft_id
  from public.recettes_craft recette
  group by recette.produit_id
  having bool_and((select stock.quantite from public.stocks stock where stock.article_id = recette.ingredient_id) >= recette.quantite_requise)
  order by recette.produit_id
  limit 1;
  select stock.quantite into stock_produit_avant
  from public.stocks stock where stock.article_id = produit_craft_id;
  quantite_fabriquee := public.fabriquer_article(employe_id, produit_craft_id, 1);
  assert quantite_fabriquee > 0, 'La fabrication doit retourner la quantité produite';
  assert (select stock.quantite from public.stocks stock where stock.article_id = produit_craft_id)
    = stock_produit_avant + quantite_fabriquee,
    'La fabrication d’un craft doit incrémenter le stock produit';

  commande_id := public.creer_commande(
    client_id,
    employe_id,
    current_date + 7,
    jsonb_build_array(jsonb_build_object('article_id', article_id, 'quantite', 3))
  );
  select commande.prix_total into total_commande
  from public.commandes commande where commande.id = schema_smoke.commande_id;
  assert total_commande = 3 * (
    select catalogue.prix_vente from public.catalogue catalogue
    where catalogue.id = schema_smoke.article_id
  ),
    'Le total de commande doit provenir des lignes';

  assert exists (select 1 from public.clients where hibou is not null),
    'Le référentiel client doit contenir des hiboux recherchables';

  select count(*) into transactions_avant from public.transactions;
  select count(*) into commandes_avant from public.commandes;
  periode_cloturee_id := public.cloturer_periode_horodatee(
    now(),
    jsonb_build_array(jsonb_build_object(
      'employe_id', employe_id,
      'prime', 100,
      'total_paye', 500
    ))
  );
  select count(*) into transactions_apres from public.transactions;
  select count(*) into commandes_apres from public.commandes;
  assert transactions_apres = transactions_avant, 'La clôture doit conserver les transactions';
  assert commandes_apres = commandes_avant, 'La clôture doit conserver les commandes';
  assert (select statut from public.periodes_comptables where id = periode_cloturee_id) = 'clôturée',
    'La période courante doit être clôturée';
  assert (select count(*) from public.periodes_comptables where statut = 'ouverte') = 1,
    'Une nouvelle période doit être ouverte';
  assert (select count(*) from public.transactions_courantes) = 0,
    'La nouvelle période doit présenter un journal courant vide';
  assert exists (
    select 1 from public.archives_rh
    where periode_id = periode_cloturee_id and employe_nom is not null
  ), 'L’archive RH doit conserver le nom de l’employé';

  erreur_attendue := false;
  begin
    insert into public.periodes_comptables (
      date_debut, date_fin, debut_at, fin_at, statut, cloturee_at
    ) values (
      current_date, current_date, now(), now() + interval '30 seconds',
      'clôturée', now()
    );
  exception when exclusion_violation then
    erreur_attendue := true;
  end;
  assert erreur_attendue, 'Deux périodes comptables ne doivent pas se chevaucher';
end
$$;

select 'ok 1 - Les invariants du schéma et des RPC sont respectés';

rollback;
