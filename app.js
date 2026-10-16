require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const { engine } = require('express-handlebars');

const { helpers, QABUL_ROLLAR } = require('./helpers/hbs');
const { hozir } = require('./helpers/sana');
const { requireLogin } = require('./middleware/auth');
const Users = require('./queries/users');
const Qabul = require('./queries/qabul');
const Navbat = require('./queries/navbat');

const app = express();

// --- .hbs sozlamalari ---
app.engine(
  'hbs',
  engine({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: path.join(__dirname, 'views', 'layouts'),
    partialsDir: path.join(__dirname, 'views', 'partials'),
    helpers,
  })
);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
  })
);

// Har bir .hbs ichida {{me}}, {{isStaff}}, {{isStudent}}, {{isQabulchi}} va {{flash}} mavjud bo'ladi
app.use((req, res, next) => {
  const me = req.session.user || null;
  res.locals.me = me;
  res.locals.isStaff = !!me && (me.role === 'admin' || me.role === 'dekanat');
  res.locals.isStudent = !!me && me.role === 'student';
  res.locals.isQabulchi = !!me && QABUL_ROLLAR.includes(me.role);
  res.locals.qabulMenu = res.locals.isStaff || res.locals.isQabulchi;
  if (req.session.flash) {
    res.locals.flash = req.session.flash;
    delete req.session.flash;
  }
  next();
});

app.use(require('./routes/auth'));

app.get('/', requireLogin, async (req, res, next) => {
  try {
    const me = req.session.user;
    const bugun = hozir().sana;
    const isStudent = me.role === 'student';
    const [soni, jadval, profil, navbatlarim, tyutorlar, kunlar] = await Promise.all([
      Users.countByRole(),
      Qabul.schedule(),
      Users.findById(me.id),
      isStudent ? Navbat.mine(me.id) : [],
      isStudent ? Users.tyutorlari(me.id) : [],
      QABUL_ROLLAR.includes(me.role) ? Navbat.kelgusiKunlar(me.id, bugun, 5) : [],
    ]);
    // O'chirilgan yoki bloklangan foydalanuvchini tizimdan chiqaramiz
    if (!profil || !profil.status) return req.session.destroy(() => res.redirect('/login'));
    const yaqin = navbatlarim
      .filter((n) => n.sana >= bugun && (n.status === 'kutilmoqda' || n.status === 'tasdiqlandi'))
      .reverse()
      .slice(0, 3);
    const bugungi = kunlar.find((k) => k.sana === bugun);
    res.render('home', {
      title: 'Bosh sahifa',
      soni,
      jadval,
      profil,
      yaqin,
      tyutorlar,
      kunlar,
      bugungiSoni: bugungi ? bugungi.soni : 0,
    });
  } catch (err) {
    next(err);
  }
});

app.use('/users', require('./routes/users'));
app.use('/qabul', require('./routes/qabul'));
app.use('/bolimlar', require('./routes/bolimlar'));
app.use('/navbat', require('./routes/navbat'));
app.use('/qabulxona', require('./routes/qabulxona'));

app.use((req, res) => {
  res.status(404).render('error', { title: 'Topilmadi', message: 'Sahifa topilmadi.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Xato', message: 'Serverda xatolik yuz berdi.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
