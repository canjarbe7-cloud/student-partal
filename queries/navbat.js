const db = require('../db/pool');
const { QABUL_ROLLAR, FAOL_HOLATLAR } = require('../helpers/hbs');
const { TZ, BRON_KUNLARI, hozir, addDays, haftaKuni, isSana } = require('../helpers/sana');

// Talabaning bir vaqtdagi kelgusi faol navbatlari chegarasi
const FAOL_LIMIT = 5;

// Talabaga ko'rsatiladigan xato (validatsiya); boshqa xatolar 500 bo'ladi
class NavbatError extends Error {}

// Talaba yozila oladigan xodim: faol, qabul qiluvchi rolda, faol qabul vaqti bor.
// Tyutor faqat talabaning guruhiga biriktirilgan bo'lsa ko'rinadi. $1 = student_id, $2 = rollar
const BOOKABLE = `
  u.status AND u.role = ANY($2)
  AND EXISTS (SELECT 1 FROM qabul_vaqti q WHERE q.xodim_id = u.id AND q.status)
  AND (u.role <> 'tyutor' OR EXISTS (
        SELECT 1 FROM tyutor_guruh g
          JOIN student_info s ON lower(btrim(s.guruh)) = lower(btrim(g.guruh))
         WHERE g.tyutor_id = u.id AND s.user_id = $1))`;

async function xodimlar({ studentId, bolimId = null, q = null, xodimId = null }) {
  const r = await db.query(
    `SELECT u.id, u.ism, u.familiya, u.ochestva, u.role, u.phone,
            COALESCE((SELECT x.lavozim FROM xodim_bolim x
                       WHERE x.user_id = u.id AND x.lavozim IS NOT NULL
                       ORDER BY x.asosiy DESC LIMIT 1), d.lavozim) AS lavozim,
            (SELECT string_agg(b.nomi, ', ' ORDER BY x.asosiy DESC, b.nomi)
               FROM xodim_bolim x JOIN bolimlar b ON b.id = x.bolim_id
              WHERE x.user_id = u.id AND b.status) AS bolimlar,
            (SELECT json_agg(json_build_object('hafta_kuni', q.hafta_kuni, 'start_time', q.start_time,
                                               'end_time', q.end_time) ORDER BY q.hafta_kuni, q.start_time)
               FROM qabul_vaqti q WHERE q.xodim_id = u.id AND q.status) AS kunlar
       FROM users u
       LEFT JOIN dekanat_user_info d ON d.user_id = u.id
      WHERE ${BOOKABLE}
        AND ($3::bigint IS NULL
             OR EXISTS (SELECT 1 FROM xodim_bolim x WHERE x.user_id = u.id AND x.bolim_id = $3)
             OR EXISTS (SELECT 1 FROM qabul_vaqti q WHERE q.xodim_id = u.id AND q.bolim_id = $3))
        AND ($4::text IS NULL OR u.familiya ILIKE $4 OR u.ism ILIKE $4)
        AND ($5::bigint IS NULL OR u.id = $5)
      ORDER BY (u.role = 'tyutor') DESC, u.familiya, u.ism`,
    [studentId, QABUL_ROLLAR, bolimId, q ? `%${q}%` : null, xodimId]
  );
  return r.rows;
}

// Qabul oralig'ini slotlarga bo'ladi: 09:00–10:00, 15 daqiqa -> 09:00, 09:15, 09:30, 09:45
function slotlar(q) {
  const res = [];
  for (let m = q.start_time, i = 1; m + q.slot_min <= q.end_time; m += q.slot_min, i += 1) {
    res.push({ min: m, raqam: i });
  }
  return res;
}

