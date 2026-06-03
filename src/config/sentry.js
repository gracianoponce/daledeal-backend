/**
 * Sentry error tracking — backend (Node.js).
 *
 * CÓMO ACTIVAR:
 *   1) Crear cuenta en https://sentry.io (gratis hasta 5k events/mes)
 *   2) New project → Node.js → name "dale-deal-backend"
 *   3) Sentry da un DSN tipo:
 *      https://abc123def456@o12345.ingest.us.sentry.io/789
 *   4) Setear variable en Railway: SENTRY_DSN_BACKEND=<el DSN>
 *   5) Redeploy automático y listo
 *
 * Sin SENTRY_DSN_BACKEND, este archivo no hace nada (init es no-op).
 *
 * Sentry v8 requiere init() ANTES de cualquier require de express, por eso
 * este archivo se carga apenas arranca index.js — antes de cualquier router.
 */

const Sentry = require('@sentry/node');

function initSentry() {
  const dsn = process.env.SENTRY_DSN_BACKEND;
  if (!dsn) {
    // En dev local sin DSN, no spammeamos warnings cada arranque.
    return false;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    // Sample rate: capturamos 100% de errores siempre, 10% de transactions
    // (más que suficiente para 5k events/mes free tier).
    tracesSampleRate: 0.1,
    // No mandar PII por default. Si lo necesitamos, hay que opt-in.
    sendDefaultPii: false,
    // Release: si Railway nos da el commit sha, lo usamos para asociar
    // errores con commits específicos (útil para git bisect cuando algo rompe).
    release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
  });

  console.log('[sentry] Inicializado para env', process.env.NODE_ENV || 'development');
  return true;
}

module.exports = { initSentry, Sentry };
