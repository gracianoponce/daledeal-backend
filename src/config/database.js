const { Pool } = require('pg');

// Pool de conexiones a PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // En producción con SSL (Railway, Render, etc.):
  // ssl: { rejectUnauthorized: false }
});

// Verificar conexión al iniciar
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Error al conectar con PostgreSQL:', err.message);
  } else {
    console.log('✅ Conectado a PostgreSQL');
    release();
  }
});

// Función helper para ejecutar queries
const query = (text, params) => pool.query(text, params);

module.exports = { query, pool };
