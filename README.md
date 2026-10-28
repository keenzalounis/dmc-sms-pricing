# DMC SMS Pricing - Référentiel Tarifs Sinch & Facturation

Solution complète, légère et autonome de gestion, d'intégration en temps réel (API Sinch), d'historisation et d'exportation des tarifs SMS internationaux partenaires pour la plateforme **DMC SFR Business**.

---

## 📋 Table des Matières

- [1. Fonctionnalités](#1-fonctionnalités)
- [2. Architecture & Structure du Projet](#2-architecture--structure-du-projet)
- [3. Démarrage Rapide en Local](#3-démarrage-rapide-en-local)
- [4. Procédure de Déploiement sur la VM Ubuntu](#4-procédure-de-déploiement-sur-la-vm-ubuntu)
- [5. Documentation Associée](#5-documentation-associée)

---

## 1. Fonctionnalités

- **Intégration API Sinch en Direct (Priorité 1bis DMC) :** Interrogation directe de l'API REST Sinch (`/xms/v1/{service_plan_id}/rates`) pour obtenir en temps réel les prix d'achat par pays/opérateur, avec fallback automatique vers le bac à sable (Mock) en environnement déconnecté ou de qualification.
- **Ingestion & Normalisation CSV :** Double compatibilité assurée pour ingérer à la fois le catalogue initial (`base_tarifs.csv`) et les notifications de variation de prix envoyées par email (`PriceChangeNotification.csv`).
- **Historisation Complète & Calcul de Deltas :** Conservation de tous les anciens prix avec date d'effet, référence produit et source pour tracer l'évolution dans le temps et justifier les prix auprès des clients.
- **Tableau de Bord Web Interactif :** Recherche instantanée par pays, opérateur, indicatif ou code MCC/MNC, avec courbes de tendance interactives (Canvas HTML5).
- **Module Facturation :** Exportation en un clic au format CSV compatible Microsoft Excel FR (séparateur `;`, encodage UTF-8 BOM) avec calcul paramétrable de la marge commerciale.
- **Moteur Graphique Avancé Python :** Module d'analyse avec `pandas`, `matplotlib` et `seaborn` produisant des graphiques haute définition 300 DPI pour les comités et le pôle facturation.
- **Zéro Dépendance Externe Obligatoire pour le Web :** Le serveur HTTP, l'API REST et le connecteur Sinch fonctionnent sur les modules natifs Node.js (`https`, `http`, `fs`, `path`).

---

## 2. Architecture & Structure du Projet

```text
dmc-sms-pricing/
├── .gitignore                    # Fichiers exclus du versionnement
├── package.json                  # Métadonnées et scripts npm
├── requirements.txt              # Dépendances Python (pandas, matplotlib, seaborn)
├── README.md                     # Guide général du projet
│
├── data/
│   ├── base_tarifs.csv           # Catalogue tarifaire initial de référence
│   ├── database.json             # Base de données locale (tarifs actuels + historique)
│   ├── export_facturation.csv    # Dernier export généré pour la facturation
│   └── updates/                  # Dossier des notifications Sinch reçues
│       └── PriceChangeNotification_sample.csv
│
├── docs/
│   ├── EXPRESSION_BESOIN_DMC.md  # EB complète pour cadrage avec Gabriel (v1.1)
│   └── MODOP_FACTURATION.md      # Mode opératoire détaillé pour l'équipe facturation
│
├── scripts/
│   └── generate_charts.py        # Moteur graphique Python (Seaborn / Matplotlib)
│
├── src/
│   ├── sinch-api.js              # Connecteur direct API REST Sinch & Sync temps réel
│   ├── ingest.js                 # Moteur d'ingestion et de calcul des deltas
│   ├── export.js                 # Moteur d'exportation Excel pour la facturation
│   ├── server.js                 # Serveur HTTP et API REST autonome
│   └── public/                   # Interface utilisateur web
│       ├── index.html            # Dashboard HTML5
│       ├── styles.css            # Charte graphique SFR Business
│       ├── app.js                # Logique UI, synchro Sinch et graphes Canvas
│       └── charts/               # Images PNG haute résolution générées par Python
│
└── test/
    └── run-tests.js              # Suite de tests unitaires et d'intégration
```

---

## 3. Démarrage Rapide en Local

### Prérequis
- Node.js (version 18 ou supérieure).
- (Optionnel) Python 3 avec `pip install -r requirements.txt` pour générer les graphiques haute résolution.

### Commandes principales
```bash
# 1. Lancer la suite complète de tests (12 tests)
npm test

# 2. Synchroniser les tarifs depuis l'API Sinch (ou mode bac à sable)
npm run sync:sinch:mock

# 3. Réinitialiser la base avec le catalogue de base CSV (si souhaité)
node src/ingest.js data/base_tarifs.csv

# 4. Appliquer un fichier de notification de prix Sinch
node src/ingest.js data/updates/PriceChangeNotification_sample.csv

# 5. Générer les graphiques Python (si Python 3 est installé)
npm run charts

# 6. Générer un export facturation (ex: avec 15% de marge)
node src/export.js --margin=15

# 7. Démarrer le serveur web
npm start
# L'interface est alors accessible sur : http://localhost:3000
```

---

## 4. Procédure de Déploiement sur la VM Ubuntu

### Étape 4.1 : Cloner le dépôt sur la VM Ubuntu
Connectez-vous en SSH à votre machine virtuelle Ubuntu :
```bash
# Cloner le projet depuis GitHub
git clone <URL_DU_DEPOT_GITHUB> /opt/dmc-sms-pricing
cd /opt/dmc-sms-pricing
```

### Étape 4.2 : Vérifier Node.js
```bash
node -v # Doit afficher v18+ (si absent : sudo apt update && sudo apt install -y nodejs)
```

### Étape 4.3 : Configurer les Identifiants API Sinch (Optionnel)
Créez ou renseignez vos variables d'environnement dans `/etc/environment` ou dans un fichier de configuration :
```bash
export SINCH_SERVICE_PLAN_ID="votre_service_plan_id"
export SINCH_API_TOKEN="votre_cle_api_secrete"
```
*(Si non renseignés, la plateforme utilise automatiquement le mode Bac à sable / Simulation sans bloquer).*

### Étape 4.4 : Configurer le service d'arrière-plan (systemd)
Pour que l'application tourne en permanence et redémarre automatiquement en cas de reboot de la machine :

1. Créez le fichier de service :
```bash
sudo nano /etc/systemd/system/dmc-pricing.service
```

2. Collez la configuration suivante :
```ini
[Unit]
Description=DMC SMS Pricing Service SFR
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/dmc-sms-pricing
ExecStart=/usr/bin/node /opt/dmc-sms-pricing/src/server.js
Restart=always
RestartSec=10
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

3. Activez et démarrez le service :
```bash
sudo systemctl daemon-reload
sudo systemctl enable dmc-pricing
sudo systemctl start dmc-pricing
sudo systemctl status dmc-pricing
```

### Étape 4.5 : Planification de la synchronisation automatique (Crontab)
Pour mettre à jour automatiquement les tarifs Sinch chaque lundi matin à 04h00 et régénérer l'export facturation :
```bash
crontab -e
```
Ajoutez :
```cron
0 4 * * 1 cd /opt/dmc-sms-pricing && npm run sync:sinch >> /var/log/dmc_sinch_sync.log 2>&1
30 4 * * 1 cd /opt/dmc-sms-pricing && node src/export.js --margin=15 >> /var/log/dmc_export.log 2>&1
```

L'application est immédiatement accessible sur le réseau SFR à l'adresse :  
`http://<IP_DE_LA_VM>:3000`

---

## 5. Documentation Associée

- **[docs/EXPRESSION_BESOIN_DMC.md](docs/EXPRESSION_BESOIN_DMC.md)** : Document formel d'Expression des Besoins (v1.1) avec le détail de l'intégration API Sinch et les points de cadrage pour Gabriel.
- **[docs/MODOP_FACTURATION.md](docs/MODOP_FACTURATION.md)** : Mode opératoire exhaustif pour l'équipe Facturation, ADV et Contrôle de gestion (récupération des tarifs, application de la marge commerciale, export Excel FR).
