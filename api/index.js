require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const { body, query, validationResult } = require('express-validator');
const { Participant, Team, Announcement, Message } = require('./models');
const { hashPw, checkPw, sign, verify, same } = require('./auth');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Cached connection (needed for serverless on Vercel)
let conn = null;
async function connectDB() {
  if (conn) return conn;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  conn = mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  await conn;
  return conn;
}
app.use('/api', async (req, res, next) => {
  try { await connectDB(); next(); }
    catch (e) { conn = null; console.error('MongoDB error:', e.message); res.status(500).json({ errors: [{ msg: 'Database connection failed: ' + e.message }] }); }
});

// ---------- Auth ----------
app.use('/api', (req, res, next) => { const h = req.headers.authorization || ''; req.user = h.startsWith('Bearer ') ? verify(h.slice(7)) : null; next(); });
const needMember = (req, res, next) => !req.user ? res.status(401).json({ errors: [{ msg: 'Please log in first' }] })
  : req.user.role !== 'user' ? res.status(403).json({ errors: [{ msg: 'Log in as a participant to do this' }] }) : next();
const needAdmin = (req, res, next) => !req.user ? res.status(401).json({ errors: [{ msg: 'Please log in as admin' }] })
  : req.user.role !== 'admin' ? res.status(403).json({ errors: [{ msg: 'Admin access only' }] }) : next();
const asMe = (req, res, next) => { req.body.email = req.body.leaderEmail = req.query.email = req.user.email; next(); };
const pub = u => ({ id: u._id, name: u.name, email: u.email, role: 'user', avatar: u.avatar });
const AV = body('avatar').optional({ checkFalsy: true }).matches(/^[a-z-]+:[A-Za-z0-9 ._-]{1,40}$/).withMessage('Invalid avatar');

const csv = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const rxEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const check = (req, res, next) => {
  const r = validationResult(req);
  if (!r.isEmpty()) return res.status(400).json({ errors: r.array().map(e => ({ field: e.path, msg: e.msg })) });
  next();
};

// ---------- Participants ----------
app.get('/api/participants', async (req, res) => {
  const q = {};
  if (req.query.skill) q.skills = new RegExp(rxEsc(req.query.skill), 'i');
  res.json(await Participant.find(q).select(req.user && req.user.role === 'admin' ? '' : '-email').sort('-createdAt').limit(100));
});

