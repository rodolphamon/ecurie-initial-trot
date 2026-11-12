# Fiches chevaux Écurie Initial

Cette arborescence publie les fiches individuelles des **34 chevaux** de l'effectif fourni par les fichiers sources au 12 novembre 2026.

- Catalogue : `docs/chevaux/index.html`
- Pages individuelles : `docs/chevaux/<identifiant>/index.html`
- Style commun : `docs/chevaux/assets/style.css`
- Affichage et filtres : `docs/chevaux/assets/app.js`
- Noms, entraîneurs, casaques et liens vers fiches externes : `docs/chevaux/data/chevaux.json`
- Résultats et engagements communiqués par l'écurie : `docs/chevaux/data/editorial.json`
- Gains et records Trot : `docs/data/effectif-trot.json`
- Gains et valeurs Galop : `docs/data/effectif-galop.json`

## Photographies

Déposer chaque photo en JPG sous : `docs/chevaux/photos/<identifiant>.jpg`. Le système l'affiche sans modifier le code. En l'absence de photo, la casaque officielle est affichée. Pour LORD ON WAY, déposer `docs/chevaux/photos/lord-on-way.jpg`.

## Performances et engagements

Le fichier `editorial.json` contient les données sportives éditoriales, sans les inventer. Lorsqu'aucun historique détaillé n'est saisi, la fiche affiche un état non renseigné et propose un lien vers une fiche externe, si disponible. Les engagements passés sont retirés **uniquement de l'affichage**, pas du JSON source, selon l'heure de Paris. Aucun scraping ou flux officiel automatisé de résultats/engagements n'a été ajouté.

## Mise en ligne sur IONOS

Les noms dans les deux tableaux embarqués renvoient désormais aux nouvelles fiches GitHub Pages. Pour conserver les fiches sous le domaine de l'écurie, configurer ultérieurement un sous-domaine dédié ou créer des pages IONOS correspondantes. Ne pas supposer que les URLs GitHub appartiennent au domaine IONOS.

## Ajouter un cheval

Créer son entrée dans `docs/chevaux/data/chevaux.json`, ajouter sa page `docs/chevaux/<id>/index.html`, l'ajouter à l'effectif de référence et, le cas échéant, déposer sa photo.
