# Expression du besoin — Référentiel des tarifs SMS internationaux DMC

| Métadonnée | Valeur |
|---|---|
| Projet | DMC — Tarification SMS internationaux Sinch |
| Utilisateurs | Équipe DMC et pôle Facturation SFR Business |
| Statut | Prototype local en cours ; déploiement et automatisation email à valider |

## 1. Contexte

Les clients DMC peuvent envoyer des SMS vers l'international. Les tarifs d'achat Sinch peuvent varier et doivent pouvoir être consultés par destination afin de faciliter leur prise en compte dans les tarifs destinés aux clients et dans les travaux du pôle Facturation.

Le besoin porte sur les grilles de prix et leur évolution. Il ne s'agit pas de récupérer par API les volumes de SMS consommés, les relevés d'usage ou les factures détaillées de Sinch.

## 2. Besoin fonctionnel

La solution doit permettre de :

1. Importer le catalogue initial des tarifs et les notifications CSV Sinch reçues ultérieurement.
2. Identifier un tarif par pays et opérateur, avec les informations télécom disponibles (indicatif, MCC/MNC, réseau).
3. conserver les anciennes versions du référentiel et l'historique des prix, avec la date d'effet et la provenance du fichier importé.
4. Consulter et comparer les tarifs, y compris la France et les autres pays, puis examiner les évolutions annuelles lorsque suffisamment de données sont disponibles.
5. Exporter une grille tarifaire au format CSV pour le pôle Facturation.
6. À terme, traiter automatiquement les notifications reçues dans une boîte générique dédiée, après validation des accès et règles métier.

## 3. Données attendues

### Fichier de base

Les colonnes observées sont `Country`, `Operator`, `Service type`, `Originator`, `MCC`, `MCC/MNC`, `Price` et `Currency`.

### Notification de changement

Les colonnes observées sont `Product`, `Country`, `Operator`, `Network`, `CC`, `MCC`, `MNC`, `Old Price`, `New Price` et `Valid From`.

Le système doit préserver les identifiants de destination et les dates d'effet. Les tarifs ne doivent pas être considérés comme validés pour la facturation sans contrôle métier des données importées.

## 4. Périmètre logiciel actuel

- Application Node.js locale avec interface de recherche et tableau de tarifs.
- Import manuel CSV depuis l'interface et historique des prix par destination.
- Archive JSON téléchargeable du référentiel avant import, avec le fichier CSV importé.
- Export CSV pour la facturation.
- Graphiques générés en Python : comparaison des tarifs moyens par pays (France mise en évidence) et évolution annuelle issue de l'historique.

L'ancienne intégration de l'API Sinch a été retirée. Elle portait sur la récupération de tarifs et ne répondait pas au besoin de données d'usage ou de facturation des SMS. Aucun accès automatique à une boîte mail n'est encore intégré.

## 5. Automatisation email à concevoir

L'automatisation est une étape ultérieure. Elle nécessitera des décisions de l'entreprise concernant :

- l'adresse et le fournisseur de la boîte de service ;
- le connecteur autorisé (API de messagerie, workflow interne ou passerelle) et ses droits ;
- l'identification des courriels et pièces jointes autorisés ;
- la validation du schéma CSV, des dates et des prix ;
- le traitement des doublons, erreurs, notifications et rejets ;
- le stockage durable du fichier source et la traçabilité des mises à jour.

La réception automatique ne doit pas être présentée comme active tant que ce mécanisme n'a pas été implémenté et testé sur la VM.

## 6. Déploiement et exploitation

Le déploiement sur une VM accessible aux collaborateurs est conditionné par les règles d'hébergement SFR : réseau interne/VPN, reverse proxy, HTTPS, authentification, supervision, sauvegarde et restauration. Le serveur du prototype ne fournit pas d'authentification ; il ne doit pas être exposé directement sur un réseau partagé sans protections approuvées.

Les données sous `data/` doivent résider sur un stockage persistant et être sauvegardées séparément du code. Les déploiements doivent préserver `database.json` et les archives, exécuter les tests et inclure une procédure de retour arrière.

## 7. Critères d'acceptation à confirmer

- Import d'un fichier de base avec colonnes MCC/MNC acceptées et prix correctement associés au pays/opérateur.
- Import d'une notification avec calcul des variations et date d'effet.
- Archive consultable du référentiel précédent et conservation du fichier importé.
- Recherche et export cohérents avec les données importées et les devises.
- Graphiques fondés uniquement sur les données présentes, avec limites visibles lorsque l'historique est insuffisant.
- Procédure documentée de déploiement interne, sauvegarde et restauration.
- Automatisation email testée de bout en bout uniquement après fourniture des accès et validation par l'équipe concernée.
