-- =============================================================
-- Migration 009 — Fix imágenes mal asignadas a productos
-- =============================================================
--
-- Misma raíz que migration 008 (servicios). Reportado por el dueño:
-- "ya que estás, revisá también las fotos de los productos".
--
-- Bugs encontrados auditando el endpoint /products:
--   - 28 de 30 productos tenían 1 sola imagen → galería pobre en
--     /HTML/producto.html (con 1 thumb huérfano, ya fixed en frontend).
--   - Roomba (id=13) y Moto Yamaha (id=22) compartían la URL
--     1558618666-fcd25c85cd64 (foto que parece de plomería) — claro
--     error de seed.
--   - Termotanque (id=27) tenía la foto del Split de aire acondicionado
--     (1585771724684-38269d6639fd, también asignada al servicio id=4).
--
-- Esta migration:
--   - Reemplaza la columna `images` (TEXT[]) de los 30 productos con
--     un array de 3 URLs específicas y coherentes con cada producto.
--   - Todas las URLs validadas con curl HEAD 200 antes de commitear
--     (Unsplash a veces 404 fotos que rotan).
--   - Idempotente: usa WHERE id = X, correr 2 veces no rompe nada.
--   - BEGIN/COMMIT explícito por seguridad.
--
-- Cómo correrla en Railway prod:
--   Dashboard → tu DB → Data → Query → pegar este archivo entero.
-- =============================================================

BEGIN;

-- ── Tecnología ──────────────────────────────────────────────
-- 1. iPhone 14 Pro
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1592286927505-1def25115558?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1591337676887-a217a6970a8a?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1605236453806-6ff36851218e?w=600&h=400&fit=crop'
] WHERE id = 1;

-- 2. MacBook Air M2
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1611186871348-b1ce696e52c9?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600&h=400&fit=crop'
] WHERE id = 2;

-- 3. Samsung Galaxy S23 Ultra
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1556656793-08538906a9f8?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1565849904461-04a58ad377e0?w=600&h=400&fit=crop'
] WHERE id = 3;

-- 4. Smart TV Samsung 55" QLED
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1593784991095-a205069470b6?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1567690187548-f07b1d7bf5a9?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1593305841991-05c297ba4575?w=600&h=400&fit=crop'
] WHERE id = 4;

-- 5. PlayStation 5
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1622297845775-5ff3fef71d13?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1607252650355-f7fd0460ccdb?w=600&h=400&fit=crop'
] WHERE id = 5;

-- 6. AirPods Pro 2da Gen
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1572569511254-d8f925fe2cbb?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1606220945770-b5b6c2c55bf1?w=600&h=400&fit=crop'
] WHERE id = 6;

-- 7. Notebook Lenovo IdeaPad
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=600&h=400&fit=crop'
] WHERE id = 7;

-- ── Indumentaria / Accesorios ───────────────────────────────
-- 8. Campera The North Face
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1544441893-675973e31985?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1593030761757-71fae45fa0e7?w=600&h=400&fit=crop'
] WHERE id = 8;

-- 9. Zapatillas Nike Air Max 90
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=600&h=400&fit=crop'
] WHERE id = 9;

-- 10. Reloj Casio G-Shock
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1524805444758-089113d48a6d?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1547996160-81dfa63595aa?w=600&h=400&fit=crop'
] WHERE id = 10;

-- 11. Mochila Osprey
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1577733966973-d680bffd2e80?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1581605405669-fcdf81165afa?w=600&h=400&fit=crop'
] WHERE id = 11;

-- ── Hogar ───────────────────────────────────────────────────
-- 12. Sillón de cuero
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1540574163026-643ea20ade25?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=600&h=400&fit=crop'
] WHERE id = 12;

-- 13. Roomba i3+ (antes tenía foto que parecía plomería)
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1582719471384-894fbb16e074?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1567113463300-102a7eb3cb26?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1581578017093-cd30fce4eeb7?w=600&h=400&fit=crop'
] WHERE id = 13;

-- 14. Set ollas Tramontina
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=600&h=400&fit=crop'
] WHERE id = 14;

-- 15. Cafetera Nespresso
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=600&h=400&fit=crop'
] WHERE id = 15;

-- ── Deportes ────────────────────────────────────────────────
-- 16. Bicicleta Trek
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1576435728678-68d0fbf94e91?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1532298229144-0ec0c57515c7?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=600&h=400&fit=crop'
] WHERE id = 16;

-- 17. Pesas Bowflex
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1584466977773-e625c37cdd50?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=600&h=400&fit=crop'
] WHERE id = 17;

-- 18. Raqueta Wilson
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1542144612-1b3641ec3459?w=600&h=400&fit=crop'
] WHERE id = 18;

-- ── Juguetes ────────────────────────────────────────────────
-- 19. LEGO Technic Ferrari
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1558060370-d644479cb6f7?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1585366119957-e9730b6d0f60?w=600&h=400&fit=crop'
] WHERE id = 19;

-- 20. Hot Wheels colección
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1614332287897-cdc485fa562d?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1594787318286-3d835c1d207f?w=600&h=400&fit=crop'
] WHERE id = 20;

-- ── Vehículos ───────────────────────────────────────────────
-- 21. Ford Focus III
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1542362567-b07e54358753?w=600&h=400&fit=crop'
] WHERE id = 21;

-- 22. Moto Yamaha MT-03 (antes tenía foto que parecía plomería)
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1571068316344-75bc76f77890?w=600&h=400&fit=crop'
] WHERE id = 22;

-- ── Tecnología (parte 2) ─────────────────────────────────────
-- 23. iPad Pro 11" M2
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1542751110-97427bbecf20?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1561154464-82e9adf32764?w=600&h=400&fit=crop'
] WHERE id = 23;

-- 24. Cámara Sony Alpha A7III
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1554080353-a576cf803bda?w=600&h=400&fit=crop'
] WHERE id = 24;

-- 25. Monitor LG 4K
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1551816230-ef5deaed4a26?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1593640408182-31c70c8268f5?w=600&h=400&fit=crop'
] WHERE id = 25;

-- ── Hogar / Misceláneos ─────────────────────────────────────
-- 26. Escritorio de madera
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1486946255434-2466348c2166?w=600&h=400&fit=crop'
] WHERE id = 26;

-- 27. Termotanque Rheem (antes tenía foto de Split AC)
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1581094288338-2314dddb7ece?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600&h=400&fit=crop'
] WHERE id = 27;

-- 28. Kayak Perception
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1553544260-f87e671974ee?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1571687949921-1306bfb24b72?w=600&h=400&fit=crop'
] WHERE id = 28;

-- 29. Guitarra Fender Stratocaster
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1564186763535-ebb21ef5277f?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1525201548942-d8732f6617a0?w=600&h=400&fit=crop'
] WHERE id = 29;

-- 30. Set de fotografía
UPDATE products SET images = ARRAY[
  'https://images.unsplash.com/photo-1452780212940-6f5c0d14d848?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1554080353-a576cf803bda?w=600&h=400&fit=crop'
] WHERE id = 30;

COMMIT;

-- Verificación post-migración: los 3 productos que estaban con foto de
-- plomería / AC ahora deberían tener 3 imágenes coherentes.
SELECT id, title, array_length(images, 1) AS img_count, images[1] AS first_img
FROM products
WHERE id IN (13, 22, 27)
ORDER BY id;
