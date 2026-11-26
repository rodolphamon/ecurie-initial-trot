-- Répertoire préparatoire issu de docs/chevaux/data/chevaux.json.
-- Les trois accès déjà actifs se gèrent dans ei_entraineurs et ne changent pas.
-- Un nom de compte attendu n'est pas une habilitation.
CREATE TABLE IF NOT EXISTS public.ei_entraineurs_repertoire (
 entraineur_nom text PRIMARY KEY,
 compte_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
 compte_attendu text,
 cree_le timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT nom_entraineur_repertoire_valide CHECK(length(trim(entraineur_nom))>2)
);
CREATE TABLE IF NOT EXISTS public.ei_entraineurs_repertoire_chevaux (
 entraineur_nom text NOT NULL REFERENCES public.ei_entraineurs_repertoire(entraineur_nom) ON DELETE CASCADE,
 cheval_slug text NOT NULL,
 cheval_nom text NOT NULL,
 PRIMARY KEY(entraineur_nom,cheval_slug)
);
ALTER TABLE public.ei_entraineurs_repertoire ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ei_entraineurs_repertoire_chevaux ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ei_entraineurs_repertoire,public.ei_entraineurs_repertoire_chevaux FROM anon,authenticated;
GRANT SELECT ON public.ei_entraineurs_repertoire,public.ei_entraineurs_repertoire_chevaux TO authenticated;
CREATE POLICY repertoire_entraineurs_admin_read ON public.ei_entraineurs_repertoire FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.associes a WHERE a.user_id=(SELECT auth.uid()) AND a.actif AND a.administrateur));
CREATE POLICY repertoire_entraineurs_chevaux_admin_read ON public.ei_entraineurs_repertoire_chevaux FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.associes a WHERE a.user_id=(SELECT auth.uid()) AND a.actif AND a.administrateur));
INSERT INTO public.ei_entraineurs_repertoire(entraineur_nom,compte_user_id,compte_attendu)
VALUES ('Antonio RIPOLL RIGO',NULL,NULL),
('Bruno MARIE',NULL,'Mathias LEGROS'),
('Charley HESLOUIN',NULL,NULL),
('Gilles PANNIER','1f57106c-ab48-4754-b246-5f2485070849',NULL),
('Laurent BARASSIN','4b1fb525-d27d-4ec4-ae9e-7647c6a57c69',NULL),
('Mathieu DAOUGABEL',NULL,NULL),
('Michel HANQUIER',NULL,NULL),
('Vincent HÉBERT',NULL,NULL)
ON CONFLICT(entraineur_nom) DO UPDATE SET compte_attendu=COALESCE(public.ei_entraineurs_repertoire.compte_attendu,EXCLUDED.compte_attendu);
INSERT INTO public.ei_entraineurs_repertoire_chevaux(entraineur_nom,cheval_slug,cheval_nom)
VALUES ('Gilles PANNIER','andresy','ANDRESY'),
('Gilles PANNIER','bailychka','BAILYCHKA'),
('Gilles PANNIER','bobrovkha','BOBROVKHA'),
('Gilles PANNIER','douriann','DOURIANN'),
('Gilles PANNIER','giorgiana','GIORGIANA'),
('Gilles PANNIER','gonafoot','GONAFOOT'),
('Charley HESLOUIN','indice-deladou','INDICE DELADOU'),
('Bruno MARIE','isolee-du-bouillon','ISOLÉE DU BOUILLON'),
('Gilles PANNIER','le-roi-leon','LE ROI LEON'),
('Gilles PANNIER','limpide','LIMPIDE'),
('Bruno MARIE','lord-on-way','LORD ON WAY'),
('Mathieu DAOUGABEL','lucky-des-gaudines','LUCKY DES GAUDINES'),
('Vincent HÉBERT','mandragora-fleury','MANDRAGORA FLEURY'),
('Gilles PANNIER','master-pat','MASTER PAT'),
('Laurent BARASSIN','memphis-belle','MEMPHIS BELLE'),
('Michel HANQUIER','mona-lisa-stardust','MONA LISA STARDUST'),
('Bruno MARIE','moondance-okina','MOONDANCE OKINA'),
('Bruno MARIE','myrtille-marboula','MYRTILLE MARBOULA'),
('Vincent HÉBERT','nebraska-fleury','NEBRASKA FLEURY'),
('Michel HANQUIER','nelson-star','NELSON STAR'),
('Laurent BARASSIN','nostalgie-dairpet','NOSTALGIE DAIRPET'),
('Vincent HÉBERT','odacieuse-fleury','ODACIEUSE FLEURY'),
('Vincent HÉBERT','olano-de-la-vallee','OLANO DE LA VALLÉE'),
('Gilles PANNIER','on-lockdown','ON LOCKDOWN'),
('Laurent BARASSIN','palazzo-grassi','PALAZZO GRASSI'),
('Antonio RIPOLL RIGO','phacelie-bilou','PHACÉLIE BILOU'),
('Vincent HÉBERT','popstar-d-eri','POPSTAR D''ERI'),
('Laurent BARASSIN','prince-gio','PRINCE GIO'),
('Gilles PANNIER','rosa-mia','ROSA MIA'),
('Gilles PANNIER','saturday-night','SATURDAY NIGHT'),
('Gilles PANNIER','singapor-initial','SINGAPOR INITIAL'),
('Gilles PANNIER','victoria-secret','VICTORIA SECRET'),
('Gilles PANNIER','vyborg','VYBORG'),
('Gilles PANNIER','zartop','ZARTOP')
ON CONFLICT(entraineur_nom,cheval_slug) DO UPDATE SET cheval_nom=EXCLUDED.cheval_nom;
