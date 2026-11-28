create or replace function public.ei_rattacher_compte_entraineur(p_entraineur_nom text,p_user_id uuid)
returns text language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_current uuid; v_ass public.associes%rowtype; v_existing text;
begin
 if auth.uid() is null or not exists(select 1 from public.associes where user_id=auth.uid() and actif and administrateur) then raise exception 'Accès administrateur requis'; end if;
 select compte_user_id into v_current from public.ei_entraineurs_repertoire where entraineur_nom=p_entraineur_nom for update;
 if not found then raise exception 'Fiche professionnelle inconnue'; end if;
 select * into v_ass from public.associes where user_id=p_user_id and actif;
 if not found then raise exception 'Compte utilisateur absent ou inactif'; end if;
 select nom_entraineur into v_existing from public.ei_entraineurs where user_id=p_user_id;
 if v_existing is not null and v_existing<>p_entraineur_nom then raise exception 'Ce compte est déjà lié à une autre équipe'; end if;
 if exists(select 1 from public.ei_entraineurs_repertoire where compte_user_id=p_user_id and entraineur_nom<>p_entraineur_nom) then raise exception 'Compte déjà lié à une autre fiche'; end if;
 insert into public.ei_entraineurs(user_id,nom_entraineur,actif) values(p_user_id,p_entraineur_nom,true) on conflict(user_id) do update set actif=true;
 if v_current is null then
 update public.ei_entraineurs_repertoire set compte_user_id=p_user_id where entraineur_nom=p_entraineur_nom;
 end if;
 insert into public.ei_entraineurs_chevaux(cheval_slug,entraineur_id,cheval_nom)
 select h.cheval_slug,coalesce(v_current,p_user_id),h.cheval_nom from public.ei_entraineurs_repertoire_chevaux h where h.entraineur_nom=p_entraineur_nom on conflict(cheval_slug) do nothing;
 insert into public.ei_lancement_pilotes(user_id) values(p_user_id) on conflict do nothing;
 return 'Compte lié : '||v_ass.nom_affiche||' → '||p_entraineur_nom;
end;$function$;
revoke execute on function public.ei_rattacher_compte_entraineur(text,uuid) from public,anon;
grant execute on function public.ei_rattacher_compte_entraineur(text,uuid) to authenticated;
create policy ei_publications_equipe_insert on public.ei_entraineurs_publications for insert to authenticated with check (entraineur_id=(select auth.uid()) and exists(select 1 from public.ei_entraineurs t join public.associes a on a.user_id=t.user_id where t.user_id=(select auth.uid()) and t.actif and a.actif) and exists(select 1 from public.ei_entraineurs_chevaux l join public.ei_entraineurs owner on owner.user_id=l.entraineur_id join public.ei_entraineurs me on me.nom_entraineur=owner.nom_entraineur where me.user_id=(select auth.uid()) and me.actif and owner.actif and l.cheval_slug=ei_entraineurs_publications.cheval_slug));
create policy ei_publications_equipe_update on public.ei_entraineurs_publications for update to authenticated using (entraineur_id=(select auth.uid()) and exists(select 1 from public.ei_entraineurs t join public.associes a on a.user_id=t.user_id where t.user_id=(select auth.uid()) and t.actif and a.actif)) with check (entraineur_id=(select auth.uid()) and exists(select 1 from public.ei_entraineurs t join public.associes a on a.user_id=t.user_id where t.user_id=(select auth.uid()) and t.actif and a.actif) and exists(select 1 from public.ei_entraineurs_chevaux l join public.ei_entraineurs owner on owner.user_id=l.entraineur_id join public.ei_entraineurs me on me.nom_entraineur=owner.nom_entraineur where me.user_id=(select auth.uid()) and me.actif and owner.actif and l.cheval_slug=ei_entraineurs_publications.cheval_slug));
create policy ei_medias_equipe_insert on storage.objects for insert to authenticated with check (bucket_id='ei-entraineurs-medias' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.ei_entraineurs t join public.associes a on a.user_id=t.user_id where t.user_id=(select auth.uid()) and t.actif and a.actif) and exists(select 1 from public.ei_entraineurs_chevaux l join public.ei_entraineurs owner on owner.user_id=l.entraineur_id join public.ei_entraineurs me on me.nom_entraineur=owner.nom_entraineur where me.user_id=(select auth.uid()) and me.actif and owner.actif and l.cheval_slug=(storage.foldername(objects.name))[2]));
