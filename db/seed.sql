-- ============================================================
-- DALE DEAL — Seed completo v2.0
-- Incluye: categorías, usuarios de prueba, productos, servicios y reseñas
--
-- Cómo ejecutar:
--   npm run db:schema   ← primero el esquema
--   npm run db:seed     ← luego este seed
--
-- Usuarios de prueba (todos con password: Demo1234)
--   ana.garcia@daledeal.com
--   carlos.ruiz@daledeal.com
--   maria.lopez@daledeal.com
--   jorge.fernandez@daledeal.com
--   lucia.gomez@daledeal.com
-- ============================================================

BEGIN;

-- Limpieza en orden para respetar FK
TRUNCATE TABLE reviews, favorites, orders, services, products,
               service_categories, product_categories, users
  RESTART IDENTITY CASCADE;

-- ============================================================
-- CATEGORÍAS DE PRODUCTOS
-- ============================================================
INSERT INTO product_categories (name, slug, icon) VALUES
  ('Electrónica',        'electronica',      'laptop'),
  ('Ropa y accesorios',  'ropa-accesorios',  'shirt'),
  ('Hogar y jardín',     'hogar-jardin',     'home'),
  ('Deportes',           'deportes',         'activity'),
  ('Juguetes',           'juguetes',         'star'),
  ('Vehículos',          'vehiculos',        'car'),
  ('Inmuebles',          'inmuebles',        'building'),
  ('Otros',              'otros',            'package');

-- ============================================================
-- CATEGORÍAS DE SERVICIOS
-- ============================================================
INSERT INTO service_categories (name, slug, icon) VALUES
  ('Plomería',           'plomeria',         'droplet'),
  ('Electricidad',       'electricidad',     'zap'),
  ('Gasista',            'gasista',          'flame'),
  ('Peluquería',         'peluqueria',       'scissors'),
  ('Limpieza',           'limpieza',         'wind'),
  ('Pintura',            'pintura',          'paintbrush'),
  ('Carpintería',        'carpinteria',      'hammer'),
  ('Mecánica',           'mecanica',         'settings'),
  ('Informática',        'informatica',      'monitor'),
  ('Otros servicios',    'otros-servicios',  'briefcase');

-- ============================================================
-- USUARIOS DE PRUEBA
-- password: Demo1234  (bcrypt 12 rounds)
-- ============================================================
INSERT INTO users (name, email, password_hash, avatar_url, phone, location, role, is_active) VALUES
(
  'Ana García',
  'ana.garcia@daledeal.com',
  '$2a$12$51/hY2onfc0IPuhQScYvGOY.4SChAtzaQ9DTML/fBlnebudyGS142',
  'https://ui-avatars.com/api/?name=Ana+Garcia&background=D63031&color=fff&size=128',
  '+54 11 4567-8901',
  'Buenos Aires, CABA',
  'user',
  true
),
(
  'Carlos Ruiz',
  'carlos.ruiz@daledeal.com',
  '$2a$12$51/hY2onfc0IPuhQScYvGOY.4SChAtzaQ9DTML/fBlnebudyGS142',
  'https://ui-avatars.com/api/?name=Carlos+Ruiz&background=2d3436&color=fff&size=128',
  '+54 351 456-7890',
  'Córdoba Capital',
  'user',
  true
),
(
  'María López',
  'maria.lopez@daledeal.com',
  '$2a$12$51/hY2onfc0IPuhQScYvGOY.4SChAtzaQ9DTML/fBlnebudyGS142',
  'https://ui-avatars.com/api/?name=Maria+Lopez&background=6c5ce7&color=fff&size=128',
  '+54 341 567-8901',
  'Rosario, Santa Fe',
  'user',
  true
),
(
  'Jorge Fernández',
  'jorge.fernandez@daledeal.com',
  '$2a$12$51/hY2onfc0IPuhQScYvGOY.4SChAtzaQ9DTML/fBlnebudyGS142',
  'https://ui-avatars.com/api/?name=Jorge+Fernandez&background=00b894&color=fff&size=128',
  '+54 261 678-9012',
  'Mendoza Capital',
  'user',
  true
),
(
  'Lucía Gómez',
  'lucia.gomez@daledeal.com',
  '$2a$12$51/hY2onfc0IPuhQScYvGOY.4SChAtzaQ9DTML/fBlnebudyGS142',
  'https://ui-avatars.com/api/?name=Lucia+Gomez&background=e17055&color=fff&size=128',
  '+54 387 789-0123',
  'Salta Capital',
  'user',
  true
);

