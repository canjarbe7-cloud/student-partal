// npm run migrate  -> jadvallarni yaratadi va birinchi adminni qo'shadi
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('./pool');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('Jadvallar tayyor.');

    const login = process.env.ADMIN_LOGIN || 'admin';
    const parol = process.env.ADMIN_PAROL || 'admin123';
    const hash = await bcrypt.hash(parol, 10);
    const r = await pool.query(
      `INSERT INTO users (ism, familiya, login, parol, role)
       VALUES ('Admin', 'Admin', $1, $2, 'admin')
       ON CONFLICT (login) DO NOTHING
       RETURNING id`,
      [login, hash]
    );
    console.log(r.rowCount ? `Admin yaratildi: ${login}` : `Admin allaqachon bor: ${login}`);
  } catch (err) {
    console.error('Migratsiya xatosi:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