app.post('/api/participants', [
  body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters')
    .matches(/^[A-Za-z .'-]+$/).withMessage('Name may contain only letters and spaces'),
  body('email').trim().isEmail().withMessage('Enter a valid email').normalizeEmail(),
  body('password').isLength({ min: 6, max: 72 }).withMessage('Password must be 6-72 characters'),
  body('role').isIn(['Frontend', 'Backend', 'Full Stack', 'Designer', 'Data/AI', 'Other']).withMessage('Select a valid role'),
  body('experience').isIn(['Beginner', 'Intermediate', 'Advanced']).withMessage('Select experience level'),
  body('skills').trim().notEmpty().withMessage('Enter at least one skill (comma separated)'),
  body('bio').optional().isLength({ max: 300 }).withMessage('Bio can be at most 300 characters'), AV
], check, async (req, res) => {
  try {
    if (await Participant.findOne({ email: req.body.email }))
      return res.status(409).json({ errors: [{ field: 'email', msg: 'This email is already registered' }] });
    const { name, email, role, experience, bio, avatar } = req.body;
    const p = await Participant.create({ name, email, role, experience, bio, avatar: avatar || 'avataaars:' + name, skills: csv(req.body.skills), passwordHash: hashPw(req.body.password) });
    res.status(201).json({ token: sign({ id: p._id, email: p.email, name: p.name, role: 'user' }), user: pub(p) });
  } catch (e) { res.status(500).json({ errors: [{ msg: 'Could not save participant' }] }); }
});

app.post('/api/login/user', [body('email').trim().isEmail().withMessage('Enter a valid email').normalizeEmail(), body('password').notEmpty().withMessage('Enter your password')], check, async (req, res) => {
  const u = await Participant.findOne({ email: req.body.email }).select('+passwordHash');
  if (!u || !checkPw(req.body.password, u.passwordHash)) return res.status(401).json({ errors: [{ field: 'password', msg: 'Invalid email or password' }] });
  res.json({ token: sign({ id: u._id, email: u.email, name: u.name, role: 'user' }), user: pub(u) });
});

app.post('/api/login/admin', [body('email').trim().notEmpty().withMessage('Enter admin email'), body('password').notEmpty().withMessage('Enter admin password')], check, (req, res) => {
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return res.status(500).json({ errors: [{ msg: 'Admin login is not configured on the server' }] });
  if (!same(req.body.email.toLowerCase(), ADMIN_EMAIL.toLowerCase()) || !same(req.body.password, ADMIN_PASSWORD))
    return res.status(401).json({ errors: [{ field: 'password', msg: 'Invalid admin credentials' }] });
  res.json({ token: sign({ email: ADMIN_EMAIL, name: 'Admin', role: 'admin' }), user: { name: 'Admin', email: ADMIN_EMAIL, role: 'admin' } });
});

app.put('/api/me/avatar', needMember, [AV], check, async (req, res) => {
  const u = await Participant.findByIdAndUpdate(req.user.id, { avatar: req.body.avatar }, { new: true });
  if (!u) return res.status(404).json({ errors: [{ msg: 'Account not found' }] });
  res.json({ user: pub(u) });
});

app.delete('/api/participants/:id', needAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ errors: [{ msg: 'Invalid id' }] });
    await Participant.findByIdAndDelete(id);
    for (const t of await Team.find({ members: id })) {
      t.members = t.members.filter(m => !m.equals(id));
      if (!t.members.length) { await t.deleteOne(); continue; }
      if (t.leader.equals(id)) t.leader = t.members[0];
      await t.save();
    }
    res.json({ message: 'Participant removed' });
  } catch (e) { res.status(500).json({ errors: [{ msg: 'Could not remove participant' }] }); }
});

app.delete('/api/teams/:id', needAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ errors: [{ msg: 'Invalid id' }] });
  await Team.findByIdAndDelete(req.params.id); res.json({ message: 'Team deleted' });
});

// ---------- Teams ----------
app.get('/api/teams', async (req, res) => {
  const q = {};
  if (req.query.search) {
    const rx = new RegExp(rxEsc(req.query.search), 'i');
    q.$or = [{ name: rx }, { hackathon: rx }, { techStack: rx }];
  }
  const teams = await Team.find(q).populate('leader members', 'name role experience skills avatar').sort('-createdAt').lean();
  res.json(teams.map(t => ({ ...t, balance: balance(t.members, t.maxSize) })));
});

app.post('/api/teams', needMember, asMe, [
  body('name').trim().isLength({ min: 3, max: 40 }).withMessage('Team name must be 3-40 characters'),
  body('hackathon').trim().isLength({ min: 3, max: 60 }).withMessage('Hackathon name must be 3-60 characters'),
  body('description').trim().isLength({ min: 10, max: 500 }).withMessage('Description must be 10-500 characters'),
  body('maxSize').isInt({ min: 2, max: 6 }).withMessage('Team size must be between 2 and 6').toInt(),
  body('techStack').trim().notEmpty().withMessage('Enter at least one technology'),
  body('leaderEmail').trim().isEmail().withMessage("Enter the leader's registered email").normalizeEmail()
], check, async (req, res) => {
  try {
    const leader = await Participant.findOne({ email: req.body.leaderEmail });
    if (!leader) return res.status(404).json({ errors: [{ field: 'leaderEmail', msg: 'Register as a participant first' }] });
    if (await Team.findOne({ name: new RegExp(`^${rxEsc(req.body.name)}$`, 'i') }))
      return res.status(409).json({ errors: [{ field: 'name', msg: 'Team name already taken' }] });
    const t = await Team.create({
      name: req.body.name, hackathon: req.body.hackathon, description: req.body.description,
      maxSize: req.body.maxSize, techStack: csv(req.body.techStack), lookingFor: [].concat(req.body.lookingFor || []), leader: leader._id, members: [leader._id]
    });
    res.status(201).json(t);
  } catch (e) { res.status(500).json({ errors: [{ msg: 'Could not create team' }] }); }
});

