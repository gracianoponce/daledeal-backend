/**
 * Valida que las variables de entorno críticas estén presentes
 * antes de arrancar el servidor. Falla rápido si falta algo,
 * para evitar errores raros en runtime.
 *
 * Se llama desde index.js antes de levantar la app.
 */

const REQUIRED = [
  // Identidad / DB
  { name: 'DATABASE_URL', desc: 'Connection string de PostgreSQL' },
  { name: 'JWT_SECRET',   desc: 'Secret para firmar JWT (>= 32 chars)' },

  // Mercado Pago
  { name: 'MP_ACCESS_TOKEN', desc: 'Access token de Mercado Pago (TEST-... o APP_USR-...)' },

  // URLs públicas (importantes para CORS, MP back_urls y webhooks)
  { name: 'FRONTEND_URL',  desc: 'URL del frontend (para CORS)' },
  { name: 'APP_BASE_URL',  desc: 'URL pública del backend (para webhooks de MP)' },
];

const RECOMMENDED = [
  { name: 'MP_WEBHOOK_SECRET',          desc: 'Secret para validar firma del webhook MP' },
  { name: 'MARKETPLACE_COMMISSION_RATE', desc: 'Comisión del marketplace (default 0.05)' },
  { name: 'JWT_EXPIRES_IN',              desc: 'Expiración de JWT (default 7d)' },
  { name: 'NODE_ENV',                    desc: 'development | production | test' },
  { name: 'RESEND_API_KEY',              desc: 'API key de Resend (sin esto los emails no se envían, solo se loggean)' },
  { name: 'EMAIL_FROM',                  desc: 'Remitente de emails (default: Dale Deal <hola@daledeal.com.ar>)' },
];

function validateEnv() {
  const missing = [];
  const warnings = [];

  REQUIRED.forEach(({ name, desc }) => {
    const v = process.env[name];
    if (!v || String(v).trim() === '') missing.push({ name, desc });
  });

  RECOMMENDED.forEach(({ name, desc }) => {
    const v = process.env[name];
    if (!v || String(v).trim() === '') warnings.push({ name, desc });
  });

  // Validaciones específicas extra
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    missing.push({
      name: 'JWT_SECRET',
      desc: `JWT_SECRET es muy corto (${process.env.JWT_SECRET.length} chars). Mínimo 32. Generá uno con:\n        node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`,
    });
  }

  if (process.env.NODE_ENV === 'production') {
    // En prod, FRONTEND_URL no puede ser localhost
    if (/localhost/i.test(process.env.FRONTEND_URL || '')) {
      missing.push({
        name: 'FRONTEND_URL',
        desc: 'En producción no puede apuntar a localhost. Usá la URL pública del frontend.',
      });
    }
    // En prod, APP_BASE_URL debe ser HTTPS
    if (process.env.APP_BASE_URL && !process.env.APP_BASE_URL.startsWith('https://')) {
      warnings.push({
        name: 'APP_BASE_URL',
        desc: 'En producción debería ser HTTPS para que MP acepte el webhook y back_urls.',
      });
    }
    // En prod, MP_ACCESS_TOKEN no debería ser TEST-
    if ((process.env.MP_ACCESS_TOKEN || '').startsWith('TEST-')) {
      warnings.push({
        name: 'MP_ACCESS_TOKEN',
        desc: 'En producción estás usando un token TEST de Mercado Pago. Cambialo por el de PRD.',
      });
    }
    // En prod, MP_WEBHOOK_SECRET es OBLIGATORIO. Sin esto, cualquiera con
    // la URL del webhook podría marcar órdenes como pagadas.
    if (!process.env.MP_WEBHOOK_SECRET || String(process.env.MP_WEBHOOK_SECRET).trim() === '') {
      missing.push({
        name: 'MP_WEBHOOK_SECRET',
        desc: 'En producción es obligatorio para validar la firma del webhook de MP. Sacalo del panel de developers MP > Webhooks.',
      });
    }
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  Variables de entorno opcionales/recomendadas faltantes:');
    warnings.forEach(({ name, desc }) => console.warn(`   • ${name} — ${desc}`));
    console.warn('');
  }

  if (missing.length > 0) {
    console.error('\n❌ FALTAN VARIABLES DE ENTORNO CRÍTICAS:\n');
    missing.forEach(({ name, desc }) => console.error(`   • ${name}\n     ${desc}\n`));
    console.error('Copiá .env.example como .env y completalas. Saliendo.\n');
    process.exit(1);
  }
}

module.exports = validateEnv;
