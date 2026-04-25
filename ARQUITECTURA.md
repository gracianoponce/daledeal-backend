# Dale Deal — Arquitectura del Backend v2.0

## Stack tecnológico

- **Runtime:** Node.js
- **Framework:** Express
- **Base de datos:** PostgreSQL
- **Autenticación:** JWT (JSON Web Tokens)
- **Hash de contraseñas:** bcryptjs (12 rounds)
- **Conexión a DB:** node-postgres (`pg`)

---

## Estructura de carpetas

```
dale-deal-backend/
├── src/
│   ├── index.js                  ← Entrada principal (Express + middlewares)
│   ├── config/
│   │   └── database.js           ← Pool de conexión a PostgreSQL
│   ├── middleware/
│   │   ├── auth.js               ← Verificación JWT
│   │   ├── rateLimiter.js        ← Rate limiting en memoria (anti fuerza bruta)
│   │   ├── securityHeaders.js    ← Headers de seguridad (equiv. Helmet)
│   │   ├── logger.js             ← Logger de requests (equiv. Morgan)
│   │   └── validate.js           ← Validaciones y sanitización de inputs
│   ├── routes/
│   │   ├── auth.js
│   │   ├── products.js
│   │   ├── services.js
│   │   ├── users.js
│   │   ├── favorites.js          ← Nuevo ✨
│   │   ├── orders.js             ← Nuevo ✨
│   │   └── reviews.js            ← Nuevo ✨
│   └── controllers/
│       ├── authController.js
│       ├── productController.js
│       ├── serviceController.js
│       ├── userController.js
│       ├── favoritesController.js ← Nuevo ✨
│       ├── ordersController.js    ← Nuevo ✨
│       └── reviewsController.js   ← Nuevo ✨
├── db/
│   ├── schema.sql                ← Tablas (incluye favorites, orders, reviews)
│   └── seed.sql                  ← Datos iniciales (categorías)
├── .env.example                  ← Plantilla de variables de entorno
├── .gitignore
├── package.json
└── ARQUITECTURA.md               ← Este archivo
```

---

## Seguridad implementada

| Feature               | Implementación                                       |
|-----------------------|------------------------------------------------------|
| Security headers      | `securityHeaders.js` — X-Frame-Options, CSP, etc.   |
| Rate limiting (auth)  | 10 requests / 15 min por IP en `/auth`               |
| Rate limiting (API)   | 200 requests / 15 min por IP en `/api`               |
| Rate limiting (POST)  | 30 publicaciones / hora por IP                       |
| Body size limit       | 2MB máximo por request                               |
| Input sanitización    | Escape de HTML en todos los strings del body         |
| Password hashing      | bcrypt con 12 rounds                                 |
| Password validation   | Mínimo 8 chars + mayúscula + número                  |
| Email normalización   | Siempre lowercase antes de guardar                   |
| JWT verification      | En todos los endpoints protegidos                    |
| Owner check           | Solo el dueño puede editar/eliminar sus recursos     |
| No info leak          | Login devuelve mensaje genérico para evitar enumerar |

---

## Tablas de la base de datos

### `users`
| Campo         | Tipo         | Descripción                    |
|---------------|--------------|--------------------------------|
| id            | SERIAL PK    | ID auto-incremental            |
| name          | VARCHAR(100) | Nombre completo                |
| email         | VARCHAR(255) | Email único (lowercase)        |
| password_hash | VARCHAR(255) | bcrypt 12 rounds               |
| avatar_url    | TEXT         | URL de foto de perfil          |
| phone         | VARCHAR(30)  | Teléfono                       |
| location      | VARCHAR(150) | Ciudad / provincia             |
| role          | VARCHAR(20)  | `user` o `admin`               |
| is_active     | BOOLEAN      | Cuenta activa/inactiva         |
| created_at    | TIMESTAMP    | Fecha de creación              |
| updated_at    | TIMESTAMP    | Última actualización           |

### `products` / `services`
Ver schema.sql para campos completos.

