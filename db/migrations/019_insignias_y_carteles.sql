-- 019: insignias de usuario y carteles de publicaciones.
--  - users.badges:    las asigna un admin desde el panel (CEO, Fundador, Equipo,
--                     Vendedor Fundador, …). "Verificado" y "Título" no van acá:
--                     salen de aprobar la verificación (verified_identity /
--                     verified_professional).
--  - products.badges / services.badges: hasta 2 carteles [{ text, color }] que
--                     el vendedor carga en Publicar y se ven sobre la foto.
-- El backend tolera que no esté aplicada (sin estas columnas no hay insignias
-- ni carteles, pero el sitio sigue andando), así que da lo mismo correrla
-- antes o después del deploy.
ALTER TABLE users    ADD COLUMN IF NOT EXISTS badges JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS badges JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE services ADD COLUMN IF NOT EXISTS badges JSONB NOT NULL DEFAULT '[]'::jsonb;
