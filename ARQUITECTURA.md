# Dale Deal — Arquitectura del Backend

## Stack tecnológico

- **Runtime:** Node.js
- **Framework:** Express
- **Base de datos:** PostgreSQL
- **Autenticación:** JWT (JSON Web Tokens)
- **Hash de contraseñas:** bcryptjs
- **Conexión a DB:** node-postgres (`pg`)

---

## Estructura de carpetas

```
dale-deal-backend/
├── src/
│   ├── index.js                  ← Punto de entrada, servidor Express
│   ├── config/
│   │   └── database.js           ← Pool de conexión a PostgreSQL
│   ├── middleware/
│   │   └── auth.js               ← Verificación JWT
│   ├── routes/
│   │   ├── auth.js
│   │   ├── products.js
│   │   ├── services.js
│   │   └── users.js
│   └── controllers/
│       ├── authController.js
│       ├── productController.js
│       ├── serviceController.js
│       └── userController.js
├── db/
│   ├── schema.sql                ← Tablas de la base de datos
│   └── seed.sql                  ← Datos iniciales (categorías)
├── .env.example                  ← Plantilla de variables de entorno
├── .gitignore
├── package.json
└── ARQUITECTURA.md               ← Este archivo
```

---

## Tablas de la base de datos

### `users`
| Campo           | Tipo           | Descripción                       |
|-----------------|----------------|-----------------------------------|
| id              | SERIAL PK      | ID auto-incremental               |
| name            | VARCHAR(100)   | Nombre completo                   |
| email           | VARCHAR(255)   | Email único                       |
| password_hash   | VARCHAR(255)   | Contraseña hasheada con bcrypt    |
| avatar_url      | TEXT           | URL de foto de perfil             |
| phone           | VARCHAR(30)    | Teléfono de contacto              |
| location        | VARCHAR(150)   | Ciudad / provincia                |
| role            | VARCHAR(20)    | `user` o `admin`                  |
| is_active       | BOOLEAN        | Cuenta activa/inactiva            |
| created_at      | TIMESTAMP      | Fecha de creación                 |

### `product_categories`
| Campo | Tipo        | Descripción           |
|-------|-------------|---------------------- |
| id    | SERIAL PK   | ID auto-incremental   |
| name  | VARCHAR     | Nombre (ej: Electrónica) |
| slug  | VARCHAR     | URL-friendly (ej: electronica) |
| icon  | VARCHAR     | Nombre de ícono       |

### `products`
| Campo       | Tipo           | Descripción                         |
|-------------|----------------|-------------------------------------|
| id          | SERIAL PK      | ID auto-incremental                 |
| title       | VARCHAR(255)   | Título del producto                 |
| description | TEXT           | Descripción larga                   |
| price       | DECIMAL(12,2)  | Precio                              |
| currency    | VARCHAR(3)     | `ARS` por defecto                   |
| stock       | INTEGER        | Cantidad disponible                 |
| condition   | VARCHAR(20)    | `new` o `used`                      |
| category_id | FK → product_categories | Categoría              |
| seller_id   | FK → users     | Usuario vendedor                    |
| images      | TEXT[]         | Array de URLs de imágenes           |
| location    | VARCHAR(150)   | Ciudad del vendedor                 |
| status      | VARCHAR(20)    | `active`, `paused`, `sold`          |
| views       | INTEGER        | Contador de visitas                 |

### `service_categories`
Igual que `product_categories` pero para servicios.

### `services`
| Campo         | Tipo           | Descripción                         |
|---------------|----------------|-------------------------------------|
| id            | SERIAL PK      | ID auto-incremental                 |
| title         | VARCHAR(255)   | Título del servicio                 |
| description   | TEXT           | Descripción                         |
| price_from    | DECIMAL(12,2)  | Precio desde (puede ser null)       |
| price_to      | DECIMAL(12,2)  | Precio hasta (puede ser null)       |
| price_type    | VARCHAR(20)    | `fixed`, `hourly`, `quote`          |
| category_id   | FK → service_categories | Categoría                |
| provider_id   | FK → users     | Usuario prestador                   |
| images        | TEXT[]         | Fotos del servicio                  |
| location      | VARCHAR(150)   | Ciudad base del prestador           |
| zones_covered | TEXT[]         | Zonas donde trabaja                 |
| status        | VARCHAR(20)    | `active`, `paused`                  |

---

## Endpoints de la API

### Autenticación
| Método | Ruta            | Auth | Descripción                    |
|--------|-----------------|------|--------------------------------|
| POST   | /auth/register  | No   | Registrar nuevo usuario        |
| POST   | /auth/login     | No   | Login, devuelve JWT            |
| GET    | /auth/me        | Sí   | Obtener usuario autenticado    |