### `favorites` ✨
| Campo     | Tipo        | Descripción                           |
|-----------|-------------|---------------------------------------|
| id        | SERIAL PK   | ID                                    |
| user_id   | FK → users  | Usuario que guardó el favorito        |
| item_type | VARCHAR(10) | `product` o `service`                 |
| item_id   | INTEGER     | ID del producto o servicio            |
| created_at| TIMESTAMP   | Cuándo fue guardado                   |

### `orders` ✨
| Campo           | Tipo         | Descripción                       |
|-----------------|--------------|-----------------------------------|
| id              | SERIAL PK    | ID                                |
| buyer_id        | FK → users   | Comprador                         |
| seller_id       | FK → users   | Vendedor                          |
| product_id      | FK → products| Producto comprado                 |
| quantity        | INTEGER      | Cantidad                          |
| unit_price      | DECIMAL      | Precio unitario al momento        |
| total_price     | DECIMAL      | Total                             |
| status          | VARCHAR      | pending/confirmed/shipped/delivered/cancelled |
| payment_status  | VARCHAR      | pending/paid/refunded/failed      |
| shipping_address| TEXT         | Dirección de envío                |
| notes           | TEXT         | Notas del comprador               |

### `reviews` ✨
| Campo       | Tipo         | Descripción                    |
|-------------|--------------|--------------------------------|
| id          | SERIAL PK    | ID                             |
| reviewer_id | FK → users   | Quien hizo la reseña           |
| item_type   | VARCHAR(10)  | `product` o `service`          |
| item_id     | INTEGER      | ID del item reseñado           |
| rating      | SMALLINT     | 1 a 5                          |
| title       | VARCHAR(150) | Título (opcional)              |
| body        | TEXT         | Texto de la reseña (opcional)  |

---

## Endpoints de la API

### Autenticación
| Método | Ruta                    | Auth | Descripción                        |
|--------|-------------------------|------|------------------------------------|
| POST   | /auth/register          | No   | Registro (rate limited)            |
| POST   | /auth/login             | No   | Login, devuelve JWT (rate limited) |
| GET    | /auth/me                | Sí   | Usuario autenticado                |
| POST   | /auth/change-password   | Sí   | Cambiar contraseña                 |
| POST   | /auth/deactivate        | Sí   | Desactivar cuenta                  |

### Productos
| Método | Ruta                 | Auth | Descripción                          |
|--------|----------------------|------|--------------------------------------|
| GET    | /products            | No   | Listar con filtros y sorting         |
| GET    | /products/:id        | No   | Ver producto                         |
| GET    | /products/categories | No   | Listar categorías                    |
| POST   | /products            | Sí   | Crear producto                       |
| PUT    | /products/:id        | Sí   | Editar (solo dueño)                  |
| DELETE | /products/:id        | Sí   | Eliminar (solo dueño)                |

**Query params de GET /products:**
```
?search=iphone          → búsqueda full-text
?category=electronica   → slug de categoría
?condition=used         → new | used
?min_price=1000         → precio mínimo
?max_price=50000        → precio máximo
?seller_id=5            → filtrar por vendedor
?sort=price             → price | title | views | created_at
?order=asc              → asc | desc
?page=1&limit=20        → paginación (max 100 por página)
```

### Servicios
| Método | Ruta                  | Auth | Descripción                    |
|--------|-----------------------|------|--------------------------------|
| GET    | /services             | No   | Listar con filtros             |
| GET    | /services/:id         | No   | Ver servicio                   |
| GET    | /services/categories  | No   | Listar categorías              |
| POST   | /services             | Sí   | Crear servicio                 |
| PUT    | /services/:id         | Sí   | Editar (solo dueño)            |
| DELETE | /services/:id         | Sí   | Eliminar (solo dueño)          |

### Usuarios
| Método | Ruta               | Auth | Descripción                       |
|--------|--------------------|------|-----------------------------------|
| GET    | /users/:id         | No   | Perfil público + publicaciones    |
| PUT    | /users/me          | Sí   | Editar mi perfil                  |
| GET    | /users/me/products | Sí   | Mis productos                     |
| GET    | /users/me/services | Sí   | Mis servicios                     |

