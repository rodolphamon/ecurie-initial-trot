# Écurie Initial — Effectif Trot

Projet gratuit de publication des données de **18 trotteurs** pour le site `www.ecurie-initial.com` (IONOS MyWebsite Now).

## État réel

- ✅ Dépôt de travail créé.
- ✅ Relevé initial fourni par l'Écurie Initial le 10 novembre 2026.
- ⏳ Hébergement GitHub Pages à activer.
- ⛔ **Aucune collecte automatique de gains/records n'est activée.**
- ⛔ Les sites PMU, LeTROT, Geny ou Equidia n'ont pas donné ici d'autorisation attestée de réutilisation automatisée.

Le fichier `docs/data/effectif-trot.json` conserve les **valeurs transmises par l'écurie** et ne constitue pas une information officielle actualisée. Les champs nuls signifient « non renseigné ».

## Affichage

Après activation de GitHub Pages (Settings → Pages → Deploy from a branch → main → /docs), le flux sera :
`https://rodolphamon.github.io/ecurie-initial-trot/data/effectif-trot.json`

Le module HTML d'IONOS pourra lire ce JSON pour actualiser uniquement les colonnes gains/records, en conservant les vrais pictogrammes de casaques et les liens des chevaux.

## Actualisation future

Le workflow prévu effectue un **contrôle quotidien de validité**, pas une collecte de données protégées. Lorsqu'une source gratuite et **autorisée** est identifiée et testée, nous pourrons ajouter un connecteur qui vérifie les valeurs, écrit uniquement celles qui sont confirmées, puis actualise `docs/data/effectif-trot.json`.

Ne pas saisir de mot de passe, clé API, ou information privée dans ce dépôt public.
