const db = require('../config/database');
const { findOrCreateConversation } = require('./messageController');

// ============================================================
// POST /orders
// Crea una orden de compra para un producto.
// Body: { product_id, quantity, shipping_address, payment_method }
// ============================================================
const createOrder = async (req, res) => {
  const {
    product_id,
    quantity       = 1,
    shipping_address,
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
    // Obtener producto y verificar disponibilidad
    const productResult = await db.query(
      `SELECT id, title, price, currency, stock, seller_id, status
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

    const total_price = parseFloat(product.price) * quantity;

    // Crear la orden dentro de una transacción
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const orderResult = await client.query(
        `INSERT INTO orders
           (buyer_id, seller_id, product_id, quantity, unit_price,
            total_price, currency, shipping_address, payment_method, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          req.user.id, product.seller_id, product_id, quantity,
          product.price, total_price, product.currency,
          shipping_address || null, payment_method, notes || null,
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
         o.shipping_address, o.notes, o.created_at, o.updated_at,
         p.title AS product_title, p.images AS product_images,
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
         o.shipping_address, o.notes, o.created_at, o.updated_at,
         p.title AS product_title, p.images AS product_images,
         u.name  AS buyer_name, u.avatar_url AS buyer_avatar
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

    const result = await db.query(
      `UPDATE orders SET status = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [status, id]
    );

    res.json({ message: 'Estado actualizado', order: result.rows[0] });
  } catch (err) {
    console.error('Error en updateOrderStatus:', err);
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
};

module.exports = { createOrder, getMyOrders, getMySales, getOrderById, updateOrderStatus };
