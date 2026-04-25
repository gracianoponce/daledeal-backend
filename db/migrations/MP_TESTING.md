# Testing end-to-end — Mercado Pago (sandbox)

Guía paso a paso para probar el flujo de pagos completo con credenciales TEST
de Mercado Pago antes de ir a producción.

---

## 1. Prerrequisitos

1. **Cuenta de desarrollador en Mercado Pago** (gratis):
   <https://www.mercadopago.com.ar/developers/panel/app>

2. Crear una aplicación tipo "Checkout Pro".

3. Copiar las credenciales **TEST** (sandbox):
   - `Access Token` (empieza con `TEST-`)
   - `Public Key` (empieza con `TEST-`)

4. En el panel de Mercado Pago → **Webhooks**, configurar:
   - URL: `https://TU-TUNEL.ngrok.io/payments/webhook`
     (o tu URL pública si ya deployaste en el VPS)
   - Eventos: **Payments** ✓
   - Copiar el **Secret** que genera MP y ponerlo en `MP_WEBHOOK_SECRET`

5. Instalar **ngrok** (para exponer localhost al webhook de MP):
   ```bash
   npm install -g ngrok
   # o descargarlo de https://ngrok.com/download
   ```

---

## 2. Setup local

### 2.1 Instalar dependencias

```bash
cd dale-deal-backend
npm install           # esto baja mercadopago@^2.0.15
```

### 2.2 Configurar .env

Copiar `.env.example` a `.env` y completar:

```env
MP_ACCESS_TOKEN=TEST-xxxx-xxxx-xxxx
MP_PUBLIC_KEY=TEST-xxxxxxxx-xxxx
MP_WEBHOOK_SECRET=<el-secret-de-la-config-de-webhook>
MARKETPLACE_COMMISSION_RATE=0.05
APP_BASE_URL=https://TU-TUNEL.ngrok.io
FRONTEND_URL=http://localhost:5500
```

⚠️ `APP_BASE_URL` **DEBE ser la URL pública de ngrok**, porque es la que
Mercado Pago va a usar para llamar al webhook.

### 2.3 Correr la migración

```bash
npm run db:migrate:payments
```

Esto agrega los campos `mp_*` a `orders` y crea `payment_events` + `seller_payouts`.

### 2.4 Levantar el backend y el túnel

Terminal 1:
```bash
cd dale-deal-backend
npm run dev
```

Terminal 2:
```bash
ngrok http 3000
# copiar la URL https://xxxx.ngrok.io → esa es APP_BASE_URL
```

Importante: cada vez que reiniciás ngrok te da una URL distinta. Tenés que
actualizar `APP_BASE_URL` en `.env` Y la URL del webhook en el panel de MP.

---

## 3. Tarjetas de prueba

Con credenciales TEST, Mercado Pago sólo acepta tarjetas de prueba.
**No funciona con tarjetas reales en sandbox.**

| Resultado           | Tarjeta                   | Nombre   | CVV | Vencimiento |
| ------------------- | ------------------------- | -------- | --- | ----------- |
| ✅ Aprobado          | 5031 7557 3453 0604       | APRO     | 123 | 11/30       |
| ❌ Rechazo genérico  | 5031 7557 3453 0604       | OTHE     | 123 | 11/30       |
| ⏳ Pendiente         | 5031 7557 3453 0604       | CONT     | 123 | 11/30       |
| ❌ Saldo insuf.      | 5031 7557 3453 0604       | FUND     | 123 | 11/30       |
| ❌ CVV inválido      | 5031 7557 3453 0604       | SECU     | 123 | 11/30       |
| ❌ Vencida           | 5031 7557 3453 0604       | EXPI     | 123 | 11/30       |
| ❌ Form incompleto   | 5031 7557 3453 0604       | FORM     | 123 | 11/30       |

El **NOMBRE** es el que determina el resultado. DNI: `12345678`.

Listado completo oficial:
<https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/test-cards>

---

## 4. Casos a probar

### Caso 1 — Pago aprobado (happy path) ✅

1. Loguearte como comprador en el frontend.
2. Ir a un producto → "Comprar ahora".
3. Se crea la orden y redirige a `sandbox_init_point` de MP.
4. Usar tarjeta **APRO** → completar y pagar.
5. MP redirige a `pago-exitoso.html?order_id=X&payment_id=...&status=approved`.

**Verificar**:
- [ ] La página muestra "¡Pago recibido!" con el detalle.
- [ ] En el backend, logs: `[mp-webhook] Orden X → paid`.
- [ ] En la DB:
  ```sql
  SELECT id, payment_status, status, mp_payment_id, paid_at
    FROM orders WHERE id = X;
  -- → payment_status = 'paid', status = 'paid', paid_at IS NOT NULL
  ```
