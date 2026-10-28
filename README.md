# DMC SMS Pricing

Application web interne de consultation des tarifs SMS internationaux Sinch, de suivi de leurs variations et d'export des tarifs pour le pôle Facturation.

## Fonctionnalités actuelles

- Import manuel des fichiers CSV initiaux et des notifications tarifaires Sinch.
- Prise en charge des colonnes de mise à jour (`Old Price`, `New Price`, `Valid From`) et du format de base (`Country`, `Operator`, `Service type`, `Originator`, `MCC`, `MCC/MNC`, `Price`, `Currency`).
- Conservation de l'historique des prix par opérateur, ainsi qu'une archive téléchargeable du référentiel antérieur et du CSV importé à chaque import valide.
- Recherche et consultation des tarifs depuis le tableau de bord.
- Graphiques analytiques générés en Python : comparaison des tarifs moyens par pays (France mise en évidence) et évolution annuelle issue des historiques.
- Export CSV pour la facturation.

**L'application n'interroge pas l'API Sinch.** L'API envisagée dans la première version concernait des tarifs, pas les données de consommation ou de facturation des SMS. Les mises à jour sont importées à partir de CSV. La lecture automatique d'une boîte mail dédiée n'est pas encore implémentée.

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

Dans le tableau de bord, choisir **Mettre à jour les tarifs**, sélectionner le CSV Sinch puis lancer l'ingestion. Le serveur valide les lignes de tarif, archive l'ancien référentiel avant l'application des données et garde le CSV importé dans l'archive JSON. Les archives sont consultables et téléchargeables depuis **Historique des versions**.

Les archives et la base active sont enregistrées sous `data/`. Il faut donc inclure ce dossier dans les sauvegardes de la VM et éviter de le remplacer lors d'un déploiement.

## Déploiement VM : prérequis opérationnels

La procédure de déploiement sur la VM de l'entreprise dépend de l'environnement SFR (réseau, accès, reverse proxy, HTTPS et authentification). Le serveur applicatif seul ne fournit pas d'authentification ; **ne pas l'exposer directement à Internet ou au réseau d'entreprise sans les protections et validations requises**. Le service peut être placé derrière le reverse proxy et le mécanisme d'authentification approuvés par l'entreprise.

Avant le déploiement, vérifier notamment :

1. Node.js 18+ et, pour les graphiques, Python 3 avec `pip install -r requirements.txt`.
2. Le service démarre et reste actif après redémarrage de la VM.
3. Le chemin de données persistant `data/` est sauvegardé et n'est pas écrasé par les mises à jour du code.
4. L'accès navigateur est publié via le réseau interne / VPN, le HTTPS et l'authentification approuvés.
5. Une procédure de mise à jour Git conserve la base et les archives, puis exécute `npm test`.

## Automatisation future par email

Pour déclencher l'import dès réception d'une notification Sinch, il faudra préciser le fournisseur de la boîte générique, le mode d'accès autorisé (par exemple connecteur de messagerie ou flux d'automatisation approuvé), les règles de validation des expéditeurs/pièces jointes, et la politique de traitement des doublons et erreurs. Cette intégration n'est pas active dans la version actuelle ; aucun identifiant de messagerie n'est requis pour l'import manuel.

## Fichiers utiles

- `src/server.js` : serveur HTTP, API locale, import CSV, archives et export.
- `src/ingest.js` : parsing, normalisation et historisation.
- `src/public/` : interface web.
- `scripts/generate_charts.py` : analyses Python.
- `data/base_tarifs.csv` et `data/updates/` : exemples de données.
- `docs/` : expression du besoin et mode opératoire.
