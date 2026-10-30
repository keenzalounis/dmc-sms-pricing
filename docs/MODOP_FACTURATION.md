# Mode opératoire — Tarifs SMS internationaux DMC

| Métadonnée | Valeur |
|---|---|
| Application | DMC SMS Pricing |
| Utilisateurs | Pôle Facturation, ADV, Contrôle de gestion |
| État | Import CSV manuel et relève planifiée de la boîte mail si configurée |

## 1. Objectif et limites

L'application centralise les tarifs d'achat SMS internationaux transmis par Sinch, conserve leur historique, permet de les rechercher et prépare un export CSV destiné au pôle Facturation.

La version actuelle ne récupère pas les données de consommation ou de facturation DMC par API Sinch. L'API envisagée précédemment concernait les tarifs et n'est pas utilisée. Les notifications Sinch sont importées depuis leur CSV, manuellement ou via la relève planifiée de la boîte mail lorsque celle-ci est configurée.

La base de démonstration fournie dans le dépôt peut contenir des valeurs provenant de l'ancien mode mock. Avant une utilisation métier, importer et faire valider le fichier tarifaire de référence ; ne pas utiliser les valeurs de démonstration pour facturer.

## 2. Ouvrir le tableau de bord

- En local : `http://localhost:3000`.
- En VM : utiliser l'adresse interne communiquée par l'équipe d'exploitation après publication sécurisée (réseau interne/VPN, HTTPS et authentification approuvés).

L'application ne fournit pas elle-même d'authentification. Ne pas exposer directement le serveur à Internet ou à un réseau partagé sans protections approuvées.

## 3. Importer une notification de mise à jour

1. Depuis le tableau de bord, choisir **Mettre à jour les tarifs**.
2. Sélectionner le CSV reçu de Sinch, puis lancer l'ingestion.
3. Vérifier le message de résultat, les tarifs et les dates d'effet dans le tableau.
4. Ouvrir **Historique des versions** pour vérifier que l'ancienne version du référentiel est archivée.

L'import prend en charge les colonnes d'une notification telles que `Product`, `Country`, `Operator`, `Network`, `CC`, `MCC`, `MNC`, `Old Price`, `New Price` et `Valid From`. Le format de base peut fournir `Country`, `Operator`, `Service type`, `Originator`, `MCC`, `MCC/MNC`, `Price` et `Currency`.

Avant chaque import valide, l'application conserve un instantané de la base précédente et le contenu du CSV importé. Les versions sont accessibles et téléchargeables depuis **Historique des versions** et stockées sous `data/archives/`. Elles doivent être sauvegardées avec `data/database.json` lors de l'exploitation de la VM.

Les colonnes obligatoires sont `Country`, `Operator` et `Price` pour un fichier de base, ou `Country`, `Operator` et `New Price` pour une mise à jour. Toutes les lignes de tarif sont contrôlées avant l'import ; si une ligne est invalide ou si le schéma ne correspond pas, le fichier entier est refusé et la base n'est pas modifiée. Le message d'erreur indique les colonnes attendues ou les premières lignes à corriger. Ne remplacez pas manuellement `data/database.json` pour corriger un import : contactez l'équipe technique et restaurez une archive vérifiée si nécessaire.

## 4. Rechercher et examiner un tarif

La recherche accepte notamment un pays, un opérateur, un indicatif téléphonique, un MCC ou un MNC. La colonne **Historique** de chaque destination ouvre les dates d'effet, les anciens et nouveaux prix ainsi que la source/fichier importé.

Les hausses et baisses sont calculées à partir des prix présents dans les fichiers importés. Vérifier la devise, le pays, l'opérateur et la date d'effet avant toute utilisation pour un tarif client.

## 5. Générer les graphiques

Choisir **Analyses & graphiques**, puis **Générer les graphiques**. Les deux vues Python disponibles sont présentées dans une galerie responsive :

- la comparaison du prix moyen actuel par pays, avec la France mise en évidence ;
- l'évolution mensuelle des prix moyens par pays à partir des dates d'effet historisées, avec la France incluse lorsqu'elle dispose de plusieurs mois de données.

La génération nécessite Python 3 et les dépendances listées dans `requirements.txt` sur la machine qui exécute le serveur. La tendance utilise uniquement les mois présents dans l'historique ; en l'absence de plusieurs mois pour comparer un pays, le graphique indique que l'historique est insuffisant au lieu d'inventer une évolution.

## 6. Exporter pour la facturation

1. Choisir **Export Facturation**.
2. Renseigner la marge demandée et, si nécessaire, filtrer par pays.
3. Télécharger le CSV compatible Excel FR.
4. Vérifier le périmètre, la devise et la marge avec les règles de facturation en vigueur avant toute intégration dans un SI.

L'export n'est pas un relevé de consommation SMS ni une facture Sinch. Il fournit une grille tarifaire calculée à partir des tarifs importés.

## 7. Démarrage local et exploitation VM

En local sous Windows PowerShell :

```powershell
npm.cmd test
npm.cmd start
```

Le serveur écoute sur le port configuré par `PORT` (3000 par défaut). En VM, l'exploitation doit assurer le démarrage automatique, les journaux, les sauvegardes de `data/`, le reverse proxy et l'authentification approuvés par SFR. Tester une mise à jour du code et une restauration d'archive avant toute mise en service métier.

## 8. Relève de la boîte mail et alertes

La relève planifiée et le déclenchement manuel depuis la fenêtre d'import s'appuient sur les paramètres de `data/mail_config.json` (à créer à partir du modèle `data/mail_config.example.json`). Vérifier dans l'interface que la boîte est configurée et que la relève répond avant de compter sur l'automatisation.

Les messages Sinch et les pièces jointes sont contrôlés. Les messages suspects, les pièces jointes non CSV et les fichiers dont les colonnes ou les tarifs sont invalides sont rejetés ; une alerte est envoyée au destinataire configuré si le transport de courriel est opérationnel. Vérifier la configuration et les journaux du serveur en cas d'échec d'envoi.

Cette version utilise une relève planifiée ; elle ne nécessite pas de webhook entrant public. Les identifiants de boîte et d'envoi doivent rester dans la configuration runtime et ne doivent pas être publiés.
