const db = require('../config/database');
const { findOrCreateConversation } = require('./messageController');
const { sendEmail, orderShippedBuyerTemplate } = require('../services/email');

// ============================================================
// Helper: valida los datos de envío que vienen al crear la orden
// contra lo que el producto realmente ofrece.
//
// Devuelve { ok, fields } o { ok:false, status, error }.
// ============================================================
function resolveShippingForOrder(product, body) {
  const required = !!product.shipping_required;
  const offersDelivery = !!product.offers_delivery;
  const offersPickup   = !!product.offers_pickup;

  // Producto sin logística (servicio, descarga, etc.)
  if (!required) {
    return {
      ok: true,
      fields: {
        shipping_method: null,
        shipping_cost:   0,
        recipient_name:  null, phone: null, street: null,
        city: null, province: null, postal_code: null, notes: null,
      },
    };
  }

  let method = body.shipping_method;

  // Auto-elegir si solo hay una opción
  if (!method) {
    if (offersDelivery && !offersPickup) method = 'delivery';
    else if (offersPickup && !offersDelivery) method = 'pickup';
  }

  if (!method) {
    return {
      ok: false, status: 400,
      error: 'shipping_method es obligatorio: "delivery" o "pickup"',
    };
  }
  if (method === 'delivery' && !offersDelivery) {
    return {
      ok: false, status: 400,
      error: 'Este vendedor no ofrece envío a domicilio para este producto',
    };
  }
  if (method === 'pickup' && !offersPickup) {
    return {
      ok: false, status: 400,
      error: 'Este vendedor no ofrece retiro en persona para este producto',
    };
  }

  if (method === 'delivery') {
    // Validar dirección
    const addr = body.shipping_address_obj || {};
    const requiredFields = ['recipient_name', 'phone', 'street', 'city', 'province'];
    const missing = requiredFields.filter(f => !String(addr[f] || '').trim());
    if (missing.length) {
      return {
        ok: false, status: 400,
        error: `Faltan datos de envío: ${missing.join(', ')}`,
      };
    }
    return {
      ok: true,
      fields: {
        shipping_method: 'delivery',
        shipping_cost:   parseFloat(product.shipping_cost || 0),
        recipient_name:  addr.recipient_name.trim(),
        phone:           addr.phone.trim(),
        street:          addr.street.trim(),
        city:            addr.city.trim(),
        province:        addr.province.trim(),
        postal_code:     (addr.postal_code || '').trim() || null,
        notes:           (addr.notes || '').trim() || null,
      },
    };
  }

  // pickup → no hace falta dirección, solo confirmar
  return {
    ok: true,
    fields: {
      shipping_method: 'pickup',
      shipping_cost:   0,
      recipient_name:  null, phone: null, street: null,
      city: null, province: null, postal_code: null,
      notes: (body.shipping_address_obj?.notes || '').trim() || null,
    },
  };
}

