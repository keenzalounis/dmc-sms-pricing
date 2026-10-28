# Expression des Besoins (EB) - Module DMC Tarification SMS Sinch & Facturation

| Document | Expression des Besoins (EB) |
| :--- | :--- |
| **Projet** | DMC (Direct Marketing / Digital Message Center) - SFR Business |
| **Sujet** | Intégration en direct de l'API Sinch, historisation des tarifs SMS internationaux et restitution pour l'équipe Facturation |
| **Auteur** | Équipe Technique DMC / SFR Business |
| **Destinataire** | Pôle Facturation / Équipe DMC SFR Business |
| **Version** | 1.1 (Priorité 1bis DMC) |
| **Date** | Octobre 2026 |
| **Statut** | **Opérationnel — Conforme aux besoins DMC & Facturation** |

---

## 1. Contexte & Périmètre de la Priorité 1bis

### 1.1 Contexte Général DMC
La plateforme **DMC** de SFR Business permet l'acheminement de millions de SMS transactionnels (codes OTP, alertes bancaires) et marketing pour le compte de grands comptes et entreprises :
- **En France métropolitaine**, les flux sont routés directement sur les réseaux nationaux SFR, Orange, Bouygues et Free avec des coûts de terminaison régulés et stables.
- **À l'international**, SFR s'appuie sur son agrégateur mondial **Sinch** pour délivrer les SMS vers l'ensemble des opérateurs des 5 continents.

### 1.2 Objectif Spécifique « Priorité 1bis »
Jusqu'à présent, la mise à jour des prix d'achat Sinch reposait exclusivement sur des emails de notification périodiques (`PriceChangeNotification.csv`) reçus par SFR, nécessitant une manipulation manuelle et introduisant des délais de prise en compte dans la facturation client.

La **Priorité 1bis** vise à :
1. **Intégrer directement l'API REST de Sinch** pour récupérer les tarifs SMS par pays et par opérateur en temps réel.
2. **Conserver la double compatibilité** : ingestion en direct via API Sinch REST ET ingestion des fichiers CSV de notification par email.
3. **Fournir un mode simulation / bac à sable** garantissant le fonctionnement continu de la plateforme et des tests même hors connexion ou avant obtention des clés API définitives de production.
4. **Mettre à disposition de l'équipe Facturation une documentation complète et un Mode Opératoire (MODOP)** opérationnel pas-à-pas pour la récupération des grilles tarifaires et l'application des marges commerciales.

---

## 2. Architecture de la Solution Enrichie (v1.1)

L'architecture est déployée sur une **machine virtuelle Ubuntu Linux** d'exploitation SFR Business :

```
                        ┌─────────────────────────────────────────────────────────┐
                        │                   SOURCES DE DONNÉES                    │
                        │                                                         │
                        │  1. API Sinch REST (GET /xms/v1/{service_plan_id}/rates)│
                        │  2. Fichiers CSV Sinch (PriceChangeNotification.csv)    │
                        │  3. Catalogue initial de référence (base_tarifs.csv)    │
                        └────────────────────────────┬────────────────────────────┘
                                                     │
                                                     ▼
     ┌────────────────────────────────────────────────────────────────────────────────────────┐
     │                     MOTEUR D'INGESTION, HISTORISATION ET SYNCHRO                       │
     │                                                                                        │
     │  • src/sinch-api.js : Connecteur HTTPS natif vers API Sinch (Bearer Token, Retry,      │
     │                       fallback mock sandbox, normalisation multi-pays)                 │
     │  • src/ingest.js    : Parseur CSV universel, calcul des deltas (€ et %),               │
     │                       détection hausses/baisses, normalisation ISO dates               │
     │  • data/database.json : Référentiel centralisé unifié (tarifs actuels + historique)   │
     └───────────────────────────────────────┬────────────────────────────────────────────────┘
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       ▼                                           ▼
┌──────────────────────────────────────────────┐  ┌─────────────────────────────────────────┐
│            SERVEUR HTTP & API REST           │  │             MODULE FACTURATION          │
│                (src/server.js)               │  │              (src/export.js)            │
│                                              │  │                                         │
│ - Port 3000 (configurable via PORT)          │  │ - Export Excel FR (point-virgule)       │
│ - GET  /api/stats    : KPI globaux           │  │ - Encodage UTF-8 avec BOM officiel      │
│ - GET  /api/prices   : Recherche & filtres   │  │ - Application de marge commerciale (%)  │
│ - GET  /api/history  : Courbe historique     │  │ - Filtre pays ou export global          │
│ - GET  /api/sinch/status : État synchro API  │  │ - Fichier prêt à l'emploi pour le       │
│ - POST /api/sinch/sync   : Déclenchement API │  │   pôle facturation SFR Business         │
│ - POST /api/charts/generate : Graphes Python │  └─────────────────────────────────────────┘
│ - Web Dashboard interactif avec Canvas       │
└──────────────────────────────────────────────┘
```

