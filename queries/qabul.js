const db = require('../db/pool');

// Har bir vaqt oralig'i + unga biriktirilgan xodimlar soni
async function list() {
  const r = await db.query(`
    SELECT q.id, q.start_time, q.end_time, q.week_date,
           (SELECT COUNT(*) FROM teacher_info t WHERE t.qabul_vaqti = q.id)::int      AS teacher_soni,
           (SELECT COUNT(*) FROM dekanat_user_info d WHERE d.qabul_vaqti = q.id)::int AS dekanat_soni
    FROM qabul_vaqti q
    ORDER BY q.week_date, q.start_time`);
  return r.rows;
}

async function findById(id) {
  return (await db.query('SELECT * FROM qabul_vaqti WHERE id = $1', [id])).rows[0] || null;
}

async function create({ start_time, end_time, week_date }) {
  const r = await db.query(
    `INSERT INTO qabul_vaqti (start_time, end_time, week_date)
     VALUES ($1, $2, $3) RETURNING id`,
    [start_time, end_time, week_date]
  );
  return r.rows[0].id;
}

async function update(id, { start_time, end_time, week_date }) {
  const r = await db.query(
    `UPDATE qabul_vaqti SET start_time = $1, end_time = $2, week_date = $3 WHERE id = $4`,
    [start_time, end_time, week_date, id]
  );
  return r.rowCount > 0;
}

// teacher_info / dekanat_user_info dagi havolalar ON DELETE SET NULL bo'ladi
async function remove(id) {
  return (await db.query('DELETE FROM qabul_vaqti WHERE id = $1', [id])).rowCount > 0;
}

// Talaba uchun jadval: kim, qaysi kuni, soat nechada qabul qiladi
async function schedule() {
  const r = await db.query(`
    SELECT q.week_date, q.start_time, q.end_time,
           u.ism, u.familiya, u.ochestva, u.phone, 'teacher' AS role, NULL::bigint AS lavozim
      FROM teacher_info t
      JOIN users u       ON u.id = t.user_id AND u.status
      JOIN qabul_vaqti q ON q.id = t.qabul_vaqti
    UNION ALL
    SELECT q.week_date, q.start_time, q.end_time,
           u.ism, u.familiya, u.ochestva, u.phone, 'dekanat', d.lavozim
      FROM dekanat_user_info d
      JOIN users u       ON u.id = d.user_id AND u.status
      JOIN qabul_vaqti q ON q.id = d.qabul_vaqti
    ORDER BY week_date, start_time, familiya`);
  return r.rows;
}

module.exports = { list, findById, create, update, remove, schedule };
