/**
 * ============================================================
 * DALE DEAL — Servidor Prototipo (sin PostgreSQL)
 * Usa JSON en memoria para desarrollo rápido.
 * Ejecutar: node prototype-server.js
 * ============================================================
 */

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dale-deal-proto-secret';

// ============================================================
// CARGA DE DATOS (JSON en memoria)
// ============================================================
const DATA_FILE = path.join(__dirname, 'db', 'prototype-data.json');

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ============================================================
// MIDDLEWARES
// ============================================================
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json());
app.use((req, res, next) => {
  const ts = new Date().toISOString().replace('T', ' ').slice(0,19);
  console.log(`[${ts}] ${req.method.padEnd(6)} ${req.path}`);
  next();
});

// Middleware JWT
function auth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }
  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// Helper: paginación
function paginate(arr, page = 1, limit = 20) {
  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, Math.max(1, parseInt(limit)));
  const start = (p - 1) * l;
  return {
    data: arr.slice(start, start + l),
    total: arr.length,
    page: p,
    limit: l,
    totalPages: Math.ceil(arr.length / l),
  };
}

// Helper: próximo ID
function nextId(arr) {
  return arr.length ? Math.max(...arr.map(x => x.id)) + 1 : 1;
}

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/', (req, res) => {
  const d = loadData();
  res.json({
    message: '🟡 Dale Deal API Prototipo corriendo',
    mode: 'JSON in-memory (sin PostgreSQL)',
    version: '2.0.0-prototype',
    stats: {
      users: d.users.length,
      products: d.products.length,
      services: d.services.length,
      orders: d.orders.length,
      reviews: d.reviews.length,
    },
    endpoints: { auth:'/auth', products:'/products', services:'/services', users:'/users', favorites:'/favorites', orders:'/orders', reviews:'/reviews' }
  });
});

