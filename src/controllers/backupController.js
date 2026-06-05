/**
 * Backup de la base de datos sin exponer Postgres a internet.
 *
 * Contexto: el backup anterior dependía de un TCP proxy público de Railway
 * que borramos por seguridad (cualquiera con la URL podía leer/borrar la DB).
 * Este endpoint lo reemplaza: genera un dump JSON de todas las tablas y lo
 * devuelve. Un GitHub Action lo llama cada noche y guarda el resultado como
 * artifact (retención 30 días).
 *
 * AUTENTICACIÓN: usa un token dedicado `BACKUP_TOKEN` (env var), separado del
 * JWT de usuarios. Por qué:
 *   - No expira (los JWT de admin sí) → el cron no se rompe sola
 *   - Scope único (solo backup) → si se filtra, el daño es leer datos, no
 *     hacerse admin
 *   - Se pasa por header X-Backup-Token, nunca en URL
 *
 * Por qué JSON y no pg_dump: pg_dump es un binario externo que puede no estar
 * en el contenedor de Railway. Un dump JSON table-by-table no tiene esa
 * dependencia, es legible, y es restaurable con un script de import.
 * Para el tamaño actual de Dale Deal (decenas de filas) es más que suficiente.
 */

const db = require('../config/database');

// Timing-safe comparison para evitar timing attacks al comparar el token.
const crypto = require('crypto');
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function dumpDatabase(req, res) {
  // 1. Auth por token dedicado
  const expected = process.env.BACKUP_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'BACKUP_TOKEN no configurado en el servidor' });
  }
  const provided = req.get('x-backup-token');
  if (!safeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Token de backup inválido' });
  }

  try {
    // 2. Listar todas las tablas del schema public (se adapta a tablas futuras)
    const tablesRes = await db.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    const tableNames = tablesRes.rows.map(r => r.tablename);

    // 3. Dump cada tabla. Las identificadores van con comillas dobles para
    //    seguridad (vienen de pg_tables, no de user input, pero por las dudas).
    const dump = {};
    let totalRows = 0;
    for (const t of tableNames) {
      // Validación extra defensiva del nombre de tabla (solo [a-z_0-9])
      if (!/^[a-z_][a-z0-9_]*$/i.test(t)) continue;
      const r = await db.query(`SELECT * FROM "${t}"`);
      dump[t] = r.rows;
      totalRows += r.rows.length;
    }

    const payload = {
      meta: {
        generated_at: new Date().toISOString(),
        database: 'daledeal',
        table_count: tableNames.length,
        total_rows: totalRows,
        format_version: 1,
      },
      tables: dump,
    };

    // 4. Headers para descarga como archivo
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition',
      `attachment; filename="daledeal-backup-${new Date().toISOString().slice(0,10)}.json"`);
    res.send(JSON.stringify(payload));

    console.log(`[backup] Dump generado: ${tableNames.length} tablas, ${totalRows} filas`);
  } catch (err) {
    console.error('[backup] Error:', err);
    res.status(500).json({ error: 'Error generando el backup' });
  }
}

module.exports = { dumpDatabase };
