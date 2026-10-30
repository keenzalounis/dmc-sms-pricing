# DMC SMS Pricing

Application web interne de consultation des tarifs SMS internationaux Sinch, de suivi de leurs variations et d'export des tarifs pour le pôle Facturation.

## Fonctionnalités actuelles

- Import manuel des fichiers CSV initiaux et des notifications tarifaires Sinch.
- Prise en charge des colonnes de mise à jour (`Old Price`, `New Price`, `Valid From`) et du format de base (`Country`, `Operator`, `Service type`, `Originator`, `MCC`, `MCC/MNC`, `Price`, `Currency`).
- Conservation de l'historique des prix par opérateur, ainsi qu'une archive téléchargeable du référentiel antérieur et du CSV importé à chaque import valide.
- Recherche et consultation des tarifs depuis le tableau de bord.
- Graphiques analytiques générés en Python : comparaison des tarifs moyens par pays (France mise en évidence) et tendance mensuelle ou annuelle selon l'historique disponible.
- Export CSV pour la facturation.

**L'application n'interroge pas l'API Sinch.** L'API envisagée dans la première version concernait des tarifs, pas les données de consommation ou de facturation des SMS. Les tarifs peuvent être importés depuis l'interface ou récupérés par le connecteur de boîte mail lorsqu'il est configuré. Les messages et pièces jointes sont contrôlés avant l'ingestion ; les anomalies peuvent déclencher une alerte au destinataire configuré.

La base de démonstration déjà présente dans le dépôt contient des données de tests issues de l'ancien mode mock. Avant tout usage métier, importer et valider le fichier de base tarifaire approuvé par Sinch ; ne pas considérer ces valeurs de démonstration comme des prix de production.

## Prérequis

- Node.js 18 ou supérieur pour le serveur et les tests.
- Python 3 et les dépendances de `requirements.txt` pour générer les graphiques. Le site et l'import CSV restent utilisables sans Python ; seule la génération des graphiques en dépend.

## Démarrage local (Windows / PowerShell)

```powershell
cd C:\Users\TRETEC\dmc-sms-pricing
npm.cmd test
npm.cmd start
```

Ouvrir ensuite <http://localhost:3000>. Garder la fenêtre du terminal ouverte tant que le serveur est utilisé ; `Ctrl+C` l'arrête.

Pour générer les graphiques, installer les dépendances Python puis exécuter :

```powershell
python -m pip install -r requirements.txt
npm.cmd run charts
```

Sur Linux / VM Ubuntu, les commandes npm s'exécutent normalement avec `npm`.

## Import et archives

Dans le tableau de bord, choisir **Mettre à jour les tarifs**, sélectionner le CSV Sinch puis lancer l'ingestion. Le serveur vérifie les colonnes obligatoires et chaque ligne tarifaire avant toute modification. Si le format ou une ligne est invalide, le fichier entier est refusé pour éviter un import partiel. Un import valide archive l'ancien référentiel et conserve le CSV importé dans l'archive JSON. Les archives sont consultables et téléchargeables depuis **Historique des versions**.

Les archives et la base active sont enregistrées sous `data/`. Il faut donc inclure ce dossier dans les sauvegardes de la VM et éviter de le remplacer lors d'un déploiement.

## Déploiement VM : prérequis opérationnels

La procédure de déploiement sur la VM de l'entreprise dépend de l'environnement SFR (réseau, accès, reverse proxy, HTTPS et authentification). Le serveur applicatif seul ne fournit pas d'authentification ; **ne pas l'exposer directement à Internet ou au réseau d'entreprise sans les protections et validations requises**. Le service peut être placé derrière le reverse proxy et le mécanisme d'authentification approuvés par l'entreprise.

Avant le déploiement, vérifier notamment :

1. Node.js 18+ et, pour les graphiques, Python 3 avec `pip install -r requirements.txt`.
2. Le service démarre et reste actif après redémarrage de la VM.
3. Le chemin de données persistant `data/` est sauvegardé et n'est pas écrasé par les mises à jour du code.
4. L'accès navigateur est publié via le réseau interne / VPN, le HTTPS et l'authentification approuvés.
5. Une procédure de mise à jour Git conserve la base et les archives, puis exécute `npm test`.

## Relève de la boîte mail

Le connecteur de boîte mail est configuré dans `data/mail_config.json` à partir du modèle `data/mail_config.example.json`. Il prend en charge une relève planifiée et un déclenchement manuel depuis la fenêtre d'import. Vérifier la configuration et le statut dans l'application avant de compter sur l'automatisation. Les identifiants de messagerie ne doivent pas être intégrés au code source ni partagés.

Les courriels sont filtrés selon les expéditeurs et le contenu attendus. Les pièces jointes non CSV, les messages non conformes et les fichiers dont le schéma ou les tarifs sont invalides sont rejetés et peuvent déclencher une alerte au destinataire configuré. Aucun webhook entrant n'est utilisé par cette relève planifiée.

## Fichiers utiles

- `src/server.js` : serveur HTTP, API locale, import CSV, archives et export.
- `src/ingest.js` : parsing, normalisation et historisation.
- `src/public/` : interface web.
- `scripts/generate_charts.py` : analyses Python.
- `data/base_tarifs.csv` et `data/updates/` : exemples de données.
- `docs/` : expression du besoin et mode opératoire.