### Productos
| Método | Ruta                     | Auth | Descripción                    |
|--------|--------------------------|------|--------------------------------|
| GET    | /products                | No   | Listar productos (con filtros) |
| GET    | /products/:id            | No   | Ver producto individual        |
| GET    | /products/categories     | No   | Listar categorías              |
| POST   | /products                | Sí   | Crear producto                 |
| PUT    | /products/:id            | Sí   | Editar producto (solo dueño)   |
| DELETE | /products/:id            | Sí   | Eliminar producto (solo dueño) |

### Servicios
| Método | Ruta                     | Auth | Descripción                    |
|--------|--------------------------|------|--------------------------------|
| GET    | /services                | No   | Listar servicios (con filtros) |
| GET    | /services/:id            | No   | Ver servicio individual        |
| GET    | /services/categories     | No   | Listar categorías              |
| POST   | /services                | Sí   | Crear servicio                 |
| PUT    | /services/:id            | Sí   | Editar servicio (solo dueño)   |
| DELETE | /services/:id            | Sí   | Eliminar servicio (solo dueño) |

### Usuarios
| Método | Ruta                  | Auth | Descripción                       |
|--------|-----------------------|------|-----------------------------------|
| GET    | /users/:id            | No   | Perfil público + publicaciones    |
| PUT    | /users/me             | Sí   | Editar mi perfil                  |
| GET    | /users/me/products    | Sí   | Mis productos publicados          |
| GET    | /users/me/services    | Sí   | Mis servicios publicados          |

---

## Parámetros de búsqueda

### GET /products
```
?search=iphone        → búsqueda en título y descripción
?category=electronica → filtrar por slug de categoría
?condition=used       → filtrar por condición (new/used)
?page=1&limit=20      → paginación
```

### GET /services
```
?search=plomero       → búsqueda en título y descripción
?category=plomeria    → filtrar por slug de categoría
?location=Córdoba     → filtrar por ciudad
?page=1&limit=20      → paginación
```

---

## Autenticación con JWT

El cliente debe enviar el token en el header `Authorization` en cada request que lo requiera:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

El token se obtiene al hacer login o registro y expira en 7 días (configurable en `.env`).

---

## Instalación y configuración inicial

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus datos de PostgreSQL

# 3. Crear la base de datos en PostgreSQL
createdb daledeal

# 4. Ejecutar el esquema
npm run db:schema

# 5. Cargar categorías iniciales
npm run db:seed

# 6. Iniciar en desarrollo
npm run dev

# 6b. Iniciar en producción
npm start
```

---

## Despliegue en VPS (DigitalOcean / Linode)

### Instalar dependencias en el servidor

```bash
# Node.js (via nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20
nvm use 20

# PostgreSQL
sudo apt update
sudo apt install postgresql postgresql-contrib

# PM2 (gestor de procesos)
npm install -g pm2
```

### Configurar PostgreSQL

```bash
sudo -u postgres psql
CREATE DATABASE daledeal;
CREATE USER daledeal_user WITH ENCRYPTED PASSWORD 'tu_password';
GRANT ALL PRIVILEGES ON DATABASE daledeal TO daledeal_user;
\q
```

### Subir el proyecto y ejecutar

```bash
git clone tu-repo
cd dale-deal-backend
npm install
cp .env.example .env
# Editar .env con los datos del VPS
npm run db:schema
npm run db:seed
pm2 start src/index.js --name dale-deal-api
pm2 save
pm2 startup
```

### Nginx como reverse proxy (opcional pero recomendado)

```nginx
server {
    listen 80;
    server_name tu-dominio.com;

    location /api/ {
        proxy_pass http://localhost:3000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## Conectar el frontend con la API

### 1. Crear un archivo `api.js` en el frontend

```javascript
const API_URL = 'http://tu-dominio.com:3000'; // o '/api' con Nginx

// Función helper para requests autenticados
async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) throw await res.json();
  return res.json();
}
```

### 2. Reemplazar el login simulado

```javascript
// ANTES (simulado)
const users = JSON.parse(localStorage.getItem('users')) || [];

// AHORA (real)
async function login(email, password) {
  const data = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', JSON.stringify(data.user));
  return data.user;
}
```

### 3. Reemplazar products.json

```javascript
// ANTES (simulado)
const products = await fetch('products.json').then(r => r.json());

// AHORA (real)
async function getProducts(filters = {}) {
  const params = new URLSearchParams(filters).toString();
  return apiFetch(`/products?${params}`);
}
```

### 4. Publicar un producto

```javascript
async function publishProduct(productData) {
  return apiFetch('/products', {
    method: 'POST',
    body: JSON.stringify(productData)
  });
}
```

---

## Próximos pasos para el MVP

Una vez funcionando el backend base, los siguientes pasos naturales son:

1. **Sistema de contacto / mensajes** entre compradores y vendedores
2. **Favoritos** guardados en DB (en lugar de localStorage)
3. **Upload de imágenes** (Cloudinary o S3)
4. **Sistema de valoraciones / reseñas**
5. **Notificaciones por email** (nodemailer)
6. **Búsqueda avanzada** con filtros por precio, ubicación, etc.
