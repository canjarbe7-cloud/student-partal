// Bo'limlar, ulardagi xodimlar va murojaat turlari (admin, dekanat)
const router = require('express').Router();
const Bolimlar = require('../queries/bolimlar');
const Users = require('../queries/users');
const { requireRole } = require('../middleware/auth');
const { BOLIM_TURLARI, QABUL_ROLLAR } = require('../helpers/hbs');
const { str, num, bool, flash } = require('../helpers/form');

const turlar = Object.entries(BOLIM_TURLARI).map(([id, nom]) => ({ id, nom }));

router.use(requireRole('admin', 'dekanat'));

function parseForm(body) {
  const d = {
    nomi: str(body.nomi),
    turi: str(body.turi),
    parent_id: num(body.parent_id),
    xona: str(body.xona),
    status: bool(body.status),
  };
  const errors = [];
  if (!d.nomi) errors.push('Nomi kiritilmagan');
  if (d.nomi && d.nomi.length > 150) errors.push('Nomi 150 belgidan oshmasin');
  if (!BOLIM_TURLARI[d.turi]) errors.push("Turi noto'g'ri");
  if (d.xona && d.xona.length > 50) errors.push('Xona 50 belgidan oshmasin');
  if (Number.isNaN(d.parent_id)) errors.push("Yuqori bo'lim noto'g'ri");
  return { d, errors };
}

async function form(res, o, status = 200) {
  const bolimlar = (await Bolimlar.list()).filter((b) => !o.item.id || b.id !== o.item.id);
  res.status(status).render('bolimlar/form', { title: "Bo'lim", turlar, bolimlar, ...o });
}

router.get('/', async (req, res, next) => {
  try {
    res.render('bolimlar/list', { title: "Bo'limlar", bolimlar: await Bolimlar.list() });
  } catch (err) {
    next(err);
  }
});

router.get('/new', (req, res, next) => {
  form(res, { item: { status: true, turi: 'bolim' }, isNew: true }).catch(next);
});

router.post('/', async (req, res, next) => {
  const { d, errors } = parseForm(req.body);
  try {
    if (errors.length) return await form(res, { item: d, isNew: true, errors }, 400);
    const id = await Bolimlar.create(d);
    flash(req, "Bo'lim yaratildi");
    res.redirect(`/bolimlar/${id}`);
  } catch (err) {
    if (err.code === '23503') return form(res, { item: d, isNew: true, errors: ["Yuqori bo'lim topilmadi"] }, 400).catch(next);
    next(err);
  }
});

router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const bolim = await Bolimlar.findById(req.params.id);
    if (!bolim) return next();
    const [xodimlar, murojaatlar, users] = await Promise.all([
      Bolimlar.xodimlar(bolim.id),
      Bolimlar.turlar(bolim.id),
      Users.receivers(QABUL_ROLLAR),
    ]);
    res.render('bolimlar/show', { title: bolim.nomi, bolim, xodimlar, murojaatlar, users });
  } catch (err) {
    next(err);
  }
});

router.get('/:id(\\d+)/edit', async (req, res, next) => {
  try {
    const item = await Bolimlar.findById(req.params.id);
    if (!item) return next();
    await form(res, { item, isNew: false });
  } catch (err) {
    next(err);
  }
});

router.post('/:id(\\d+)', async (req, res, next) => {
  const id = Number(req.params.id);
  const { d, errors } = parseForm(req.body);
  const item = { ...d, id };
  try {
    if (d.parent_id && (await Bolimlar.isInside(id, d.parent_id))) {
      errors.push("Bo'limni o'zining ichidagi bo'limga bo'ysundirib bo'lmaydi");
    }
    if (errors.length) return await form(res, { item, isNew: false, errors }, 400);
    if (!(await Bolimlar.update(id, d))) return next();
    flash(req, 'Saqlandi');
    res.redirect(`/bolimlar/${id}`);
  } catch (err) {
    if (err.code === '23503') return form(res, { item, isNew: false, errors: ["Yuqori bo'lim topilmadi"] }, 400).catch(next);
    next(err);
  }
});

router.post('/:id(\\d+)/delete', async (req, res, next) => {
  try {
    await Bolimlar.remove(req.params.id);
    flash(req, "Bo'lim o'chirildi");
    res.redirect('/bolimlar');
  } catch (err) {
    next(err);
  }
});

// --- xodimlar ---

router.post('/:id(\\d+)/xodim', async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const d = { user_id: num(req.body.user_id), lavozim: str(req.body.lavozim), asosiy: bool(req.body.asosiy) };
    const user = Number.isSafeInteger(d.user_id) ? await Users.findById(d.user_id) : null;
    if (!user || !QABUL_ROLLAR.includes(user.role)) flash(req, 'Xodim tanlanmagan', 'err');
    else if (d.lavozim && d.lavozim.length > 100) flash(req, 'Lavozim 100 belgidan oshmasin', 'err');
    else {
      await Bolimlar.saveXodim(id, d);
      flash(req, 'Xodim saqlandi');
    }
    res.redirect(`/bolimlar/${id}`);
  } catch (err) {
    if (err.code === '23503') return next();
    next(err);
  }
});

router.post('/:id(\\d+)/xodim/:xid(\\d+)/delete', async (req, res, next) => {
  try {
    await Bolimlar.removeXodim(req.params.id, req.params.xid);
    flash(req, "Xodim bo'limdan chiqarildi");
    res.redirect(`/bolimlar/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

// --- murojaat turlari ---

router.post('/:id(\\d+)/tur', async (req, res, next) => {
  const id = Number(req.params.id);
  try {
    const nomi = str(req.body.nomi);
    if (!nomi || nomi.length > 150) flash(req, 'Nomi 1–150 belgi bo\'lsin', 'err');
    else {
      try {
        await Bolimlar.addTur(id, nomi);
        flash(req, "Murojaat turi qo'shildi");
      } catch (err) {
        if (err.code === '23503') return next();
        if (err.code !== '23505') throw err;
        flash(req, 'Bunday murojaat turi bor', 'err');
      }
    }
    res.redirect(`/bolimlar/${id}`);
  } catch (err) {
    next(err);
  }
});

router.post('/:id(\\d+)/tur/:tid(\\d+)/delete', async (req, res, next) => {
  try {
    await Bolimlar.removeTur(req.params.id, req.params.tid);
    flash(req, "Murojaat turi o'chirildi");
    res.redirect(`/bolimlar/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
