const KUNLAR = ['', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];
const ROLLAR = { admin: 'Admin', student: 'Talaba', teacher: "O'qituvchi", dekanat: 'Dekanat' };

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
  time: minToTime,
  kun: (n) => KUNLAR[n] || '',
  rol: (r) => ROLLAR[r] || r,
  // {{qabul this}} -> "Dushanba, 09:00–11:00"
  qabul: (o) =>
    o && o.week_date ? `${KUNLAR[o.week_date]}, ${minToTime(o.start_time)}–${minToTime(o.end_time)}` : '—',
  fio: (o) => [o.familiya, o.ism, o.ochestva].filter(Boolean).join(' '),
  or: (a, b) => (a === null || a === undefined || a === '' ? b : a),
};

module.exports = { helpers, KUNLAR, ROLLAR, minToTime, timeToMin };
