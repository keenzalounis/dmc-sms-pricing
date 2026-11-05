# DMC SMS Pricing — Référentiel des Tarifs SMS Internationaux Sinch

Plateforme web interne sécurisée de gestion, d'historisation et d'export des tarifs SMS internationaux Sinch pour l'équipe **DMC** et le **Pôle Facturation de SFR Business**.

L'application automatise l'ensemble de la chaîne tarifaire : de la relève nocturne des e-mails Sinch jusqu'à l'export de facturation sous Excel avec marge personnalisée, tout en intégrant un contrôle d'accès strict par rôles (RBAC) et un système d'alerte en cas de notification anormale.

---

## Sommaire

1. [Architecture Technique Globale](#1-architecture-technique-globale)
2. [Arborescence Détaillée du Projet](#2-arborescence-détaillée-du-projet)
3. [Moteur d'Ingestion & Algorithmes Clés (`src/ingest.js`)](#3-moteur-dingestion--algorithmes-clés-srcingestjs)
4. [Relève Automatique Sinch & Alertes Email](#4-relève-automatique-sinch--alertes-email)
5. [Authentification & Gestion des Rôles (RBAC)](#5-authentification--gestion-des-rôles-rbac)
6. [Interface Web & Visualisations Graphiques](#6-interface-web--visualisations-graphiques)
7. [Module d'Export Facturation (`src/export.js`)](#7-module-dexport-facturation-srcexportjs)
8. [Déploiement & Exploitation sur la VM Ubuntu](#8-déploiement--exploitation-sur-la-vm-ubuntu)
9. [Jeux de Données & Tests Automatisés](#9-jeux-de-données--tests-automatisés)

---

## 1. Architecture Technique Globale

L'application est conçue selon un principe de **résilience maximale et zéro dépendance externe** pour le serveur principal (aucun module npm tiers n'est nécessaire pour faire tourner l'API, l'authentification, le chiffrement, la relève IMAP ou l'envoi SMTP).

```text
       ┌─────────────────────────────────────────────────────────────┐
       │                EXPÉDITEUR SINCH (Fournisseur)               │
       │       Envoi mensuel d'un e-mail avec PriceChange.csv        │
       └──────────────────────────────┬──────────────────────────────┘
                                      │
                                      ▼
       ┌─────────────────────────────────────────────────────────────┐
       │               BOÎTE MAIL DÉDIÉE (Gmail TLS:993)             │
       │                 dmc.tarifs.sinch@gmail.com                  │
       └──────────────────────────────┬──────────────────────────────┘
                                      │
               ┌──────────────────────┴──────────────────────┐
               │ Relève nocturne 02:00 (src/mail_sync.js)    │
               │   • Filtrage expéditeur (@sinch.com)        │
               │   • Parseur récursif MIME multi-parties     │
               │   • Filtre anti-faux-positifs (image001.png)│
               └──────────┬───────────────────────┬──────────┘
                          │                       │
               [Si Anomalie / Rejet]       [Si CSV Conforme]
                          │                       │
                          ▼                       ▼
            ┌───────────────────────────┐   ┌───────────────────────────┐
            │ ALERTE SMTP TLS (Port 465)│   │  MOTEUR D'INGESTION       │
            │     src/alert_mailer.js   │   │     src/ingest.js         │
            │  Envoi immédiat vers :    │   │  • Smart Matching (913)   │
            │   kenza.lounis@sfr.com    │   │  • Dictionnaire indicatifs│
            └───────────────────────────┘   │  • Archivage atomique     │
                                            └─────────────┬─────────────┘
                                                          │
                                                          ▼
                                            ┌───────────────────────────┐
                                            │ BASE ACTIVE database.json │
                                            │ 913 destinations en direct│
                                            └─────────────┬─────────────┘
                                                          │
   ┌──────────────────────────────────────────────────────┴──────────────────────────────────────────────────────┐
   │                                           SERVEUR API REST (src/server.js)                                  │
   │           Reverse Proxy Nginx : https://vm.inspear.org/dmc/ ──> Port local 3002 (0.0.0.0)                   │
   │           Auth RBAC : Session 256 bits, Cookies HttpOnly, Hachage scrypt (src/auth.js)                      │
   └───────────────┬──────────────────────────────────────────────┬──────────────────────────────┬───────────────┘
                   │                                              │                              │
                   ▼                                              ▼                              ▼
     ┌───────────────────────────┐                  ┌───────────────────────────┐  ┌───────────────────────────┐
     │ ÉCRAN DE CONNEXION SFR    │                  │  TABLEAU DE BORD (DMC)    │  │ EXPORT FACTURATION        │
     │   src/public/index.html   │                  │  • Sparklines par ligne   │  │   src/export.js           │
     │   • Auth Email + Pass     │                  │  • Courbes d'évolution    │  │  • Marge commerciale %    │
     │   • Profils Admin/Billing │                  │  • Polling temps réel 30s │  │  • Format Excel (UTF-8 BOM│
     └───────────────────────────┘                  └───────────────────────────┘  └───────────────────────────┘
```

---

## 2. Arborescence Détaillée du Projet

```text
dmc-sms-pricing/
├── data/                                  # Données persistance, catalogues et archives
│   ├── archives/                          # Instantanés JSON horodatés sauvegardés avant chaque import
│   ├── base_tarifs.csv                    # Fichier maquette historique (15 pays de démonstration)
│   ├── database.json                      # Base de données active en temps réel (913 destinations)
│   ├── mail_config.example.json           # Gabarit de configuration de la boîte mail (sans secret)
│   ├── mail_config.json                   # Configuration active (identifiants IMAP/SMTP) [EXCLU GIT]
│   ├── sinch_config.json                  # Paramètres annexes de connectivité Sinch [EXCLU GIT]
│   ├── sinch_pricelist__20261022.csv      # Référentiel mondial officiel Sinch initial (913 pays)
│   ├── test_samples/                      # Échantillons de test pour validations et démonstrations
│   │   ├── 01_notification_hausses_baisses_valide.csv       # 15 opérateurs représentatifs
│   │   ├── 02_notification_destinations_internationales.csv # Destinations Afrique, Asie, Amériques
│   │   ├── 03_fichier_invalide_colonnes_manquantes.csv      # Test rejet et déclenchement d'alerte
│   │   ├── 04_fichier_vide_ou_corrompu.csv                  # Test de robustesse du parseur
│   │   ├── 05_test_notification_valide.csv                  # Échantillon minimaliste valide
│   │   ├── 06_test_old_price_sans_new_price.csv             # Test rejet incohérence prix
│   │   ├── 07_test_tarifs_invalides.csv                     # Test rejet tarif non numérique
│   │   ├── 08_test_colonnes_incorrectes.csv                 # Test rejet schéma invalide
│   │   ├── djezzy_etape1_novembre.csv                       # Test multi-fichiers (hausse Djezzy)
│   │   ├── djezzy_etape2_decembre.csv                       # Test multi-fichiers (baisse Djezzy)
│   │   └── README_TESTS.md                                  # Guide opératoire des jeux de test
│   └── users.json                         # Répertoire des utilisateurs et hachages [EXCLU GIT]
├── deploy/                                # Configuration de déploiement d'infrastructure
│   └── nginx/
│       └── default                        # Configuration du virtual host Nginx (HTTPS, reverse proxy)
├── docs/                                  # Documentation projet & spécifications
│   ├── EXPRESSION_BESOIN_DMC.md           # Expression de besoin détaillée pour la direction
│   └── MODOP_FACTURATION.md               # Mode opératoire pas-à-pas pour le pôle Facturation
├── scripts/                               # Scripts d'automatisation, graphiques et maintenance
│   ├── apply_nginx.sh                     # Script d'installation de la configuration Nginx sur la VM
│   ├── generate_charts.py                 # Moteur d'analyse globale par pays (Python / Matplotlib)
│   ├── generate_record_chart.py           # Génération à la demande du PNG d'évolution d'un opérateur
│   ├── install_python_deps.sh             # Installation automatique des dépendances Python sur la VM
│   ├── restart.sh                         # Script tout-en-un de redémarrage/mise à jour sur la VM
│   ├── setup_mail_config.sh               # Initialisation rapide de la configuration mail
│   └── sync_mail.js                       # Lanceur de relève mail en ligne de commande (npm run sync-mail)
├── src/                                   # Code source de l'application
│   ├── alert_mailer.js                    # Client SMTP TLS natif et modèles d'e-mails d'alerte
│   ├── auth.js                            # Authentification, hachage scrypt, sessions et rôles RBAC
│   ├── export.js                          # Moteur de calcul de marge et export CSV format Excel
│   ├── ingest.js                          # Parseur CSV, smart-matching, indicatifs et historisation
│   ├── mail_sync.js                       # Client IMAP TLS natif, décodeur MIME et planificateur 02:00
│   ├── manual_upload.js                   # Gestionnaire sécurisé des téléversements de fichiers web
│   ├── server.js                          # Serveur HTTP, routage API REST et distribution des assets
│   └── public/                            # Interface utilisateur web (Single Page Application)
│       ├── app.js                         # Logique front-end, rendu des courbes et gestion des onglets
│       ├── index.html                     # Structure du tableau de bord et fenêtres modales
│       └── styles.css                     # Feuille de styles charte SFR Business (rouge #E2001A)
├── test/                                  # Suite de tests automatisés
│   └── run-tests.js                       # 38 tests unitaires et d'intégration autonomes
├── .gitignore                             # Exclusion des secrets, cookies, bases locales et temporaires
├── package.json                           # Métadonnées du projet et commandes npm
├── README.md                              # Référence technique globale du projet (ce fichier)
└── requirements.txt                       # Dépendances Python optionnelles (pandas, matplotlib, seaborn)
```

---

## 3. Moteur d'Ingestion & Algorithmes Clés (`src/ingest.js`)

Le fichier [`src/ingest.js`](src/ingest.js) est le cœur algorithmique du projet. Il gère la normalisation, la détection des opérateurs et l'intégrité de la base de données.

### A. La Correspondance Intelligente (*Smart Matching*)
* **Problématique résolue :** Dans le catalogue initial Sinch (`sinch_pricelist`), les codes réseaux MNC sont souvent combinés avec le code pays (ex: `MCC = 292`, `MNC = 29201` pour Saint-Marin) ou regroupés en listes séparées par des virgules (ex: `20809, 20827, 20810` pour SFR France). Lors des notifications de variation, Sinch ne transmet qu'un code simple (ex: `01` ou `10`). Une comparaison naïve créait des doublons et faisait grimper le total de 913 à 930 destinations.
* **Fonction `resolveTargetRecordKey(db, country, operator, mcc, mnc)` :**
  1. Teste d'abord une clé exacte construite avec `buildRecordKey`.
  2. Si non trouvée, filtre les candidats existants au sein du même pays.
  3. Effectue une normalisation : si le code réseau commence par le MCC, il extrait le suffixe utile.
  4. Vérifie l'appartenance du code à la liste des sous-réseaux connus de l'opérateur.
  5. Rapproche les libellés commerciaux (ex: *Orange France* ↔ *Orange*, *Everything Everywhere* ↔ *EE*).
  6. **Garantie :** Les notifications mettent à jour les fiches existantes sans altérer le décompte global (**913 destinations stables**).

### B. Attribution Automatique des Indicatifs Téléphoniques (`MCC_TO_CC`)
* **Problématique :** Le fichier officiel Sinch ne comporte pas de colonne d'indicatif téléphonique (`+33`, `+213`...).
* **Fonction `lookupCountryCode(country, mcc)` :** 
  - Embarque le dictionnaire standardisé UIT-T E.164 reliant chaque code pays mobile (MCC) à son préfixe téléphonique international.
  - Couvre **912 destinations sur 913** (la seule ligne sans indicatif étant une ligne technique internationale déclarée sans pays par Sinch).
  - Élimine tous les tirets vides `-` du tableau et enrichit automatiquement l'export de facturation.

### C. Parseur CSV Universel & Détection de Délimiteur
* **Fonction `parseCSV` / `splitCSVLine` / `detectDelimiter` :**
  - Élimine le caractère d'en-tête invisible UTF-8 BOM (`﻿`).
  - Détecte automatiquement si le délimiteur est une virgule `,`, un point-virgule `;` ou une tabulation `\t`.
  - Respecte les guillemets et préserve les virgules présentes à l'intérieur des libellés d'opérateurs (ex: `"SFR, Business"`).

### D. Sauvegarde Atomique & Historisation Chronologique
* **Fonction `saveDatabase` :** Écrit d'abord dans un fichier temporaire `data/database.json.tmp` avant de le renommer de façon atomique vers `data/database.json`. Cela garantit que la base ne sera jamais corrompue même en cas de coupure de courant pendant l'enregistrement.
* **Historique par opérateur :** Chaque mise à jour ajoute un nœud dans le tableau `history` de l'opérateur :
  ```json
  {
    "date": "2026-11-15",
    "price": 0.04500,
    "oldPrice": 0.03950,
    "product": "SFRBu_202611_FR01",
    "source": "PriceChangeNotification.csv"
  }
  ```
* **Fonction `resetToBaseCatalog` :** Sanctuarise le fichier `sinch_pricelist__20261022.csv`. Réinitialise la base active, remet à zéro les variations (`priceChange = 0`, `percentChange = 0`) et purge les archives de test lorsque demandé.

---

## 4. Relève Automatique Sinch & Alertes Email

### A. Client IMAP TLS Autonome (`src/mail_sync.js`)
* Se connecte en TLS direct (port 993) à `imap.gmail.com` via le module natif `tls` de Node.js.
* Prend en charge les tunnels mandataires d'entreprise (via tunnel `HTTP CONNECT` si un proxy `http_proxy` est présent).
* Interroge la boîte de réception à la recherche des e-mails **non lus** (`SEARCH UNSEEN`).
* Ne traite que les expéditeurs autorisés dans `allowedSenders` (`@sinch.com`, `kenza.lounis@sfr.com`).
* **Planificateur nocturne :** Calcule les millisecondes jusqu'à la prochaine occurrence de **02h00 du matin** et programme une vérification quotidienne automatique.

### B. Parseur Récursif MIME & Filtrage des Signatures Outlook
* Décode récursivement les e-mails imbriqués multi-parties (`multipart/mixed`, `multipart/alternative`, `multipart/related`).
* **Filtre anti-faux-positifs (`isSignatureOrInlineImage`) :** 
  Les logiciels comme Microsoft Outlook attachent systématiquement les images des signatures d'e-mail (logos d'entreprise, icônes réseaux sociaux) sous forme de fichiers `image001.png`, `image002.jpg`. 
  Le système identifie et ignore silencieusement ces images pour ne pas bloquer l'import d'un CSV valide et éviter les fausses alertes.

### C. Système d'Alertes SMTP Sécurisé (`src/alert_mailer.js`)
En cas de rejet d'un e-mail d'un expéditeur autorisé ou d'un téléversement web invalide, un courriel d'alerte HTML et texte est immédiatement transmis à **`kenza.lounis@sfr.com`** via `smtp.gmail.com:465` dans **3 cas d'anomalie** :

| Type d'anomalie | Déclencheur | Contenu de l'alerte |
|---|---|---|
| **`EMAIL_FORMAT_INVALID`** | E-mail sans rapport avec la tarification (aucun mot-clé *Price Change*, *rates*, *notification*...). | Détail de l'expéditeur, du sujet et rappel des mots-clés requis. |
| **`ATTACHMENT_NOT_CSV`** | Notification reçue sans pièce jointe ou avec un document non supporté (`.xlsx`, `.pdf`, `.zip`...). | Indication du nom du fichier reçu et rappel du format `.csv` obligatoire. |
| **`CSV_SCHEMA_INVALID`** | CSV vide, colonnes obligatoires manquantes (`Country`, `Operator`, `Price`) ou tarifs non numériques. | Liste exacte des colonnes absentes et première ligne brute reçue. |

---

## 5. Authentification & Gestion des Rôles (RBAC)

Le fichier [`src/auth.js`](src/auth.js) fournit un contrôle d'accès d'entreprise conforme aux exigences de sécurité SFR Business.

### A. Sécurité Cryptographique
* **Hachage des mots de passe :** Algorithme `scrypt` combiné à un sel aléatoire cryptographique de 16 octets (`crypto.randomBytes`). Aucun mot de passe en clair n'est conservé.
* **Résistance aux attaques temporelles :** La validation des hashs utilise `crypto.timingSafeEqual` pour empêcher toute attaque par analyse temporelle (*timing attack*).
* **Gestion des sessions :** Génération de jetons aléatoires de 256 bits (32 octets hexadécimaux). Les sessions sont transmises via un cookie sécurisé :
  ```http
  Set-Cookie: dmc_session=<token_256bits>; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800
  ```
  Le drapeau `HttpOnly` empêche tout vol de session par script JavaScript malveillant (XSS).

### B. Contrôle d'Accès par Rôles

| Fonctionnalité | Rôle `admin` (Kenza Lounis) | Rôle `billing` (Collaborateurs Facturation) |
|---|:---:|:---:|
| Consultation du catalogue & Recherche 913 pays | ✅ Autorisé | ✅ Autorisé |
| Visualisation des sparklines & Courbes par opérateur | ✅ Autorisé | ✅ Autorisé |
| Téléchargement du fichier **Export Facturation** (marge %) | ✅ Autorisé | ✅ Autorisé |
| Modification du mot de passe personnel (`🔑`) | ✅ Autorisé | ✅ Autorisé |
| Import manuel de CSV (`Mettre à jour les tarifs`) | ✅ Autorisé | 🔒 Masqué & Refusé (HTTP 403) |
| Consultation de l'historique des versions archivées | ✅ Autorisé | 🔒 Masqué & Refusé (HTTP 403) |
| Réinitialisation de la plateforme au catalogue de base | ✅ Autorisé | 🔒 Masqué & Refusé (HTTP 403) |
| Gestion des comptes collaborateurs (Création / Suppression) | ✅ Autorisé | 🔒 Masqué & Refusé (HTTP 403) |

* **Sécurité de délégation :** Le système interdit formellement la suppression du dernier compte administrateur.

---

## 6. Interface Web & Visualisations Graphiques

L'interface utilisateur ([src/public/index.html](src/public/index.html) et [src/public/app.js](src/public/app.js)) est développée en Single Page Application (SPA) légère aux couleurs de SFR Business (`#E2001A`).

### A. Mini-Courbes Sparklines Intégrées au Tableau
Dans la colonne **`📊 Graphique d'évolution`**, chaque ligne du tableau dispose de son propre mini-graphique vectoriel SVG rendu instantanément (0 ms) :
* **Courbe rouge montante (`#DC2626`) :** Prix en hausse lors du dernier mouvement.
* **Courbe verte descendante (`#059669`) :** Prix en baisse lors du dernier mouvement.
* **Ligne grise neutre (`#94A3B8`) :** Tarif stable issu du catalogue initial.
* **Infobulle dynamique :** Le survol de la courbe affiche la trajectoire résumée (ex: `0.1560€ → 0.1750€ → 0.1620€`).

### B. Fenêtre Modale d'Évolution Détaillée
Un clic sur **`Graphique`** sur n'importe quel opérateur ouvre la fenêtre d'analyse :
1. **Courbe d'évolution chronologique :** Affiche la progression des prix à travers chaque fichier importé, avec la date d'effet, le montant exact en euros, le badge de pourcentage (`▲ +12.2%` ou `▼ -7.4%`) et le nom du fichier source Sinch associé à chaque point.
2. **Tableau historique complet :** Récapitule les versions antérieures enregistrées pour cet opérateur.

### C. Fenêtre « Mon Compte & Collaborateurs » avec Rubriques
Le menu profil en haut à droite ouvre un panneau unifié à 4 rubriques :
* **👥 Collaborateurs :** Tableau des accès d'équipe avec statut et suppression (Admin).
* **➕ Ajouter un accès :** Formulaire de création de compte avec sélection de rôle (Admin).
* **🔑 Mot de passe & Sécurité :** Formulaire de mise à jour du mot de passe personnel.
* **ℹ️ Mes informations :** Récapitulatif de la session active et des droits accordés.
* **🚪 Déconnexion :** Bouton de fermeture de session sécurisée.

### D. Compatibilité Reverse Proxy (`apiUrl`)
Toutes les requêtes d'API s'adaptent dynamiquement au chemin racine grâce à la fonction `apiUrl`, garantissant un fonctionnement parfait en local (`http://localhost:3000/`) ou derrière le reverse proxy sous préfixe (`https://vm.inspear.org/dmc/`). Un mécanisme de rafraîchissement automatique en arrière-plan interroge l'API toutes les 30 secondes pour actualiser les données sans rechargement de page.

---

## 7. Module d'Export Facturation (`src/export.js`)

Le module [`src/export.js`](src/export.js) convertit le référentiel actif en un document CSV directement exploitable par les outils de facturation et Microsoft Excel.

### Formule de Calcul
$$\text{Tarif\_Facture\_Client\_EUR} = \text{Tarif\_Achat\_Sinch\_EUR} \times \left(1 + \frac{\text{Marge\_Appliquée\_\%}}{100}\right)$$

### Spécifications du Fichier Généré :
* **Encodage :** UTF-8 avec BOM (`﻿`) pour un affichage immédiat et parfait des caractères accentués sous Excel sans manipulation d'importation.
* **Séparateur :** Point-virgule (`;`), standard des versions françaises d'Excel.
* **Colonnes produites :**
  `Pays ; Operateur ; Reseau ; Indicatif_Tel ; MCC ; MNC ; Tarif_Achat_Sinch_EUR ; Marge_Appliquee_Pct ; Tarif_Facture_Client_EUR ; Variation_Recente_EUR ; Variation_Recente_Pct ; Date_Entree_Vigueur ; Ref_Produit_Sinch`

---

## 8. Déploiement & Exploitation sur la VM Ubuntu

### A. Configuration du Reverse Proxy Nginx
Le fichier [deploy/nginx/default](deploy/nginx/default) configure l'accès HTTPS public sur le domaine `vm.inspear.org` en relayant le sous-chemin `/dmc/` vers le port local de l'application (`3002`) :

```nginx
server {
    listen 443 ssl;
    server_name vm.inspear.org;

    ssl_certificate /etc/letsencrypt/live/vm.inspear.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vm.inspear.org/privkey.pem;

    location = /dmc {
        return 301 /dmc/;
    }

    location /dmc/ {
        proxy_pass http://127.0.0.1:3002/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Le script [`scripts/apply_nginx.sh`](scripts/apply_nginx.sh) permet de déployer et de recharger cette configuration en une seule commande.

### B. Script de Redémarrage et Mise à Jour (`scripts/restart.sh`)
Ce script automatise l'alignement sur le dépôt Git et la relance propre du service sur la VM :
```bash
bash scripts/restart.sh
```
1. Télécharge les derniers commits et force l'alignement (`git fetch origin && git reset --hard origin/main`).
2. Vérifie et initialise `data/mail_config.json` si absent.
3. Arrête proprement tout ancien processus sur le port 3002 (`fuser -k 3002/tcp`).
4. Lance le nouveau serveur avec `PORT=3002 HOST=0.0.0.0 node src/server.js` en tâche de fond.
5. Effectue un test de santé HTTP (`curl -I http://localhost:3002`) et confirme le statut `200 OK`.

### C. Maintien en Service 24h/24 via PM2
Pour que l'application reste active en permanence (y compris pour la relève automatique de 02h00) :
```bash
npm install -g pm2
pm2 start src/server.js --name "dmc-sms-pricing" --env PORT=3002,HOST=0.0.0.0
pm2 save
pm2 startup
```

---

## 9. Jeux de Données & Tests Automatisés

### A. Jeux de Données de Test (`data/test_samples/`)
Le dossier `data/test_samples/` met à disposition des fichiers prêts à l'emploi documentés dans [README_TESTS.md](data/test_samples/README_TESTS.md) :
* **`01_notification_hausses_baisses_valide.csv` :** 15 opérateurs représentatifs (10 hausses, 5 baisses) pour tester l'animation des badges et l'historisation sans modifier le total de 913 destinations.
* **`02_notification_destinations_internationales.csv` :** Variations sur l'Afrique, l'Asie et l'Amérique Latine.
* **`03_fichier_invalide_colonnes_manquantes.csv` :** Colonnes tronquées pour tester le rejet et le déclenchement de l'alerte email.
* **`04_fichier_vide_ou_corrompu.csv` :** Données non numériques ou négatives pour valider la robustesse du parseur.
* **`djezzy_etape1_novembre.csv` & `djezzy_etape2_decembre.csv` :** Deux fichiers consécutifs pour tester la trajectoire multi-points sur une même destination (hausse puis baisse).

### B. Suite de Tests Automatisés (`test/run-tests.js`)
L'application intègre **38 tests unitaires et d'intégration** exécutables sans aucune connexion réseau :
```bash
npm test
```
* **Section 1 :** Ingestion et parsing CSV (séparateurs, BOM, apostrophes, décimales françaises, normalisation des dates, clés uniques).
* **Section 2 :** Calcul des hausses/baisses, archivage automatique, restauration et suppression d'archive.
* **Section 3 :** Export facturation, respect des marges commerciales et réinitialisation au catalogue officiel.
* **Section 4 :** Connecteur mail, extraction récursive MIME, filtres d'expéditeurs Sinch, filtres d'images de signature et simulateur d'alertes.
* **Section 5 :** Sécurité, hachage scrypt, robustesse timingSafeEqual, création d'utilisateurs, gestion des rôles et jetons de session.
