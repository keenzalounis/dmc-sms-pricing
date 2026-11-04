# Échantillons de test DMC SMS Pricing

Les fichiers `01` et `02` contiennent des données valides à importer dans l'application. Les fichiers `03`, `04`, `06`, `07` et `08` servent à vérifier les rejets de schéma ou de tarif. Un import manuel invalide affiche une erreur, mais ne déclenche pas d'e-mail : les alertes sont réservées aux messages Sinch traités par la relève automatique.

## Nouveaux scénarios

| Fichier | Scénario | Résultat attendu |
|---|---|---|
| `05_test_notification_valide.csv` | Deux tarifs de test valides, une hausse et une baisse | Import accepté et historisé |
| `06_test_old_price_sans_new_price.csv` | Ancien tarif fourni sans nouveau tarif | Rejet avec raison précise ; alerte si reçu par e-mail |
| `07_test_tarifs_invalides.csv` | Nouveau tarif non numérique ou négatif | Rejet ; alerte si reçu par e-mail |
| `08_test_colonnes_incorrectes.csv` | En-têtes incompatibles avec le format Sinch | Rejet ; alerte si reçu par e-mail |

Le fichier `01_notification_hausses_baisses_valide.csv` contient 15 lignes tarifaires (16 lignes en comptant l'en-tête) : 10 hausses et 5 baisses.

## Exécution locale

1. Lancez `npm test`. Les tests valident aussi le chemin d'alerte CSV avec un expéditeur simulé : aucun e-mail réel n'est envoyé.
2. Pour tester l'import valide, utilisez `05_test_notification_valide.csv` dans « Mettre à jour les tarifs ».
3. Pour vérifier le comportement complet de la relève, placez un message de test provenant d'un expéditeur autorisé dans la boîte configurée et lancez la relève manuelle. L'envoi réel d'alerte exige un compte SMTP fonctionnel et un destinataire défini dans `data/mail_config.json`; ne partagez pas ce fichier et ne le versionnez pas.

La génération des graphiques détaillés nécessite Python 3 et les dépendances de `requirements.txt`. Les mini-courbes dans le tableau restent visibles sans Python.