-- ============================================================
-- PRODUCTOS (30 en total)
-- seller_id hace referencia al ID de usuario (1-5)
-- category_id hace referencia al ID de categoría de productos (1-8)
-- ============================================================

-- === ELECTRÓNICA (category_id = 1) ===
INSERT INTO products (seller_id, category_id, title, description, price, currency, condition, stock, images, location, status) VALUES
(
  1, 1,
  'iPhone 14 Pro 256GB - Space Black',
  'Vendo iPhone 14 Pro en perfectas condiciones. Batería al 94%, con funda y cargador original. Sin rayones. Caja original incluida. Comprado en diciembre 2023.',
  1200000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1678685888221-cda773a3dcdb?w=600', 'https://images.unsplash.com/photo-1510557880182-3d4d3cba35a5?w=600'],
  'Buenos Aires, CABA',
  'active'
),
(
  2, 1,
  'MacBook Air M2 - Midnight 8GB/256GB',
  'MacBook Air M2 chip 8GB RAM 256GB SSD. Excelente estado, uso universitario. Batería con 87 ciclos. Incluye cargador MagSafe y funda de neoprene.',
  1800000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600', 'https://images.unsplash.com/photo-1611186871525-b5bba3b7b48d?w=600'],
  'Córdoba Capital',
  'active'
),
(
  3, 1,
  'Samsung Galaxy S23 Ultra 256GB',
  'Galaxy S23 Ultra con S-Pen incluido. Color Phantom Black. Batería al 91%. Siempre con funda y vidrio templado. Funciona perfecto.',
  950000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=600'],
  'Rosario, Santa Fe',
  'active'
),
(
  4, 1,
  'Smart TV Samsung 55" QLED 4K',
  'TV Samsung 55 pulgadas QLED 4K UHD. 2 años de uso, imagen impecable. Incluye control remoto, cables HDMI y soporte de pared (no instalado). Modelo QN55Q60BAGXZS.',
  480000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1593784991095-a205069470b6?w=600'],
  'Mendoza Capital',
  'active'
),
(
  5, 1,
  'PlayStation 5 + 2 Joysticks + 3 juegos',
  'PS5 edición estándar con lector de disco. 2 controles DualSense (uno azul, uno blanco). Juegos: Spider-Man 2, God of War Ragnarök, Horizon Forbidden West. Todo en perfecto estado.',
  950000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=600'],
  'Salta Capital',
  'active'
),
(
  1, 1,
  'AirPods Pro 2da Generación',
  'AirPods Pro segunda gen. con cancelación activa de ruido. Estuche con carga MagSafe. Batería al 96%. Incluye puntas de silicona talla S/M/L y caja original.',
  280000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600'],
  'Buenos Aires, CABA',
  'active'
),
(
  2, 1,
  'Notebook Lenovo IdeaPad 5 Pro 14"',
  'Lenovo IdeaPad 5 Pro con Ryzen 7 5800H, 16GB RAM DDR4, SSD NVMe 512GB. Pantalla 14" 2.8K OLED. Excelente para trabajo y gaming liviano. Con bolso incluido.',
  720000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600'],
  'Córdoba Capital',
  'active'
),

-- === ROPA Y ACCESORIOS (category_id = 2) ===
(
  3, 2,
  'Campera The North Face Thermoball - Talle L',
  'Campera de plumas sintéticas The North Face Thermoball. Color negro. Talle L. Muy poco uso, como nueva. Ideal para invierno o trekking. Original, con etiquetas.',
  85000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1544441893-675973e31985?w=600'],
  'Rosario, Santa Fe',
  'active'
),
(
  4, 2,
  'Zapatillas Nike Air Max 90 - Talle 42',
  'Nike Air Max 90 en blanco/gris. Talle 42 ARG. Usadas 2 veces solamente. Vienen con caja original. Compradas en Miami.',
  120000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600'],
  'Mendoza Capital',
  'active'
),
(
  5, 2,
  'Reloj Casio G-Shock GA-2100',
  'Casio G-Shock GA-2100 "CasiOak" en negro mate. Resistente al agua 200m, analógico-digital. Excelente estado. Con caja y documentación original.',
  65000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600'],
  'Salta Capital',
  'active'
),
(
  1, 2,
  'Mochila Osprey Farpoint 40L',
  'Mochila de viaje Osprey Farpoint 40L. Color verde musgo. Muy buen estado, viajé con ella 2 veces. Ideal para carry-on. Múltiples compartimentos, cintura ergonómica.',
  55000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600'],
  'Buenos Aires, CABA',
  'active'
),

