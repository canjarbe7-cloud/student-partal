// Formadan kelgan qiymatlarni tozalash

// bo'sh satr -> null
const str = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

// bo'sh -> null, son emas -> NaN
const num = (v) => {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : NaN;
};

const bool = (v) => v === 'on' || v === 'true';

// Bir martalik xabar: keyingi sahifada bir marta ko'rinadi
function flash(req, text, type = 'ok') {
  req.session.flash = { type, text };
}

// POST'dan keyin oldingi sahifaga qaytish (faqat o'z saytimiz ichida)
function back(req, fallback) {
  const ref = req.get('Referer');
  try {
    const u = new URL(ref);
    if (u.host === req.get('host')) return u.pathname + u.search;
  } catch {
    // Referer yo'q yoki noto'g'ri
  }
  return fallback;
}

module.exports = { str, num, bool, flash, back };
