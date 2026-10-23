# viewer — fenêtre d'alertes sur le PC

Petite fenêtre Windows (Python 3 + Tkinter, rien à installer) qui affiche en direct les notifications ntfy envoyées par le bot.

## Installation

1. Installer Python 3 depuis python.org (cocher « Add python.exe to PATH »).
2. Créer `ntfy_topic.txt` à côté de `ntfy_viewer.pyw` et y écrire le nom du canal ntfy (le même que le secret `NTFY_TOPIC`). Ce fichier est ignoré par Git.
3. Double-cliquer sur `ntfy_viewer.pyw`.

Démarrage avec Windows : mettre un raccourci vers le script dans `shell:startup` (Win+R).

## Ce que fait la fenêtre

- Charge les messages des 12 dernières heures, puis reste connectée.
- Une ligne par article : **Statut | Boutique | Article | Prix | Reçu**. Les récapitulatifs « Test OK » / « Surveillance démarrée » sont découpés ligne par ligne.
- Couleurs : COMMANDABLE en vert, « pas encore en ligne » / « bientôt disponible » en orange, le reste en gris.
- Case « Seulement les commandables ».
- Double-clic sur une ligne : ouvre la page du produit.
- Alerte quand un article devient commandable et que la fenêtre n'est pas au premier plan : son, icône qui clignote dans la barre des tâches, bulle en bas à droite (clic = ouvrir le produit). Pas d'alerte pour l'historique, les « Test OK » ni les cartes à l'unité. Bouton « Tester l'alerte ».

## Réglages (en haut du script)

`HISTORIQUE`, `MAX_LIGNES`, `ALERTE`, `DUREE_BULLE`, `MASQUER_CARTES_UNITE` (cache les cartes à l'unité), `JOURNAL` (enregistre les messages bruts dans `messages_recus.txt`, utile pour adapter le découpage si le format des notifications change).

Le découpage suppose le format du bot : `Article — Prix — statut (détails)`, avec le tiret long « — » comme séparateur.
