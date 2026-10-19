# stock-watch

Vérifie toutes les ~10 min si un article est commandable et envoie une notification ntfy sur le téléphone.
Ne se connecte à aucun compte et n'achète rien.

## Mise en place

1. **Settings → Secrets and variables → Actions → New repository secret** : `NTFY_TOPIC` = le nom de ton sujet ntfy.
2. **Actions → stock-watch → Run workflow** pour un premier test : tu dois recevoir « Surveillance démarrée ».

## Notifications

- **Surveillance démarrée** : premier passage, avec l'état actuel.
- **🚨 COMMANDABLE** : le prix et le bouton « Ajouter au panier » sont apparus.
- **Changement** : le texte de statut a changé (ex. « Commande bientôt disponible » → prix).

## Ajouter un article

Ajoute une entrée dans `watch.json` (`name` + `url`). Pour l'instant, le script lit les pages 400coups.ch (CS-Cart).
