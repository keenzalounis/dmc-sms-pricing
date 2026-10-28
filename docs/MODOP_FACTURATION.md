# Mode Opératoire (MODOP) - Récupération des Tarifs SMS Internationaux DMC

| Métadonnées | Détails |
| :--- | :--- |
| **Document** | Mode Opératoire (MODOP) Utilisateur & Exploitation |
| **Projet** | DMC (Direct Marketing / Digital Message Center) |
| **Sujet** | Procédure de récupération, d'audit et d'exportation des tarifs SMS Sinch pour la facturation |
| **Destinataires** | Pôle Facturation, Administration des Ventes (ADV), Contrôle de Gestion SFR Business |
| **Version** | 1.1 (Priorité 1bis - API Sinch en temps réel) |
| **Date** | Octobre 2026 |
| **Application** | DMC SMS Pricing (Serveur VM Ubuntu port 3000) |

---

## 📋 Sommaire

1. [Introduction & Rôle du Document](#1-introduction--rôle-du-document)
2. [Vue d'Ensemble du Circuit Tarifaire DMC](#2-vue-densemble-du-circuit-tarifaire-dmc)
3. [Accès à la Plateforme](#3-accès-à-la-plateforme)
4. [Procédure 1 : Synchroniser les Prix SMS via l'API Sinch](#4-procédure-1--synchroniser-les-prix-sms-via-lapi-sinch)
5. [Procédure 2 : Rechercher et Auditer un Tarif International](#5-procédure-2--rechercher-et-auditer-un-tarif-international)
6. [Procédure 3 : Exporter la Grille Facturation vers Excel (avec Marge)](#6-procédure-3--exporter-la-grille-facturation-vers-excel-avec-marge)
7. [Procédure 4 : Récupération Automatisée (CLI VM & API REST)](#7-procédure-4--récupération-automatisée-cli-vm--api-rest)
8. [Checklist de Contrôle Avant Clôture de Facturation](#8-checklist-de-contrôle-avant-clôture-de-facturation)
9. [Dictionnaire des Données de l'Export Facturation](#9-dictionnaire-des-données-de-lexport-facturation)
10. [Formule de Calcul de la Marge Commerciale](#10-formule-de-calcul-de-la-marge-commerciale)
11. [Assistance & Escalade Support](#11-assistance--escalade-support)

---

## 1. Introduction & Rôle du Document

Ce guide opérationnel est destiné aux équipes de **Facturation**, de l'**ADV** et du **Contrôle de Gestion** de SFR Business.

Il décrit pas à pas la démarche pour :
- **Récupérer en temps réel** les derniers coûts d'achat des SMS internationaux directement auprès de l'API de notre partenaire Sinch.
- **Identifier immédiatement les hausses ou baisses tarifaires** pour prévenir tout risque de sous-facturation ou de marge négative sur les campagnes DMC de nos clients.
- **Générer un export Excel officiel** avec l'application automatique de la marge commerciale SFR Business, prêt pour injection dans les outils de facturation.

---

## 2. Vue d'Ensemble du Circuit Tarifaire DMC

```
┌─────────────────────────────────┐
│     PARTENAIRE SINCH            │
│  - API REST en temps réel       │
│  - Notifications CSV par email  │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│   PLATEFORME DMC SMS PRICING    │
│  - Référentiel centralisé       │
│  - Historisation des variations │
│  - Détection automatique hausses│
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│   ÉQUIPE FACTURATION / ADV      │
│  - Contrôle et validation       │
│  - Choix de la marge client (%) │
│  - Export CSV compatible Excel  │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│    SI FACTURATION SFR CLIENT    │
│  - Factures mensuelles émises   │
│  - Marge commerciale sécurisée  │
└─────────────────────────────────┘
```

---

## 3. Accès à la Plateforme

L'application est accessible sans installation sur votre poste de travail (compatible Google Chrome et Microsoft Edge) via le réseau interne SFR ou VPN :

- **URL de production (VM Ubuntu) :** `http://<IP_DE_LA_VM_UBUNTU>:3000`
- **URL d'environnement local / qualification :** `http://localhost:3000`

---

## 4. Procédure 1 : Synchroniser les Prix SMS via l'API Sinch

Grâce au développement de la **Priorité 1bis**, vous n'avez plus besoin d'attendre la réception manuelle d'un email pour disposer des derniers tarifs en vigueur.

### Étapes à suivre :
1. Connectez-vous sur le tableau de bord DMC SMS Pricing.
2. Dans la barre supérieure, cliquez sur le bouton **« 🌐 API Sinch »**.
3. Une fenêtre modale s'affiche avec le statut de la connexion :
   - Badge vert **● En direct Sinch API** : la plateforme est reliée à l'API officielle Sinch.
   - Badge orange **○ Bac à sable / Mock actif** : mode de simulation sécurisé (utilisé en qualification ou si les clés de production sont en cours de renouvellement).
4. *(Optionnel)* Cochez **« Mode Simulation / Sandbox »** si vous souhaitez tester la synchronisation sans appel réseau externe.
5. Cliquez sur le bouton bleu **« 🔄 Lancer la Synchronisation »**.
6. En quelques secondes, le résultat s'affiche en vert :
   - Nombre total de tarifs pays récupérés.
   - Nombre de nouvelles destinations créées.
   - Nombre de prix mis à jour avec le détail des variations.
7. Fermez la fenêtre : le tableau et les indicateurs KPI sont immédiatement actualisés.

> **Note de bascule de secours :** Si un fichier `PriceChangeNotification.csv` est exceptionnellement envoyé par email par Sinch, vous pouvez toujours l'ingérer manuellement via le bouton **« Importer un CSV Sinch »**.

---

## 5. Procédure 2 : Rechercher et Auditer un Tarif International

### 5.1 Recherche rapide d'une destination
Dans la barre de recherche au centre de l'écran, saisissez :
- Soit le **nom du pays** (ex: `San Marino`, `Spain`, `Morocco`...)
- Soit le **nom de l'opérateur** (ex: `Telefonica`, `Vodafone`, `Orange`...)
- Soit l'**indicatif téléphonique** (ex: `+378`, `+34`, `+212`...)
- Soit le couple télécom **MCC / MNC** (ex: `292/01`, `214/07`...)

Le filtrage se fait en temps réel.

### 5.2 Comprendre les indicateurs visuels
- **Tarif Actuel (€) :** Coût d'achat unitaire brut HT facturé par Sinch à SFR.
- **Variation :**
  - Badge rouge **▲ +X% (+0.0XXX€)** : Prix en hausse. Vigilance requise sur les devis clients !
  - Badge vert **▼ -X% (-0.0XXX€)** : Prix en baisse. Gain de compétitivité.
  - Badge gris **Stable** : Tarif inchangé par rapport à la dernière mise à jour.

### 5.3 Consulter l'historique d'évolution dans le temps
1. Cliquez sur le bouton **« 📈 Graphe »** situé à droite de la ligne souhaitée.
2. La fenêtre présente :
   - Le graphique dynamique Canvas avec la courbe chronologique du prix.
   - Le tableau détaillé sous la courbe avec chaque date d'effet, l'ancien prix, le nouveau prix et la source (API Sinch ou CSV).
   - Ce tableau permet de justifier formellement auprès d'un client toute répercussion de hausse tarifaire.

### 5.4 Rapports et synthèses haute définition (Python)
Pour les comités de direction ou les bilans mensuels de facturation :
1. Cliquez sur **« 📊 Rapports Python »** dans l'en-tête.
2. Cliquez sur **« ⚡ Régénérer les graphiques avec Python »**.
3. Vous pouvez visualiser et télécharger en HD (300 DPI) :
   - Le Top des variations récentes (hausses/baisses en %).
   - Le comparatif des tarifs d'achat par destination.
   - L'évolution chronologique complète.
   - La synthèse exécutive prête à imprimer au format A4.

---

## 6. Procédure 3 : Exporter la Grille Facturation vers Excel (avec Marge)

C'est l'étape clé pour alimenter les outils de facturation SFR Business à chaque clôture mensuelle.

### 6.1 Étapes d'exportation
1. Cliquez sur le bouton rouge **« Export Facturation »** en haut à droite.
2. Dans la boîte de dialogue :
   - **Marge commerciale à appliquer (%) :** Saisissez le taux de marge validé avec la direction commerciale (ex: `15` pour 15%, `20` pour 20%). Saisissez `0` si vous souhaitez uniquement les coûts d'achat stricts.
   - **Filtrer par pays (optionnel) :** Laissez le champ vide pour exporter l'ensemble des destinations mondiales, ou saisissez un nom de pays pour un chiffrage spécifique.
3. Cliquez sur **« Télécharger le fichier CSV »**.
4. Le fichier est automatiquement téléchargé avec le nommage normé :
   `export_facturation_dmc_AAAA-MM-JJ.csv` (ex: `export_facturation_dmc_2026-10-28.csv`).

### 6.2 Ouverture dans Microsoft Excel
- Le fichier utilise nativement le **séparateur point-virgule (`;`)** et l'encodage **UTF-8 avec BOM**.
- Double-cliquez simplement sur le fichier téléchargé : **Microsoft Excel l'ouvre directement avec les colonnes bien alignées et les accents préservés**, sans passer par l'assistant d'importation de texte.

---

## 7. Procédure 4 : Récupération Automatisée (CLI VM & API REST)

Pour les équipes souhaitant automatiser l'intégration directement dans l'ERP de facturation SFR :

### 7.1 Via l'API REST Directe (Recommandé pour les scripts et SI)
Effectuez une requête HTTP GET vers le serveur :

```bash
# Export mondial avec 15% de marge
curl -O -J "http://<IP_VM>:3000/api/export?margin=15"

# Export spécifique pour l'Espagne avec 20% de marge
curl -O -J "http://<IP_VM>:3000/api/export?margin=20&country=Spain"
```

### 7.2 Via la Ligne de Commande sur la VM Ubuntu
Connectez-vous en SSH sur la machine virtuelle :

```bash
cd /opt/dmc-sms-pricing  # ou votre répertoire d'installation

# 1. Forcer la synchronisation avec l'API Sinch
npm run sync:sinch

# 2. Générer le fichier CSV avec 15% de marge
node src/export.js --margin=15 --out=data/export_facturation_mensuelle.csv
```

### 7.3 Automatisation par tâche planifiée (Cron)
Pour synchroniser automatiquement les prix tous les lundis à 04h00 et générer l'export :

```cron
0 4 * * 1 cd /opt/dmc-sms-pricing && npm run sync:sinch >> /var/log/dmc_sinch_sync.log 2>&1
30 4 * * 1 cd /opt/dmc-sms-pricing && node src/export.js --margin=15 >> /var/log/dmc_export.log 2>&1
```

---

## 8. Checklist de Contrôle Avant Clôture de Facturation

Avant d'injecter la grille dans le système de facturation client, l'analyste facturation doit vérifier les 5 points suivants :

- [ ] **1. Date de dernière synchronisation :** Vérifier dans le bandeau KPI que la dernière synchronisation date de moins de 7 jours.
- [ ] **2. Alerte fortes hausses :** Consulter la colonne « Variation ». Si une hausse dépasse **+20%**, vérifier auprès du chef de produit DMC si le tarif client doit être réajusté ou bloqué.
- [ ] **3. Cohérence du prix moyen :** Contrôler que le prix moyen affiché dans le KPI se situe dans la fourchette habituelle (entre 0,035 € et 0,055 €).
- [ ] **4. Vérification du taux de marge :** S'assurer que le taux de marge appliqué lors de l'export correspond bien à la directive commerciale du mois en cours.
- [ ] **5. Contrôle du nombre de lignes :** L'export doit contenir l'ensemble des pays d'activité (au minimum 14 destinations principales).

---

## 9. Dictionnaire des Données de l'Export Facturation

| Colonne Excel | Format | Description Métier | Exemple |
| :--- | :--- | :--- | :--- |
| `Pays` | Texte | Pays de destination du message SMS | `San Marino` |
| `Operateur` | Texte | Nom de l'opérateur de réseau mobile local | `San Marino Telecom` |
| `Reseau` | Texte | Nom technique du réseau télécom | `San Marino Telecom` |
| `Indicatif_Tel` | Texte | Préfixe international | `+378` |
| `MCC` | Code 3 car. | Mobile Country Code (Code UIT du pays) | `292` |
| `MNC` | Code 2-3 car. | Mobile Network Code (Code réseau opérateur) | `01` |
| `Tarif_Achat_Sinch_EUR` | Numérique (5 déc.) | **Coût d'achat brut unitaire HT facturé par Sinch à SFR** | `0.07700` |
| `Marge_Appliquee_Pct` | Numérique | Taux de marge commerciale appliqué (%) | `15` |
| `Tarif_Facture_Client_EUR` | Numérique (5 déc.) | **Tarif unitaire HT conseillé pour la facturation au client final** | `0.08855` |
| `Variation_Recente_EUR` | Numérique (signé) | Écart en euros par rapport au tarif d'achat précédent | `+0.03190` |
| `Variation_Recente_Pct` | Texte | Évolution en pourcentage | `+70.73%` |
| `Date_Entree_Vigueur` | Date AAAA-MM-JJ | Date officielle de prise d'effet du tarif Sinch | `2026-10-27` |
| `Ref_Produit_Sinch` | Texte | Référence de l'offre ou identifiant API Sinch | `SFRBu_20261008053302366_ra` |

---

## 10. Formule de Calcul de la Marge Commerciale

Le calcul du tarif facturé au client final est strictement défini par la formule mathématique suivante :

$$\text{Tarif\_Facture\_Client\_EUR} = \text{Tarif\_Achat\_Sinch\_EUR} \times \left(1 + \frac{\text{Marge\_Appliquée\_Pct}}{100}\right)$$

### Exemples d'application :
1. **San Marino (Achat Sinch = 0,07700 €, Marge = 15%) :**
   $$\text{Tarif Client} = 0,07700 \times 1,15 = 0,08855\text{ € HT / SMS}$$
2. **Espagne (Achat Sinch = 0,04200 €, Marge = 20%) :**
   $$\text{Tarif Client} = 0,04200 \times 1,20 = 0,05040\text{ € HT / SMS}$$
3. **France métropolitaine (Achat Sinch = 0,02500 €, Marge = 10%) :**
   $$\text{Tarif Client} = 0,02500 \times 1,10 = 0,02750\text{ € HT / SMS}$$

---

## 11. Assistance & Escalade Support

En cas de difficulté lors de la récupération ou d'incohérence constatée :

| Nature du Problème | Premier Niveau | Escalade / Délais |
| :--- | :--- | :--- |
| **Erreur de connexion API Sinch** | Vérifier si le badge indique "Bac à sable" puis relancer la synchro. | Équipe Technique DMC (contact@sfr-business-dmc.local) |
| **Contestation client sur un prix** | Consulter l'historique dans l'application pour fournir la date d'effet exacte. | Responsable Produit DMC / ADV SFR |
| **Demande de format spécifique (ERP)** | Exporter le CSV standard et appliquer la macro de conversion. | Support Facturation SI SFR |
| **Serveur inaccessible sur le port 3000** | Vérifier si le service tourne sur la VM Ubuntu (`systemctl status dmc-sms-pricing`). | Équipe Exploitation VM |
