const db = require('../db/pool');
const { QABUL_ROLLAR } = require('../helpers/hbs');

// Qabul vaqtlari + xodim, bo'lim va kelgusi faol navbatlar soni. xodimId berilsa faqat uniki.
async function list({ xodimId = null, bugun }) {
  const r = await db.query(
    `SELECT q.*, u.ism, u.familiya, u.ochestva, u.role, b.nomi AS bolim_nomi,
            (SELECT COUNT(*) FROM navbatlar n
              WHERE n.qabul_vaqti_id = q.id AND n.sana >= $2
                AND n.status IN ('kutilmoqda', 'tasdiqlandi'))::int AS navbat_soni
       FROM qabul_vaqti q
       JOIN users u         ON u.id = q.xodim_id
       LEFT JOIN bolimlar b ON b.id = q.bolim_id
      WHERE $1::bigint IS NULL OR q.xodim_id = $1
      ORDER BY u.familiya, u.ism, q.hafta_kuni, q.start_time`,
    [xodimId, bugun]
  );
  return r.rows;
}

async function findById(id) {
  return (await db.query('SELECT * FROM qabul_vaqti WHERE id = $1', [id])).rows[0] || null;
}

const COLS = ['xodim_id', 'bolim_id', 'hafta_kuni', 'start_time', 'end_time', 'slot_min', 'max_navbat', 'status'];

async function create(d) {
  const r = await db.query(
    `INSERT INTO qabul_vaqti (${COLS.join(', ')})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    COLS.map((c) => d[c])
  );
  return r.rows[0].id;
}

async function update(id, d) {
  const r = await db.query(
    `UPDATE qabul_vaqti SET ${COLS.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${COLS.length + 1}`,
    [...COLS.map((c) => d[c]), id]
  );
  return r.rowCount > 0;
}

// Unga yozilgan navbatlar ham CASCADE bilan o'chadi
async function remove(id) {
  return (await db.query('DELETE FROM qabul_vaqti WHERE id = $1', [id])).rowCount > 0;
}

// Xodimning shu kundagi boshqa qabuli bilan vaqt kesishadimi
async function overlaps({ xodim_id, hafta_kuni, start_time, end_time }, exceptId = null) {
  const r = await db.query(
    `SELECT 1 FROM qabul_vaqti
      WHERE xodim_id = $1 AND hafta_kuni = $2 AND start_time < $4 AND end_time > $3
        AND ($5::bigint IS NULL OR id <> $5)`,
    [xodim_id, hafta_kuni, start_time, end_time, exceptId]
  );
  return r.rowCount > 0;
}

// Bosh sahifa uchun umumiy jadval: kim, qaysi kuni, soat nechada, qayerda qabul qiladi
async function schedule() {
  const r = await db.query(
    `SELECT q.hafta_kuni, q.start_time, q.end_time, b.nomi AS bolim_nomi, b.xona,
            u.id AS xodim_id, u.ism, u.familiya, u.ochestva, u.phone, u.role
       FROM qabul_vaqti q
       JOIN users u         ON u.id = q.xodim_id AND u.status AND u.role = ANY($1)
       LEFT JOIN bolimlar b ON b.id = q.bolim_id
      WHERE q.status
      ORDER BY q.hafta_kuni, q.start_time, u.familiya`,
    [QABUL_ROLLAR]
  );
  return r.rows;
}

// --- qabul bo'lmaydigan kunlar ---

async function istisnolar({ xodimId = null, dan }) {
  const r = await db.query(
    `SELECT i.*, u.ism, u.familiya, u.ochestva
       FROM qabul_istisno i JOIN users u ON u.id = i.xodim_id
      WHERE ($1::bigint IS NULL OR i.xodim_id = $1) AND i.sana >= $2
      ORDER BY i.sana, u.familiya`,
    [xodimId, dan]
  );
  return r.rows;
}

async function findIstisno(id) {
  return (await db.query('SELECT * FROM qabul_istisno WHERE id = $1', [id])).rows[0] || null;
}

// Istisno qo'shiladi va o'sha kunga yozilgan faol navbatlar bekor qilinadi. Bekor qilinganlar sonini qaytaradi.
async function addIstisno({ xodim_id, sana, sabab }) {
  return db.tx(async (client) => {
    await client.query('INSERT INTO qabul_istisno (xodim_id, sana, sabab) VALUES ($1, $2, $3)', [
      xodim_id,
      sana,
      sabab,
    ]);
    const r = await client.query(
      `UPDATE navbatlar n
          SET status = 'bekor', javob_izoh = $3
         FROM qabul_vaqti q
        WHERE q.id = n.qabul_vaqti_id AND q.xodim_id = $1 AND n.sana = $2
          AND n.status IN ('kutilmoqda', 'tasdiqlandi')`,
      [xodim_id, sana, `Bu kuni qabul bo'lmaydi${sabab ? ': ' + sabab : ''}`]
    );
    return r.rowCount;
  });
}

async function removeIstisno(id) {
  await db.query('DELETE FROM qabul_istisno WHERE id = $1', [id]);
}

module.exports = {
  list,
  findById,
  create,
  update,
  remove,
  overlaps,
  schedule,
  istisnolar,
  findIstisno,
  addIstisno,
  removeIstisno,
};
