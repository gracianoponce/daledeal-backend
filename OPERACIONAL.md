# 📘 Operacional — Dale Deal

Guía rápida para mantener el marketplace en marcha. Audiencia: **vos** (Gastón/Graciano) cuando algo se cae, hay que correr una migration, o cuando un dev nuevo se sube al proyecto.

> Última actualización: **2026-06-05**
> Estado: pre-launch técnico al 100% (faltan decisiones de producto + MP a prod).

---

## 🗺️ Mapa del stack

```
┌─────────────────────┐       ┌──────────────────────────┐
│  Cloudflare Workers │ ──────│  daledeal.com.ar         │
│  (frontend dist/)   │       │  www.daledeal.com.ar     │
└──────────┬──────────┘       └──────────────────────────┘
           │ fetch
           ▼
┌─────────────────────────────────────────────────────────┐
│  Railway: daledeal-backend (Express + Node 20)          │
│  daledeal-backend-production.up.railway.app             │
│  (api.daledeal.com.ar — DNS configurado, SSL pending)   │
└──────────┬──────────────────┬───────────────────────────┘
           │                  │
           ▼                  ▼
┌─────────────────┐  ┌──────────────────┐
│ Postgres 18.4   │  │ Resend (email)   │
│ (Railway,       │  │ Mercado Pago     │
│  network priv)  │  │ Google OAuth     │
└─────────────────┘  └──────────────────┘
```

## 🔑 Servicios externos

| Servicio | Para qué | Cuenta | Credencial |
|---|---|---|---|
| **Cloudflare Workers** | Hosting frontend | Graciano (`b453287b...`) | Wrangler CLI / API token |
| **Railway** | Hosting backend + DB | Graciano (project `sparkling-happiness`) | Project token (rotable) |
| **Postgres** (Railway) | DB principal | — | `POSTGRES_PASSWORD` env var |
| **Resend** | Emails transaccionales | Graciano | `RESEND_API_KEY` env var |
| **Mercado Pago** | Pagos (sandbox hoy) | A definir (dueño) | `MP_ACCESS_TOKEN` (`TEST-` hoy) |
| **Google OAuth** | Sign-in con Google | Graciano | `GOOGLE_CLIENT_ID` env var |
| **Sentry** | Error tracking | A definir | `SENTRY_DSN_BACKEND` (set OK) |
| **UptimeRobot** | Monitoreo uptime | Graciano | UI propia, sin var |
| **GitHub** | Repos de código | `gastoncge/Dale-Deal` (frontend), `gracianoponce/daledeal-backend` (backend) | PAT user-scoped |

## 📦 Repos

- **Frontend**: https://github.com/gastoncge/Dale-Deal (branch: `main`)
- **Backend**: https://github.com/gracianoponce/daledeal-backend (branch: `main`)
- **PR pendiente de mergear**: https://github.com/gastoncge/Dale-Deal/pull/3 (13 commits míos sobre el refactor de Gastón)

---

## 🚨 Runbook — qué hacer cuando…

### "El sitio se cayó"
1. Chequear UptimeRobot dashboard (debería haber alertado por email).
2. Si frontend (daledeal.com.ar) está down: `https://www.cloudflarestatus.com/`.
3. Si backend está down: `https://railway.com/dashboard` → ver logs del servicio `daledeal-backend`.
4. Sentry → tab "Issues" → ver el último error en `dale-deal-backend` o `dale-deal-frontend`.

### "Un usuario reporta que algo no funciona"
1. Pedirle el URL exacto + browser + screenshot.
2. Sentry: filtrar por su email si está logueado (`Sentry.setUser` lo asocia).
3. Si es bug visual: hard reload (`Cmd+Shift+R`) primero — el cache-busting universal del frontend evita 99% de bugs de cache stale.

### "Hay que correr una migration nueva"
1. Crear el `.sql` en `dale-deal-backend/db/migrations/0XX_nombre.sql`.
2. Pushear al repo.
3. **Aplicar en Railway prod**, 2 opciones:
   - **Dashboard UI**: Railway → Postgres → tab **Data** → barra "Query" → pegar el SQL → Run.
   - **Vía CLI con TCP proxy temporal** (lo que hace Claude):
     ```bash
     # 1. Crear TCP proxy via Railway API (necesita Project Token)
     # 2. psql "postgresql://postgres:PASS@HOST:PORT/railway" -f db/migrations/0XX.sql
     # 3. Borrar el TCP proxy
     ```
