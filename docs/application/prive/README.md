# Espace associés Écurie Initial — préparation technique

## Décisions validées
- Application publique pour les chevaux, courses, palmarès.
- Tribune privée visible uniquement aux associés autorisés et actifs.
- Chaque associé peut suivre **tous** les chevaux et publier/commenter.
- L'administrateur valide les invitations et peut suspendre les accès et modérer.
- Connexion par e-mail et mot de passe défini par l'associé; jamais de mot de passe communiqué en clair par le gérant.
- Les informations financières et documents individuels ne sont visibles que par leur destinataire.

## État
Le site GitHub Pages est public. La page `docs/application/tribune/` est une maquette fictive, pas un espace protégé. Aucune invitation ni connexion réelle n'est active.

## Étapes nécessaires avant activation
1. Créer un projet Supabase détenu par l'Écurie Initial et configurer les URL de redirection autorisées.
2. Configurer l'authentification e-mail, les invitations et le domaine d'envoi. Ne jamais exposer une clé `service_role` dans GitHub Pages.
3. Exécuter et auditer `schema.sql` dans la base du projet. Tester les règles RLS avec un visiteur, deux associés, un associé suspendu et un administrateur.
4. Déployer une fonction serveur sécurisée d'invitation/activation réservée à l'administrateur, avec journalisation et limitation de débit.
5. Connecter l'interface de la Tribune à la session authentifiée; afficher les publications uniquement après vérification des droits par le serveur.
6. Pour les photos : stockage privé, contrôle du type et de la taille, politiques d'accès et modération. Pour les factures : règles par propriétaire distinctes.
7. Vérifier les mentions d'information RGPD, la durée de conservation et les procédures de suppression/export des données.

Ne pas importer de liste d'associés ou de données personnelles dans le dépôt public.