-- === HOGAR Y JARDÍN (category_id = 3) ===
(
  2, 3,
  'Sillón de cuero marrón 3 cuerpos',
  'Sillón de cuero genuino marrón oscuro, 3 cuerpos. Excelente estado, muy cómodo. 220cm de largo. Me mudo y no entra. Retiro por Córdoba Capital únicamente.',
  180000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=600'],
  'Córdoba Capital',
  'active'
),
(
  3, 3,
  'Robot aspiradora Roomba i3+',
  'Roomba i3+ con base de vaciado automático. Funciona perfecto. Incluye filtros de repuesto y cepillos. App configurada, lista para usar. Ideal para dueños de mascotas.',
  280000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600'],
  'Rosario, Santa Fe',
  'active'
),
(
  4, 3,
  'Set de ollas Tramontina 7 piezas - Inox',
  'Set de ollas Tramontina Professional de acero inoxidable. 7 piezas: 2 ollas (20 y 24cm), 1 cacerola, 1 sartén, 1 pavera y 2 tapas. Impecables.',
  75000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?w=600'],
  'Mendoza Capital',
  'active'
),
(
  5, 3,
  'Cafetera Nespresso Vertuo Plus + 40 cápsulas',
  'Cafetera Nespresso Vertuo Plus en negro. Funciona perfecto. Incluye aeroccino para espumar leche y 40 cápsulas surtidas. Muy poco uso.',
  95000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600'],
  'Salta Capital',
  'active'
),

-- === DEPORTES (category_id = 4) ===
(
  1, 4,
  'Bicicleta de montaña Trek Marlin 5 rodado 29',
  'Trek Marlin 5 2022, rodado 29. Cuadro aluminio talla M. Cambios Shimano Altus 21 velocidades. Frenos a disco mecánicos. Muy buen estado. Ideal para XC y senderos.',
  320000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1576435728678-68d0fbf94e91?w=600'],
  'Buenos Aires, CABA',
  'active'
),
(
  2, 4,
  'Kit pesas ajustables Bowflex SelectTech 552',
  'Mancuernas ajustables Bowflex SelectTech 552. Ajuste de 2.5kg a 24kg. Como nuevas, usadas en casa. Incluye soporte original. Perfectas para entrenar en casa.',
  195000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1584466977773-e625c37cdd50?w=600'],
  'Córdoba Capital',
  'active'
),
(
  3, 4,
  'Raqueta de tenis Wilson Blade 98 v8',
  'Wilson Blade 98 (16x19) v8. Encordado Luxilon ALU Power a 57 libras. Grip 2 original. Muy buen estado, la usé 6 meses. Ideal para jugador avanzado.',
  85000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=600'],
  'Rosario, Santa Fe',
  'active'
),

-- === JUGUETES (category_id = 5) ===
(
  4, 5,
  'LEGO Technic Ferrari Daytona SP3 - Set 42143',
  'LEGO Technic Ferrari Daytona SP3 (set 42143). Armado una sola vez. Incluye todas las piezas y manual. Impecable. Ideal para coleccionistas.',
  280000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=600'],
  'Mendoza Capital',
  'active'
),
(
  5, 5,
  'Hot Wheels colección 50 autos + pista loop',
  'Colección de 50 autos Hot Wheels variados más pista con loop doble. Excelente estado, pocos usos. Ideal regalo para nenes de 4 a 10 años.',
  35000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=600'],
  'Salta Capital',
  'active'
),

-- === VEHÍCULOS (category_id = 6) ===
(
  1, 6,
  'Ford Focus III 2015 2.0 N AT6 - 80.000km',
  'Ford Focus III SE Plus 2.0 nafta automático 2015. 80.000km reales con service en concesionaria. Full equipo, techos panorámicos, GPS, cámara de retroceso. Excelente estado.',
  8500000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=600'],
  'Buenos Aires, CABA',
  'active'
),
(
  2, 6,
  'Moto Yamaha MT-03 2022 - 15.000km',
  'Yamaha MT-03 ABS 2022. Color gris mate. 15.000km con services al día. Excelente estado. Con baúl y protecciones incluidas. Listo para el verano.',
  4200000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600'],
  'Córdoba Capital',
  'active'
),

