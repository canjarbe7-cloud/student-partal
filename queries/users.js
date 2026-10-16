const bcrypt = require('bcryptjs');
const db = require('../db/pool');

// users + rolga mos info jadvali + tyutor guruhlari + bo'limlar — bitta qatorda
const SELECT_FULL = `
  SELECT u.id, u.ism, u.familiya, u.ochestva, u.login, u.role, u.phone,
         u.status, u.created_at, u.updated_at,
         s.guruh, s.kurs, d.lavozim,
         COALESCE(s.tg_user, t.tg_user, d.tg_user) AS tg_user,
         (SELECT string_agg(g.guruh, ', ' ORDER BY g.guruh)
            FROM tyutor_guruh g WHERE g.tyutor_id = u.id) AS guruhlar,
         (SELECT string_agg(b.nomi || COALESCE(' (' || xb.lavozim || ')', ''), ', ' ORDER BY xb.asosiy DESC, b.nomi)
            FROM xodim_bolim xb JOIN bolimlar b ON b.id = xb.bolim_id
           WHERE xb.user_id = u.id) AS bolimlar,
         (SELECT COUNT(*) FROM qabul_vaqti q WHERE q.xodim_id = u.id)::int AS qabul_soni
  FROM users u
  LEFT JOIN student_info      s ON s.user_id = u.id
  LEFT JOIN teacher_info      t ON t.user_id = u.id
  LEFT JOIN dekanat_user_info d ON d.user_id = u.id
`;

async function list({ role, q } = {}) {
  const where = [];
  const params = [];
  if (role) {
    params.push(role);
    where.push(`u.role = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(u.ism ILIKE $${params.length} OR u.familiya ILIKE $${params.length}
                 OR u.login ILIKE $${params.length} OR u.phone ILIKE $${params.length}
                 OR s.guruh ILIKE $${params.length})`);
  }
  const sql = `${SELECT_FULL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY u.id DESC`;
  return (await db.query(sql, params)).rows;
}

async function findById(id) {
  return (await db.query(`${SELECT_FULL} WHERE u.id = $1`, [id])).rows[0] || null;
}

// Login uchun: parol hash'i bilan
async function findByLogin(login) {
  const r = await db.query('SELECT * FROM users WHERE login = $1', [login]);
  return r.rows[0] || null;
}

// Rolga mos info jadvaliga yozadi (bor bo'lsa yangilaydi), boshqa rol jadvallarini tozalaydi
async function saveRoleInfo(client, userId, role, d) {
  if (role !== 'student') await client.query('DELETE FROM student_info WHERE user_id = $1', [userId]);
  if (role !== 'teacher') await client.query('DELETE FROM teacher_info WHERE user_id = $1', [userId]);
  if (role !== 'dekanat') await client.query('DELETE FROM dekanat_user_info WHERE user_id = $1', [userId]);
  // Tyutor guruhlari har safar formadagi ro'yxat bilan to'liq almashtiriladi
  await client.query('DELETE FROM tyutor_guruh WHERE tyutor_id = $1', [userId]);

  if (role === 'student') {
    await client.query(
      `INSERT INTO student_info (user_id, guruh, kurs, tg_user)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET guruh = EXCLUDED.guruh, kurs = EXCLUDED.kurs, tg_user = EXCLUDED.tg_user`,
      [userId, d.guruh, d.kurs, d.tg_user]
    );
  } else if (role === 'teacher') {
    await client.query(
      `INSERT INTO teacher_info (user_id, tg_user)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET tg_user = EXCLUDED.tg_user`,
      [userId, d.tg_user]
    );
  } else if (role === 'dekanat') {
    await client.query(
      `INSERT INTO dekanat_user_info (user_id, lavozim, tg_user)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE
         SET lavozim = EXCLUDED.lavozim, tg_user = EXCLUDED.tg_user`,
      [userId, d.lavozim, d.tg_user]
    );
  } else if (role === 'tyutor' && d.guruhlar.length) {
    await client.query(
      'INSERT INTO tyutor_guruh (tyutor_id, guruh) SELECT $1, unnest($2::varchar[])',
      [userId, d.guruhlar]
    );
  }
}

async function create(d) {
  const hash = await bcrypt.hash(d.parol, 10);
  return db.tx(async (client) => {
    const r = await client.query(
      `INSERT INTO users (ism, familiya, ochestva, login, parol, role, phone, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [d.ism, d.familiya, d.ochestva, d.login, hash, d.role, d.phone, d.status]
    );
    const id = r.rows[0].id;
    await saveRoleInfo(client, id, d.role, d);
    return id;
  });
}

async function update(id, d) {
  const hash = d.parol ? await bcrypt.hash(d.parol, 10) : null;
  return db.tx(async (client) => {
    // parol bo'sh qoldirilsa eski hash saqlanadi
    const r = await client.query(
      `UPDATE users
          SET ism = $1, familiya = $2, ochestva = $3, login = $4,
              parol = COALESCE($5, parol), role = $6, phone = $7, status = $8
        WHERE id = $9`,
      [d.ism, d.familiya, d.ochestva, d.login, hash, d.role, d.phone, d.status, id]
    );
    if (!r.rowCount) return false;
    await saveRoleInfo(client, id, d.role, d);
    return true;
  });
}

async function setStatus(id, status) {
  await db.query('UPDATE users SET status = $1 WHERE id = $2', [status, id]);
}

// info jadvallaridagi qatorlar ON DELETE CASCADE bilan birga o'chadi
async function remove(id) {
  return (await db.query('DELETE FROM users WHERE id = $1', [id])).rowCount > 0;
}

async function countByRole() {
  const r = await db.query('SELECT role, COUNT(*)::int AS soni FROM users GROUP BY role');
  return Object.fromEntries(r.rows.map((x) => [x.role, x.soni]));
}

// Qabul qiladigan faol xodimlar (select'lar uchun)
async function receivers(roles) {
  const r = await db.query(
    `SELECT id, ism, familiya, ochestva, role FROM users
      WHERE role = ANY($1) AND status ORDER BY familiya, ism`,
    [roles]
  );
  return r.rows;
}

// Talabaning guruhiga biriktirilgan tyutor(lar)
async function tyutorlari(studentId) {
  const r = await db.query(
    `SELECT u.id, u.ism, u.familiya, u.ochestva, u.phone
       FROM student_info s
       JOIN tyutor_guruh g ON lower(btrim(g.guruh)) = lower(btrim(s.guruh))
       JOIN users u        ON u.id = g.tyutor_id AND u.status AND u.role = 'tyutor'
      WHERE s.user_id = $1
      ORDER BY u.familiya, u.ism`,
    [studentId]
  );
  return r.rows;
}

module.exports = {
  list,
  findById,
  findByLogin,
  create,
  update,
  setStatus,
  remove,
  countByRole,
  receivers,
  tyutorlari,
};