### Favoritos ✨
| Método | Ruta                          | Auth | Descripción                    |
|--------|-------------------------------|------|--------------------------------|
| GET    | /favorites                    | Sí   | Mis favoritos                  |
| GET    | /favorites/check/:type/:id    | Sí   | ¿Está en mis favoritos?        |
| POST   | /favorites                    | Sí   | Agregar a favoritos            |
| DELETE | /favorites/:id                | Sí   | Eliminar por ID de favorito    |
| DELETE | /favorites/item/:type/:itemId | Sí   | Eliminar por tipo+itemId       |

### Órdenes ✨
| Método | Ruta                   | Auth | Descripción                    |
|--------|------------------------|------|--------------------------------|
| POST   | /orders                | Sí   | Crear orden de compra          |
| GET    | /orders/my             | Sí   | Mis compras                    |
| GET    | /orders/sales          | Sí   | Mis ventas                     |
| GET    | /orders/:id            | Sí   | Detalle de una orden           |
| PATCH  | /orders/:id/status     | Sí   | Actualizar estado              |

**Estados de una orden:** `pending → confirmed → shipped → delivered`  
(El comprador y/o vendedor pueden cancelar: `cancelled`)

### Reseñas ✨
| Método | Ruta                    | Auth | Descripción                       |
|--------|-------------------------|------|-----------------------------------|
| GET    | /reviews/:type/:itemId  | No   | Reseñas de un producto/servicio   |
| GET    | /reviews/user/:userId   | No   | Reseñas recibidas por un usuario  |
| POST   | /reviews                | Sí   | Crear reseña (requiere orden OK)  |
| PUT    | /reviews/:id            | Sí   | Editar reseña propia              |
| DELETE | /reviews/:id            | Sí   | Eliminar reseña propia            |

---

## Autenticación

El cliente envía el token en el header `Authorization`:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

El token se obtiene al hacer login o registro y expira en 7 días (configurable en `.env`).

---

## Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# → Editá .env con tus credenciales de PostgreSQL

# 3. Crear la base de datos
createdb daledeal

# 4. Ejecutar el esquema
npm run db:schema

# 5. Cargar categorías iniciales
npm run db:seed

# 6. Iniciar en desarrollo
npm run dev

# Iniciar en producción
npm start
```

---

## Conectar el frontend con la API

### Helper de fetch autenticado

```javascript
const API_URL = 'http://localhost:3000';

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('daledealer_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) throw await res.json();
  return res.json();
}
```

### Login
```javascript
const { token, user } = await apiFetch('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password })
});
localStorage.setItem('daledealer_token', token);
```

### Productos
```javascript
// Listar con filtros
const { data, total } = await apiFetch('/products?search=iphone&sort=price&order=asc');

// Crear
await apiFetch('/products', { method: 'POST', body: JSON.stringify(productData) });
```

### Favoritos
```javascript
// Verificar si está en favoritos
const { isFavorite } = await apiFetch('/favorites/check/product/42');

// Agregar
await apiFetch('/favorites', { method: 'POST', body: JSON.stringify({ item_type: 'product', item_id: 42 }) });

// Quitar
await apiFetch('/favorites/item/product/42', { method: 'DELETE' });
```

### Órdenes
```javascript
// Comprar
await apiFetch('/orders', {
  method: 'POST',
  body: JSON.stringify({ product_id: 42, quantity: 1, shipping_address: 'Av. Corrientes 1234, CABA' })
});

// Mis compras
const { data } = await apiFetch('/orders/my');
```

### Reseñas
```javascript
// Ver reseñas de un producto
const { data, avgRating } = await apiFetch('/reviews/product/42');

// Publicar reseña
await apiFetch('/reviews', {
  method: 'POST',
  body: JSON.stringify({ item_type: 'product', item_id: 42, rating: 5, title: '¡Excelente!', body: 'Llegó rápido y en perfectas condiciones.' })
});
```