### Points forts de l'implémentation :
- **Zéro dépendance npm pour le cœur applicatif** : Fonctionne avec les modules natifs Node.js (`https`, `http`, `fs`, `path`, `url`). Déploiement instantané sur VM Ubuntu sans blocage par proxy d'entreprise.
- **Résilience et Fallback automatique** : Si l'API Sinch est temporairement indisponible ou en l'absence de credentials, le système bascule sur le cache local ou le mock sandbox sans interrompre le service ni la facturation.
- **Historisation exhaustive** : Chaque changement de prix conserve son horodatage, sa date d'effet, son tarif antérieur, son delta et sa source (`sinch_api`, `PriceChangeNotification.csv`, ou `base_initiale`).

---

## 3. Spécifications Techniques de l'Intégration API Sinch

### 3.1 Endpoint & Authentification Sinch
- **Base URL :** `https://sms.api.sinch.com` *(configurable via `SINCH_BASE_URL`)*
- **Endpoint Tarifs SMS :** `GET /xms/v1/{service_plan_id}/rates`
- **Filtre pays optionnel :** `GET /xms/v1/{service_plan_id}/rates?country={code_pays}`
- **Authentification :** En-tête HTTP standard :
  ```http
  Authorization: Bearer <SINCH_API_TOKEN>
  ```
- **Identifiants requis :**
  1. `servicePlanId` : Identifiant du contrat / sous-compte SMS Sinch.
  2. `apiToken` : Clé d'API secrète générée sur le portail Sinch Customer Dashboard.

### 3.2 Format de Réponse Sinch & Normalisation SFR
L'API Sinch renvoie une liste d'objets tarifaires. Le module `src/sinch-api.js` les normalise automatiquement selon le modèle universel du projet :

```json
{
  "id": "san_marino__san_marino_telecom__292_01",
  "country": "San Marino",
  "operator": "San Marino Telecom",
  "network": "San Marino Telecom",
  "cc": "+378",
  "mcc": "292",
  "mnc": "01",
  "currentPrice": 0.07700,
  "previousPrice": 0.04510,
  "priceChange": 0.03190,
  "percentChange": 70.73,
  "validFrom": "2026-10-27",
  "lastSyncSource": "sinch_rest_api_live",
  "history": [
    { "date": "2026-09-01", "price": 0.04510, "source": "base_tarifs.csv" },
    { "date": "2026-10-27", "price": 0.07700, "oldPrice": 0.04510, "source": "sinch_api" }
  ]
}
```

### 3.3 Déclencheurs de Synchronisation
Trois modes de déclenchement sont disponibles :
1. **Interface Web :** Bouton **« 🌐 API Sinch »** dans la barre supérieure du tableau de bord.
2. **API REST :** Appel `POST http://localhost:3000/api/sinch/sync` (intégrable dans tout ordonnanceur).
3. **Ligne de commande CLI / Cron VM :** `npm run sync:sinch` ou `node src/sinch-api.js --sync`.

---

## 4. Modalités de Restitution pour l'Équipe Facturation

L'équipe Facturation dispose de 3 canaux de récupération :

