// Qabul vaqtlari va qabul bo'lmaydigan kunlar.
// Admin/dekanat hamma xodimnikini boshqaradi, qolgan qabul qiluvchilar faqat o'zinikini.
const router = require('express').Router();
const Qabul = require('../queries/qabul');
const Users = require('../queries/users');
const Bolimlar = require('../queries/bolimlar');
const { requireRole } = require('../middleware/auth');
const { timeToMin, KUNLAR, QABUL_ROLLAR } = require('../helpers/hbs');
const { hozir, isSana } = require('../helpers/sana');
const { str, num, bool, flash } = require('../helpers/form');

const kunlar = KUNLAR.slice(1).map((nom, i) => ({ id: i + 1, nom }));
const isStaff = (u) => u.role === 'admin' || u.role === 'dekanat';

router.use(requireRole('admin', ...QABUL_ROLLAR));

// Formadagi xodim: staff tanlaydi, boshqalar uchun har doim o'zi
const xodimOf = (req, v) => (isStaff(req.session.user) ? num(v) : req.session.user.id);

// current — tahrirlanayotgan yozuv (yangi bo'lsa null)
async function parseForm(req, current) {
  const b = req.body;
  const d = {
    xodim_id: xodimOf(req, b.xodim_id),
    bolim_id: num(b.bolim_id),
    hafta_kuni: Number(b.hafta_kuni),
    start_time: timeToMin(b.start_time),
    end_time: timeToMin(b.end_time),
    slot_min: num(b.slot_min) ?? 15,
    max_navbat: num(b.max_navbat),
    status: bool(b.status),
  };
  const errors = [];
  if (d.start_time === null) errors.push("Boshlanish vaqti noto'g'ri");
  if (d.end_time === null) errors.push("Tugash vaqti noto'g'ri");
  if (d.start_time !== null && d.end_time !== null && d.end_time <= d.start_time) {
    errors.push("Tugash vaqti boshlanishdan keyin bo'lishi kerak");
  }
  if (!(d.hafta_kuni >= 1 && d.hafta_kuni <= 7)) errors.push('Hafta kuni tanlanmagan');
  if (!(d.slot_min >= 5 && d.slot_min <= 240)) errors.push("Bitta navbat 5–240 daqiqa bo'lsin");
  else if (d.start_time !== null && d.end_time > d.start_time && d.end_time - d.start_time < d.slot_min) {
    errors.push('Qabul oralig\'iga birorta ham navbat sig\'maydi');
  }
  if (d.max_navbat !== null && !(d.max_navbat >= 1 && d.max_navbat <= 500)) {
    errors.push("Kunlik navbatlar soni 1–500 oralig'ida bo'lsin");
  }
  if (Number.isNaN(d.bolim_id)) errors.push("Bo'lim noto'g'ri");

  const xodim = Number.isSafeInteger(d.xodim_id) ? await Users.findById(d.xodim_id) : null;
  if (!xodim || !QABUL_ROLLAR.includes(xodim.role)) errors.push('Xodim tanlanmagan');
  // Xodim faqat o'z bo'limini tanlaydi; admin qo'ygan bo'limni esa saqlab qolishi mumkin
  if (d.bolim_id && !isStaff(req.session.user) && d.bolim_id !== current?.bolim_id) {
    const mening = await Bolimlar.ofUser(req.session.user.id);
    if (!mening.some((x) => x.id === d.bolim_id)) errors.push("Siz bu bo'limda ishlamaysiz");
  }
  return { d, errors };
}

async function form(req, res, o, status = 200) {
  const me = req.session.user;
  const [xodimlar, bolimlar] = await Promise.all([
    isStaff(me) ? Users.receivers(QABUL_ROLLAR) : [],
    isStaff(me) ? Bolimlar.options() : Bolimlar.ofUser(me.id),
  ]);
  // Hozirgi bo'lim ro'yxatda bo'lmasa ham tanlovda ko'rinsin
  const joriy = o.item.bolim_id;
  if (joriy && !bolimlar.some((b) => b.id === joriy)) {
    const b = await Bolimlar.findById(joriy);
    if (b) bolimlar.push(b);
  }
  res.status(status).render('qabul/form', { title: 'Qabul vaqti', kunlar, xodimlar, bolimlar, ...o });
}

// Yozuv shu foydalanuvchiga tegishlimi (staff uchun hammasi)
async function ownItem(req) {
  const item = await Qabul.findById(req.params.id);
  if (!item) return null;
  if (!isStaff(req.session.user) && item.xodim_id !== req.session.user.id) return null;
  return item;
}