-- === ELECTRÓNICA nuevos (category_id = 1) ===
(
  3, 1,
  'iPad Pro 11" M2 256GB WiFi + Apple Pencil 2',
  'iPad Pro 11 pulgadas M2 chip 256GB WiFi. Color Space Gray. Con Apple Pencil 2da gen (magnético). Excelente para ilustración y trabajo. Batería al 98%.',
  980000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600'],
  'Rosario, Santa Fe',
  'active'
),
(
  4, 1,
  'Cámara Sony Alpha A7III + lente 28-70mm',
  'Sony Alpha A7III mirrorless full frame con lente kit 28-70mm OSS. 12.000 disparos aprox. Excelente estado. Incluye 2 baterías, cargador doble y bolso Lowepro.',
  1450000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=600'],
  'Mendoza Capital',
  'active'
),
(
  5, 1,
  'Monitor LG 27" 4K IPS - 27UK850',
  'Monitor LG 27UK850 27 pulgadas 4K IPS. Excelente para diseño y edición. Puerto USB-C con carga de 60W. HDR10. Calibrado de fábrica. Soporte VESA incluido.',
  380000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1551816230-ef5deaed4a26?w=600'],
  'Salta Capital',
  'active'
),

-- === HOGAR (category_id = 3) ===
(
  1, 3,
  'Escritorio de madera maciza + silla ergonómica',
  'Escritorio de quebracho colorado 140x70cm y silla ergonómica con soporte lumbar. Excelente setup para home office. Todo en perfecto estado. Retiro en Palermo.',
  95000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=600'],
  'Buenos Aires, CABA',
  'active'
),
(
  2, 3,
  'Termotanque Rheem 80L - Gas natural',
  'Termotanque a gas natural Rheem 80 litros. Funcionando perfectamente. Me cambio a calefón. 4 años de uso, service al día. Listo para instalar. Sin rotura.',
  65000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=600'],
  'Córdoba Capital',
  'active'
),

-- === DEPORTES (category_id = 4) ===
(
  3, 4,
  'Kayak Perception Swifty 9.5 + remo',
  'Kayak recreativo Perception Swifty 9.5. Para una persona, 150kg de carga. Color naranja. Excelente estado, muy pocas salidas. Incluye remo de aluminio y chaleco salvavidas.',
  185000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600'],
  'Rosario, Santa Fe',
  'active'
),

-- === OTROS (category_id = 8) ===
(
  4, 8,
  'Guitarra eléctrica Fender Stratocaster Player',
  'Fender Stratocaster Player Series en Polar White con diapasón de pau ferro. Excelente estado. Incluye funda Fender, correa y cable. Perfecta para el nivel inicial a intermedio.',
  420000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=600'],
  'Mendoza Capital',
  'active'
),
(
  5, 8,
  'Set de fotografía: 2 flash Godox + softboxes',
  'Set de iluminación fotográfica: 2 flash Godox SK400II, 2 softboxes octagonales 95cm, 2 trípodes y trigger radio. Excelente para retratos y producto.',
  180000,
  'ARS',
  'used',
  1,
  ARRAY['https://images.unsplash.com/photo-1452780212940-6f5c0d14d848?w=600'],
  'Salta Capital',
  'active'
);

-- ============================================================
-- SERVICIOS (15 en total)
-- ============================================================
INSERT INTO services (provider_id, category_id, title, description, price_from, price_to, price_type, images, location, zones_covered, status) VALUES
-- === PLOMERÍA (category_id = 1) ===
(
  1, 1,
  'Plomero matriculado - urgencias 24hs',
  'Plomero matriculado con 15 años de experiencia. Destapaciones, roturas de cañerías, instalación de termotanques y calefones, colocación de sanitarios. Atención de urgencias las 24 horas. Presupuesto sin cargo.',
  8000, 35000, 'quote',
  ARRAY['https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600'],
  'Buenos Aires, CABA',
  ARRAY['CABA', 'GBA Norte'],
  'active'
),
(
  2, 1,
  'Instalaciones sanitarias - construcción y reforma',
  'Especialista en instalaciones sanitarias para construcción y reforma de baños y cocinas. Presupuesto gratis. Garantía escrita en todos los trabajos. Más de 200 obras realizadas.',
  15000, 80000, 'quote',
  ARRAY['https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=600'],
  'Córdoba Capital',
  ARRAY['Córdoba Capital', 'Gran Córdoba'],
  'active'
),

