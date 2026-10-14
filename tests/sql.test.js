/**
 * Las consultas SQL del código, contra una base de verdad.
 *
 * El resto de los tests mockea la base, así que un error que solo detecta
 * Postgres llegaba a producción sin que nada avisara: el UPDATE que guarda el
 * resultado de cada pago de Mercado Pago usaba el mismo parámetro en dos
 * lugares con tipos distintos (42P08) y falló desde el primer día: ninguna
 * orden podía pasar a 'paid'.
 *
 * Acá cada consulta estática de src/ se PREPARA (no se ejecuta), que es lo
 * mismo que hace node-pg al mandarla: Postgres valida tablas, columnas y tipos
 * de parámetros sin tocar un solo dato. Las que se arman con ${...} no se
 * pueden preparar sueltas y quedan afuera.
 *
 * Necesita Postgres con el schema cargado (la base local o la de CI). Si no
 * hay, o si DATABASE_URL no apunta a esta máquina, se saltea.
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Client } = require('pg');

const SRC = path.join(__dirname, '..', 'src');
const SQL_START = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i;
const SQL_BODY  = /\b(FROM|INTO|SET|VALUES)\b/i;

function jsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) jsFiles(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function visit(node, fn) {
  fn(node);
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) value.forEach(child => child && typeof child.type === 'string' && visit(child, fn));
    else if (value && typeof value.type === 'string') visit(value, fn);
  }
}

// Strings y template literals de un archivo que son una consulta completa.
function sqlStatements(acorn, file) {
  const ast = acorn.parse(fs.readFileSync(file, 'utf8'), {
    ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true,
  });
  const found = [];
  const add = (node, text, dynamic) => {
    if (SQL_START.test(text) && SQL_BODY.test(text)) {
      found.push({ where: `${path.relative(path.join(SRC, '..'), file)}:${node.loc.start.line}`, text, dynamic });
    }
  };
  visit(ast, node => {
    if (node.type === 'TemplateLiteral') {
      add(node, node.quasis.map(q => q.value.cooked).join(' '), node.expressions.length > 0);
    } else if (node.type === 'Literal' && typeof node.value === 'string') {
      add(node, node.value, false);
    }
  });
  return found;
}

describe('SQL del código contra la base real', () => {
  let client = null;
  let statements = [];
  let skipped = null;

  beforeAll(async () => {
    let acorn;
    try { acorn = require('acorn'); } catch { skipped = 'falta el paquete acorn'; return; }

    let host;
    try { host = new URL(process.env.DATABASE_URL).hostname; } catch { skipped = 'DATABASE_URL no está configurada'; return; }
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) { skipped = 'DATABASE_URL no apunta a esta máquina'; return; }

    const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
    try {
      await c.connect();
      const { rows } = await c.query("SELECT to_regclass('public.orders') AS t");
      if (!rows[0].t) { await c.end(); skipped = 'la base no tiene el schema cargado'; return; }
    } catch (err) {
      await c.end().catch(() => {});
      skipped = `no hay Postgres disponible (${err.message})`;
      return;
    }
    client = c;
    statements = jsFiles(SRC).flatMap(file => sqlStatements(acorn, file));
  });

  afterAll(async () => {
    if (client) await client.end();
  });

  test('todas las consultas estáticas se pueden preparar', async () => {
    if (skipped) return console.warn(`[sql.test] salteado: ${skipped}`);

    const estaticas = statements.filter(s => !s.dynamic);
    // Si el buscador dejara de encontrar consultas, el test pasaría sin probar nada.
    expect(estaticas.length).toBeGreaterThan(100);
    // Las que usan columnas de la migración 019 también tienen que preparar
    // en su variante sin esas líneas (lo que corre query019 si falta la migración).
    const { withoutMigration019 } = require('../src/services/badges');
    const sinMigracion = estaticas.filter(s => /\/\*019\*\//.test(s.text))
      .map(s => ({ where: `${s.where} (sin la 019)`, text: withoutMigration019(s.text) }));
    expect(sinMigracion.length).toBeGreaterThan(3);

    const errores = [];
    for (const s of [...estaticas, ...sinMigracion]) {
      try {
        await client.query(`PREPARE sql_test AS ${s.text}`);
        await client.query('DEALLOCATE sql_test');
      } catch (err) {
        errores.push(`${s.where}  [${err.code}] ${err.message}${err.detail ? ` (${err.detail})` : ''}`);
      }
    }
    expect(errores).toEqual([]);
  });
});