app.post('/api/teams/:id/join', needMember, asMe, [
  body('email').trim().isEmail().withMessage('Enter your registered email').normalizeEmail()
], check, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ errors: [{ msg: 'Invalid team id' }] });
    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ errors: [{ msg: 'Team not found' }] });
    const user = await Participant.findOne({ email: req.body.email });
    if (!user) return res.status(404).json({ errors: [{ field: 'email', msg: 'Email not registered. Register first.' }] });
    if (team.members.some(m => m.equals(user._id))) return res.status(409).json({ errors: [{ msg: 'You are already in this team' }] });
    if (team.members.length >= team.maxSize) return res.status(409).json({ errors: [{ msg: 'Team is full' }] });
    team.members.push(user._id);
    await team.save();
    res.json({ message: 'Joined successfully' });
  } catch (e) { res.status(500).json({ errors: [{ msg: 'Could not join team' }] }); }
});


// ================= NEW FEATURES =================
const EXP = { Beginner: 1, Intermediate: 2, Advanced: 3 };
const CORE = ['Frontend', 'Backend', 'Designer', 'Data/AI'];

// Feature 1: Team Balance Score (role diversity + experience mix + skill breadth)
function balance(members, maxSize) {
  if (!members.length) return { score: 0, missing: CORE.slice(0, 2) };
  const roles = new Set(members.map(m => m.role));
  const exps = new Set(members.map(m => m.experience));
  const skills = new Set(members.flatMap(m => (m.skills || []).map(x => x.toLowerCase())));
  const raw = (roles.size / members.length) * 45 + Math.min(exps.size / Math.min(3, members.length), 1) * 30 + Math.min(skills.size / 8, 1) * 25;
  const score = Math.round(raw * (0.6 + 0.4 * members.length / maxSize));
  const missing = CORE.filter(r => !roles.has(r) && !roles.has('Full Stack')).slice(0, 2);
  return { score: Math.min(score, 100), missing };
}

// Feature 2: Dashboard stats
app.get('/api/stats', async (req, res) => {
  const [participants, teams] = await Promise.all([Participant.find().lean(), Team.find().populate('members', 'role experience skills').lean()]);
  const roles = {};
  participants.forEach(p => { roles[p.role] = (roles[p.role] || 0) + 1; });
  const scores = teams.map(t => balance(t.members, t.maxSize).score);
  res.json({
    participants: participants.length, teams: teams.length,
    openSpots: teams.reduce((a, t) => a + (t.maxSize - t.members.length), 0),
    hackathons: new Set(teams.map(t => t.hackathon.toLowerCase())).size,
    avgBalance: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    roles
  });
});

// Feature 3: Smart Match - ranks teams for a participant
app.get('/api/match', needMember, asMe, [query('email').trim().isEmail().withMessage('Enter a valid email').normalizeEmail()], check, async (req, res) => {
  const me = await Participant.findOne({ email: req.query.email }).lean();
  if (!me) return res.status(404).json({ errors: [{ field: 'email', msg: 'Email not registered. Register first.' }] });
  const mine = me.skills.map(s => s.toLowerCase());
  const teams = await Team.find().populate('members', 'name role experience skills avatar').lean();
  const out = teams
    .filter(t => t.members.length < t.maxSize && !t.members.some(m => String(m._id) === String(me._id)))
    .map(t => {
      const reasons = []; let score = 10;
      const stack = t.techStack.map(s => s.toLowerCase());
      const common = stack.filter(s => mine.some(k => k.includes(s) || s.includes(k)));
      if (stack.length) score += (common.length / stack.length) * 50;
      if (common.length) reasons.push(`Shares ${common.length} tech skill${common.length > 1 ? 's' : ''}: ${common.join(', ')}`);
      if (t.lookingFor.includes(me.role)) { score += 25; reasons.push(`They are looking for a ${me.role}`); }
      if (!t.members.some(m => m.role === me.role)) { score += 10; reasons.push(`You add a new role (${me.role})`); }
      if (!t.members.some(m => m.experience === me.experience)) { score += 5; reasons.push(`Adds ${me.experience} experience mix`); }
      return { team: { ...t, balance: balance(t.members, t.maxSize) }, match: Math.min(Math.round(score), 99), reasons };
    }).sort((a, b) => b.match - a.match).slice(0, 6);
  res.json(out);
});

