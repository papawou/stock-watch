# stock-watch

Vérifie régulièrement des articles sur plusieurs boutiques et envoie une notification ntfy sur le téléphone.
Ne se connecte à aucun compte et n'achète rien.

## Ce qui est surveillé (`watch.json`)

- **`products`** : une page produit précise (400coups.ch). Alerte quand le prix et le bouton « Ajouter au panier » apparaissent.
- **`searches`** : les listes de produits d'une boutique filtrées par mots-clés. Alerte quand un nouvel article correspondant apparaît, puis quand il devient commandable.
  - `shop` : `prestashop` (red-line.shop), `woocommerce` (mix-image.ch) ou `shopify` (poke-swiss.ch).
  - `allOf` : le nom doit contenir au moins un mot de **chaque** groupe, **ou** l'article est dans une des `categories`.
  - `exclude` / `excludeCategories` : aucun de ces mots, aucune de ces catégories (préfixe : `accessoires`).
  - `language` (ex. `FR`) : écarte les autres langues. Un article sans langue connue est gardé, marqué « (langue ?) ». Un article bilingue « FR/EN » compte comme FR.
  - `singles: "once"` (Shopify) : les cartes à l'unité (produits sans étiquette) ne sont annoncées qu'à leur apparition, pas à chaque réassort.
- Plus de 3 nouvelles cartes à l'unité d'un coup → **une seule** notification groupée. Les produits scellés ont toujours leur propre notification.

Ajouter un article 400 Coups = une entrée dans `products` (`name` + `url`).

## Déclenchement

- **cron-job.org**, toutes les 10 min : `POST https://api.github.com/repos/tchappuis42/stock-watch/actions/workflows/watch.yml/dispatches`
  - en-têtes : `Authorization: Bearer <jeton GitHub>`, `Accept: application/vnd.github+json`
  - corps : `{"ref":"main","inputs":{"report":"false"}}`
- **GitHub** lance aussi un passage de secours toutes les heures.
- **Actions → stock-watch → Run workflow** : test manuel, envoie toujours l'état actuel.

Secret requis : `NTFY_TOPIC` (Settings → Secrets and variables → Actions).

## Notifications

- **Surveillance démarrée** : premier passage d'une surveillance, avec l'état actuel.
- **🆕** : nouvel article correspondant aux mots-clés.
- **🚨 COMMANDABLE** : l'article peut être commandé.
- **Changement** : le statut d'une page produit a changé.
- **Test OK / Test — Page non lue** : uniquement sur un test manuel.
