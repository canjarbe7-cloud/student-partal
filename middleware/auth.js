function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// requireRole('admin', 'dekanat')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('error', { title: 'Ruxsat yo\'q', message: 'Bu sahifaga ruxsatingiz yo\'q.' });
    }
    next();
  };
}

module.exports = { requireLogin, requireRole };