- [ ] Se creó un row en `seller_payouts` con `status = 'pending'`.
- [ ] Se creó un row en `payment_events` con `signature_valid = true`.

### Caso 2 — Pago rechazado ❌

1. Repetir el flujo pero usar tarjeta con nombre **OTHE** u **FUND**.
2. MP redirige a `pago-fallido.html?order_id=X&status=rejected&status_detail=cc_rejected_other_reason`.

**Verificar**:
- [ ] Se muestra el motivo del rechazo.
- [ ] Botón "Intentar de nuevo" genera una nueva preferencia y redirige.
- [ ] En DB: `payment_status = 'rejected'`.

### Caso 3 — Pago pendiente ⏳

1. Usar tarjeta con nombre **CONT**, o elegir Rapipago/PagoFácil.
2. MP redirige a `pago-pendiente.html?order_id=X&status=pending`.

**Verificar**:
- [ ] Se muestra "Estamos procesando tu pago".
- [ ] En DB: `payment_status = 'in_process'` o `'pending'`.

### Caso 4 — Webhook duplicado (idempotencia) 🔁

MP a veces reenvía el mismo evento. El sistema tiene que ignorarlo.

1. Completar un pago aprobado.
2. En el panel de MP → Notificaciones → reenviar la última notificación.
3. **Verificar** en `payment_events`:
   ```sql
   SELECT request_id, processed_at FROM payment_events
     WHERE mp_payment_id = 'X' ORDER BY processed_at;
   ```
   Si MP manda el mismo `x-request-id`, debería existir un solo row.
   Si manda uno nuevo, hay dos rows pero el estado final de la orden
   se mantiene (no hay double-credit en `seller_payouts` gracias al
   `ON CONFLICT (order_id) DO NOTHING`).

### Caso 5 — Webhook con firma inválida 🚨

1. Mandar manualmente con curl un POST al webhook con firma falsa:
   ```bash
   curl -X POST http://localhost:3000/payments/webhook \
     -H "Content-Type: application/json" \
     -H "x-signature: ts=123,v1=firma_falsa" \
     -H "x-request-id: fake-req-1" \
     -d '{"type":"payment","data":{"id":"1234"}}'
   ```
2. El backend responde `200 OK` (para que no reintente MP), pero
   en los logs tiene que loguear `signature_valid = false` y no
   tocar la orden.

### Caso 6 — Carrito con varios items 🛒

1. Agregar 2-3 productos de vendedores distintos al carrito.
2. Click "Finalizar compra".
3. Se crean N órdenes, redirige a MP para la primera.
4. Pagar (APRO).
5. En `pago-exitoso.html` **tiene que aparecer el banner "Todavía te
   quedan N orden(es) por pagar"** con botones para cada una.
6. Click en uno → redirige a MP con esa orden.

---

## 5. Debug rápido

### Ver la tabla de eventos

```sql
SELECT id, order_id, mp_topic, mp_action, status, signature_valid, processed_at
  FROM payment_events
  ORDER BY processed_at DESC
  LIMIT 10;
```

### Ver órdenes pendientes de pago

```sql
SELECT id, buyer_id, seller_id, total_price, payment_status, created_at
  FROM orders
  WHERE payment_status IN ('pending', 'in_process')
  ORDER BY created_at DESC;
```

### Ver liquidaciones pendientes al vendedor

```sql
SELECT sp.*, u.name AS seller_name, u.email
  FROM seller_payouts sp
  JOIN users u ON u.id = sp.seller_id
  WHERE sp.status = 'pending'
  ORDER BY sp.created_at;
```

### Forzar estado de una orden (para testing)

```sql
UPDATE orders SET payment_status = 'paid', status = 'paid', paid_at = NOW()
 WHERE id = X;
```

---

## 6. Pasos a producción

Cuando todos los casos pasen en sandbox:

1. Cambiar `MP_ACCESS_TOKEN` por las credenciales **APP_USR** de producción.
2. Actualizar la URL del webhook en el panel de MP a la URL del VPS
   (no ngrok).
3. Verificar que `APP_BASE_URL` y `FRONTEND_URL` apunten a dominios reales.
4. `NODE_ENV=production` en el VPS.
5. Primer pago real: hacer una compra pequeña (ej. $100) con tu propia
   tarjeta para confirmar que llega el dinero a la cuenta de MP.

⚠️ En producción, MP cobra una **comisión por transacción** (~5% + IVA).
Esa comisión es adicional a nuestro `MARKETPLACE_COMMISSION_RATE`.
