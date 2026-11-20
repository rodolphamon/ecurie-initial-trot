# Sauvegarde des Edge Functions — Écurie Initial

## Source de référence

Les **six fonctions Supabase** du projet sont versionnées dans `supabase/functions/<nom>/index.ts`. Les copies initiales des trois dernières fonctions manquantes proviennent du code **actif en production le 20 novembre 2026**, récupéré directement dans Supabase (sans modification du contenu).

| Fonction | Version active sauvegardée le 20/11/2026 | Vérification JWT à la passerelle |
|---|---:|---|
| `gerer-associes` | 26 | oui |
| `notifications` | 41 | non, vérification applicative |
| `push-dispatch` | 51 | non, secret de tâche contrôlé par le code |
| `smart-service` | **9** | **oui** |
| `team-contact` | **4** | **non, contrôles effectués dans la fonction** |
| `push-receipt` | **1** | **non, contrôles effectués dans la fonction** |

Les versions indiquées sont des **repères de sauvegarde**, pas une garantie qu'une fonction actuellement en ligne n'ait pas évolué depuis. L'historique Git conserve chaque modification ultérieure.

**Important :** les secrets, jetons privés, clés VAPID et mots de passe ne sont **pas** sauvegardés dans ce dépôt public. Ils demeurent dans la configuration sécurisée de Supabase. Les fichiers TypeScript ne référencent que les variables d'environnement.

### Dépendances et secrets nécessaires

- `smart-service` : `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- `team-contact` : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`.
- `push-receipt` : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

Ne **jamais** mettre les valeurs de ces secrets dans GitHub.

## Restauration contrôlée

1. Ouvrir **GitHub > Actions > Restaurer une fonction Supabase (manuel)**.
2. Choisir la fonction et lancer `Run workflow`. Sélectionner la branche/version Git validée.
3. Le flux vérifie la présence des fichiers et l'intégrité des contrôles, puis redéploie **uniquement** la fonction choisie, avec le même paramètre JWT que la sauvegarde.
4. Vérifier dans Supabase que la fonction est **ACTIVE** et effectuer un test réel de son parcours (sans envoyer d'alertes de masse).

**Il n'existe aucun redéploiement automatique des trois fonctions sauvegardées à chaque push.** Une restauration doit être volontaire pour protéger l'application en production.

Les autres fonctions ont leurs propres procédures de déploiement existantes.

## Contrôle de non-régression

Le workflow `Vérifier l'application avant régression` s'exécute sur les changements de l'application, des six fonctions et de `supabase/config.toml`. Il contrôle :
- la présence des six fichiers d'entrée ;
- la cohérence des six réglages `verify_jwt` ;
- l'absence de secrets codés en dur selon plusieurs signatures usuelles ;
- les commandes d'administration, les restrictions Presse et les sources chevaux.

Il **ne remplace pas** la validation des notifications sur des téléphones verrouillés ni les tests d'authentification de bout en bout.

**Règle de sécurité :** si le code en production a été modifié directement dans Supabase, récupérer la version active et comparer avant toute restauration depuis GitHub, afin de ne pas effacer une correction récente.