4. Verificar con un SELECT que la tabla/columna esté creada.

### "Hay que reembolsar una orden"
1. Login admin en https://daledeal.com.ar/HTML/admin.html
2. Tab **Órdenes** → buscá la orden → botón rojo **"Reembolsar"**
3. Modal: pegar motivo (opcional) + tickear checkbox de confirmación → **Reembolsar**
4. El comprador recibe email automático "Reembolso procesado · Orden #X"
5. El dinero se acredita en 1-5 días hábiles según MP

### "Necesito exportar leads o pedidos a Excel"
1. Admin → tab Órdenes o Leads B2B → botón **"Exportar CSV"** o **"Exportar leads"**
2. El archivo descarga con BOM UTF-8 (Excel detecta acentos)
3. Tiene fecha en el filename para no confundirse

### "Hay que rotar una credencial"
| Si se filtra... | Rotar en | Backend redeploya solo? |
|---|---|---|
| `DATABASE_URL` / Postgres password | Railway → Postgres → Settings → "Rotate password" | Sí (variable referenciada con `${{...}}`) |
| `JWT_SECRET` | Railway → backend service → Variables → editar | Sí, pero **invalida todas las sesiones activas** |
| `MP_ACCESS_TOKEN` | MP panel → Credenciales → Regenerar | Manualmente actualizar Railway var |
| `RESEND_API_KEY` | Resend dashboard → API keys → Revoke + Create | Manualmente actualizar Railway var |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → Credentials | Update Railway + JS/utils.js |
| `SENTRY_DSN_*` | Sentry → Project → Settings → Client Keys → Revoke + Create | Update Railway var (backend) o JS/utils.js (frontend) |

---

## 🗃️ Migrations (estado actual en prod)

| # | Archivo | Aplicada en prod | Qué hace |
|---|---|---|---|
| 001 | `messages.sql` | ✅ | Sistema de mensajería buyer/seller |
| 002 | `payments.sql` | ✅ | Tabla payouts + MP integration |
| 003 | `shipping.sql` | ✅ | Campos de envío en orders |
| 004 | `password_reset.sql` | ✅ | Tabla tokens de reset |
| 005 | `reports.sql` | ✅ | Reportes de problemas |
| 006 | `indexes.sql` | ✅ | Performance indexes |
| 007 | `google_oauth.sql` | ✅ | Campo `google_id` en users |
| 008 | `fix_service_images.sql` | ✅ | 3 imágenes coherentes por servicio (15 servicios) |
| 009 | `fix_product_images.sql` | ✅ | 3 imágenes coherentes por producto (30 productos) |
| 010 | `company_leads.sql` | ✅ | Tabla `company_leads` (B2B funnel) |
| 011 | `newsletter.sql` | ✅ | Tabla `newsletter_subscribers` |

---

## 🔐 Seguridad — checklist post-Sprint 6

| Item | Estado | Notas |
|---|---|---|
| DB Postgres privada (sin TCP proxy público) | ✅ | Se crea temporal solo para correr migrations |
| Rate limit en endpoints públicos | ✅ | `/contact` (5/15min), `/newsletter` (10/15min), `/auth/login` (existente) |
| Honeypot en form contacto | ✅ | Campo `website` invisible — 95% efectividad sin captcha |
| CSV injection prevention | ✅ | Prefix `'` en valores que empiezan con `= + - @ \| %` |
| Email injection prevention | ✅ | Rechazo de `,;\n\r\t` en email + max 254 chars |
| Refund race condition | ✅ | Transacción + `SELECT FOR UPDATE` en orders |
| XSS en HTML de emails | ✅ | `escapeHtml()` en todos los templates |
| SQL injection | ✅ | Parametrized queries en todos los endpoints |
| Admin endpoints protegidos | ✅ | Middleware `requireAdmin` + JWT |
| Sentry monitoring | ✅ | Frontend + backend con DSN propios |
| Logs sensibles | ✅ | `sendDefaultPii: false` en Sentry |
| CSP / Security headers | ✅ | `securityHeaders` middleware (CSP, X-Frame-Options, etc.) |

