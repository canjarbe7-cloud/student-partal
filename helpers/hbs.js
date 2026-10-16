const { haftaKuni } = require('./sana');

const KUNLAR = ['', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];
const ROLLAR = {
  admin: 'Admin',
  student: 'Talaba',
  teacher: "O'qituvchi",
  dekanat: 'Dekanat',
  mudir: 'Mudir',
  tyutor: 'Tyutor',
  xodim: "Bo'lim xodimi",
};
// Talabalarni qabul qiladigan (navbat oladigan) rollar
const QABUL_ROLLAR = ['teacher', 'dekanat', 'mudir', 'tyutor', 'xodim'];
const HOLATLAR = {
  kutilmoqda: 'Kutilmoqda',
  tasdiqlandi: 'Tasdiqlandi',
  bajarildi: 'Bajarildi',
  kelmadi: 'Kelmadi',
  bekor: 'Bekor qilingan',
};
// Talaba hali bekor qila oladigan, slotni band qilib turgan holatlar
const FAOL_HOLATLAR = ['kutilmoqda', 'tasdiqlandi'];
const BOLIM_TURLARI = { dekanat: 'Dekanat', kafedra: 'Kafedra', bolim: "Bo'lim" };

// 540 -> "09:00"
function minToTime(m) {
  if (m === null || m === undefined || m === '') return '';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// "09:00" -> 540 ; noto'g'ri bo'lsa null
function timeToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[1]) <= 24 && Number(m[2]) < 60 && v <= 1440 ? v : null;
}

const helpers = {
  eq: (a, b) => String(a) === String(b),
  // {{#if (oneOf role "teacher dekanat")}}
  oneOf: (v, list) => String(list).split(' ').includes(String(v)),
  time: minToTime,
  kun: (n) => KUNLAR[n] || '',
  rol: (r) => ROLLAR[r] || r,
  holat: (s) => HOLATLAR[s] || s,
  turi: (t) => BOLIM_TURLARI[t] || t,
  // {{qabul this}} -> "Dushanba, 09:00–11:00"
  qabul: (o) =>
    o && o.hafta_kuni ? `${KUNLAR[o.hafta_kuni]}, ${minToTime(o.start_time)}–${minToTime(o.end_time)}` : '—',
  // '2026-10-16' -> '16.10.2026'
  sana: (s) => (s ? String(s).split('-').reverse().join('.') : '—'),
  // '2026-10-16' -> 'Payshanba'
  sanaKun: (s) => (s ? KUNLAR[haftaKuni(s)] : ''),
  fio: (o) => [o.familiya, o.ism, o.ochestva].filter(Boolean).join(' '),
  or: (a, b) => (a === null || a === undefined || a === '' ? b : a),
};

module.exports = {
  helpers,
  KUNLAR,
  ROLLAR,
  QABUL_ROLLAR,
  HOLATLAR,
  FAOL_HOLATLAR,
  BOLIM_TURLARI,
  minToTime,
  timeToMin,
};
