-- 020 · Categorías para los rubros de los vendedores fundadores (30/10/2026).
-- Idempotente: se puede correr más de una vez. Correr en producción desde
-- Railway → Postgres → Console:  psql -U postgres -d railway  y pegar todo.
-- Los filtros del front (productos.html / servicios.html) y el select de
-- Publicar usan estos slugs; el front correspondiente se deploya después.

-- Productos: herramientas/ferretería (3 fundadores), electrodomésticos (2),
-- decoración y artesanías (4), alimentos y bebidas (2), mascotas (1).
INSERT INTO product_categories (name, slug, icon) VALUES
  ('Herramientas y ferretería',  'herramientas-ferreteria',  'wrench'),
  ('Electrodomésticos',          'electrodomesticos',        'plug'),
  ('Decoración y artesanías',    'decoracion-artesanias',    'palette'),
  ('Alimentos y bebidas',        'alimentos-bebidas',        'coffee'),
  ('Mascotas',                   'mascotas',                 'heart')
ON CONFLICT (slug) DO NOTHING;

-- Servicios: Peluquería pasa a "Belleza y estética" (barbería, estética, uñas;
-- mismo id 4, las publicaciones existentes no se mueven) + eventos (2-3
-- fundadores), service técnico (aires/electro/celulares), marketing y diseño.
UPDATE service_categories
   SET name = 'Belleza y estética', slug = 'belleza-estetica', icon = 'scissors'
 WHERE slug = 'peluqueria';

INSERT INTO service_categories (name, slug, icon) VALUES
  ('Eventos',              'eventos',          'party-popper'),
  ('Service técnico',      'service-tecnico',  'wrench'),
  ('Marketing y diseño',   'marketing-diseno', 'megaphone')
ON CONFLICT (slug) DO NOTHING;