// Xodimning kelgusi BRON_KUNLARI kunlik taqvimi: har bir qabul kuni, undagi bloklar va slotlar holati
async function taqvim(xodimId) {
  const { sana: bugun, min: hozirMin } = hozir();
  const oxiri = addDays(bugun, BRON_KUNLARI - 1);
  const [qabullar, istisno, band, turlar] = await Promise.all([
    db.query(
      `SELECT q.*, b.nomi AS bolim_nomi, b.xona FROM qabul_vaqti q
         LEFT JOIN bolimlar b ON b.id = q.bolim_id
        WHERE q.xodim_id = $1 AND q.status ORDER BY q.start_time`,
      [xodimId]
    ),
    db.query('SELECT sana, sabab FROM qabul_istisno WHERE xodim_id = $1 AND sana BETWEEN $2 AND $3', [
      xodimId,
      bugun,
      oxiri,
    ]),
    db.query(
      `SELECT n.qabul_vaqti_id, n.sana, n.boshlanish FROM navbatlar n
         JOIN qabul_vaqti q ON q.id = n.qabul_vaqti_id
        WHERE q.xodim_id = $1 AND n.sana BETWEEN $2 AND $3 AND n.status <> 'bekor'`,
      [xodimId, bugun, oxiri]
    ),
    db.query(
      `SELECT id, bolim_id, nomi FROM murojaat_turlari
        WHERE bolim_id IN (SELECT bolim_id FROM qabul_vaqti WHERE xodim_id = $1 AND status)
        ORDER BY nomi`,
      [xodimId]
    ),
  ]);

  const kunlar = [];
  for (let i = 0; i < BRON_KUNLARI; i += 1) {
    const sana = addDays(bugun, i);
    const hk = haftaKuni(sana);
    const shuKun = qabullar.rows.filter((q) => q.hafta_kuni === hk);
    if (!shuKun.length) continue;
    const ist = istisno.rows.find((x) => x.sana === sana);
    const bloklar = shuKun.map((q) => {
      const bandlar = new Set(
        band.rows.filter((n) => n.qabul_vaqti_id === q.id && n.sana === sana).map((n) => n.boshlanish)
      );
      const toldi = q.max_navbat !== null && bandlar.size >= q.max_navbat;
      const slots = slotlar(q).map((s) => {
        const band = bandlar.has(s.min);
        const otgan = sana === bugun && s.min <= hozirMin;
        return { ...s, band, otgan, yopiq: band || otgan || toldi || !!ist };
      });
      return {
        q,
        slots,
        toldi,
        // Kunlik chegara bo'lsa, bo'sh slotlar undan oshmaydi
        bosh: Math.min(
          slots.filter((s) => !s.yopiq).length,
          q.max_navbat === null ? Infinity : q.max_navbat - bandlar.size
        ),
        turlar: turlar.rows.filter((t) => t.bolim_id === q.bolim_id),
      };
    });
    kunlar.push({
      sana,
      istisno: ist ? ist.sabab || "Qabul yo'q" : null,
      bloklar,
      bosh: bloklar.reduce((a, b) => a + b.bosh, 0),
    });
  }
  return kunlar;
}

// Navbatga yozish. Barcha qoidalar shu yerda, bitta tranzaksiyada tekshiriladi.
async function create({ studentId, qabulId, sana, boshlanish, murojaatTuriId, mavzu }) {
  const { sana: bugun, min: hozirMin } = hozir();
  if (!isSana(sana) || sana < bugun || sana > addDays(bugun, BRON_KUNLARI - 1)) {
    throw new NavbatError(`Sana bugundan boshlab ${BRON_KUNLARI} kun ichida bo'lishi kerak`);
  }
  try {
    return await db.tx(async (client) => {
      // Qabul qatorini qulflaymiz: bir vaqtda kelgan so'rovlar ketma-ket tekshiriladi
      const q = (
        await client.query(
          `SELECT q.*, u.role, u.status AS xodim_status FROM qabul_vaqti q
             JOIN users u ON u.id = q.xodim_id
            WHERE q.id = $1 FOR UPDATE OF q`,
          [qabulId]
        )
      ).rows[0];
      if (!q || !q.status || !q.xodim_status || !QABUL_ROLLAR.includes(q.role)) {
        throw new NavbatError('Bu qabul vaqti mavjud emas');
      }
      if (haftaKuni(sana) !== q.hafta_kuni) throw new NavbatError("Tanlangan sana bu qabul kuniga to'g'ri kelmaydi");

      const off = boshlanish - q.start_time;
      if (!Number.isSafeInteger(boshlanish) || off < 0 || off % q.slot_min !== 0 || boshlanish + q.slot_min > q.end_time) {
        throw new NavbatError("Vaqt noto'g'ri tanlangan");
      }
      if (sana === bugun && boshlanish <= hozirMin) throw new NavbatError("Bu vaqt o'tib ketgan");

      if (q.role === 'tyutor') {
        const ok = await client.query(
          `SELECT 1 FROM tyutor_guruh g
             JOIN student_info s ON lower(btrim(s.guruh)) = lower(btrim(g.guruh))
            WHERE g.tyutor_id = $1 AND s.user_id = $2`,
          [q.xodim_id, studentId]
        );
        if (!ok.rowCount) throw new NavbatError("Faqat o'z guruhingiz tyutoriga yozila olasiz");
      }

      const ist = await client.query('SELECT sabab FROM qabul_istisno WHERE xodim_id = $1 AND sana = $2', [
        q.xodim_id,
        sana,
      ]);
      if (ist.rowCount) {
        throw new NavbatError(`Bu kuni qabul bo'lmaydi${ist.rows[0].sabab ? ': ' + ist.rows[0].sabab : ''}`);
      }

      if (q.max_navbat !== null) {
        const c = await client.query(
          `SELECT COUNT(*)::int AS n FROM navbatlar
            WHERE qabul_vaqti_id = $1 AND sana = $2 AND status <> 'bekor'`,
          [q.id, sana]
        );
        if (c.rows[0].n >= q.max_navbat) throw new NavbatError("Bu kunga navbatlar to'lgan");
      }

      const faol = await client.query(
        'SELECT COUNT(*)::int AS n FROM navbatlar WHERE student_id = $1 AND status = ANY($2) AND sana >= $3',
        [studentId, FAOL_HOLATLAR, bugun]
      );
      if (faol.rows[0].n >= FAOL_LIMIT) {
        throw new NavbatError(`Bir vaqtda ${FAOL_LIMIT} tadan ortiq faol navbatga yozilib bo'lmaydi`);
      }

      if (murojaatTuriId !== null) {
        const t = await client.query('SELECT bolim_id FROM murojaat_turlari WHERE id = $1', [murojaatTuriId]);
        if (!t.rowCount || t.rows[0].bolim_id !== q.bolim_id) throw new NavbatError("Murojaat turi noto'g'ri");
      }

      const r = await client.query(
        `INSERT INTO navbatlar (student_id, qabul_vaqti_id, murojaat_turi_id, sana, boshlanish, tugash,
                                navbat_raqami, mavzu)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, sana, boshlanish, navbat_raqami`,
        [studentId, q.id, murojaatTuriId, sana, boshlanish, boshlanish + q.slot_min, off / q.slot_min + 1, mavzu]
      );
      return r.rows[0];
    });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'uq_navbat_slot') {
      throw new NavbatError("Bu vaqtni boshqa talaba band qilib bo'ldi, boshqasini tanlang");
    }
    if (err.code === '23505' && err.constraint === 'uq_navbat_student') {
      throw new NavbatError('Siz bu kunga shu qabulga allaqachon yozilgansiz');
    }
    throw err;
  }
}

