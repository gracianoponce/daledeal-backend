/**
 * Configuración del SDK de Mercado Pago (v2).
 *
 * Requiere las siguientes variables de entorno:
 *   - MP_ACCESS_TOKEN   → TEST-xxx para sandbox, APP_USR-xxx para producción
 *   - MP_PUBLIC_KEY     → opcional, solo para el frontend si usamos Bricks
 *   - MP_WEBHOOK_SECRET → opcional, usado para validar la firma x-signature
 *   - APP_BASE_URL      → URL pública del backend (para back_urls y notification_url)
 *   - FRONTEND_URL      → URL del frontend (para back_urls success/failure/pending)
 *
 * Docs:
 *   - https://www.mercadopago.com.ar/developers/es/docs/sdks-library/landing
 *   - https://github.com/mercadopago/sdk-nodejs
 */

const { MercadoPagoConfig, Preference, Payment, MerchantOrder } = require('mercadopago');

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const ENV = process.env.NODE_ENV || 'development';

if (!ACCESS_TOKEN) {
  console.warn('⚠️  MP_ACCESS_TOKEN no está configurado. Los pagos no van a funcionar.');
}

// Nota: MP unificó el formato del token. Ahora tanto test como producción
// pueden empezar con APP_USR-. No se puede distinguir por prefijo.
// Si estás en production, chequeá manualmente que subiste las credenciales
// correctas desde el panel de MP.
if (ACCESS_TOKEN && ACCESS_TOKEN.startsWith('TEST-') && ENV === 'production') {
  console.warn('⚠️  Estás en production pero usando credenciales TEST de Mercado Pago.');
}

// Cliente base — se reutiliza para instanciar Preference, Payment, etc.
const client = ACCESS_TOKEN
  ? new MercadoPagoConfig({
      accessToken: ACCESS_TOKEN,
      options: {
        timeout: 8000,
        idempotencyKey: undefined, // seteamos por request
      },
    })
  : null;

// Helper para lanzar un error claro si se usa MP sin configurar
function requireClient() {
  if (!client) {
    const err = new Error('Mercado Pago no está configurado (falta MP_ACCESS_TOKEN)');
    err.status = 503;
    throw err;
  }
  return client;
}

module.exports = {
  client,
  requireClient,
  // Reexportamos los servicios para que los controllers solo importen esto
  Preference,
  Payment,
  MerchantOrder,
  // Flags útiles
  isConfigured: !!ACCESS_TOKEN,
  isSandbox:    !!(ACCESS_TOKEN && ACCESS_TOKEN.startsWith('TEST-')),
};
