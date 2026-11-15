# Notifications Push — Écurie Initial

## Fonctionnalités préparées
- Visiteur non connecté : récapitulatif des **partants du jour à 10 h** (Europe/Paris), **résultats officiels** de tous les chevaux.
- Associé connecté : **partant confirmé**, **rappel à 10 h**, **15 min avant**, **résultat officiel**, **non-partant / forfait** ; choix entre **mes chevaux** et **tout l'effectif**.
- L'engagement seul ne déclenche **aucune notification**.
- En cas de non-partant, le moteur supprime les rappels/confirmations encore en attente.
- Préférences et jetons Push : table privée inaccessible par l'API anonyme, modification via Edge Function seulement.
- Le serveur n'envoie jamais de données privées dans le contenu Push.

## Mise en service dans Supabase (à faire AVANT de promettre des alertes)
La présence des fichiers sur GitHub **ne suffit pas** à lancer les envois.

1. Supabase → SQL Editor : exécuter la migration du dépôt :
   `supabase/migrations/20261115_ei_notifications.sql`.
2. Générer **une seule paire VAPID P-256** avec un outil local fiable (ex. `npx web-push generate-vapid-keys`). La clef publique pourra être utilisée côté navigateur ; la clef privée doit rester **dans Supabase Secrets uniquement**.
3. Supabase → Edge Functions → Secrets : renseigner
   - `PUSH_VAPID_PUBLIC_KEY` : clef publique (base64url)
   - `PUSH_VAPID_PRIVATE_KEY` : clef privée (base64url)
   - `PUSH_JOB_SECRET` : grand secret aléatoire, distinct des clefs VAPID
   - `SUPABASE_SERVICE_ROLE_KEY` et `SUPABASE_URL` : normalement fournis par la plateforme, à confirmer. Ne jamais les placer dans GitHub ou la PWA.
4. Déployer **2 Edge Functions** :
   - `notifications` : source `supabase/functions/notifications/index.ts`
   - `push-dispatch` : source `supabase/functions/push-dispatch/index.ts`
   - Les deux exigent `verify_jwt=false` (voir `supabase/config.toml`). Le code vérifie respectivement le jeton d'appareil et le secret CRON. Si vous utilisez le Dashboard plutôt que la CLI, vérifier les réglages des fonctions.
5. Supabase → Integrations → Cron → Créer un job exécuté **chaque minute** (`* * * * *`) :
   - POST vers `https://yeecwaaizmvrhwobukfa.supabase.co/functions/v1/push-dispatch`
   - Header `Authorization: Bearer <PUSH_JOB_SECRET>`
   - Header `Content-Type: application/json`
   - Corps `{}`
   - Placer le secret dans Supabase Vault si la méthode de création du job le permet, **jamais en clair dans un fichier public**.
6. Ouvrir `https://fiches.ecurie-initial.com/application/notifications/` dans l'application installée (Chrome Android ou écran d'accueil iPhone), activer et choisir les préférences.
7. Vérifier les logs des 2 Edge Functions et du Cron avant ouverture au public.

## Source des événements et vérification
- Le moteur relit `/chevaux/data/editorial.json` et `/chevaux/data/chevaux.json`.
- Statuts `partant` ou `declare` : rappels / confirmations.
- Statuts `non-partant`, `forfait`, `elimine` : alerte d'annulation.
- **Résultats officiels** : seules les performances dotées de `"officiel": true` (ou `"statut": "officiel"`) déclenchent une alerte. À ajouter **uniquement après vérification du classement officiel**. Aujourd'hui la source ne comporte pas ce drapeau par défaut ; les résultats ne partent donc pas automatiquement tant que le processus d'officialisation n'est pas raccordé.
- Première exécution : amorce l'état de référence pour éviter de notifier rétrospectivement tous les partants existants.
- Contrôle d'idempotence en base : une alerte unique par événement et un journal d'envoi unique par appareil.
- Heures des courses en fuseau Europe/Paris ; prise en compte des changements d'heure saisonniers.

## Réserves avant production
- Tester l'envoi réel sur Android et iPhone et la mise à jour de l'horaire d'une course.
- Tester le retour d'un forfait en dernière minute (ne jamais envoyer de rappel périmé).
- La ponctualité de l'alerte Push dépend aussi des services navigateur, du téléphone et de la connectivité.
- En cas de panne du Cron ou de données officielles absentes, l'alerte ne peut être garantie.
- Les envois SMTP IONOS et les Push sont deux services **distincts**.
