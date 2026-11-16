# Comptes associés : invitations, adresses et rattachements aux chevaux

## État du code (16 novembre 2026)
- `docs/application/administration/` : gestion des comptes, des accès, et interface chevaux / e-mail par compte.
- `supabase/functions/gerer-associes/index.ts` : fonction serveur authentifiant l'administrateur pour les invitations avec rattachement des chevaux, suspensions, modifications des participations, corrections d'e-mail et renvoi d'un lien d'accès aux comptes existants.
- `docs/application/mes-chevaux/` : espace personnel ; n'affiche les chevaux rattachés qu'après authentification.
- `supabase/email-templates/invite.html` et `recovery.html` : modèles des courriels personnalisés, **à copier dans les réglages Supabase**.

**Important : un commit GitHub ne déploie pas automatiquement une Edge Function Supabase, ne configure pas les modèles e-mail, et ne modifie pas les comptes existants.**

## Déploiement côté Supabase
1. Vérifier les tables existantes `associes`, `participations_chevaux`, les RLS et la présence de l'administrateur actif. Les noms et adresses des associés ne doivent jamais être ajoutés au dépôt public.
2. Déployer la fonction `gerer-associes` depuis le dossier `supabase/functions/gerer-associes/` dans le projet Supabase **yeecwaaizmvrhwobukfa**. Le JWT du gestionnaire doit être exigé. Vérifier le résultat du déploiement et les logs.
3. Sous Supabase **Authentication → URL Configuration**, autoriser explicitement l'URL de retour `https://fiches.ecurie-initial.com/application/connexion/` ; vérifier également la configuration du domaine personnalisé de l'application avant tout changement d'URL.
4. Sous **Authentication → SMTP Settings**, configurer **IONOS** avec l'expéditeur **Écurie Initial <contact@ecurie-initial.com>** : hôte **smtp.ionos.fr**, port **465** en **SSL/TLS**, identifiant **contact@ecurie-initial.com** et mot de passe de la boîte IONOS (à saisir uniquement dans Supabase). En alternative : port **587** en **STARTTLS**. Vérifier les DNS SPF/DKIM. Ne jamais publier identifiants SMTP, `service_role` ou secrets dans GitHub.
5. Sous **Authentication → Email Templates**, coller les fichiers `invite.html` (Invite user) et `recovery.html` (Reset password) avec les objets :
   - « Écurie Initial – Votre invitation à l'espace associés »
   - « Écurie Initial – Réinitialisation de votre mot de passe »
6. Sur la page d'administration, le bouton « Lien d'accès » permet d'envoyer une demande de réinitialisation du mot de passe **sans créer de second compte**. L'envoi dépend du SMTP configuré. Tester ce bouton sur un compte d'essai.
7. Tester sur deux comptes d'essai actifs : l'un propriétaire du cheval A, l'autre du cheval B. Vérifier la réception de l'invitation, la création du mot de passe, le retour vers la connexion, la visibilité isolée de « Mes chevaux » et l'absence d'accès croisé.
8. Tester « Corriger l'e-mail » sur un **compte de test** avant modification d'une vraie adresse. Ce changement est administratif et ne déclenche pas d'invitation : l'identité et les rattachements du compte sont conservés.
9. Tester l'ajout puis le retrait d'un cheval sur un compte de test ; s'assurer que l'associé ne lit jamais les contenus privés d'un cheval qu'il ne détient pas.

## Limites
- Le serveur SMTP Supabase intégré est réservé aux essais et ne permet pas l'envoi libre aux associés : un SMTP personnalisé est nécessaire en production.
- Une nouvelle invitation déclenche un e-mail via Supabase Auth, mais rien n'est envoyé tant que le serveur SMTP n'est pas configuré ou l'action d'invitation n'est pas explicitement demandée dans l'administration.
- Les fonctions proposées et les pages ne sont pas des preuves que les données privées ont déjà été synchronisées : elles sont à vérifier dans le projet Supabase.

## Pour terminer la mise en service
- La configuration Supabase ne se fait pas par publication sur GitHub.
- Dans Supabase > Authentication > URL Configuration, ajouter `https://fiches.ecurie-initial.com/application/connexion/` aux Redirect URLs.
- Dans Supabase > Authentication > SMTP Settings, compléter l'envoi par IONOS, puis renseigner dans Email Templates les fichiers du dépôt.
- Dans GitHub > Actions, ouvrir « Déployer la gestion des associés (Supabase) » et déclencher le workflow manuel **après** avoir configuré le secret `SUPABASE_ACCESS_TOKEN` dans GitHub. Ne partager aucun mot de passe ni jeton dans le chat.
- Tester la réception d'un e-mail et les droits d'accès avec deux comptes d'essai séparés avant toute invitation générale.

## Préouverture du 16 novembre au 1er décembre 2026

**Règle souhaitée :** les invitations peuvent partir et les nouveaux associés peuvent définir leur mot de passe avant le lancement, mais **aucun accès aux espaces privés ni aux notifications d'associé avant le 1er décembre 2026 à 00:00 heure de Paris**, hormis les quatre testeurs (compte administrateur, Adrien Delgery, Nicolas Barré et Éric Schott).

**Étape indispensable avant d'envoyer des invitations :** exécuter dans Supabase SQL Editor `supabase/migrations/20261116_ei_preouverture_1_decembre.sql`. Le SQL :
- identifie **exactement quatre** comptes actifs (un administrateur et les trois testeurs nommés) puis fige leurs UUID dans `ei_lancement_pilotes` ; si le comptage n'est pas exact, la transaction échoue sans modifier les droits ;
- protège les participations privées, les actualités des chevaux, la Tribune et les médias privés par des fonctions et politiques RLS imposant la date ou l'appartenance aux quatre testeurs ;
- expose aux sessions connectées le seul état de leur propre préinscription via `ei_etat_lancement()` ;
- déverrouille les comptes actifs **automatiquement** le 1er décembre sans tâche planifiée ni activation manuelle.

Le serveur `gerer-associes` a un contrôle `ei_lancement_pret()` : **aucune nouvelle invitation ne doit partir avant l'installation SQL**. Les Edge Functions `notifications` et `push-dispatch` vérifient elles aussi la préouverture. Le déploiement du code n'applique PAS la migration SQL.

Après application, contrôler avec **un compte non testeur invité** que le lien d'invitation permet la création du mot de passe et affiche la page « Votre inscription est enregistrée », mais que l'accès direct à la Tribune, à Mes chevaux, aux données privées via Supabase REST et aux notifications d'associé reste refusé. Contrôler sur les quatre comptes pilotes que le fonctionnement habituel est préservé. Faire également un test négatif de lecture inter-chevaux.

Le modèle `supabase/email-templates/invite.html` a été adapté pour annoncer la préouverture. Il faut **mettre à jour manuellement** le modèle « Invite user » dans Supabase Authentication → Email Templates : GitHub ne déploie pas les modèles e-mail. Ne jamais envoyer la campagne générale avant vérification du SQL, du SMTP et de la page d'attente.

Attention : les pages publiques du site www.ecurie-initial.com restent publiques et ne sont pas protégées par la préouverture. Seuls l'application privée, ses fonctionnalités associées et les notifications d'associé sont réservés aux quatre testeurs.