router.get('/', async (req, res, next) => {
  try {
    const me = req.session.user;
    const xodimId = isStaff(me) ? num(req.query.xodim) || null : me.id;
    const [qabullar, xodimlar] = await Promise.all([
      Qabul.list({ xodimId, bugun: hozir().sana }),
      isStaff(me) ? Users.receivers(QABUL_ROLLAR) : [],
    ]);
    res.render('qabul/list', { title: 'Qabul vaqtlari', qabullar, xodimlar, xodimId });
  } catch (err) {
    next(err);
  }
});

router.get('/new', (req, res, next) => {
  const xodim_id = num(req.query.xodim) || null;
  form(req, res, { item: { status: true, slot_min: 15, xodim_id }, isNew: true }).catch(next);
});

async function save(req, res, next, current) {
  const id = current ? current.id : null;
  const isNew = id === null;
  try {
    const { d, errors } = await parseForm(req, current);
    const item = { ...d, id };
    if (!errors.length && (await Qabul.overlaps(d, id))) {
      errors.push("Bu kunda xodimning boshqa qabuli bilan vaqt kesishadi");
    }
    if (errors.length) return await form(req, res, { item, isNew, errors }, 400);
    if (isNew) await Qabul.create(d);
    else await Qabul.update(id, d);
    flash(req, 'Qabul vaqti saqlandi');
    res.redirect(isStaff(req.session.user) ? `/qabul?xodim=${d.xodim_id}` : '/qabul');
  } catch (err) {
    next(err);
  }
}

router.post('/', (req, res, next) => save(req, res, next, null));

router.get('/:id(\\d+)/edit', async (req, res, next) => {
  try {
    const item = await ownItem(req);
    if (!item) return next();
    await form(req, res, { item, isNew: false });
  } catch (err) {
    next(err);
  }
});

router.post('/:id(\\d+)', async (req, res, next) => {
  try {
    const item = await ownItem(req);
    if (!item) return next();
    await save(req, res, next, item);
  } catch (err) {
    next(err);
  }
});

router.post('/:id(\\d+)/delete', async (req, res, next) => {
  try {
    if (!(await ownItem(req))) return next();
    await Qabul.remove(req.params.id);
    flash(req, "Qabul vaqti o'chirildi");
    res.redirect('/qabul');
  } catch (err) {
    next(err);
  }
});

// --- Qabul bo'lmaydigan kunlar ---

router.get('/istisno', async (req, res, next) => {
  try {
    const me = req.session.user;
    const xodimId = isStaff(me) ? num(req.query.xodim) || null : me.id;
    const bugun = hozir().sana;
    const [istisnolar, xodimlar] = await Promise.all([
      Qabul.istisnolar({ xodimId, dan: bugun }),
      isStaff(me) ? Users.receivers(QABUL_ROLLAR) : [],
    ]);
    res.render('qabul/istisno', { title: "Qabul bo'lmaydigan kunlar", istisnolar, xodimlar, xodimId, bugun });
  } catch (err) {
    next(err);
  }
});

router.post('/istisno', async (req, res, next) => {
  try {
    const d = { xodim_id: xodimOf(req, req.body.xodim_id), sana: str(req.body.sana), sabab: str(req.body.sabab) };
    const back = isStaff(req.session.user) && d.xodim_id ? `/qabul/istisno?xodim=${d.xodim_id}` : '/qabul/istisno';
    const xodim = Number.isSafeInteger(d.xodim_id) ? await Users.findById(d.xodim_id) : null;
    let error = null;
    if (!xodim || !QABUL_ROLLAR.includes(xodim.role)) error = 'Xodim tanlanmagan';
    else if (!isSana(d.sana) || d.sana < hozir().sana) error = "Sana bugun yoki keyingi kun bo'lishi kerak";
    else if (d.sabab && d.sabab.length > 255) error = 'Sabab 255 belgidan oshmasin';
    if (error) {
      flash(req, error, 'err');
      return res.redirect(back);
    }
    try {
      const bekor = await Qabul.addIstisno(d);
      flash(req, bekor ? `Saqlandi. Shu kunga yozilgan ${bekor} ta navbat bekor qilindi.` : 'Saqlandi');
    } catch (err) {
      if (err.code !== '23505') throw err;
      flash(req, 'Bu sana allaqachon qo\'shilgan', 'err');
    }
    res.redirect(back);
  } catch (err) {
    next(err);
  }
});

router.post('/istisno/:id(\\d+)/delete', async (req, res, next) => {
  try {
    const item = await Qabul.findIstisno(req.params.id);
    const me = req.session.user;
    if (!item || (!isStaff(me) && item.xodim_id !== me.id)) return next();
    await Qabul.removeIstisno(item.id);
    flash(req, "O'chirildi. Bekor qilingan navbatlar qayta tiklanmaydi.");
    res.redirect('/qabul/istisno');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
