-- ============================================================
-- DALE DEAL - Datos iniciales (seed)
-- ============================================================

-- Categorías de productos
INSERT INTO product_categories (name, slug, icon) VALUES
  ('Electrónica',       'electronica',       'laptop'),
  ('Ropa y accesorios', 'ropa-accesorios',   'shirt'),
  ('Hogar y jardín',    'hogar-jardin',      'home'),
  ('Deportes',          'deportes',          'activity'),
  ('Juguetes',          'juguetes',          'star'),
  ('Vehículos',         'vehiculos',         'car'),
  ('Inmuebles',         'inmuebles',         'building'),
  ('Otros',             'otros',             'package');

-- Categorías de servicios
INSERT INTO service_categories (name, slug, icon) VALUES
  ('Plomería',          'plomeria',          'droplet'),
  ('Electricidad',      'electricidad',      'zap'),
  ('Gasista',           'gasista',           'flame'),
  ('Peluquería',        'peluqueria',        'scissors'),
  ('Limpieza',          'limpieza',          'wind'),
  ('Pintura',           'pintura',           'paintbrush'),
  ('Carpintería',       'carpinteria',       'hammer'),
  ('Mecánica',          'mecanica',          'settings'),
  ('Informática',       'informatica',       'monitor'),
  ('Otros servicios',   'otros-servicios',   'briefcase');
