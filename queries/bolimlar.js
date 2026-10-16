const db = require('../db/pool');

async function list() {
  const r = await db.query(`
    SELECT b.*, p.nomi AS parent_nomi,
           (SELECT COUNT(*) FROM xodim_bolim x WHERE x.bolim_id = b.id)::int      AS xodim_soni,
           (SELECT COUNT(*) FROM murojaat_turlari m WHERE m.bolim_id = b.id)::int AS tur_soni
      FROM bolimlar b
      LEFT JOIN bolimlar p ON p.id = b.parent_id
     ORDER BY b.turi, b.nomi`);
  return r.rows;
}

// Select'lar uchun faol bo'limlar
async function options() {
  return (await db.query('SELECT id, nomi, turi FROM bolimlar WHERE status ORDER BY nomi')).rows;
}

// Xodim ishlaydigan faol bo'limlar
async function ofUser(userId) {
  const r = await db.query(
    `SELECT b.id, b.nomi, b.turi FROM xodim_bolim x JOIN bolimlar b ON b.id = x.bolim_id
      WHERE x.user_id = $1 AND b.status ORDER BY x.asosiy DESC, b.nomi`,
    [userId]
  );
  return r.rows;
}

async function findById(id) {
  const r = await db.query(
    `SELECT b.*, p.nomi AS parent_nomi FROM bolimlar b
       LEFT JOIN bolimlar p ON p.id = b.parent_id WHERE b.id = $1`,
    [id]
  );
  return r.rows[0] || null;
}

async function create({ nomi, turi, parent_id, xona, status }) {
  const r = await db.query(
    `INSERT INTO bolimlar (nomi, turi, parent_id, xona, status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [nomi, turi, parent_id, xona, status]
  );
  return r.rows[0].id;
}

async function update(id, { nomi, turi, parent_id, xona, status }) {
  const r = await db.query(
    `UPDATE bolimlar SET nomi = $1, turi = $2, parent_id = $3, xona = $4, status = $5 WHERE id = $6`,
    [nomi, turi, parent_id, xona, status, id]
  );
  return r.rowCount > 0;
}

// Xodimlar va murojaat turlari CASCADE bilan, qabul_vaqti.bolim_id esa NULL bo'ladi
async function remove(id) {
  return (await db.query('DELETE FROM bolimlar WHERE id = $1', [id])).rowCount > 0;
}

// parentId bo'lim id'ning o'zi yoki uning ichidagi bo'limmi (aylana ierarxiyani oldini olish)
async function isInside(id, parentId) {
  const r = await db.query(
    `WITH RECURSIVE t AS (
       SELECT id FROM bolimlar WHERE id = $1
       UNION
       SELECT b.id FROM bolimlar b JOIN t ON b.parent_id = t.id
     )
     SELECT 1 FROM t WHERE id = $2`,
    [id, parentId]
  );
  return r.rowCount > 0;
}

// --- bo'lim xodimlari ---

async function xodimlar(bolimId) {
  const r = await db.query(
    `SELECT x.id, x.lavozim, x.asosiy, u.id AS user_id, u.ism, u.familiya, u.ochestva, u.role, u.status
       FROM xodim_bolim x JOIN users u ON u.id = x.user_id
      WHERE x.bolim_id = $1
      ORDER BY x.asosiy DESC, u.familiya, u.ism`,
    [bolimId]
  );
  return r.rows;
}

// Xodim allaqachon bo'lsa lavozimi yangilanadi. asosiy = true bo'lsa boshqa bo'limlardagi belgi olinadi.
async function saveXodim(bolimId, { user_id, lavozim, asosiy }) {
  return db.tx(async (client) => {
    if (asosiy) {
      await client.query('UPDATE xodim_bolim SET asosiy = FALSE WHERE user_id = $1 AND asosiy', [user_id]);
    }
    await client.query(
      `INSERT INTO xodim_bolim (user_id, bolim_id, lavozim, asosiy)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, bolim_id) DO UPDATE
         SET lavozim = EXCLUDED.lavozim, asosiy = EXCLUDED.asosiy`,
      [user_id, bolimId, lavozim, asosiy]
    );
  });
}

async function removeXodim(bolimId, id) {
  await db.query('DELETE FROM xodim_bolim WHERE id = $1 AND bolim_id = $2', [id, bolimId]);
}

// --- murojaat turlari ---

async function turlar(bolimId) {
  const r = await db.query(
    `SELECT m.id, m.nomi,
            (SELECT COUNT(*) FROM navbatlar n WHERE n.murojaat_turi_id = m.id)::int AS navbat_soni
       FROM murojaat_turlari m WHERE m.bolim_id = $1 ORDER BY m.nomi`,
    [bolimId]
  );
  return r.rows;
}

async function addTur(bolimId, nomi) {
  await db.query('INSERT INTO murojaat_turlari (bolim_id, nomi) VALUES ($1, $2)', [bolimId, nomi]);
}

// Navbatlardagi havola ON DELETE SET NULL bo'ladi
async function removeTur(bolimId, id) {
  await db.query('DELETE FROM murojaat_turlari WHERE id = $1 AND bolim_id = $2', [id, bolimId]);
}

module.exports = {
  list,
  options,
  ofUser,
  findById,
  create,
  update,
  remove,
  isInside,
  xodimlar,
  saveXodim,
  removeXodim,
  turlar,
  addTur,
  removeTur,
};
