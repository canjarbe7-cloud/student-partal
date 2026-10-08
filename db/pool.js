require('dotenv').config();
const { Pool, types } = require('pg');

// bigint (OID 20) pg'da string bo'lib keladi -> number qilamiz
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// date (OID 1082) ni JS Date'ga aylantirmay 'YYYY-MM-DD' holida qoldiramiz
types.setTypeParser(1082, (v) => v);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render tashqi ulanishda SSL talab qiladi
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 5,
});

// Tranzaksiya yordamchisi: fn(client) xato bersa ROLLBACK
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, tx, query: (text, params) => pool.query(text, params) };
