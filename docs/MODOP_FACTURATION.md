# Mode Opératoire (MODOP) - Récupération des Tarifs SMS Internationaux DMC

| Document | Mode Opératoire (MODOP) |
| :--- | :--- |
| **Destinataires** | Équipe Facturation, Contrôle de Gestion & ADV SFR Business |
| **Application** | DMC SMS Pricing (Référentiel Tarifs Sinch) |
| **Fréquence** | Mensuelle (clôture de facturation) ou à la demande (chiffrage client) |
| **Version** | 1.0 - Octobre 2026 |

---

## 1. Objectif du Guide

Ce document décrit pas à pas la procédure permettant à l'équipe **Facturation** de :
1. **Consulter en temps réel** les tarifs d'achat et de vente des SMS envoyés vers l'international via la plateforme DMC.
2. **Exporter la grille tarifaire** directement vers Microsoft Excel avec l'application de la marge commerciale.
3. **Mettre à jour le référentiel** si un nouveau fichier de notification de changement de tarifs (`PriceChangeNotification.csv`) est reçu par mail de notre partenaire Sinch.

---

## 2. Accès à l'Application

L'application est accessible directement depuis votre navigateur web habituel (Google Chrome ou Microsoft Edge) sans installation préalable :

- **Adresse d'accès :** `http://<IP_DE_LA_VM_UBUNTU>:3000` *(ou `http://localhost:3000` en environnement de test)*.
- **Identifiants :** Accès direct sur le réseau interne SFR / VPN.

---

## 3. Cas d'Usage N°1 : Rechercher un tarif pour un client ou un pays

*Exemple : Un client demande le tarif pour envoyer des campagnes SMS vers Saint-Marin ou l'Espagne.*

1. Ouvrez l'interface web **DMC SMS Pricing**.
2. Dans la barre de recherche au centre de l'écran, tapez le nom du pays (ex: `San Marino` ou `Spain`), le nom de l'opérateur, ou l'indicatif téléphonique (ex: `+378`).
3. Le tableau filtre automatiquement les résultats :
   - La colonne **Tarif Actuel (€)** indique le coût unitaire d'achat HT facturé par Sinch à SFR.
   - La colonne **Variation** vous indique immédiatement si ce tarif est stable, en hausse (badge rouge ▲), ou en baisse (badge vert ▼).
4. Cliquez sur le bouton **📈 Graphe** à droite de la ligne :
   - Une fenêtre s'ouvre avec la courbe d'évolution du prix dans le temps.
   - Vous pouvez visualiser l'historique complet des dates d'effet pour justifier l'évolution tarifaire auprès du client.

---

## 4. Cas d'Usage N°2 : Exporter la grille tarifaire pour la facturation mensuelle

Pour intégrer les tarifs dans vos outils de facturation (SI Facturation, macro Excel, ERP) :

1. Cliquez sur le bouton rouge **« Export Facturation »** en haut à droite de l'écran.
2. Une boîte de dialogue s'affiche :
   - **Marge commerciale à appliquer (%) :** Saisissez le pourcentage de marge souhaité (par exemple `15` pour appliquer 15% de marge brute sur le coût d'achat). Si vous souhaitez exporter les coûts d'achat stricts sans marge, laissez `0`.
   - **Filtrer par pays (optionnel) :** Laissez vide pour exporter le monde entier, ou saisissez le nom d'un pays particulier.
3. Cliquez sur **« Télécharger le fichier CSV »**.
4. Le fichier se télécharge immédiatement :  
   `export_facturation_dmc_AAAA-MM-JJ.csv`
5. Ouvrez le fichier dans **Microsoft Excel** :
   - Le fichier utilise le séparateur point-virgule (`;`) et un encodage UTF-8 conforme aux versions françaises d'Excel.
   - Les colonnes et les accents s'affichent immédiatement de manière ordonnée sans manipulation technique.

---

## 5. Dictionnaire des Colonnes du Fichier d'Export Excel

| Nom de la Colonne | Description | Exemple |
| :--- | :--- | :--- |
| `Pays` | Pays de destination des SMS | `San Marino` |
| `Operateur` | Nom de l'opérateur télécom local | `San Marino Telecom` |
| `Reseau` | Nom technique du réseau | `San Marino Telecom` |
| `Indicatif_Tel` | Préfixe téléphonique international | `+378` |
| `MCC` | Mobile Country Code (Code pays télécom officiel) | `292` |
| `MNC` | Mobile Network Code (Code réseau de l'opérateur) | `01` |
| `Tarif_Achat_Sinch_EUR` | **Coût d'achat unitaire brut HT facturé par Sinch** | `0.07700` |
| `Marge_Appliquee_Pct` | Taux de marge commerciale configuré | `15` |
| `Tarif_Facture_Client_EUR` | **Tarif unitaire conseillé à facturer au client final HT** | `0.08855` |
| `Variation_Recente_EUR` | Différence en euros par rapport au tarif précédent | `+0.03190` |
| `Variation_Recente_Pct` | Pourcentage d'évolution récent | `+70.73%` |
| `Date_Entree_Vigueur` | Date officielle de prise d'effet du tarif | `2026-10-27` |
| `Ref_Produit_Sinch` | Identifiant technique de l'offre Sinch | `SFRBu_20261008053302366_ra` |

---

## 6. Cas d'Usage N°3 : Intégrer un nouveau fichier de variation tarifaire Sinch

Lorsque le partenaire Sinch envoie par email un nouveau fichier de notification de tarifs (ex: `PriceChangeNotification.csv`) :

### Méthode 1 : Depuis l'Interface Web (Recommandée)
1. Téléchargez la pièce jointe CSV reçue par email sur votre poste.
2. Dans l'application DMC, cliquez sur le bouton gris **« Importer un CSV Sinch »** en haut à droite.
3. Glissez-déposez le fichier CSV dans le cadre en pointillés (ou cliquez sur **« Parcourir les fichiers »**).
4. Cliquez sur **« Lancer l'ingestion »**.
5. L'application met à jour instantanément les tarifs concernés, conserve l'ancien prix dans l'historique et recalcule les indicateurs en quelques secondes.

### Méthode 2 : Automatique (sur la VM Ubuntu)
Si l'automatisation par email est activée sur la VM :
- Les fichiers CSV déposés dans le dossier `data/updates/` sur le serveur Ubuntu sont ingérés automatiquement chaque nuit ou dès réception.
- Aucune action manuelle n'est requise de votre part.

---

## 7. En cas de Question ou d'Anomalie

| Type de problème | Action à mener |
| :--- | :--- |
| **Opérateur ou pays manquant dans la liste** | Vérifier si la destination est ouverte dans l'offre DMC auprès de l'équipe technique DMC. |
| **Contestation client sur un tarif** | Consulter le graphe historique dans l'application pour fournir la date exacte de la notification Sinch. |
| **Serveur inaccessible** | Contacter le support DMC pour vérifier l'état du service sur la VM Ubuntu. |
