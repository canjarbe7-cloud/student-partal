require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const { engine } = require('express-handlebars');

const { helpers } = require('./helpers/hbs');
const { requireLogin } = require('./middleware/auth');
const Users = require('./queries/users');
const Qabul = require('./queries/qabul');

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

// Har bir .hbs ichida {{me}} va {{isStaff}} mavjud bo'ladi
app.use((req, res, next) => {
  const me = req.session.user || null;
  res.locals.me = me;
  res.locals.isStaff = !!me && (me.role === 'admin' || me.role === 'dekanat');
  next();
});

app.use(require('./routes/auth'));

app.get('/', requireLogin, async (req, res, next) => {
  try {
    const [soni, jadval, profil] = await Promise.all([
      Users.countByRole(),
      Qabul.schedule(),
      Users.findById(req.session.user.id),
    ]);
    // O'chirilgan yoki bloklangan foydalanuvchini tizimdan chiqaramiz
    if (!profil || !profil.status) return req.session.destroy(() => res.redirect('/login'));
    res.render('home', { title: 'Bosh sahifa', soni, jadval, profil });
  } catch (err) {
    next(err);
  }
});

app.use('/users', require('./routes/users'));
app.use('/qabul', require('./routes/qabul'));

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
