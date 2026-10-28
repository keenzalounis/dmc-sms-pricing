# DMC SMS Pricing - Référentiel Tarifs Sinch & Facturation

Solution légère et autonome de gestion, d'historisation et d'exportation des tarifs SMS internationaux partenaires (Sinch) pour la plateforme **DMC SFR Business**.

---

## 📋 Table des Matières

- [1. Fonctionnalités](#1-fonctionnalités)
- [2. Architecture & Structure du Projet](#2-architecture--structure-du-projet)
- [3. Démarrage Rapide en Local](#3-démarrage-rapide-en-local)
- [4. Procédure de Déploiement sur la VM Ubuntu](#4-procédure-de-déploiement-sur-la-vm-ubuntu)
- [5. Documentation Associée](#5-documentation-associée)

---

## 1. Fonctionnalités

- **Ingestion & Normalisation :** Lecture du catalogue initial (`base_tarifs.csv`) et des notifications de variation de prix Sinch (`PriceChangeNotification.csv`).
- **Historisation Complète :** Conservation de tous les anciens prix avec date d'effet et référence produit pour tracer l'évolution dans le temps.
- **Tableau de Bord Web :** Recherche instantanée par pays, opérateur, indicatif ou code MCC/MNC, avec courbes de tendance interactives (Canvas HTML5).
- **Module Facturation :** Exportation en un clic au format CSV compatible Microsoft Excel FR (séparateur `;`, encodage UTF-8 BOM) avec calcul de marge commerciale personnalisable.
- **Moteur Graphique Avancé Python :** Module d'analyse avec `pandas`, `matplotlib` et `seaborn` produisant des graphiques haute définition 300 DPI pour les comités et le pôle facturation.
- **Zéro Dépendance Externe Obligatoire pour le Web :** Le serveur HTTP et l'API fonctionnent sur les modules natifs Node.js (`http`, `fs`, `path`).

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
│   ├── EXPRESSION_BESOIN_DMC.md  # EB complète pour cadrage avec Gabriel
│   └── MODOP_FACTURATION.md      # Mode opératoire détaillé pour l'équipe facturation
│
├── scripts/
│   └── generate_charts.py        # Moteur graphique Python (Seaborn / Matplotlib)
│
├── src/
│   ├── ingest.js                 # Moteur d'ingestion et de calcul des deltas
│   ├── export.js                 # Moteur d'exportation Excel pour la facturation
│   ├── server.js                 # Serveur HTTP et API REST autonome
│   └── public/                   # Interface utilisateur web
│       ├── index.html            # Dashboard HTML5
│       ├── styles.css            # Charte graphique SFR Business
│       ├── app.js                # Logique UI et moteur de graphes Canvas
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
# 1. Lancer les tests unitaires
npm test

# 2. Réinitialiser la base avec le catalogue de base
node src/ingest.js data/base_tarifs.csv

# 3. Appliquer un fichier de notification de prix Sinch
node src/ingest.js data/updates/PriceChangeNotification_sample.csv

# 4. Générer les graphiques Python (si Python 3 est installé)
npm run charts

# 5. Générer un export facturation (ex: avec 15% de marge)
node src/export.js --margin=15

# 6. Démarrer le serveur web
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

### Étape 4.3 : Configurer le service d'arrière-plan (systemd)
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

L'application est immédiatement accessible sur le réseau SFR à l'adresse :  
`http://<IP_DE_LA_VM>:3000`

---

## 5. Documentation Associée

- **[docs/EXPRESSION_BESOIN_DMC.md](docs/EXPRESSION_BESOIN_DMC.md)** : Document formel d'Expression des Besoins pour le point d'alignement avec Gabriel.
- **[docs/MODOP_FACTURATION.md](docs/MODOP_FACTURATION.md)** : Guide pas-à-pas illustré pour l'équipe Facturation.