**Pendientes** (no críticos):
- ⏳ Sentry source maps upload (requiere CLI setup, 30 min)
- ⏳ CSRF para admin endpoints (mitigado con Bearer token; agregar Origin check)
- ⏳ Backup automático (workflow GitHub Actions roto al borrar TCP proxy — repensar estrategia)

---

## 📊 Endpoints clave

### Públicos
| Método | Path | Para qué |
|---|---|---|
| GET | `/health` | Health check (UptimeRobot lo pinguea) |
| GET | `/products?sort=views&order=desc&limit=4` | Trending |
| GET | `/products?search=iphone` | Búsqueda |
| GET | `/services` / `/services/:id` | Catálogo + detalle |
| GET | `/sitemap-products.xml` | Sitemap dinámico (Google indexing) |
| POST | `/contact` | Form contacto (rate-limited 5/15min) |
| POST | `/newsletter/subscribe` | Newsletter footer (rate-limited 10/15min) |
| POST | `/auth/register` / `/auth/login` / `/auth/google` | Sign up & login |
| POST | `/auth/forgot-password` | Olvidé mi clave |

### Logueados
| Método | Path | Para qué |
|---|---|---|
| GET | `/users/me` | Perfil propio (Mi Cuenta) |
| PUT | `/users/me` | Editar perfil |
| GET | `/orders/sales` | Mis ventas |
| POST | `/payments/preference` | Crear preference MP |

### Admin
| Método | Path | Para qué |
|---|---|---|
| GET | `/admin/stats` | Dashboard métricas |
| GET | `/admin/stats/timeseries?days=30` | Datos diarios para charts |
| GET | `/admin/orders` / `/admin/users` / `/admin/products` | Listados |
| POST | `/admin/orders/:id/refund` | Reembolso |
| GET | `/admin/leads` / `PATCH /admin/leads/:id` | Gestión leads B2B |
| GET | `/admin/{orders,leads,newsletter}.csv` | Export CSV |

---

## 🚀 Deploy

### Frontend (Cloudflare Workers)
```bash
# Local en el worktree del frontend:
npm run build       # → genera dist/ con cache-busting hash
npx wrangler deploy # → sube assets + Worker + custom domain mapping
```

Cache-busting: cada build genera un hash único en query string de todos los `<script>` y `<link>` (ver `build.js → appendCacheBust`). Garantiza que el browser refetch los assets nuevos sin esperar TTL del cache.

### Backend (Railway)
Auto-deploy en cada push a `main` del repo `daledeal-backend`. Workflow GitHub Actions corre tests primero (`ci.yml`).

---

## 📝 Decisiones pendientes (necesitan al dueño)

1. **Mercado Pago a producción**: hoy estamos en sandbox (`TEST-` tokens). Para cobrar real necesitamos credenciales `APP_USR-` que sale de la verificación de identidad del CUIT del dueño en MP.
2. **Upload de imágenes en `/publicar`**: hoy el form solo acepta URLs hosteadas en otro lado (Imgur, Drive). Para upload real necesitamos definir servicio (Cloudflare R2 / ImgBB / Cloudinary).
3. **Mensajería buyer-seller**: el backend ya tiene `/messages/*` endpoints. Falta UI para activarla en producto.html / servicio.html.
4. **Soporte humano**: cuando un usuario tenga un problema (refund, dispute, lo que sea), ¿quién y cómo lo atiende? Definir canal (email contacto@, WhatsApp, chat).

---

## 🧪 Tests

```bash
cd dale-deal-backend
npm test    # 56 tests, ~1s
```

Cubre: endpoints públicos (productos, servicios, auth), validación de inputs, rechazo de inputs raros (XSS, SQL injection attempts), 401 sin token en endpoints protegidos, /contact validation + honeypot, /users/me, /admin endpoints.

---

## 📞 En caso de duda

1. Releer este doc.
2. Revisar commits recientes en el backend: `git log --oneline -20`.
3. Sentry — los errores cuentan mucho mejor lo que pasó que cualquier intuición.
4. Si está caído, **revertir el último deploy** desde Railway dashboard suele resolver el 80% de los casos.
