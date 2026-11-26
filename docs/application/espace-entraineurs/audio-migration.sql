-- Migration du module vocal, appliquée en base le 26 novembre 2026.
-- La publication reste dans l'espace entraîneurs de test, sans déclencheur de notifications.
ALTER TABLE public.ei_entraineurs_publications DROP CONSTRAINT IF EXISTS ei_entraineurs_publications_media_type_check;
ALTER TABLE public.ei_entraineurs_publications ADD CONSTRAINT ei_entraineurs_publications_media_type_check
 CHECK (media_type IS NULL OR media_type IN ('image','video','audio'));
UPDATE storage.buckets
 SET allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/webm',
 'audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/aac']
 WHERE id='ei-entraineurs-medias';
DROP POLICY IF EXISTS ei_entraineurs_media_read ON storage.objects;
CREATE POLICY ei_entraineurs_media_read ON storage.objects FOR SELECT TO authenticated
 USING (
  bucket_id='ei-entraineurs-medias' AND
  (
   ((storage.foldername(name))[1]=(SELECT auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public.ei_entraineurs e
      JOIN public.associes a ON a.user_id=e.user_id
      WHERE e.user_id=(SELECT auth.uid()) AND e.actif AND a.actif
    ))
   OR EXISTS (SELECT 1 FROM public.ei_entraineurs_publications p WHERE p.media_path=name)
  )
 );