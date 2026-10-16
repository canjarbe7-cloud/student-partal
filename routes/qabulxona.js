// Qabulxona: xodimga yozilgan navbatlar va ularning holatini o'zgartirish.
// Admin/dekanat hamma xodimning navbatlarini ko'radi.
const router = require('express').Router();
const Navbat = require('../queries/navbat');
const Users = require('../queries/users');
const { requireRole } = require('../middleware/auth');
const { QABUL_ROLLAR, HOLATLAR } = require('../helpers/hbs');
const { hozir, addDays, isSana } = require('../helpers/sana');
const { str, num, flash, back } = require('../helpers/form');

const isStaff = (u) => u.role === 'admin' || u.role === 'dekanat';
const holatlar = Object.entries(HOLATLAR).map(([id, nom]) => ({ id, nom }));

router.use(requireRole('admin', ...QABUL_ROLLAR));

router.get('/', async (req, res, next) => {
  try {
    const me = req.session.user;
    const bugun = hozir().sana;
    // Admin uchun standart — hamma; qabul qiluvchi uchun — o'zi. Staff "?xodim=" bilan tanlaydi.
    let xodimId = me.role === 'admin' ? null : me.id;
    if (isStaff(me) && req.query.xodim !== undefined) xodimId = num(req.query.xodim) || null;

    const dan = isSana(req.query.dan) ? req.query.dan : bugun;
    let gacha = isSana(req.query.gacha) ? req.query.gacha : dan;
    if (gacha < dan) gacha = dan;
    if (gacha > addDays(dan, 62)) gacha = addDays(dan, 62);
    const holat = HOLATLAR[req.query.holat] ? req.query.holat : null;

    const [barchasi, kunlar, xodimlar] = await Promise.all([
      Navbat.incoming({ xodimId, dan, gacha }),
      Navbat.kelgusiKunlar(xodimId, bugun),
      isStaff(me) ? Users.receivers(QABUL_ROLLAR) : [],
    ]);
    const soni = Object.fromEntries(holatlar.map((h) => [h.id, 0]));
    for (const n of barchasi) soni[n.status] += 1;
    const navbatlar = holat ? barchasi.filter((n) => n.status === holat) : barchasi;

    res.render('qabulxona/list', {
      title: 'Qabulxona',
      navbatlar,
      soni,
      jami: barchasi.length,
      kunlar,
      xodimlar,
      xodimId,
      hammasi: xodimId === null,
      dan,
      gacha,
      holat,
      holatlar,
      tez: {
        bugun,
        ertaga: addDays(bugun, 1),
        hafta: addDays(bugun, 6),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id(\\d+)/holat', async (req, res, next) => {
  try {
    const me = req.session.user;
    const n = await Navbat.findById(req.params.id);
    if (!n || (!isStaff(me) && n.xodim_id !== me.id)) return next();
    const status = str(req.body.status);
    const javob = str(req.body.javob_izoh);
    const to = back(req, '/qabulxona');
    if (!HOLATLAR[status]) {
      flash(req, "Holat noto'g'ri", 'err');
      return res.redirect(to);
    }
    if (javob && javob.length > 1000) {
      flash(req, 'Izoh 1000 belgidan oshmasin', 'err');
      return res.redirect(to);
    }
    try {
      await Navbat.setHolat(n.id, status, javob);
      flash(req, `Navbat #${n.navbat_raqami}: ${HOLATLAR[status]}`);
    } catch (err) {
      // Bekor qilingan navbatni tiklashda slot boshqa talabaga o'tgan bo'lishi mumkin
      if (err.code !== '23505') throw err;
      flash(req, "Bu vaqt allaqachon boshqa talabaga berilgan, navbatni tiklab bo'lmaydi", 'err');
    }
    res.redirect(to);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
