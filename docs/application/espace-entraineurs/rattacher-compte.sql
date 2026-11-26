CREATE OR REPLACE FUNCTION public.ei_rattacher_compte_entraineur(p_entraineur_nom text,p_user_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_current uuid; v_ass public.associes%ROWTYPE; v_existing text;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.associes WHERE user_id=auth.uid() AND actif AND administrateur
 ) THEN RAISE EXCEPTION 'Accès administrateur requis'; END IF;
 SELECT compte_user_id INTO v_current FROM public.ei_entraineurs_repertoire
 WHERE entraineur_nom=p_entraineur_nom FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Fiche entraîneur inconnue'; END IF;
 IF v_current IS NOT NULL AND v_current<>p_user_id THEN
  RAISE EXCEPTION 'Ce profil est déjà rattaché à un autre compte'; END IF;
 SELECT * INTO v_ass FROM public.associes WHERE user_id=p_user_id AND actif;
 IF NOT FOUND THEN RAISE EXCEPTION 'Compte utilisateur absent ou inactif'; END IF;
 SELECT nom_entraineur INTO v_existing FROM public.ei_entraineurs WHERE user_id=p_user_id;
 IF v_existing IS NOT NULL AND v_existing<>p_entraineur_nom THEN
  RAISE EXCEPTION 'Ce compte est déjà lié à un autre entraîneur'; END IF;
 IF EXISTS (SELECT 1 FROM public.ei_entraineurs_repertoire
            WHERE compte_user_id=p_user_id AND entraineur_nom<>p_entraineur_nom) THEN
  RAISE EXCEPTION 'Compte déjà lié à une autre fiche entraîneur'; END IF;
 INSERT INTO public.ei_entraineurs(user_id,nom_entraineur,actif)
 VALUES(p_user_id,p_entraineur_nom,true)
 ON CONFLICT(user_id) DO UPDATE SET actif=true;
 UPDATE public.ei_entraineurs_repertoire SET compte_user_id=p_user_id
 WHERE entraineur_nom=p_entraineur_nom;
 INSERT INTO public.ei_entraineurs_chevaux(cheval_slug,entraineur_id,cheval_nom)
 SELECT h.cheval_slug,p_user_id,h.cheval_nom FROM public.ei_entraineurs_repertoire_chevaux h
 WHERE h.entraineur_nom=p_entraineur_nom
 ON CONFLICT(cheval_slug) DO NOTHING;
 RETURN 'Compte lié : '||v_ass.nom_affiche||' → '||p_entraineur_nom;
END;$$;
REVOKE ALL ON FUNCTION public.ei_rattacher_compte_entraineur(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ei_rattacher_compte_entraineur(text,uuid) TO authenticated;