# Actualités privées par cheval — Écurie Initial

## Fonctionnement

L'administrateur ouvre `/application/administration/actualites/`, choisit un cheval dans l'effectif, ajoute une information écrite et/ou une photo ou vidéo, puis peut cocher « Prévenir les associés du cheval ».

Les contenus sont stockés **dans Supabase, jamais dans GitHub**. Les médias sont dans le bucket privé `ei-chevaux-prives` (photos JPG/PNG/WEBP jusqu'à 12 Mo ; vidéos MP4/WEBM/MOV jusqu'à 45 Mo). Les associés autorisés consultent le contenu dans `/application/mes-chevaux/`, avec des liens signés temporaires pour les médias.

**Isolation obligatoire :** seules les participations actives à ce cheval autorisent la lecture et les notifications privées. Ni les visiteurs, ni un associé suivant « tous les chevaux » sans part dans le cheval ne peuvent voir ni recevoir cette actualité.

## Mise en service côté Supabase

Le dépôt GitHub fournit le code, mais publier les fichiers dans GitHub **ne déploie pas Supabase**.

1. Dans le **SQL Editor** du projet Supabase, vérifier que les tables existantes `associes`, `participations_chevaux` et `actualites_chevaux_privees` sont déjà créées.
2. Si ce n'est pas encore fait, exécuter `supabase/migrations/20261115_ei_notifications.sql` (préparation de Web Push). Ensuite exécuter **`supabase/migrations/20261116_ei_actualites_multimedia.sql`**. Cette seconde migration crée le bucket privé, ajoute les droits d'accès et le déclencheur de notification. Ne pas la lancer avant la première.
3. Déployer les Edge Functions `supabase/functions/notifications/index.ts` et `supabase/functions/push-dispatch/index.ts` (ex. Supabase CLI : `supabase functions deploy notifications --no-verify-jwt` puis `supabase functions deploy push-dispatch --no-verify-jwt`).
4. Dans Supabase **Edge Functions → Secrets**, définir `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY` et `PUSH_JOB_SECRET` (plus les variables Supabase standard présentes en environnement Edge). Générer une paire VAPID depuis un outil sûr. **Ne jamais coller les clés privées dans GitHub ni dans ChatGPT.**
5. Programmer l'appel POST à `/functions/v1/push-dispatch` environ chaque minute, avec le header `Authorization: Bearer <PUSH_JOB_SECRET>`, via **Cron + pg_net + Vault** ou un planificateur de confiance. La tâche et le secret doivent rester côté serveur.
6. Sur le téléphone d'un associé, ouvrir `/application/notifications/`, activer les notifications et cocher **Nouvelles privées de mes chevaux**. Cette option est indépendante des alertes publiques et des choix « Mes chevaux / Tous ».
7. Tester avec deux comptes actifs ayant des chevaux **différents** : publier une note test pour un cheval appartenant seulement au premier associé ; vérifier que le premier voit la publication et reçoit le Push (s'il s'est abonné), tandis que le second et les visiteurs ne voient rien et ne reçoivent rien. Refaire un test avec une photo puis une vidéo.

## Précautions

- L'option « Prévenir les associés » crée une alerte en base. Elle ne signifie **pas** que le Push a été délivré ; un abonnement actif et le processus d'envoi sont nécessaires.
- Les anciens abonnements ne reçoivent pas de nouvelles alertes privées sans consentement : `private_news` vaut `false` pour les appareils existants jusqu'à enregistrement de leurs préférences.
- Chaque notification privée ne contient aucun compte rendu confidentiel ni URL directe du média : elle mène à l'espace personnel, protégé par Auth + RLS.
- Les URL signées des photos/vidéos expirent au bout d'une heure ; éviter de les partager. Toute modification des participations met à jour les droits de création de nouveaux liens.
- Les fichiers dépassant la limite autorisée sont refusés. Pour les grosses vidéos, compresser avant publication ou ajuster les limites du projet et du bucket.
- En cas d'échec après upload, l'application tente de supprimer le fichier orphelin ; la migration fournit une politique DELETE administrative.
- Les publications existantes sans média restent compatibles.
