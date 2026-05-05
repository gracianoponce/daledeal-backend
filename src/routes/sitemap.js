const express = require('express');
const router  = express.Router();
const db      = require('../config/database');

const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://daledeal.com.ar';

/**
 * GET /sitemap-products.xml
 * Sitemap dinámico de todos los productos activos.
 * Lo consulta Google Search Console + se referencia en el sitemap.xml estático.
 */
router.get('/sitemap-products.xml', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, updated_at
         FROM products
        WHERE status = 'active'
        ORDER BY updated_at DESC
        LIMIT 50000`
    );

    const urls = result.rows.map(p => `
  <url>
    <loc>${SITE_URL}/HTML/producto.html?id=${p.id}</loc>
    <lastmod>${new Date(p.updated_at).toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`).join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}
</urlset>`;

    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=3600'); // 1 hora
    res.send(xml);
  } catch (err) {
    console.error('Error generando sitemap-products:', err);
    res.status(500).send('Error generando sitemap');
  }
});

/**
 * GET /sitemap-services.xml
 * Igual que productos pero para servicios.
 */
router.get('/sitemap-services.xml', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, updated_at
         FROM services
        WHERE status = 'active'
        ORDER BY updated_at DESC
        LIMIT 50000`
    );

    const urls = result.rows.map(s => `
  <url>
    <loc>${SITE_URL}/HTML/servicio.html?id=${s.id}</loc>
    <lastmod>${new Date(s.updated_at).toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`).join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}
</urlset>`;

    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (err) {
    console.error('Error generando sitemap-services:', err);
    res.status(500).send('Error generando sitemap');
  }
});

module.exports = router;