-- === ELECTRICIDAD (category_id = 2) ===
(
  3, 2,
  'Electricista matriculado - instalaciones y reparaciones',
  'Electricista matriculado habilitado por ENRE. Instalaciones eléctricas, tableros, iluminación LED, domótica básica. Certificados de instalación. Respaldo de seguro.',
  10000, 45000, 'quote',
  ARRAY['https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=600'],
  'Rosario, Santa Fe',
  ARRAY['Rosario', 'Gran Rosario'],
  'active'
),
(
  4, 2,
  'Instalación de aires acondicionados Split',
  'Instalación profesional de aires acondicionados de 1 a 6 frigorías. Split, Multi-split, cassette. Incluye gas, conexionado y puesta en marcha. Garantía 6 meses en instalación.',
  18000, 45000, 'fixed',
  ARRAY['https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=600'],
  'Mendoza Capital',
  ARRAY['Mendoza Capital', 'Gran Mendoza'],
  'active'
),

-- === GASISTA (category_id = 3) ===
(
  5, 3,
  'Gasista matriculado - instalaciones y service',
  'Gasista matriculado por Ecogas. Service de calefones, estufas y termotanques. Detección de pérdidas de gas. Habilitaciones. Urgencias. Certificados oficiales.',
  7000, 30000, 'quote',
  ARRAY['https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=600'],
  'Salta Capital',
  ARRAY['Salta Capital'],
  'active'
),

-- === PELUQUERÍA (category_id = 4) ===
(
  1, 4,
  'Peluquera a domicilio - corte, color y peinado',
  'Peluquera profesional con 10 años de experiencia. Voy a tu domicilio con todos los materiales. Especialidad en coloración y técnicas de aclarado. Martes a sábado con turno previo.',
  5000, 15000, 'fixed',
  ARRAY['https://images.unsplash.com/photo-1562322140-8baeececf3df?w=600'],
  'Buenos Aires, CABA',
  ARRAY['Palermo', 'Belgrano', 'Núñez', 'Colegiales'],
  'active'
),

-- === LIMPIEZA (category_id = 5) ===
(
  2, 5,
  'Servicio de limpieza profunda de hogar',
  'Limpieza profunda de casas, departamentos y oficinas. Incluye baños, cocina, pisos y ventanas. Personal de confianza con referencias. Productos incluidos. Presupuesto gratis.',
  8000, 25000, 'quote',
  ARRAY['https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=600'],
  'Córdoba Capital',
  ARRAY['Córdoba Capital'],
  'active'
),
(
  3, 5,
  'Limpieza de tapizados y alfombras al vapor',
  'Lavado y saneado de sillones, colchones, alfombras y tapizados de autos. Equipo profesional al vapor. Eliminación de ácaros y bacterias. Resultado garantizado o se repite.',
  12000, 40000, 'quote',
  ARRAY['https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600'],
  'Rosario, Santa Fe',
  ARRAY['Rosario', 'zona sur'],
  'active'
),

-- === PINTURA (category_id = 6) ===
(
  4, 6,
  'Pintor de interiores y exteriores - Presupuesto gratis',
  'Pintura de departamentos, casas y locales comerciales. Interior y exterior. Látex, esmalte, frentes. Trabajo prolijo con garantía. Más de 300 proyectos en toda la región.',
  15000, 90000, 'quote',
  ARRAY['https://images.unsplash.com/photo-1562259929-b4e1fd3aef09?w=600'],
  'Mendoza Capital',
  ARRAY['Mendoza Capital', 'Gran Mendoza'],
  'active'
),

-- === CARPINTERÍA (category_id = 7) ===
(
  5, 7,
  'Carpintero - muebles a medida y reparaciones',
  'Fabricación de muebles a medida: cocinas, placares, bibliotecas, escritorios. Reparación de muebles. Materiales de primera calidad. Diseño a gusto del cliente. Presupuesto sin cargo.',
  20000, 150000, 'quote',
  ARRAY['https://images.unsplash.com/photo-1500099817043-86d46000d58f?w=600'],
  'Salta Capital',
  ARRAY['Salta Capital', 'alrededores'],
  'active'
),

-- === MECÁNICA (category_id = 8) ===
(
  1, 8,
  'Mecánico a domicilio - autos y motos',
  'Mecánico con 20 años de experiencia. Service a domicilio para autos y motos. Aceite, filtros, frenos, correa de distribución. Sin taller, más cómodo para vos. Presupuesto gratis.',
  8000, 50000, 'quote',
  ARRAY['https://images.unsplash.com/photo-1530046339160-ce3e530c7d2f?w=600'],
  'Buenos Aires, CABA',
  ARRAY['CABA', 'GBA'],
  'active'
),

