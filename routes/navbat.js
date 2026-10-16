// Talaba: navbatga yozilish, o'z navbatlarini ko'rish va bekor qilish
const router = require('express').Router();
const Navbat = require('../queries/navbat');
const Bolimlar = require('../queries/bolimlar');
const Users = require('../queries/users');
const { requireRole } = require('../middleware/auth');
const { FAOL_HOLATLAR, minToTime } = require('../helpers/hbs');
const { hozir, BRON_KUNLARI } = require('../helpers/sana');
const { str, num, flash } = require('../helpers/form');

router.use(requireRole('student'));

router.get('/', async (req, res, next) => {
  try {
    const { sana: bugun, min } = hozir();
    const barchasi = await Navbat.mine(req.session.user.id);
    const isKelgusi = (n) =>
      FAOL_HOLATLAR.includes(n.status) && (n.sana > bugun || (n.sana === bugun && n.tugash > min));
    const kelgusi = barchasi.filter(isKelgusi).reverse();
    const tarix = barchasi.filter((n) => !isKelgusi(n));
    // Bekor qilish tugmasi faqat boshlanmagan navbatlarda
    for (const n of kelgusi) n.bekorQilsaBoladi = n.sana > bugun || n.boshlanish > min;
    res.render('navbat/list', { title: 'Navbatlarim', kelgusi, tarix, limit: Navbat.FAOL_LIMIT });
  } catch (err) {
    next(err);
  }
});

// 1-qadam: kimga yozilish
router.get('/yangi', async (req, res, next) => {
  try {
    const studentId = req.session.user.id;
    const bolimId = num(req.query.bolim) || null;
    const q = str(req.query.q);
    const [xodimlar, bolimlar, tyutorlar] = await Promise.all([
      Navbat.xodimlar({ studentId, bolimId, q }),
      Bolimlar.options(),
      Users.tyutorlari(studentId),
    ]);
    res.render('navbat/xodimlar', {
      title: 'Navbatga yozilish',
      xodimlar,
      bolimlar,
      bolimId,
      q,
      tyutorYoq: !tyutorlar.length,
    });
  } catch (err) {
    next(err);
  }
});

// 2-qadam: kun va vaqtni tanlash
async function renderTaqvim(req, res, { xodimId, sana, errors, tanlov = {}, status = 200 }) {
  const [xodim] = await Navbat.xodimlar({ studentId: req.session.user.id, xodimId });
  if (!xodim) return false;
  const kunlar = await Navbat.taqvim(xodimId);
  const tanlangan =
    kunlar.find((k) => k.sana === sana) || kunlar.find((k) => k.bosh > 0) || kunlar[0] || null;
  if (tanlangan) tanlangan.active = true;
  res.status(status).render('navbat/taqvim', {
    title: 'Vaqtni tanlang',
    xodim,
    kunlar,
    kun: tanlangan,
    errors,
    tanlov,
    bronKunlari: BRON_KUNLARI,
  });
  return true;
}

router.get('/yangi/:xodimId(\\d+)', async (req, res, next) => {
  try {
    const ok = await renderTaqvim(req, res, { xodimId: Number(req.params.xodimId), sana: req.query.sana });
    if (!ok) next();
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  const b = req.body;
  const d = {
    studentId: req.session.user.id,
    qabulId: num(b.qabul_vaqti_id),
    sana: str(b.sana),
    boshlanish: num(b.boshlanish),
    murojaatTuriId: num(b.murojaat_turi_id),
    mavzu: str(b.mavzu),
  };
  const xodimId = num(b.xodim_id);
  const tanlov = { qabul_vaqti_id: d.qabulId, boshlanish: d.boshlanish, murojaat_turi_id: d.murojaatTuriId, mavzu: d.mavzu };
  const fail = async (msg) => {
    const ok = Number.isSafeInteger(xodimId) &&
      (await renderTaqvim(req, res, { xodimId, sana: d.sana, errors: [msg], tanlov, status: 400 }));
    if (!ok) {
      flash(req, msg, 'err');
      res.redirect('/navbat/yangi');
    }
  };
  try {
    if (!Number.isSafeInteger(d.qabulId)) return await fail('Qabul tanlanmagan');
    if (!Number.isSafeInteger(d.boshlanish)) return await fail('Vaqtni tanlang');
    if (Number.isNaN(d.murojaatTuriId)) return await fail("Murojaat turi noto'g'ri");
    if (d.mavzu && d.mavzu.length > 1000) return await fail('Mavzu 1000 belgidan oshmasin');
    const n = await Navbat.create(d);
    flash(req, `Navbatga yozildingiz: ${n.sana.split('-').reverse().join('.')}, ${minToTime(n.boshlanish)} (${n.navbat_raqami}-navbat)`);
    res.redirect('/navbat');
  } catch (err) {
    if (err instanceof Navbat.NavbatError) return fail(err.message).catch(next);
    next(err);
  }
});

router.post('/:id(\\d+)/bekor', async (req, res, next) => {
  try {
    const ok = await Navbat.cancelByStudent(req.params.id, req.session.user.id);
    flash(req, ok ? 'Navbat bekor qilindi' : "Bu navbatni bekor qilib bo'lmaydi", ok ? 'ok' : 'err');
    res.redirect('/navbat');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