// Feature 4: Auto Team Builder - balanced teams from unassigned participants
app.post('/api/auto-teams', needAdmin, [
  body('hackathon').trim().isLength({ min: 3, max: 60 }).withMessage('Hackathon name must be 3-60 characters'),
  body('teamSize').isInt({ min: 2, max: 6 }).withMessage('Team size must be 2-6').toInt()
], check, async (req, res) => {
  try {
    const save = req.body.save === true || req.body.save === 'true';
    const size = req.body.teamSize;
    const taken = new Set((await Team.find().select('members').lean()).flatMap(t => t.members.map(String)));
    const pool = (await Participant.find().lean()).filter(p => !taken.has(String(p._id)));
    if (pool.length < 2) return res.status(400).json({ errors: [{ msg: 'Need at least 2 participants without a team' }] });
    pool.sort((a, b) => a.role.localeCompare(b.role) || EXP[b.experience] - EXP[a.experience]);
    const k = Math.ceil(pool.length / size);
    const groups = Array.from({ length: k }, () => []);
    pool.forEach((p, i) => groups[i % k].push(p)); // deal like cards => spreads roles
    const names = ['Alpha', 'Bravo', 'Nova', 'Phoenix', 'Orion', 'Vortex', 'Quantum', 'Zenith'];
    const result = groups.map((g, i) => ({
      name: `Team ${names[i % names.length]} ${Math.floor(100 + Math.random() * 900)}`,
      members: g, balance: balance(g, size)
    }));
    if (save) {
      for (const t of result) {
        const lead = [...t.members].sort((a, b) => EXP[b.experience] - EXP[a.experience])[0];
        const stack = [...new Set(t.members.flatMap(m => m.skills))].slice(0, 4);
        await Team.create({ name: t.name, hackathon: req.body.hackathon, maxSize: size, techStack: stack,
          description: 'Auto-balanced team built by the Smart Team Builder.', leader: lead._id, members: t.members.map(m => m._id) });
      }
    }
    res.json({ saved: save, teams: result });
  } catch (e) { res.status(500).json({ errors: [{ msg: 'Could not build teams' }] }); }
});

// Feature 5: Leave team (leadership passes on; empty team is removed)
app.post('/api/teams/:id/leave', needMember, asMe, [body('email').trim().isEmail().withMessage('Enter your registered email').normalizeEmail()], check, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ errors: [{ msg: 'Invalid team id' }] });
    const team = await Team.findById(req.params.id);
    const user = await Participant.findOne({ email: req.body.email });
    if (!team) return res.status(404).json({ errors: [{ msg: 'Team not found' }] });
    if (!user || !team.members.some(m => m.equals(user._id))) return res.status(404).json({ errors: [{ field: 'email', msg: 'You are not a member of this team' }] });
    team.members = team.members.filter(m => !m.equals(user._id));
    if (!team.members.length) { await team.deleteOne(); return res.json({ message: 'Team disbanded' }); }
    if (team.leader.equals(user._id)) team.leader = team.members[0];
    await team.save();
    res.json({ message: 'You left the team' });
  } catch (e) { res.status(500).json({ errors: [{ msg: 'Could not leave team' }] }); }
});

