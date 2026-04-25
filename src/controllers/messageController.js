const db = require('../config/database');

// ============================================================
// Helpers
// ============================================================

/**
 * Verifica que el usuario pertenezca a la conversación.
 * Devuelve la fila de la conversación o lanza un error HTTP.
 */
async function getConversationOrFail(conversationId, userId) {
  const result = await db.query(
    `SELECT id, buyer_id, seller_id, product_id, service_id, item_type
       FROM conversations
      WHERE id = $1`,
    [conversationId]
  );

  if (result.rows.length === 0) {
    const err = new Error('Conversación no encontrada');
    err.status = 404;
    throw err;
  }

  const convo = result.rows[0];
  if (convo.buyer_id !== userId && convo.seller_id !== userId) {
    const err = new Error('No tenés permiso para acceder a esta conversación');
    err.status = 403;
    throw err;
  }

  return convo;
}

/**
 * Busca o crea una conversación para un item (producto o servicio)
 * entre un comprador y un vendedor. Idempotente: si ya existe,
 * la devuelve sin duplicar.
 *
 * Exportada para poder reutilizarla desde ordersController.
 */
async function findOrCreateConversation({
  buyer_id,
  seller_id,
  item_type,
  product_id = null,
  service_id = null,
  order_id   = null,
  client     = db,
}) {
  if (buyer_id === seller_id) {
    const err = new Error('No podés iniciar una conversación con vos mismo');
    err.status = 400;
    throw err;
  }
  if (!['product', 'service'].includes(item_type)) {
    const err = new Error('item_type inválido');
    err.status = 400;
    throw err;
  }
  if (item_type === 'product' && !product_id) {
    const err = new Error('product_id es obligatorio para conversaciones de producto');
    err.status = 400;
    throw err;
  }
  if (item_type === 'service' && !service_id) {
    const err = new Error('service_id es obligatorio para conversaciones de servicio');
    err.status = 400;
    throw err;
  }

  // Buscar existente (respetando el índice único parcial)
  const existingQuery = item_type === 'product'
    ? `SELECT * FROM conversations
        WHERE buyer_id = $1 AND seller_id = $2 AND product_id = $3
          AND item_type = 'product'
        LIMIT 1`
    : `SELECT * FROM conversations
        WHERE buyer_id = $1 AND seller_id = $2 AND service_id = $3
          AND item_type = 'service'
        LIMIT 1`;

  const existingParam = item_type === 'product' ? product_id : service_id;
  const existing = await client.query(existingQuery, [buyer_id, seller_id, existingParam]);

  if (existing.rows.length > 0) {
    // Si vino un order_id nuevo y no estaba seteado, lo enganchamos
    const convo = existing.rows[0];
    if (order_id && !convo.order_id) {
      await client.query(
        'UPDATE conversations SET order_id = $1 WHERE id = $2',
        [order_id, convo.id]
      );
      convo.order_id = order_id;
    }
    return { conversation: convo, created: false };
  }

  const insert = await client.query(
    `INSERT INTO conversations
       (buyer_id, seller_id, product_id, service_id, order_id, item_type)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [buyer_id, seller_id, product_id, service_id, order_id, item_type]
  );

  return { conversation: insert.rows[0], created: true };
}

// ============================================================
// POST /messages/conversations
// Crea (o recupera) una conversación con el dueño de un producto
// o servicio. El vendedor se deduce del item.
// Body: { item_type: 'product'|'service', item_id, initial_message? }
// ============================================================
const startConversation = async (req, res) => {
  const { item_type, item_id, initial_message } = req.body;

  if (!item_type || !item_id) {
    return res.status(400).json({ error: 'item_type e item_id son obligatorios' });
  }

  try {
    // Resolver seller_id a partir del item
    let seller_id, product_id = null, service_id = null;

    if (item_type === 'product') {
      const r = await db.query(
        'SELECT seller_id FROM products WHERE id = $1 AND status <> $2',
        [item_id, 'deleted']
      );
      if (r.rows.length === 0) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }
      seller_id = r.rows[0].seller_id;
      product_id = item_id;
    } else if (item_type === 'service') {
      const r = await db.query('SELECT provider_id FROM services WHERE id = $1', [item_id]);
      if (r.rows.length === 0) {
        return res.status(404).json({ error: 'Servicio no encontrado' });
      }
      seller_id = r.rows[0].provider_id;
      service_id = item_id;
    } else {
      return res.status(400).json({ error: "item_type debe ser 'product' o 'service'" });
    }

    const { conversation, created } = await findOrCreateConversation({
      buyer_id:  req.user.id,
      seller_id,
      item_type,
      product_id,
      service_id,
    });

    // Mensaje inicial opcional
    if (initial_message && initial_message.trim().length > 0) {
      await db.query(
        `INSERT INTO messages (conversation_id, sender_id, body)
         VALUES ($1, $2, $3)`,
        [conversation.id, req.user.id, initial_message.trim()]
      );
    }

    res.status(created ? 201 : 200).json({ conversation, created });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Error en startConversation:', err);
    res.status(500).json({ error: 'Error al iniciar la conversación' });
  }
};

// ============================================================
// GET /messages/conversations
// Lista las conversaciones del usuario con resumen del último mensaje,
// datos de la otra parte y unread_count.
// ============================================================
const listConversations = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         c.id,
         c.item_type,
         c.product_id,
         c.service_id,
         c.order_id,
         c.last_message,
         c.last_message_at,
         c.created_at,
         -- Datos de la otra parte
         CASE WHEN c.buyer_id = $1 THEN c.seller_id ELSE c.buyer_id END AS other_user_id,
         u.name       AS other_user_name,
         u.avatar_url AS other_user_avatar,
         -- Datos del item
         COALESCE(p.title, s.title) AS item_title,
         CASE
           WHEN c.item_type = 'product'
             THEN (SELECT img FROM UNNEST(p.images) img LIMIT 1)
           ELSE (SELECT img FROM UNNEST(s.images) img LIMIT 1)
         END AS item_image,
         -- Contador de no leídos
         (SELECT COUNT(*)::int FROM messages m
            WHERE m.conversation_id = c.id
              AND m.sender_id <> $1
              AND m.read_at IS NULL) AS unread_count,
         -- Rol del usuario actual en esta conversación
         CASE WHEN c.buyer_id = $1 THEN 'buyer' ELSE 'seller' END AS my_role
       FROM conversations c
       JOIN users u ON u.id = (CASE WHEN c.buyer_id = $1 THEN c.seller_id ELSE c.buyer_id END)
       LEFT JOIN products p ON p.id = c.product_id
       LEFT JOIN services s ON s.id = c.service_id
       WHERE c.buyer_id = $1 OR c.seller_id = $1
       ORDER BY c.last_message_at DESC NULLS LAST`,
      [req.user.id]
    );

    res.json({ data: result.rows });
  } catch (err) {
    console.error('Error en listConversations:', err);
    res.status(500).json({ error: 'Error al obtener las conversaciones' });
  }
};