| Canal | Public Cible | Description | Format |
| :--- | :--- | :--- | :--- |
| **Portail Web DMC** | Gestionnaires ADV & Facturation | Téléchargement en 1 clic avec choix du % de marge et filtre pays | CSV Excel FR (`;`, UTF-8 BOM) |
| **API REST `/api/export`** | Systèmes d'information SFR / Scripts | Récupération programmatique avec paramètre `?margin=15` | Flux CSV direct HTTP |
| **Génération locale VM** | Ordonnanceur batch SFR | Commande `node src/export.js --margin=15 --out=...` | Fichier CSV sur disque/NFS |

---

## 5. Automatisation sur la VM : Boîte Email Dédiée & Réception des Mises à Jour

Afin d'automatiser complètement la chaîne de mise à jour des tarifs sur la VM Ubuntu sans intervention manuelle quotidienne :

### 5.1 Création d'une Boîte Email Générique Dédiée
Une adresse email de service dédiée (ex: `dmc-tarifs-sinch@sfr.com`) est configurée auprès de l'agrégateur Sinch pour recevoir automatiquement :
- Les notifications de variations tarifaires avec pièces jointes CSV (`PriceChangeNotification.csv`).
- Les alertes de modifications de grille internationale.

### 5.2 Deux Mécanismes de Connexion & d'Ingestion sur la VM

#### Option A : Webhook Entrant HTTP (Automatique temps réel)
Un flux automatisé (ex: connecteur Microsoft Power Automate / Logic Apps ou passerelle mail SFR) extrait la pièce jointe dès réception du mail et la transmet directement à l'API du serveur sur la VM :
- **Endpoint Webhook :** `POST http://<IP_VM>:3000/api/upload`
- **Format accepté :** `multipart/form-data` ou contenu CSV brut (`text/csv`).
- **Comportement :** L'ingestion se déclenche instantanément, met à jour `data/database.json`, calcule les deltas de prix (€ et %) et met à jour l'historique sans redémarrer le serveur.

#### Option B : Script de Relève IMAP / Dossier Surveillé sur la VM
Si le protocole IMAP est préféré sur la VM Ubuntu :
1. Un script léger planifié via Cron interroge la boîte aux lettres sécurisée en IMAPS (TLS port 993).
2. Il télécharge automatiquement tout fichier CSV reçu dans le dossier `data/updates/`.
3. Il exécute immédiatement la commande :
   ```bash
   node src/ingest.js data/updates/PriceChangeNotification_YYYYMMDD.csv
   ```
4. Les tarifs sont fusionnés et historisés immédiatement.

### 5.3 Double Source : API Sinch en Direct & Fichiers CSV
La solution garantit une robustesse maximale grâce à la redondance des sources :
1. **API Sinch en direct (`src/sinch-api.js`) :** Interrogeable à tout moment ou planifiable via cron (`npm run sync:sinch`) pour rafraîchir tous les tarifs par pays/opérateur.
2. **Notifications CSV par mail :** Ingestion automatique dès réception pour intégrer les dates d'effet futures (`Valid From`) annoncées par Sinch.
3. **Mock Sandbox / Airtable :** Permet d'alimenter la plateforme avec des données de simulation lors des tests de bout en bout sur la VM avant branchement final.

---

## 6. Circuit de Facturation & Restitution Client

1. **Extraction par le pôle Facturation :**
   - Téléchargement du CSV via l'interface web avec application de la marge commerciale (ex: 15% ou 20%).
   - Ou récupération automatique via l'API REST `GET /api/export?margin=15`.
2. **Format livré au pôle Facturation :**
   - CSV encodé en **UTF-8 avec BOM**, séparateur **point-virgule (`;`)**, directement lisible sous Microsoft Excel français.
   - Colonnes : `Pays`, `Operateur`, `Reseau`, `Indicatif_Tel`, `MCC`, `MNC`, `Tarif_Achat_Sinch_EUR`, `Marge_Appliquee_Pct`, `Tarif_Facture_Client_EUR`, `Variation_Recente_EUR`, `Variation_Recente_Pct`, `Date_Entree_Vigueur`, `Ref_Produit_Sinch`.
3. **Traçabilité & Historique :**
   - Conservation intégrale de l'historique pour justifier toute évolution tarifaire auprès des clients finaux ou de la direction financière.
