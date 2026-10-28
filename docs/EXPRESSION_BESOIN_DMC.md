# Expression des Besoins (EB) - Module DMC Tarification SMS Sinch

| Document | Expression des Besoins (EB) |
| :--- | :--- |
| **Projet** | DMC (Direct Marketing / Digital Message Center) |
| **Sujet** | Intégration, historisation et restitution des tarifs SMS internationaux Sinch |
| **Auteur** | Équipe DMC / SFR Business |
| **Destinataire** | Gabriel / Direction de Projet / Pôle Facturation |
| **Version** | 1.0 |
| **Date** | Octobre 2026 |
| **Statut** | En attente de validation / Alignement avec Gabriel |

---

## 1. Contexte & Problématique Métier

### 1.1 Le Service DMC & les SMS Internationaux
La plateforme **DMC** permet l'envoi de SMS en masse et de notifications pour les clients entreprises SFR Business. 
- **En France métropolitaine**, les coûts d'acheminement et de terminaison d'appel sont fixes et stables.
- **À l'international**, SFR s'appuie sur son partenaire agrégateur **Sinch** pour router les SMS vers l'ensemble des opérateurs mondiaux.

### 1.2 Le Problème Identifié
1. **Forte volatilité des prix :** Les prix d'achat Sinch varient fréquemment en fonction des accords d'interconnexion locaux et des devises.
2. **Traitement manuel fastidieux :** Les nouvelles grilles tarifaires arrivent périodiquement sous forme de notifications par email avec des pièces jointes CSV (`PriceChangeNotification.csv`).
3. **Risque de marge négative ou sous-facturation :** Sans système centralisé et automatisé, le pôle Facturation ne dispose pas en temps réel des tarifs d'achat à jour, ce qui rend difficile la tarification juste des clients finaux.
4. **Absence d'historique visuel :** Impossible d'anticiper les tendances ni de visualiser l'historique d'évolution des tarifs sur un pays ou un opérateur donné.

---

## 2. Objectifs du Projet

1. **Centraliser le référentiel tarifaire :** Avoir une source unique et fiable contenant les prix d'achat actuels par pays et par opérateur.
2. **Historiser l'ensemble des variations :** Conserver la trace de chaque changement de prix avec sa date de prise d'effet (`Valid From`) et la source du fichier.
3. **Mettre à disposition de la Facturation :** Fournir un export CSV/Excel directement exploitable par l'équipe Facturation, avec possibilité d'appliquer une marge commerciale automatique.
4. **Visualiser l'évolution :** Proposer un tableau de bord web interactif permettant de chercher un pays, un opérateur, un indicatif ou un code MCC/MNC et d'afficher le graphe d'évolution des prix dans le temps.
5. **Automatiser l'ingestion sur VM :** Permettre à terme l'ingestion automatique dès réception d'un mail de mise à jour sur une adresse générique dédiée.

---

## 3. Description des Données Sinch

Les fichiers fournis par Sinch (ex: `PriceChangeNotification.csv`) possèdent la structure suivante :

| Champ Sinch | Description | Exemple |
| :--- | :--- | :--- |
| `Product` | Référence de l'offre technique / contrat Sinch | `SFRBu_20260914193312096_ra` |
| `Country` | Pays de destination du SMS | `San Marino` |
| `Operator` | Nom commercial de l'opérateur local | `San Marino Telecom` |
| `Network` | Nom du réseau télécom | `San Marino Telecom` |
| `CC` | Indicatif téléphonique international (Country Code) | `+378` |
| `MCC` | Mobile Country Code (Code pays UIT) | `292` |
| `MNC` | Mobile Network Code (Code opérateur local) | `01` |
| `Old Price` | Ancien tarif d'achat HT (€) | `0.04510` |
| `New Price` | Nouveau tarif d'achat HT (€) | `0.07700` |
| `Valid From`| Date d'entrée en vigueur de la modification | `Oct 27 2026` / `2026-10-27` |

> **Remarque clé :** La combinaison du **MCC** et du **MNC** constitue l'identifiant télécom universel d'un opérateur mobile.

---

## 4. Architecture de la Solution Développée

L'application a été conçue pour tourner de manière autonome et sécurisée sur une **machine virtuelle Ubuntu Linux** :

