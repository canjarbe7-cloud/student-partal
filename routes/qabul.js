const router = require('express').Router();
const Qabul = require('../queries/qabul');
const { requireRole } = require('../middleware/auth');
const { timeToMin, KUNLAR } = require('../helpers/hbs');

const kunlar = KUNLAR.slice(1).map((nom, i) => ({ id: i + 1, nom }));

function parseForm(body) {
  const d = {
    start_time: timeToMin(body.start_time),
    end_time: timeToMin(body.end_time),
    week_date: Number(body.week_date),
  };
  const errors = [];
  if (d.start_time === null) errors.push("Boshlanish vaqti noto'g'ri");
  if (d.end_time === null) errors.push("Tugash vaqti noto'g'ri");
  if (d.start_time !== null && d.end_time !== null && d.end_time <= d.start_time) {
    errors.push("Tugash vaqti boshlanishdan keyin bo'lishi kerak");
  }
  if (!(d.week_date >= 1 && d.week_date <= 7)) errors.push('Hafta kuni tanlanmagan');
  return { d, errors };
}

const form = (res, o, status = 200) =>
  res.status(status).render('qabul/form', { title: 'Qabul vaqti', kunlar, ...o });

router.use(requireRole('admin', 'dekanat'));

router.get('/', async (req, res, next) => {
  try {
    res.render('qabul/list', { title: 'Qabul vaqtlari', qabullar: await Qabul.list() });
  } catch (err) {
    next(err);
  }
});

router.get('/new', (req, res) => form(res, { item: {}, isNew: true }));

router.post('/', async (req, res, next) => {
  const { d, errors } = parseForm(req.body);
  if (errors.length) return form(res, { item: d, isNew: true, errors }, 400);
  try {
    await Qabul.create(d);
    res.redirect('/qabul');
  } catch (err) {
    if (err.code === '23505') return form(res, { item: d, isNew: true, errors: ['Bu vaqt allaqachon mavjud'] }, 400);
    next(err);
  }
});

router.get('/:id(\\d+)/edit', async (req, res, next) => {
  try {
    const item = await Qabul.findById(req.params.id);
    if (!item) return next();
    form(res, { item, isNew: false });
  } catch (err) {
    next(err);
  }
});

router.post('/:id(\\d+)', async (req, res, next) => {
  const id = Number(req.params.id);
  const { d, errors } = parseForm(req.body);
  if (errors.length) return form(res, { item: { ...d, id }, isNew: false, errors }, 400);
  try {
    if (!(await Qabul.update(id, d))) return next();
    res.redirect('/qabul');
  } catch (err) {
    if (err.code === '23505') {
      return form(res, { item: { ...d, id }, isNew: false, errors: ['Bu vaqt allaqachon mavjud'] }, 400);
    }
    next(err);
  }
});

router.post('/:id(\\d+)/delete', async (req, res, next) => {
  try {
    await Qabul.remove(req.params.id);
    res.redirect('/qabul');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
