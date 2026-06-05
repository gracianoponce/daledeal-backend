const express = require('express');
const router  = express.Router();
const auth         = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const {
  getStats,
  getStatsTimeseries,
  listUsers,
  updateUser,
  listProducts,
  updateProductStatus,
  listOrders,
  listReviews,
  deleteReview,
} = require('../controllers/adminController');
const { listReports, updateReport } = require('../controllers/reportsController');
const { refundOrder } = require('../controllers/paymentsController');
const { listLeads, updateLead } = require('../controllers/contactController');
const { listSubscribers } = require('../controllers/newsletterController');

// Toda la API admin requiere auth + rol admin
router.use(auth);
router.use(requireAdmin);

// Dashboard
router.get('/stats', getStats);
// Timeseries diarias para charts (default 30 días, max 365 via ?days=N)
router.get('/stats/timeseries', getStatsTimeseries);

// Usuarios
router.get('/users',         listUsers);
router.patch('/users/:id',   updateUser);

// Productos
router.get('/products',         listProducts);
router.patch('/products/:id',   updateProductStatus);

// Órdenes
router.get('/orders', listOrders);

// Reembolsos — POST /admin/orders/:id/refund
// Body opcional: { amount?: number, reason?: string }
// Sin amount → reembolso total. Con amount < total → parcial.
router.post('/orders/:id/refund', refundOrder);

// Leads B2B (vienen del form de contacto con tipo=empresa)
// GET    /admin/leads         — lista paginada, ?status= para filtrar
// PATCH  /admin/leads/:id     — actualiza status / notes
router.get('/leads',         listLeads);
router.patch('/leads/:id',   updateLead);

// Newsletter subscribers
router.get('/newsletter/subscribers', listSubscribers);

// ─── Export CSV (admin convenience: bajar a Excel/Sheets) ────────────────
// Helper que serializa rows a CSV.
function rowsToCsv(rows, columns) {
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // CSV INJECTION DEFENSE: si el valor empieza con =, +, -, @, |, %
    // Excel lo interpreta como fórmula. Un atacante podría poner
    // =cmd|'/c calc'!A1 en notes/mensaje y ejecutarlo cuando el admin
    // abre el CSV. Mitigation: prefijar con apóstrofe que Excel ignora
    // al renderizar pero invalida la fórmula.
    // OWASP CSV injection: https://owasp.org/www-community/attacks/CSV_Injection
    if (/^[=+\-@|%]/.test(s)) {
      s = "'" + s;
    }
    s = s.replace(/"/g, '""');
    return /[",\n\r]/.test(s) ? `"${s}"` : s;
  };
  const header = columns.map(c => c.label || c.key).join(',');
  const body = rows.map(r => columns.map(c => escape(r[c.key])).join(',')).join('\n');
  return header + '\n' + body;
}

const db = require('../config/database');

// GET /admin/leads.csv — todos los leads B2B
router.get('/leads.csv', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, nombre, apellido, email, telefono, asunto, mensaje,
              pedido_id, status, notes, created_at, updated_at
         FROM company_leads
        ORDER BY created_at DESC`
    );
    const csv = rowsToCsv(r.rows, [
      { key: 'id' }, { key: 'nombre' }, { key: 'apellido' }, { key: 'email' },
      { key: 'telefono' }, { key: 'asunto' }, { key: 'mensaje' }, { key: 'pedido_id' },
      { key: 'status' }, { key: 'notes' }, { key: 'created_at' }, { key: 'updated_at' },
    ]);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send('﻿' + csv); // BOM para Excel detecte UTF-8 correctamente
  } catch (err) {
    if (err.code === '42P01') return res.status(503).send('Tabla company_leads no existe (correr migration 010)');
    console.error('[admin/leads.csv] Error:', err);
    res.status(500).send('Error generando CSV');
  }
});

// GET /admin/orders.csv — todas las órdenes
router.get('/orders.csv', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT o.id, o.created_at, o.status, o.payment_status, o.total_price,
              o.commission_amount, o.currency, o.shipping_method, o.shipping_cost,
              o.tracking_number,
              p.title AS product_title,
              ub.email AS buyer_email, ub.name AS buyer_name,
              us.email AS seller_email, us.name AS seller_name
         FROM orders o
         LEFT JOIN products p ON p.id = o.product_id
         LEFT JOIN users ub   ON ub.id = o.buyer_id
         LEFT JOIN users us   ON us.id = o.seller_id
        ORDER BY o.created_at DESC`
    );
    const csv = rowsToCsv(r.rows, [
      { key: 'id' }, { key: 'created_at' }, { key: 'status' }, { key: 'payment_status' },
      { key: 'total_price' }, { key: 'commission_amount' }, { key: 'currency' },
      { key: 'shipping_method' }, { key: 'shipping_cost' }, { key: 'tracking_number' },
      { key: 'product_title' },
      { key: 'buyer_email' }, { key: 'buyer_name' },
      { key: 'seller_email' }, { key: 'seller_name' },
    ]);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="orders-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send('﻿' + csv);
  } catch (err) {
    console.error('[admin/orders.csv] Error:', err);
    res.status(500).send('Error generando CSV');
  }
});

// GET /admin/newsletter.csv — emails de newsletter (para importar a Mailchimp/Resend/etc)
router.get('/newsletter.csv', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, email, source, created_at
         FROM newsletter_subscribers
         WHERE unsubscribed_at IS NULL
         ORDER BY created_at DESC`
    );
    const csv = rowsToCsv(r.rows, [
      { key: 'id' }, { key: 'email' }, { key: 'source' }, { key: 'created_at' },
    ]);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="newsletter-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send('﻿' + csv);
  } catch (err) {
    if (err.code === '42P01') return res.status(503).send('Tabla newsletter_subscribers no existe (correr migration 011)');
    console.error('[admin/newsletter.csv] Error:', err);
    res.status(500).send('Error generando CSV');
  }
});

// Reseñas
router.get('/reviews',          listReviews);
router.delete('/reviews/:id',   deleteReview);

// Reportes
router.get('/reports',          listReports);
router.patch('/reports/:id',    updateReport);

module.exports = router;
