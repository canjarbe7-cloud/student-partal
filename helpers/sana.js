// Sana bilan ishlash. Sana hamma joyda 'YYYY-MM-DD' satr ko'rinishida yuradi (pool.js ham shunday qaytaradi).
// Render serveri UTC'da ishlaydi, shuning uchun "bugun" va "hozir" universitet vaqt mintaqasida hisoblanadi.
const TZ = process.env.APP_TZ || 'Asia/Tashkent';

// Talaba necha kun oldinga navbatga yozila oladi
const BRON_KUNLARI = 14;

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// { sana: '2026-10-16', min: 615 }  (615 = 10:15)
function hozir() {
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { sana: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

function addDays(sana, n) {
  const d = new Date(`${sana}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 1 = Dushanba ... 7 = Yakshanba
function haftaKuni(sana) {
  const w = new Date(`${sana}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}

// '2026-02-30' kabi mavjud bo'lmagan sanalarni ham rad etadi
function isSana(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

module.exports = { TZ, BRON_KUNLARI, hozir, addDays, haftaKuni, isSana };