// ============================================================
// POST /orders
// Crea una orden de compra para un producto.
// Body: {
//   product_id, quantity,
//   shipping_method: 'delivery'|'pickup',
//   shipping_address_obj: {                  // solo si delivery
//     recipient_name, phone, street, city, province, postal_code, notes
//   },
//   payment_method, notes
// }
// ============================================================
const createOrder = async (req, res) => {
  const {
    product_id,
    quantity       = 1,
    payment_method = 'pending',
    notes,
  } = req.body;

  if (!product_id) {
    return res.status(400).json({ error: 'product_id es obligatorio' });
  }
  if (quantity < 1) {
    return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });
  }

  try {
    // Obtener producto con datos de envío
    const productResult = await db.query(
      `SELECT id, title, price, currency, stock, seller_id, status,
              shipping_required, offers_delivery, offers_pickup,
              shipping_cost, pickup_address
       FROM products WHERE id = $1`,
      [product_id]
    );

    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const product = productResult.rows[0];

    if (product.status !== 'active') {
      return res.status(400).json({ error: 'El producto no está disponible' });
    }
    if (product.stock < quantity) {
      return res.status(400).json({
        error:     'Stock insuficiente',
        available: product.stock,
      });
    }
    if (product.seller_id === req.user.id) {
      return res.status(400).json({ error: 'No podés comprar tu propio producto' });
    }

    // Resolver método y datos de envío contra lo que el producto ofrece
    const shipping = resolveShippingForOrder(product, req.body);
    if (!shipping.ok) {
      return res.status(shipping.status).json({ error: shipping.error });
    }
    const s = shipping.fields;

    // Total = (precio producto × qty) + costo envío
    const subtotal    = parseFloat(product.price) * quantity;
    const total_price = subtotal + s.shipping_cost;

    // Crear la orden dentro de una transacción
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const orderResult = await client.query(
        `INSERT INTO orders
           (buyer_id, seller_id, product_id, quantity, unit_price,
            total_price, currency, payment_method, notes,
            shipping_method, shipping_cost,
            shipping_recipient_name, shipping_phone,
            shipping_street, shipping_city, shipping_province,
            shipping_postal_code, shipping_notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING *`,
        [
          req.user.id, product.seller_id, product_id, quantity,
          product.price, total_price, product.currency,
          payment_method, notes || null,
          s.shipping_method, s.shipping_cost,
          s.recipient_name, s.phone,
          s.street, s.city, s.province,
          s.postal_code, s.notes,
        ]
      );

      // Descontar stock
      await client.query(
        'UPDATE products SET stock = stock - $1 WHERE id = $2',
        [quantity, product_id]
      );

      // Si se agota, cambiar status a 'sold'
      if (product.stock - quantity === 0) {
        await client.query(
          "UPDATE products SET status = 'sold' WHERE id = $1",
          [product_id]
        );
      }

      // Crear o recuperar la conversación buyer ↔ seller
      // (dentro de la misma transacción para que no queden órdenes huérfanas)
      let conversation = null;
      try {
        const result = await findOrCreateConversation({
          buyer_id:   req.user.id,
          seller_id:  product.seller_id,
          item_type:  'product',
          product_id,
          order_id:   orderResult.rows[0].id,
          client,
        });
        conversation = result.conversation;
      } catch (convErr) {
        // No romper la compra si la conversación falla; solo log.
        console.warn('No se pudo crear la conversación para la orden:', convErr.message);
      }

      await client.query('COMMIT');

      res.status(201).json({
        message:      'Orden creada exitosamente',
        order:        orderResult.rows[0],
        conversation, // puede ser null si falló la creación
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error en createOrder:', err);
    res.status(500).json({ error: 'Error al crear la orden' });
  }
};

// ============================================================
// GET /orders/my
// Mis compras (como comprador)
// ============================================================
const getMyOrders = async (req, res) => {
  const { status, page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;
  const params = [req.user.id];
  let whereExtra = '';

  if (status) {
    params.push(status);
    whereExtra = `AND o.status = $${params.length}`;
  }

  try {
    const result = await db.query(
      `SELECT
         o.id, o.status, o.quantity, o.unit_price, o.total_price,
         o.currency, o.payment_method, o.payment_status,
         o.shipping_method, o.shipping_cost,
         o.shipping_recipient_name, o.shipping_phone,
         o.shipping_street, o.shipping_city, o.shipping_province,
         o.shipping_postal_code, o.shipping_notes,
         o.tracking_number, o.dispatched_at, o.delivered_at,
         o.notes, o.created_at, o.updated_at,
         p.title AS product_title, p.images AS product_images,
         p.pickup_address AS product_pickup_address,
         u.name  AS seller_name, u.avatar_url AS seller_avatar
       FROM orders o
       LEFT JOIN products p ON o.product_id = p.id
       LEFT JOIN users u    ON o.seller_id  = u.id
       WHERE o.buyer_id = $1 ${whereExtra}
       ORDER BY o.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({ data: result.rows, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('Error en getMyOrders:', err);
    res.status(500).json({ error: 'Error al obtener tus compras' });
  }
};

// ============================================================
// GET /orders/sales
// Mis ventas (como vendedor)
// ============================================================
const getMySales = async (req, res) => {
  const { status, page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;
  const params = [req.user.id];
  let whereExtra = '';

  if (status) {
    params.push(status);
    whereExtra = `AND o.status = $${params.length}`;
  }

  try {
    const result = await db.query(
      `SELECT
         o.id, o.status, o.quantity, o.unit_price, o.total_price,
         o.currency, o.payment_method, o.payment_status,
         o.shipping_method, o.shipping_cost,
         o.shipping_recipient_name, o.shipping_phone,
         o.shipping_street, o.shipping_city, o.shipping_province,
         o.shipping_postal_code, o.shipping_notes,
         o.tracking_number, o.dispatched_at, o.delivered_at,
         o.notes, o.created_at, o.updated_at,
         p.title AS product_title, p.images AS product_images,
         u.name  AS buyer_name, u.avatar_url AS buyer_avatar, u.phone AS buyer_phone
       FROM orders o
       LEFT JOIN products p ON o.product_id = p.id
       LEFT JOIN users u    ON o.buyer_id   = u.id
       WHERE o.seller_id = $1 ${whereExtra}
       ORDER BY o.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({ data: result.rows, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('Error en getMySales:', err);
    res.status(500).json({ error: 'Error al obtener tus ventas' });
  }
};

// ============================================================
// GET /orders/:id
// Detalle de una orden (solo comprador o vendedor)
// ============================================================
const getOrderById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query(
      `SELECT o.*,
         p.title AS product_title, p.images AS product_images,
         p.description AS product_description,
         ub.name AS buyer_name,  ub.email AS buyer_email,  ub.phone AS buyer_phone,
         us.name AS seller_name, us.email AS seller_email, us.phone AS seller_phone
       FROM orders o
       LEFT JOIN products p ON o.product_id = p.id
       LEFT JOIN users ub   ON o.buyer_id   = ub.id
       LEFT JOIN users us   ON o.seller_id  = us.id
       WHERE o.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    const order = result.rows[0];

    // Solo el comprador o vendedor pueden ver la orden
    if (order.buyer_id !== req.user.id && order.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'No tenés permiso para ver esta orden' });
    }

    res.json(order);
  } catch (err) {
    console.error('Error en getOrderById:', err);
    res.status(500).json({ error: 'Error al obtener la orden' });
  }
};

// ============================================================
// PATCH /orders/:id/status
// El vendedor actualiza el estado de la orden.
// Body: { status: 'confirmed'|'shipped'|'delivered'|'cancelled' }
// ============================================================
const updateOrderStatus = async (req, res) => {
  const { id }     = req.params;
  const { status } = req.body;

  const validStatuses = ['confirmed', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      error:   'Estado inválido',
      allowed: validStatuses,
    });
  }

  try {
    const check = await db.query(
      'SELECT seller_id, buyer_id, status, product_id, quantity FROM orders WHERE id = $1',
      [id]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    const order = check.rows[0];

    // Solo el vendedor puede cambiar el estado (excepto cancelación que puede hacer el comprador)
    const isSeller = order.seller_id === req.user.id;
    const isBuyer  = order.buyer_id  === req.user.id;

    if (!isSeller && !(isBuyer && status === 'cancelled')) {
      return res.status(403).json({ error: 'No tenés permiso para cambiar el estado' });
    }

    // Si se cancela, devolver stock
    if (status === 'cancelled' && order.status !== 'cancelled') {
      await db.query(
        `UPDATE products SET stock = stock + $1,
           status = CASE WHEN status = 'sold' THEN 'active' ELSE status END
         WHERE id = $2`,
        [order.quantity, order.product_id]
      );
    }

    // Marcar timestamps del envío automáticamente
    let dispatchedSql = '';
    let deliveredSql  = '';
    if (status === 'shipped') {
      dispatchedSql = ', dispatched_at = COALESCE(dispatched_at, NOW())';
    }
    if (status === 'delivered') {
      deliveredSql  = ', delivered_at = COALESCE(delivered_at, NOW())';
    }

    const result = await db.query(
      `UPDATE orders SET status = $1, updated_at = NOW()
         ${dispatchedSql} ${deliveredSql}
       WHERE id = $2 RETURNING *`,
      [status, id]
    );

    res.json({ message: 'Estado actualizado', order: result.rows[0] });
  } catch (err) {
    console.error('Error en updateOrderStatus:', err);
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
};

// ============================================================
// PATCH /orders/:id/shipping
// El vendedor carga / actualiza el número de tracking.
// Body: { tracking_number, mark_shipped }
// Si mark_shipped=true y la orden está 'confirmed' (o 'pending'
// pagada), pasa a 'shipped' y registra dispatched_at.
// ============================================================
const updateShippingTracking = async (req, res) => {
  const { id } = req.params;
  const { tracking_number, mark_shipped } = req.body;

  if (tracking_number !== undefined && tracking_number !== null) {
    if (typeof tracking_number !== 'string' || tracking_number.trim().length === 0) {
      return res.status(400).json({ error: 'tracking_number debe ser un texto no vacío' });
    }
    if (tracking_number.length > 80) {
      return res.status(400).json({ error: 'tracking_number es demasiado largo (máx 80)' });
    }
  }

  try {
    const check = await db.query(
      `SELECT seller_id, status, payment_status, shipping_method
       FROM orders WHERE id = $1`,
      [id]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    const order = check.rows[0];

    if (order.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Solo el vendedor puede gestionar el envío' });
    }
    if (order.shipping_method !== 'delivery') {
      return res.status(400).json({
        error: 'Esta orden no tiene envío a domicilio (no aplica tracking)',
      });
    }

    const willShip = !!mark_shipped && order.status !== 'shipped' && order.status !== 'delivered';

    const result = await db.query(
      `UPDATE orders SET
         tracking_number = COALESCE($1, tracking_number),
         status          = CASE WHEN $2::boolean THEN 'shipped' ELSE status END,
         dispatched_at   = CASE
                             WHEN $2::boolean AND dispatched_at IS NULL
                             THEN NOW() ELSE dispatched_at
                           END,
         updated_at      = NOW()
       WHERE id = $3
       RETURNING *`,
      [tracking_number ? tracking_number.trim() : null, willShip, id]
    );

    // Si efectivamente pasó a 'shipped' ahora, mandar email al comprador.
    if (willShip) {
      sendShippedNotification(id).catch(e =>
        console.error('[email] shipped notify failed:', e.message)
      );
    }

    res.json({ message: 'Envío actualizado', order: result.rows[0] });
  } catch (err) {
    console.error('Error en updateShippingTracking:', err);
    res.status(500).json({ error: 'Error al actualizar el envío' });
  }
};

// ============================================================
// Helper: dispara email "tu pedido fue despachado" al comprador
// ============================================================
async function sendShippedNotification(orderId) {
  const r = await db.query(
    `SELECT o.id, o.tracking_number,
            p.title AS product_title,
            ub.email AS buyer_email, ub.name AS buyer_name,
            us.name AS seller_name
       FROM orders o
       LEFT JOIN products p ON p.id = o.product_id
       LEFT JOIN users ub   ON ub.id = o.buyer_id
       LEFT JOIN users us   ON us.id = o.seller_id
      WHERE o.id = $1`,
    [orderId]
  );
  if (r.rows.length === 0) return;
  const o = r.rows[0];
  if (!o.buyer_email) return;

  const tpl = orderShippedBuyerTemplate({
    buyerName:      o.buyer_name,
    orderId:        o.id,
    productTitle:   o.product_title,
    trackingNumber: o.tracking_number,
    sellerName:     o.seller_name,
  });
  await sendEmail({ to: o.buyer_email, subject: tpl.subject, html: tpl.html, text: tpl.text });
}

module.exports = {
  createOrder, getMyOrders, getMySales, getOrderById,
  updateOrderStatus, updateShippingTracking,
};