-- === INFORMÁTICA (category_id = 9) ===
(
  2, 9,
  'Técnico en PC - reparación y optimización',
  'Reparación de computadoras, notebooks y netbooks. Formateo e instalación de Windows/Linux. Limpieza interna. Cambio de pasta térmica. Recuperación de datos. A domicilio o taller.',
  5000, 25000, 'fixed',
  ARRAY['https://images.unsplash.com/photo-1518770660439-4636190af475?w=600'],
  'Córdoba Capital',
  ARRAY['Córdoba Capital'],
  'active'
),
(
  3, 9,
  'Desarrollo web y diseño - freelance',
  'Diseño y desarrollo de sitios web, tiendas online y landing pages. HTML/CSS/JS, React, WordPress. SEO básico incluido. Portfolio disponible. Entrega en 2-4 semanas según proyecto.',
  50000, 300000, 'quote',
  ARRAY['https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=600'],
  'Rosario, Santa Fe',
  ARRAY['Todo el país (remoto)'],
  'active'
),

-- === OTROS SERVICIOS (category_id = 10) ===
(
  4, 10,
  'Clases de guitarra para principiantes y avanzados',
  'Profe de guitarra con 12 años de experiencia. Clases presenciales o por Zoom. Todos los géneros: rock, pop, folklore, clásica. Niños y adultos. Primera clase de prueba gratis.',
  4000, 6000, 'hourly',
  ARRAY['https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=600'],
  'Mendoza Capital',
  ARRAY['Mendoza Capital', 'remoto'],
  'active'
),
(
  5, 10,
  'Fotografía profesional - eventos y retratos',
  'Fotógrafo profesional para bodas, cumpleaños, 15 años, eventos corporativos y sesiones de retratos. Entrega de galería digital en 7 días. Más de 5 años de experiencia.',
  30000, 120000, 'quote',
  ARRAY['https://images.unsplash.com/photo-1452780212940-6f5c0d14d848?w=600'],
  'Salta Capital',
  ARRAY['Salta', 'Jujuy', 'NOA'],
  'active'
);

-- ============================================================
-- RESEÑAS DE EJEMPLO
-- ============================================================
INSERT INTO reviews (reviewer_id, item_type, item_id, rating, title, body) VALUES
(2, 'product', 1, 5, 'Todo impecable', 'El iPhone llegó exactamente como lo describió. Vendedor muy confiable y rápido para responder. Lo recomiendo.'),
(3, 'product', 2, 5, 'Excelente negocio', 'La MacBook está en perfectas condiciones, batería nueva prácticamente. El vendedor muy buena onda, super recomendado.'),
(4, 'product', 6, 4, 'Muy buenos AirPods', 'Los AirPods funcionan perfecto. Le bajo una estrella porque tardó 2 días más de lo acordado en hacer el envío, pero el producto es tal cual se describió.'),
(1, 'service', 1, 5, 'Plomero de 10', 'Llamé a las 11pm por una pérdida importante y vino en menos de una hora. Resolvió el problema rápido y cobró lo justo. Volveré a llamarlo sin dudas.'),
(3, 'service', 3, 5, 'Muy profesional', 'Electricista super prolijo y matriculado como corresponde. Me dio el certificado de instalación y todo quedó perfecto. Muy recomendable.'),
(5, 'service', 6, 4, 'Buena peluquera', 'Vino a domicilio con todo el material. El corte quedó muy bien. Le pongo 4 estrellas porque llegó 20 minutos tarde pero avisó con anticipación.');

-- ============================================================
-- Actualizar views para que no arranquen en 0
-- ============================================================
UPDATE products SET views = FLOOR(RANDOM() * 300 + 20)::INTEGER;

COMMIT;

-- Verificación final
SELECT 'users'              AS tabla, COUNT(*) AS total FROM users
UNION ALL
SELECT 'products',          COUNT(*) FROM products
UNION ALL
SELECT 'services',          COUNT(*) FROM services
UNION ALL
SELECT 'product_categories',COUNT(*) FROM product_categories
UNION ALL
SELECT 'service_categories',COUNT(*) FROM service_categories
UNION ALL
SELECT 'reviews',           COUNT(*) FROM reviews
ORDER BY tabla;
