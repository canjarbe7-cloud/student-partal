const router = require('express').Router();
const Users = require('../queries/users');
const { requireRole } = require('../middleware/auth');
const { ROLLAR } = require('../helpers/hbs');
const { str, num } = require('../helpers/form');

const ROLES = Object.keys(ROLLAR);

// "101-A, 102-B" -> ['101-A', '102-B'] (takrorlar katta-kichik harfdan qat'i nazar olib tashlanadi)
function parseGuruhlar(v) {
  const seen = new Set();
  return String(v ?? '')
    .split(/[,;\n]/)
    .map((g) => g.trim())
    .filter((g) => g && !seen.has(g.toLowerCase()) && seen.add(g.toLowerCase()));
}

// Formadan kelgan ma'lumotni tozalaydi va tekshiradi
function parseForm(body, { isNew }) {
  const d = {
    ism: str(body.ism),
    familiya: str(body.familiya),
    ochestva: str(body.ochestva),
    login: str(body.login),
    parol: str(body.parol),
    role: str(body.role),
    phone: str(body.phone),
    status: body.status === 'on' || body.status === 'true',
    guruh: str(body.guruh),
    kurs: num(body.kurs),
    lavozim: str(body.lavozim),
    tg_user: str(body.tg_user),
    guruhlar: body.role === 'tyutor' ? parseGuruhlar(body.guruhlar) : [],
  };
  const errors = [];
  if (!d.ism) errors.push('Ism kiritilmagan');
  if (!d.familiya) errors.push('Familiya kiritilmagan');
  if (!d.login) errors.push('Login kiritilmagan');
  if (isNew && !d.parol) errors.push('Parol kiritilmagan');
  if (d.parol && d.parol.length < 6) errors.push("Parol kamida 6 belgidan iborat bo'lsin");
  if (!ROLES.includes(d.role)) errors.push("Rol noto'g'ri");
  for (const k of ['ism', 'familiya', 'ochestva', 'login', 'guruh', 'lavozim', 'tg_user']) {
    if (d[k] && d[k].length > 100) errors.push(`${k}: 100 belgidan oshmasin`);
  }
  if (d.phone && d.phone.length > 20) errors.push('Telefon 20 belgidan oshmasin');
  if (Number.isNaN(d.kurs)) errors.push("Kurs butun son bo'lishi kerak");
  if (d.guruhlar.some((g) => g.length > 100)) errors.push("Guruh nomi 100 belgidan oshmasin");
  if (d.role === 'student' && d.kurs !== null && !(d.kurs >= 1 && d.kurs <= 6)) {
    errors.push("Kurs 1 dan 6 gacha bo'lsin");
  }
  return { d, errors };
}

// Postgres xatolarini tushunarli matnga aylantiradi
function dbError(err) {
  if (err.code === '23505' && err.constraint === 'users_login_key') return 'Bu login band';
  return null;
}

async function renderForm(res, { user, isNew, errors, status = 200 }) {
  // Xatodan keyin qayta ko'rsatishda guruhlar massiv bo'lib keladi
  if (Array.isArray(user.guruhlar)) user = { ...user, guruhlar: user.guruhlar.join(', ') };
  res.status(status).render('users/form', {
    title: isNew ? 'Yangi foydalanuvchi' : 'Tahrirlash',
    user,
    isNew,
    errors,
    roles: ROLES,
  });
}

router.use(requireRole('admin', 'dekanat'));

// Admin foydalanuvchini faqat admin o'zgartira oladi
async function protectAdmin(req, res, next) {
  try {
    if (req.session.user.role === 'admin') return next();
    const user = await Users.findById(req.params.id);
    if (user && user.role === 'admin') {
      return res.status(403).render('error', { title: "Ruxsat yo'q", message: "Adminni o'zgartira olmaysiz." });
    }
    next();
  } catch (err) {
    next(err);
  }
}

router.get('/', async (req, res, next) => {
  try {
    const role = ROLES.includes(req.query.role) ? req.query.role : null;
    const q = str(req.query.q);
    const users = await Users.list({ role, q });
    res.render('users/list', { title: 'Foydalanuvchilar', users, role, q, roles: ROLES });
  } catch (err) {
    next(err);
  }
});

router.get('/new', async (req, res, next) => {
  try {
    await renderForm(res, { user: { status: true, role: req.query.role || 'student' }, isNew: true });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  const { d, errors } = parseForm(req.body, { isNew: true });
  if (d.role === 'admin' && req.session.user.role !== 'admin') errors.push('Admin yaratishga ruxsatingiz yo\'q');
  try {
    if (errors.length) return await renderForm(res, { user: d, isNew: true, errors, status: 400 });
    const id = await Users.create(d);
    res.redirect(`/users/${id}`);
  } catch (err) {
    const msg = dbError(err);
    if (!msg) return next(err);
    renderForm(res, { user: d, isNew: true, errors: [msg], status: 400 }).catch(next);
  }
});

router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const user = await Users.findById(req.params.id);
    if (!user) return next();
    res.render('users/show', { title: `${user.familiya} ${user.ism}`, user });
  } catch (err) {
    next(err);
  }
});

router.get('/:id(\\d+)/edit', async (req, res, next) => {
  try {
    const user = await Users.findById(req.params.id);
    if (!user) return next();
    await renderForm(res, { user, isNew: false });
  } catch (err) {
    next(err);
  }
});

router.post('/:id(\\d+)', protectAdmin, async (req, res, next) => {
  const id = Number(req.params.id);
  const me = req.session.user;
  const { d, errors } = parseForm(req.body, { isNew: false });
  if (d.role === 'admin' && me.role !== 'admin') errors.push('Admin qilishga ruxsatingiz yo\'q');
  if (id === me.id && (!d.status || d.role !== me.role)) {
    errors.push("O'zingizning rol yoki holatingizni o'zgartira olmaysiz");
  }
  try {
    if (errors.length) return await renderForm(res, { user: { ...d, id }, isNew: false, errors, status: 400 });
    const ok = await Users.update(id, d);
    if (!ok) return next();
    res.redirect(`/users/${id}`);
  } catch (err) {
    const msg = dbError(err);
    if (!msg) return next(err);
    renderForm(res, { user: { ...d, id }, isNew: false, errors: [msg], status: 400 }).catch(next);
  }
});

router.post('/:id(\\d+)/status', protectAdmin, async (req, res, next) => {
  try {
    if (Number(req.params.id) === req.session.user.id) {
      return res.status(400).render('error', { title: 'Xato', message: "O'zingizni bloklay olmaysiz." });
    }
    await Users.setStatus(req.params.id, req.body.status === 'true');
    res.redirect(req.get('Referer') || '/users');
  } catch (err) {
    next(err);
  }
});

router.post('/:id(\\d+)/delete', protectAdmin, async (req, res, next) => {
  try {
    if (Number(req.params.id) === req.session.user.id) {
      return res.status(400).render('error', { title: 'Xato', message: "O'zingizni o'chira olmaysiz." });
    }
    await Users.remove(req.params.id);
    res.redirect('/users');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