// ---------- New features ----------
// 1. Announcements (admin posts, everyone reads)
app.get('/api/announcements', async (req, res) => res.json(await Announcement.find().sort({ pinned: -1, createdAt: -1 }).limit(30).lean()));
app.post('/api/announcements', needAdmin, [
  body('title').trim().isLength({ min: 3, max: 80 }).withMessage('Title must be 3-80 characters'),
  body('body').trim().isLength({ min: 3, max: 500 }).withMessage('Message must be 3-500 characters')
], check, async (req, res) => {
  const a = await Announcement.create({ title: req.body.title, body: req.body.body, pinned: req.body.pinned === true || req.body.pinned === 'on' });
  res.status(201).json(a);
});
app.delete('/api/announcements/:id', needAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ errors: [{ msg: 'Invalid id' }] });
  await Announcement.findByIdAndDelete(req.params.id); res.json({ message: 'Announcement deleted' });
});

// 2. My Profile (participant edits own details and avatar)
app.get('/api/me', needMember, async (req, res) => {
  const u = await Participant.findById(req.user.id).lean();
  if (!u) return res.status(404).json({ errors: [{ msg: 'Account not found' }] });
  const team = await Team.findOne({ members: u._id }).select('name hackathon').lean();
  res.json({ user: { ...pub(u), experience: u.experience, skills: u.skills, bio: u.bio, roleName: u.role }, team });
});
app.put('/api/me', needMember, [
  body('role').isIn(['Frontend', 'Backend', 'Full Stack', 'Designer', 'Data/AI', 'Other']).withMessage('Select a valid role'),
  body('experience').isIn(['Beginner', 'Intermediate', 'Advanced']).withMessage('Select experience level'),
  body('skills').trim().notEmpty().withMessage('Enter at least one skill'),
  body('bio').optional().isLength({ max: 300 }).withMessage('Bio can be at most 300 characters'), AV
], check, async (req, res) => {
  const { role, experience, bio, avatar } = req.body;
  const u = await Participant.findByIdAndUpdate(req.user.id, { role, experience, bio, avatar: avatar || undefined, skills: csv(req.body.skills) }, { new: true });
  res.json({ user: pub(u), message: 'Profile updated' });
});

// 3. Team chat (members only)
async function chatGuard(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ errors: [{ msg: 'Invalid team id' }] });
  const t = await Team.findById(req.params.id).select('members').lean();
  if (!t) return res.status(404).json({ errors: [{ msg: 'Team not found' }] });
  if (!t.members.some(m => String(m) === String(req.user.id))) return res.status(403).json({ errors: [{ msg: 'Only team members can use the chat' }] });
  next();
}
app.get('/api/teams/:id/messages', needMember, chatGuard, async (req, res) =>
  res.json((await Message.find({ team: req.params.id }).sort({ createdAt: -1 }).limit(50).populate('author', 'name avatar').lean()).reverse()));
app.post('/api/teams/:id/messages', needMember, chatGuard, [body('text').trim().isLength({ min: 1, max: 300 }).withMessage('Message must be 1-300 characters')], check, async (req, res) => {
  await Message.create({ team: req.params.id, author: req.user.id, text: req.body.text }); res.status(201).json({ message: 'Sent' });
});

// 4. Admin: CSV export of participants (5. Leaderboard is computed in the browser from /api/teams)
app.get('/api/admin/export', needAdmin, async (req, res) => {
  const cell = v => { v = String(v ?? '').replace(/"/g, '""'); return '"' + (/^[=+\-@]/.test(v) ? "'" + v : v) + '"'; };
  const rows = await Participant.find().sort({ createdAt: 1 }).lean();
  const csvText = ['Name,Email,Role,Experience,Skills,Bio', ...rows.map(p => [p.name, p.email, p.role, p.experience, p.skills.join('; '), p.bio].map(cell).join(','))].join('\n');
  res.type('text/csv').send(csvText);
});

module.exports = app;
if (!process.env.VERCEL) app.listen(process.env.PORT || 3000, () => console.log('http://localhost:3000'));
