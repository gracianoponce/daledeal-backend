-- =============================================================
-- Migration 008 — Fix imágenes mal asignadas a servicios
-- =============================================================
--
-- Reportado por el dueño en QA real:
-- "entro a plomería y aparece la foto del electricista"
-- "las fotos de todos los servicios están bugeadas"
--
-- Causa:
--   - El seed original cargó URLs de imagen incorrectas (foto eléctrica para
--     plomero, etc.) y varias se duplicaban entre servicios distintos.
--   - Cada servicio tenía 1 sola imagen → la galería en /HTML/servicio.html
--     quedaba con 1 thumbnail huérfano debajo de la imagen principal.
--
-- Esta migration:
--   - Reemplaza la columna `images` (TEXT[]) de cada servicio existente con
--     un array de 3 URLs específicas y coherentes con el rubro.
--   - Las URLs son de Unsplash (uso libre) con dimensiones uniformes
--     (?w=600&h=400 para main, el frontend deriva thumbnails).
--   - Idempotente: usa WHERE id = X para que correr 2 veces no rompa nada.
--
-- Si querés agregar / cambiar imágenes de un servicio individual en el
-- futuro, hacelo desde el panel admin o vía:
--   UPDATE services SET images = ARRAY[...] WHERE id = X;
-- =============================================================

BEGIN;

-- 1. Plomero matriculado
UPDATE services SET images = ARRAY[
  'https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1542013936693-884638332954?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1585704032915-c3400ca199e7?w=600&h=400&fit=crop'
] WHERE id = 1;

-- 2. Instalaciones sanitarias
UPDATE services SET images = ARRAY[
  'https://images.unsplash.com/photo-1620626011761-996317b8d101?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=600&h=400&fit=crop'
] WHERE id = 2;

-- 3. Electricista matriculado
UPDATE services SET images = ARRAY[
  'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1565608438257-fac3c27beb36?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1517490232338-06b912a786b5?w=600&h=400&fit=crop'
] WHERE id = 3;

-- 4. Instalación de aires acondicionados Split
UPDATE services SET images = ARRAY[
  'https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1581094288338-2314dddb7ece?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=600&h=400&fit=crop'
] WHERE id = 4;

-- 5. Gasista matriculado
UPDATE services SET images = ARRAY[
  'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1574359411659-15573a27fd0c?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1556909172-54557c7e4fb7?w=600&h=400&fit=crop'
] WHERE id = 5;

-- 6. Peluquera a domicilio
UPDATE services SET images = ARRAY[
  'https://images.unsplash.com/photo-1562322140-8baeececf3df?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1605497788044-5a32c7078486?w=600&h=400&fit=crop'
] WHERE id = 6;

-- 7. Servicio de limpieza profunda
UPDATE services SET images = ARRAY[
  'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1563453392212-326f5e854473?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1527515637462-cff94eecc1ac?w=600&h=400&fit=crop'
] WHERE id = 7;

-- 8. Limpieza de tapizados y alfombras
UPDATE services SET images = ARRAY[
  'https://images.unsplash.com/photo-1558317374-067fb5f30001?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1581578017093-cd30fce4eeb7?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1564540583246-934409427776?w=600&h=400&fit=crop'
] WHERE id = 8;

-- 9. Pintor de interiores y exteriores
UPDATE services SET images = ARRAY[
  'https://images.unsplash.com/photo-1562259929-b4e1fd3aef09?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1599619351208-3e6c839d6828?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=600&h=400&fit=crop'
] WHERE id = 9;

-- 10. Carpintero
UPDATE services SET images = ARRAY[
  'https://images.unsplash.com/photo-1500099817043-86d46000d58f?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1565793298595-6a879b1d9492?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1611273426858-450d8e3c9fce?w=600&h=400&fit=crop'
] WHERE id = 10;

-- 11. Mecánico a domicilio
UPDATE services SET images = ARRAY[
  'https://images.unsplash.com/photo-1530046339160-ce3e530c7d2f?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1486006920555-c77dcf18193c?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1487754180451-c456f719a1fc?w=600&h=400&fit=crop'
] WHERE id = 11;

-- 12. Técnico en PC
UPDATE services SET images = ARRAY[
  'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1591488320449-011701bb6704?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1547082299-de196ea013d6?w=600&h=400&fit=crop'
] WHERE id = 12;

-- 13. Desarrollo web y diseño
UPDATE services SET images = ARRAY[
  'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=600&h=400&fit=crop'
] WHERE id = 13;

-- 14. Clases de guitarra
UPDATE services SET images = ARRAY[
  'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1564186763535-ebb21ef5277f?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1525201548942-d8732f6617a0?w=600&h=400&fit=crop'
] WHERE id = 14;

-- 15. Fotografía profesional
UPDATE services SET images = ARRAY[
  'https://images.unsplash.com/photo-1452780212940-6f5c0d14d848?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1554080353-a576cf803bda?w=600&h=400&fit=crop'
] WHERE id = 15;

COMMIT;

-- Verificación post-migración (mostrar 3 servicios afectados)
SELECT id, title, array_length(images, 1) AS img_count, images[1] AS first_img
FROM services
WHERE id IN (1, 3, 8)
ORDER BY id;