```
             ┌──────────────────────────────────────────────┐
             │               SOURCES DE DONNÉES             │
             │ - base_tarifs.csv (catalogue initial)        │
             │ - PriceChangeNotification.csv (emails Sinch) │
             │ - API Sinch REST (si accès direct accordé)   │
             └──────────────────────┬───────────────────────┘
                                    │
                                    ▼
             ┌──────────────────────────────────────────────┐
             │      MOTEUR D'INGESTION & HISTORISATION      │
             │               (src/ingest.js)                │
             │ - Parsing universel CSV (sans dépendance)    │
             │ - Normalisation des dates (timezone safe)    │
             │ - Calcul automatique des deltas (€ et %)     │
             │ - Alimentation du fichier data/database.json │
             └──────────────────────┬───────────────────────┘
                                    │
                   ┌────────────────┴────────────────┐
                   ▼                                 ▼
┌──────────────────────────────────────┐  ┌────────────────────────────────────┐
│         SERVEUR WEB & API            │  │          MODULE EXPORT             │
│          (src/server.js)             │  │         (src/export.js)            │
│ - Port 3000 (configurable)           │  │ - Format Excel FR (Point-virgule)  │
│ - API /api/prices, /api/history      │  │ - Encodage UTF-8 BOM               │
│ - Dashboard Web avec Chart Canvas    │  │ - Calcul marge commerciale (%)     │
└──────────────────────────────────────┘  └────────────────────────────────────┘
```

### Avantages de l'implémentation :
- **Zéro dépendance npm externe :** Utilise exclusivement les modules natifs Node.js (`http`, `fs`, `path`, `url`). Ne nécessite aucun `npm install` sur la VM Ubuntu, ce qui évite tout blocage lié aux proxys d'entreprise.
- **Fonctionnement 100% hors-ligne :** Le tracé des courbes utilise le canvas HTML5 natif (aucun chargement de bibliothèque CDN externe).

---

## 5. Fonctionnalités Livrées

1. **Tableau de bord de suivi :**
   - KPI globaux : total de destinations, coût moyen d'un SMS, nombre de hausses tarifaires détectées.
   - Barre de recherche instantanée par nom de pays, nom d'opérateur, indicatif téléphonique (+33, +378...), ou code MCC/MNC.
   - Badges colorés de variation : rouge pour les hausses, vert pour les baisses, gris pour les tarifs stables.
2. **Graphe interactif d'évolution :**
   - Visualisation de la courbe des prix dans le temps pour chaque opérateur.
   - Tableau récapitulatif chronologique des changements de prix et de la source de la modification.
3. **Module d'exportation pour la Facturation :**
   - Bouton de génération immédiate d'un CSV compatible Excel français.
   - Possibilité de spécifier une marge commerciale personnalisée (ex: 15% pour calculer automatiquement le `Tarif_Facture_Client_EUR`).
4. **Zone d'import / Ingestion manuelle et automatique :**
   - Glisser-déposer d'un nouveau fichier `PriceChangeNotification.csv` depuis l'interface web.
   - Ligne de commande CLI disponible pour l'automatisation par cron sur la VM (`node src/ingest.js chemin/vers/fichier.csv`).

---

## 6. Questions et Arbitrages pour Gabriel

Lors de notre point avec Gabriel, voici les 4 questions clés à valider :

1. **Automatisation de la réception email :**
   - Est-ce qu'une adresse email générique (ex: `dmc-sinch-pricing@sfr.com`) a été validée par les équipes réseau / sécurité ?
   - Doit-on mettre en place un script IMAP qui scrute cette boîte aux lettres sur la VM Ubuntu, ou un webhook reçu d'un service type O365 / Power Automate ?
2. **Marge commerciale par défaut :**
   - Quelle est la marge commerciale de base à appliquer pour les SMS internationaux dans DMC (ex: coût réel d'achat + X % ou montant forfaitaire par SMS) ?
3. **Format d'export privilégié pour la facturation :**
   - Le fichier CSV séparateur point-virgule avec encodage UTF-8 BOM généré convient-il à l'équipe facturation, ou préfèrent-ils un format particulier / une API directe ?
4. **Accès API directe Sinch :**
   - Disposons-nous de credentials pour l'API REST Sinch (clé API / secret) pour interroger les prix en direct plutôt que d'attendre les emails de notification ?