// ============================================================
// GET /messages/conversations/:id/messages
// Devuelve los mensajes de una conversación (paginados)
// ============================================================
const getMessages = async (req, res) => {
  const { id } = req.params;
  const { before, limit = 50 } = req.query;
  const lim = Math.min(parseInt(limit, 10) || 50, 100);

  try {
    await getConversationOrFail(id, req.user.id);

    const params = [id];
    let beforeClause = '';
    if (before) {
      params.push(before);
      beforeClause = `AND created_at < $${params.length}`;
    }
    params.push(lim);

    const result = await db.query(
      `SELECT id, conversation_id, sender_id, body, read_at, created_at
         FROM messages
        WHERE conversation_id = $1 ${beforeClause}
        ORDER BY created_at DESC
        LIMIT $${params.length}`,
      params
    );

    // Devolver en orden cronológico ascendente (natural en la UI)
    res.json({ data: result.rows.reverse() });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Error en getMessages:', err);
    res.status(500).json({ error: 'Error al obtener los mensajes' });
  }
};

// ============================================================
// POST /messages/conversations/:id/messages
// Envía un mensaje en la conversación.
// Body: { body }
// ============================================================
const sendMessage = async (req, res) => {
  const { id }   = req.params;
  const { body } = req.body;

  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
  }
  if (body.length > 2000) {
    return res.status(400).json({ error: 'El mensaje supera el máximo de 2000 caracteres' });
  }

  try {
    await getConversationOrFail(id, req.user.id);

    const result = await db.query(
      `INSERT INTO messages (conversation_id, sender_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, conversation_id, sender_id, body, read_at, created_at`,
      [id, req.user.id, body.trim()]
    );

    res.status(201).json({ message: result.rows[0] });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Error en sendMessage:', err);
    res.status(500).json({ error: 'Error al enviar el mensaje' });
  }
};

// ============================================================
// POST /messages/conversations/:id/read
// Marca todos los mensajes recibidos (no enviados por mí) como leídos.
// ============================================================
const markAsRead = async (req, res) => {
  const { id } = req.params;

  try {
    await getConversationOrFail(id, req.user.id);

    const result = await db.query(
      `UPDATE messages
          SET read_at = NOW()
        WHERE conversation_id = $1
          AND sender_id <> $2
          AND read_at IS NULL
        RETURNING id`,
      [id, req.user.id]
    );

    res.json({ updated: result.rowCount });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Error en markAsRead:', err);
    res.status(500).json({ error: 'Error al marcar como leídos' });
  }
};

// ============================================================
// GET /messages/unread-count
// Total de mensajes no leídos del usuario (para badge global).
// ============================================================
const getUnreadCount = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT COUNT(*)::int AS unread
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE (c.buyer_id = $1 OR c.seller_id = $1)
          AND m.sender_id <> $1
          AND m.read_at IS NULL`,
      [req.user.id]
    );
    res.json({ unread: result.rows[0].unread });
  } catch (err) {
    console.error('Error en getUnreadCount:', err);
    res.status(500).json({ error: 'Error al obtener mensajes no leídos' });
  }
};

module.exports = {
  startConversation,
  listConversations,
  getMessages,
  sendMessage,
  markAsRead,
  getUnreadCount,
  // Helper interno expuesto para ordersController
  findOrCreateConversation,
};
