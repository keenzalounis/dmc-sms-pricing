# DMC SMS Pricing - Échantillons de fichiers de test

Ce dossier contient 4 jeux de données types pour valider chaque fonctionnalité de l'application (ingestion, calculs, historisation, archivage et alertes de sécurité).

---

## 1. Fichier `01_notification_hausses_baisses_valide.csv`
* **Scénario :** Notification officielle Sinch standard (Europe / USA).
* **Objectif :** Vérifier que les prix actuels sont actualisés, les hausses (+15% à +25%) affichées en badge rouge, les baisses (-10%) en badge vert, et qu'une version archivée est créée.
* **Résultat attendu :**
  - Ingestion réussie.
  - Compteur "Dernières hausses" mis à jour.
  - Archive téléchargeable dans "Historique des versions".

---

## 2. Fichier `02_notification_destinations_internationales.csv`
* **Scénario :** Notification de destinations internationales (Afrique, Asie, Moyen-Orient, Amérique Latine).
* **Destinations incluses :** Maroc, Algérie, Sénégal, Côte d'Ivoire, Japon, Émirats Arabes Unis, Brésil.
* **Objectif :** Tester la recherche par pays/indicatif (+212, +213, +221...), l'export pour la facturation internationale et la mise à jour de l'historique par opérateur.

---

## 3. Fichier `03_fichier_invalide_colonnes_manquantes.csv`
* **Scénario :** Fichier reçu sans les colonnes obligatoires (`Operator`, `Price` manquants).
* **Objectif :** Vérifier la sécurité et le système d'alerte :
  - L'application **rejette** immédiatement le fichier.
  - La base active `database.json` est **strictement protégée** et non modifiée.
  - Un e-mail d'alerte automatique est envoyé à **`kenza.lounis@sfr.com`** précisant les colonnes manquantes.

---

## 4. Fichier `04_fichier_vide_ou_corrompu.csv`
* **Scénario :** Données tarifaires corrompues (prix non numériques, valeurs négatives).
* **Objectif :** Vérifier la robustesse du parseur : rejet automatique avec message d'erreur explicite.

---

## Comment exécuter un test :

### Méthode A : Via l'interface web (Glisser-Déposer)
1. Ouvrez `https://vm.inspear.org/dmc/`.
2. Cliquez sur **Mettre à jour les tarifs**.
3. Glissez-déposez l'un des fichiers ci-dessus et cliquez sur **Lancer l'ingestion**.

### Méthode B : Par relève d'e-mail automatique
1. Envoyez un e-mail à `dmc.tarifs.sinch@gmail.com` avec le fichier en pièce jointe.
2. Sur la VM : `npm run sync-mail`.