const SELECT_NAVBAT = `
  SELECT n.*, q.xodim_id, b.nomi AS bolim_nomi, b.xona, m.nomi AS murojaat,
         to_char(n.created_at AT TIME ZONE $1, 'DD.MM.YYYY HH24:MI') AS yaratilgan,
         json_build_object('ism', x.ism, 'familiya', x.familiya, 'ochestva', x.ochestva, 'role', x.role) AS xodim
    FROM navbatlar n
    JOIN qabul_vaqti q              ON q.id = n.qabul_vaqti_id
    JOIN users x                    ON x.id = q.xodim_id
    LEFT JOIN bolimlar b            ON b.id = q.bolim_id
    LEFT JOIN murojaat_turlari m    ON m.id = n.murojaat_turi_id`;

// Talabaning navbatlari (oxirgi 100 ta)
async function mine(studentId) {
  const r = await db.query(
    `${SELECT_NAVBAT} WHERE n.student_id = $2 ORDER BY n.sana DESC, n.boshlanish DESC LIMIT 100`,
    [TZ, studentId]
  );
  return r.rows;
}

// Talaba o'z navbatini vaqti o'tmaguncha bekor qila oladi
async function cancelByStudent(id, studentId) {
  const { sana, min } = hozir();
  const r = await db.query(
    `UPDATE navbatlar SET status = 'bekor', javob_izoh = 'Talaba bekor qildi'
      WHERE id = $1 AND student_id = $2 AND status = ANY($3)
        AND (sana > $4 OR (sana = $4 AND boshlanish > $5))`,
    [id, studentId, FAOL_HOLATLAR, sana, min]
  );
  return r.rowCount > 0;
}

// Qabulxona: xodimga (yoki hammaga, xodimId = null) kelgan navbatlar
async function incoming({ xodimId = null, dan, gacha }) {
  const r = await db.query(
    `SELECT t.*, su.ism, su.familiya, su.ochestva, su.phone, si.guruh, si.kurs, si.tg_user
       FROM (${SELECT_NAVBAT}
              WHERE ($2::bigint IS NULL OR q.xodim_id = $2) AND n.sana BETWEEN $3 AND $4) t
       JOIN users su             ON su.id = t.student_id
       LEFT JOIN student_info si ON si.user_id = t.student_id
      ORDER BY t.sana, t.boshlanish, t.xodim->>'familiya'`,
    [TZ, xodimId, dan, gacha]
  );
  return r.rows;
}

// Kelgusi kunlar bo'yicha faol navbatlar soni (qabulxona va bosh sahifa uchun)
async function kelgusiKunlar(xodimId, bugun, limit = 10) {
  const r = await db.query(
    `SELECT n.sana, COUNT(*)::int AS soni
       FROM navbatlar n JOIN qabul_vaqti q ON q.id = n.qabul_vaqti_id
      WHERE ($1::bigint IS NULL OR q.xodim_id = $1) AND n.sana >= $2 AND n.status = ANY($3)
      GROUP BY n.sana ORDER BY n.sana LIMIT $4`,
    [xodimId, bugun, FAOL_HOLATLAR, limit]
  );
  return r.rows;
}

async function findById(id) {
  const r = await db.query(
    `SELECT n.*, q.xodim_id FROM navbatlar n JOIN qabul_vaqti q ON q.id = n.qabul_vaqti_id WHERE n.id = $1`,
    [id]
  );
  return r.rows[0] || null;
}

async function setHolat(id, status, javobIzoh) {
  await db.query('UPDATE navbatlar SET status = $1, javob_izoh = $2 WHERE id = $3', [status, javobIzoh, id]);
}

module.exports = {
  NavbatError,
  FAOL_LIMIT,
  xodimlar,
  taqvim,
  create,
  mine,
  cancelByStudent,
  incoming,
  kelgusiKunlar,
  findById,
  setHolat,
};
