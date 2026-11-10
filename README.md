# Écurie Initial — Effectif Trot

Projet gratuit de publication des données de **18 trotteurs** pour le site `www.ecurie-initial.com` (IONOS MyWebsite Now).

## État réel

- ✅ Dépôt de travail créé.
- ✅ Relevé initial fourni par l'Écurie Initial le 10 novembre 2026.
- ⏳ Hébergement GitHub Pages à activer.
- ✅ **Vérification quotidienne des gains activée via une tâche ChatGPT**, à partir du 11 novembre 2026. Cette tâche tente de consulter des valeurs publiquement vérifiables puis de mettre à jour le JSON via GitHub, seulement si un montant est confirmé et si l'écriture est permise. Une mise à jour n'est donc **pas garantie chaque jour**.
- ⛔ **Pas de connexion API hippique officielle ni de collecte de records**. Les relevés automatiques restent conditionnés à la disponibilité de données fiables et réutilisables.
- ⛔ Les sites PMU, LeTROT, Geny ou Equidia n'ont pas donné ici d'autorisation attestée de réutilisation automatisée.

Le fichier `docs/data/effectif-trot.json` conserve les **valeurs transmises par l'écurie** et ne constitue pas une information officielle actualisée. Les champs nuls signifient « non renseigné ».

## Affichage

Après activation de GitHub Pages (Settings → Pages → Deploy from a branch → main → /docs), le flux sera :
`https://rodolphamon.github.io/ecurie-initial-trot/data/effectif-trot.json`

Le module HTML d'IONOS pourra lire ce JSON pour actualiser uniquement les colonnes gains/records, en conservant les vrais pictogrammes de casaques et les liens des chevaux.

## Actualisation future

Le workflow GitHub Actions effectue un **contrôle quotidien de validité** des fichiers (sans collecte externe). Séparément, une tâche ChatGPT quotidienne est programmée pour contrôler les gains de carrière accessibles et modifier les valeurs vérifiées dans ce dépôt. Aucun nouveau montant n'est publié sans preuve et aucune mise à jour n'est garantie. Les records restent à part. Lorsqu'une source gratuite et **autorisée** est identifiée et testée, nous pourrons ajouter un connecteur qui vérifie les valeurs, écrit uniquement celles qui sont confirmées, puis actualise `docs/data/effectif-trot.json`.

Ne pas saisir de mot de passe, clé API, ou information privée dans ce dépôt public.
