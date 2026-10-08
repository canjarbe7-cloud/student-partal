const router = require('express').Router();
const bcrypt = require('bcryptjs');
const Users = require('../queries/users');

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { title: 'Kirish', layout: 'main' });
});

router.post('/login', async (req, res, next) => {
  try {
    const { login, parol } = req.body;
    const user = await Users.findByLogin(String(login || '').trim());
    const ok = user && user.status && (await bcrypt.compare(String(parol || ''), user.parol));
    if (!ok) {
      return res.status(401).render('login', { title: 'Kirish', error: "Login yoki parol noto'g'ri", login });
    }
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, ism: user.ism, familiya: user.familiya, role: user.role };
      res.redirect('/');
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
