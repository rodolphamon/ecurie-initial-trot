-- Conserver le droit entraîneur déjà actif pour Pierre-Louis, sans modifier l'entraîneur des fiches officielles.
INSERT INTO public.ei_entraineurs_repertoire(entraineur_nom,compte_user_id)
VALUES ('Pierre-Louis DESAUNETTE','0c0d47a2-8d2f-4a53-b85f-6833a69b8dd9')
ON CONFLICT(entraineur_nom) DO UPDATE SET compte_user_id=EXCLUDED.compte_user_id
WHERE public.ei_entraineurs_repertoire.compte_user_id IS NULL;