// ============================================================
// AUTH
// ============================================================
app.post('/auth/register', async (req, res) => {
  const { name, email, password, phone, location } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios' });
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

  const d = loadData();
  if (d.users.find(u => u.email === email.toLowerCase())) {
    return res.status(409).json({ error: 'El email ya está registrado' });
  }

  const user = {
    id: nextId(d.users),
    name: name.trim(),
    email: email.toLowerCase(),
    password_hash: await bcrypt.hash(password, 10),
    avatar_url: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=d63031&color=fff`,
    phone: phone || null,
    location: location || null,
    role: 'user',
    is_active: true,
    created_at: new Date().toISOString(),
  };

  d.users.push(user);
  saveData(d);

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  const { password_hash, ...safe } = user;
  res.status(201).json({ token, user: safe });
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son obligatorios' });

  const d = loadData();
  const user = d.users.find(u => u.email === email.toLowerCase() && u.is_active);
  if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

  // En prototipo permitimos login con password "demo" para usuarios de prueba
  const ok = password === 'demo' || await bcrypt.compare(password, user.password_hash).catch(() => false);
  if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  const { password_hash, ...safe } = user;
  res.json({ token, user: safe });
});

app.get('/auth/me', auth, (req, res) => {
  const d = loadData();
  const user = d.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const { password_hash, ...safe } = user;
  res.json(safe);
});

// ============================================================
// PRODUCT CATEGORIES
// ============================================================
app.get('/products/categories', (req, res) => {
  res.json(loadData().product_categories);
});

// ============================================================
// PRODUCTS
// ============================================================
app.get('/products', (req, res) => {
  const { search, category, condition, min_price, max_price, seller_id, sort = 'created_at', order = 'desc', page = 1, limit = 20 } = req.query;
  const d = loadData();

  let products = d.products.filter(p => p.status === 'active');

  if (search) {
    const q = search.toLowerCase();
    products = products.filter(p => p.title.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
  }
  if (category) {
    const cat = d.product_categories.find(c => c.slug === category);
    if (cat) products = products.filter(p => p.category_id === cat.id);
  }
  if (condition) products = products.filter(p => p.condition === condition);
  if (min_price) products = products.filter(p => p.price >= parseFloat(min_price));
  if (max_price) products = products.filter(p => p.price <= parseFloat(max_price));
  if (seller_id) products = products.filter(p => p.seller_id === parseInt(seller_id));

  // Sort
  const dir = order === 'asc' ? 1 : -1;
  products.sort((a, b) => {
    if (a[sort] < b[sort]) return -1 * dir;
    if (a[sort] > b[sort]) return  1 * dir;
    return 0;
  });

  // Enriquecer con datos de categoría y vendedor
  products = products.map(p => enrichProduct(p, d));

  res.json({ ...paginate(products, page, limit), sort: { field: sort, order } });
});

app.get('/products/:id', (req, res) => {
  const d = loadData();
  const product = d.products.find(p => p.id === parseInt(req.params.id));
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

  // Incrementar vistas
  product.views = (product.views || 0) + 1;
  saveData(d);

  res.json(enrichProduct(product, d));
});

app.post('/products', auth, (req, res) => {
  const { title, description, price, currency = 'ARS', stock = 0, condition = 'new', category_id, images = [], location } = req.body;
  if (!title || !price) return res.status(400).json({ error: 'Título y precio son obligatorios' });

  const d = loadData();
  const product = {
    id: nextId(d.products),
    title, description, price: parseFloat(price), currency,
    stock: parseInt(stock), condition, category_id: parseInt(category_id) || null,
    seller_id: req.user.id, images, location,
    status: 'active', views: 0,
    created_at: new Date().toISOString(),
  };
  d.products.push(product);
  saveData(d);
  res.status(201).json(product);
});

app.put('/products/:id', auth, (req, res) => {
  const d = loadData();
  const idx = d.products.findIndex(p => p.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Producto no encontrado' });
  if (d.products[idx].seller_id !== req.user.id) return res.status(403).json({ error: 'No tenés permiso' });

  d.products[idx] = { ...d.products[idx], ...req.body, updated_at: new Date().toISOString() };
  saveData(d);
  res.json(d.products[idx]);
});

app.delete('/products/:id', auth, (req, res) => {
  const d = loadData();
  const idx = d.products.findIndex(p => p.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Producto no encontrado' });
  if (d.products[idx].seller_id !== req.user.id) return res.status(403).json({ error: 'No tenés permiso' });

  d.products.splice(idx, 1);
  saveData(d);
  res.json({ message: 'Producto eliminado' });
});

// ============================================================
// SERVICE CATEGORIES
// ============================================================
app.get('/services/categories', (req, res) => {
  res.json(loadData().service_categories);
});

// ============================================================
// SERVICES
// ============================================================
app.get('/services', (req, res) => {
  const { search, category, location, sort = 'created_at', order = 'desc', page = 1, limit = 20 } = req.query;
  const d = loadData();

  let services = d.services.filter(s => s.status === 'active');

  if (search) {
    const q = search.toLowerCase();
    services = services.filter(s => s.title.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q));
  }
  if (category) {
    const cat = d.service_categories.find(c => c.slug === category);
    if (cat) services = services.filter(s => s.category_id === cat.id);
  }
  if (location) {
    const loc = location.toLowerCase();
    services = services.filter(s => (s.location || '').toLowerCase().includes(loc) || (s.zones_covered || []).some(z => z.toLowerCase().includes(loc)));
  }

  const dir = order === 'asc' ? 1 : -1;
  services.sort((a, b) => {
    const av = a[sort] ?? 0, bv = b[sort] ?? 0;
    if (av < bv) return -1 * dir;
    if (av > bv) return  1 * dir;
    return 0;
  });

  services = services.map(s => enrichService(s, d));
  res.json(paginate(services, page, limit));
});

app.get('/services/:id', (req, res) => {
  const d = loadData();
  const service = d.services.find(s => s.id === parseInt(req.params.id));
  if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });

  service.views = (service.views || 0) + 1;
  saveData(d);
  res.json(enrichService(service, d));
});

app.post('/services', auth, (req, res) => {
  const { title, description, price_from, price_to, currency = 'ARS', price_type = 'fixed', category_id, images = [], location, zones_covered = [] } = req.body;
  if (!title) return res.status(400).json({ error: 'El título es obligatorio' });

  const d = loadData();
  const service = {
    id: nextId(d.services),
    title, description,
    price_from: price_from ? parseFloat(price_from) : null,
    price_to: price_to ? parseFloat(price_to) : null,
    currency, price_type,
    category_id: parseInt(category_id) || null,
    provider_id: req.user.id,
    images, location, zones_covered,
    status: 'active', views: 0,
    created_at: new Date().toISOString(),
  };
  d.services.push(service);
  saveData(d);
  res.status(201).json(service);
});

// ============================================================
// USERS
// ============================================================
app.get('/users/:id', (req, res) => {
  const d = loadData();
  const user = d.users.find(u => u.id === parseInt(req.params.id) && u.is_active);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  const { password_hash, ...safe } = user;
  const products = d.products.filter(p => p.seller_id === user.id && p.status === 'active').slice(0, 10);
  const services = d.services.filter(s => s.provider_id === user.id && s.status === 'active').slice(0, 10);
  res.json({ user: safe, products, services });
});

app.put('/users/me', auth, (req, res) => {
  const d = loadData();
  const idx = d.users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });

  const { name, phone, location, avatar_url } = req.body;
  if (name) d.users[idx].name = name;
  if (phone) d.users[idx].phone = phone;
  if (location) d.users[idx].location = location;
  if (avatar_url) d.users[idx].avatar_url = avatar_url;
  d.users[idx].updated_at = new Date().toISOString();
  saveData(d);

  const { password_hash, ...safe } = d.users[idx];
  res.json(safe);
});

app.get('/users/me/products', auth, (req, res) => {
  const d = loadData();
  const products = d.products.filter(p => p.seller_id === req.user.id).map(p => enrichProduct(p, d));
  res.json(products);
});

app.get('/users/me/services', auth, (req, res) => {
  const d = loadData();
  const services = d.services.filter(s => s.provider_id === req.user.id).map(s => enrichService(s, d));
  res.json(services);
});

// ============================================================
// FAVORITES
// ============================================================
app.get('/favorites', auth, (req, res) => {
  const d = loadData();
  const favs = d.favorites.filter(f => f.user_id === req.user.id);
  const enriched = favs.map(f => {
    const base = { favoriteId: f.id, type: f.item_type, itemId: f.item_id, savedAt: f.created_at };
    if (f.item_type === 'product') {
      const p = d.products.find(x => x.id === f.item_id);
      return p ? { ...base, ...enrichProduct(p, d) } : base;
    } else {
      const s = d.services.find(x => x.id === f.item_id);
      return s ? { ...base, ...enrichService(s, d) } : base;
    }
  });
  res.json({ data: enriched, total: enriched.length });
});

app.get('/favorites/check/:type/:itemId', auth, (req, res) => {
  const d = loadData();
  const fav = d.favorites.find(f => f.user_id === req.user.id && f.item_type === req.params.type && f.item_id === parseInt(req.params.itemId));
  res.json({ isFavorite: !!fav, favoriteId: fav?.id || null });
});

app.post('/favorites', auth, (req, res) => {
  const { item_type, item_id } = req.body;
  if (!item_type || !item_id) return res.status(400).json({ error: 'item_type e item_id son obligatorios' });

  const d = loadData();
  const dup = d.favorites.find(f => f.user_id === req.user.id && f.item_type === item_type && f.item_id === parseInt(item_id));
  if (dup) return res.status(409).json({ error: 'Ya está en tus favoritos', favoriteId: dup.id });

  const fav = { id: nextId(d.favorites), user_id: req.user.id, item_type, item_id: parseInt(item_id), created_at: new Date().toISOString() };
  d.favorites.push(fav);
  saveData(d);
  res.status(201).json({ message: 'Agregado a favoritos', favorite: fav });
});

app.delete('/favorites/item/:type/:itemId', auth, (req, res) => {
  const d = loadData();
  const idx = d.favorites.findIndex(f => f.user_id === req.user.id && f.item_type === req.params.type && f.item_id === parseInt(req.params.itemId));
  if (idx === -1) return res.status(404).json({ error: 'No encontrado en tus favoritos' });
  d.favorites.splice(idx, 1);
  saveData(d);
  res.json({ message: 'Eliminado de favoritos' });
});

app.delete('/favorites/:id', auth, (req, res) => {
  const d = loadData();
  const idx = d.favorites.findIndex(f => f.id === parseInt(req.params.id) && f.user_id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Favorito no encontrado' });
  d.favorites.splice(idx, 1);
  saveData(d);
  res.json({ message: 'Eliminado de favoritos' });
});

// ============================================================
// ORDERS
// ============================================================
app.post('/orders', auth, (req, res) => {
  const { product_id, quantity = 1, shipping_address, notes } = req.body;
  if (!product_id) return res.status(400).json({ error: 'product_id es obligatorio' });

  const d = loadData();
  const product = d.products.find(p => p.id === parseInt(product_id));
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
  if (product.status !== 'active') return res.status(400).json({ error: 'Producto no disponible' });
  if (product.stock < quantity) return res.status(400).json({ error: 'Stock insuficiente', available: product.stock });
  if (product.seller_id === req.user.id) return res.status(400).json({ error: 'No podés comprar tu propio producto' });

  const total_price = product.price * quantity;
  const order = {
    id: nextId(d.orders),
    buyer_id: req.user.id,
    seller_id: product.seller_id,
    product_id: product.id,
    quantity: parseInt(quantity),
    unit_price: product.price,
    total_price,
    currency: product.currency,
    status: 'pending',
    payment_status: 'pending',
    shipping_address: shipping_address || null,
    notes: notes || null,
    created_at: new Date().toISOString(),
  };

  product.stock -= quantity;
  if (product.stock === 0) product.status = 'sold';
  d.orders.push(order);
  saveData(d);
  res.status(201).json({ message: 'Orden creada exitosamente', order });
});

app.get('/orders/my', auth, (req, res) => {
  const d = loadData();
  const orders = d.orders
    .filter(o => o.buyer_id === req.user.id)
    .map(o => {
      const p = d.products.find(x => x.id === o.product_id);
      const seller = d.users.find(u => u.id === o.seller_id);
      return { ...o, product_title: p?.title, product_images: p?.images, seller_name: seller?.name };
    });
  res.json(paginate(orders.reverse(), req.query.page, req.query.limit));
});

app.get('/orders/sales', auth, (req, res) => {
  const d = loadData();
  const orders = d.orders
    .filter(o => o.seller_id === req.user.id)
    .map(o => {
      const p = d.products.find(x => x.id === o.product_id);
      const buyer = d.users.find(u => u.id === o.buyer_id);
      return { ...o, product_title: p?.title, product_images: p?.images, buyer_name: buyer?.name };
    });
  res.json(paginate(orders.reverse(), req.query.page, req.query.limit));
});

app.patch('/orders/:id/status', auth, (req, res) => {
  const { status } = req.body;
  const valid = ['confirmed','shipped','delivered','cancelled'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Estado inválido', allowed: valid });

  const d = loadData();
  const order = d.orders.find(o => o.id === parseInt(req.params.id));
  if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
  if (order.seller_id !== req.user.id && !(order.buyer_id === req.user.id && status === 'cancelled')) {
    return res.status(403).json({ error: 'Sin permiso' });
  }

  if (status === 'cancelled' && order.status !== 'cancelled') {
    const p = d.products.find(x => x.id === order.product_id);
    if (p) { p.stock += order.quantity; if (p.status === 'sold') p.status = 'active'; }
  }

  order.status = status;
  order.updated_at = new Date().toISOString();
  saveData(d);
  res.json({ message: 'Estado actualizado', order });
});

// ============================================================
// REVIEWS
// ============================================================
app.get('/reviews/:type/:itemId', (req, res) => {
  const { type, itemId } = req.params;
  const d = loadData();
  const reviews = d.reviews.filter(r => r.item_type === type && r.item_id === parseInt(itemId));
  const enriched = reviews.map(r => {
    const user = d.users.find(u => u.id === r.reviewer_id);
    return { ...r, reviewer_name: user?.name, reviewer_avatar: user?.avatar_url };
  });

  const avg = enriched.length ? enriched.reduce((s, r) => s + r.rating, 0) / enriched.length : 0;
  res.json({ ...paginate(enriched.reverse(), req.query.page, req.query.limit), avgRating: Math.round(avg * 10) / 10 });
});

app.post('/reviews', auth, (req, res) => {
  const { item_type, item_id, rating, title, body } = req.body;
  if (!item_type || !item_id || !rating) return res.status(400).json({ error: 'item_type, item_id y rating son obligatorios' });
  const r = parseInt(rating);
  if (r < 1 || r > 5) return res.status(400).json({ error: 'Rating entre 1 y 5' });

  const d = loadData();
  const dup = d.reviews.find(x => x.reviewer_id === req.user.id && x.item_type === item_type && x.item_id === parseInt(item_id));
  if (dup) return res.status(409).json({ error: 'Ya reseñaste este item' });

  const review = {
    id: nextId(d.reviews),
    reviewer_id: req.user.id,
    item_type, item_id: parseInt(item_id),
    rating: r, title: title || null, body: body || null,
    created_at: new Date().toISOString(),
  };
  d.reviews.push(review);
  saveData(d);
  res.status(201).json({ message: 'Reseña publicada', review });
});

app.delete('/reviews/:id', auth, (req, res) => {
  const d = loadData();
  const idx = d.reviews.findIndex(r => r.id === parseInt(req.params.id) && r.reviewer_id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Reseña no encontrada o sin permiso' });
  d.reviews.splice(idx, 1);
  saveData(d);
  res.json({ message: 'Reseña eliminada' });
});

// ============================================================
// HELPERS
// ============================================================
function enrichProduct(p, d) {
  const cat    = d.product_categories.find(c => c.id === p.category_id);
  const seller = d.users.find(u => u.id === p.seller_id);
  return {
    ...p,
    category_name:   cat?.name,
    category_slug:   cat?.slug,
    seller_name:     seller?.name,
    seller_avatar:   seller?.avatar_url,
    seller_location: seller?.location,
  };
}

function enrichService(s, d) {
  const cat      = d.service_categories.find(c => c.id === s.category_id);
  const provider = d.users.find(u => u.id === s.provider_id);
  return {
    ...s,
    category_name:     cat?.name,
    category_slug:     cat?.slug,
    provider_name:     provider?.name,
    provider_avatar:   provider?.avatar_url,
    provider_location: provider?.location,
  };
}

// ============================================================
// INICIAR
// ============================================================
app.listen(PORT, () => {
  const d = loadData();
  console.log(`\n🟡 Dale Deal PROTOTIPO corriendo en http://localhost:${PORT}`);
  console.log(`📦 ${d.products.length} productos | 🛠️  ${d.services.length} servicios | 👤 ${d.users.length} usuarios`);
  console.log(`\n💡 Login de prueba:`);
  d.users.slice(0, 3).forEach(u => console.log(`   ${u.email.padEnd(30)} contraseña: demo`));
  console.log(`\n📖 Docs: ver ARQUITECTURA.md\n`);
});
