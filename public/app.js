const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROLE = { Frontend: ['bi-window', '#6366f1'], Backend: ['bi-hdd-network', '#0ea5e9'], 'Full Stack': ['bi-layers', '#8b5cf6'], Designer: ['bi-palette', '#ec4899'], 'Data/AI': ['bi-cpu', '#10b981'], Other: ['bi-stars', '#f59e0b'] };
const STYLES = ['avataaars', 'adventurer', 'bottts', 'fun-emoji', 'lorelei', 'pixel-art'];
const SEEDS = ['Ava', 'Leo', 'Mia', 'Zed', 'Kai', 'Nia', 'Rex', 'Zoe', 'Sam', 'Ivy', 'Max', 'Lia'];
const avUrl = a => { const [st, sd] = a && a.includes(':') ? a.split(/:(.+)/) : ['avataaars', a || 'you']; return `https://api.dicebear.com/7.x/${st}/svg?seed=${encodeURIComponent(sd)}`; };
const av = (n, s = 36, a) => `<img class="av" width="${s}" height="${s}" title="${esc(n)}" alt="${esc(n)}" src="${avUrl(a || 'avataaars:' + n)}">`;
const roleBadge = r => `<span class="badge" style="background:${(ROLE[r] || ROLE.Other)[1]}"><i class="bi ${(ROLE[r] || ROLE.Other)[0]}"></i> ${esc(r)}</span>`;
const ring = s => `<div class="ring" style="--p:${s};--c:${s >= 70 ? '#22c55e' : s >= 45 ? '#f59e0b' : '#ef4444'}" title="Team balance score"><span>${s}</span></div>`;
const joinModal = new bootstrap.Modal('#joinModal'), loginModal = new bootstrap.Modal('#loginModal');
let me = null, token = localStorage.getItem('token') || '', profPk, chatTeam = null, loginRole = 'user';
try { me = JSON.parse(localStorage.getItem('me')); } catch {}
let joinTeamId = null, joinAction = 'join', teamsCache = [];

function toast(msg, type = 'success') {
  const d = document.createElement('div');
  d.className = `alert alert-${type} shadow fade show`; d.textContent = msg;
  $('#alertBox').append(d); setTimeout(() => d.remove(), 4000);
}
const party = () => typeof confetti === 'function' && confetti({ particleCount: 140, spread: 80, origin: { y: .6 } });

async function api(url, method = 'GET', data) {
  const headers = { 'Content-Type': 'application/json' }; if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(url, { method, headers, body: data ? JSON.stringify(data) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && res.status === 401 && !url.startsWith('/api/login')) { if (token) setAuth(); loginModal.show(); }
  if (!res.ok) throw json.errors || [{ msg: 'Something went wrong' }];
  return json;
}

function handleForm(form, onSubmit, keep) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    form.querySelectorAll('.server-error').forEach(x => x.remove());
    form.querySelectorAll('.is-invalid').forEach(x => x.classList.remove('is-invalid'));
    if (!form.checkValidity()) { form.classList.add('was-validated'); return; }
    const data = {};
    for (const [k, v] of new FormData(form).entries()) data[k] = k in data ? [].concat(data[k], v) : v;
    try { await onSubmit(data, e); if (!keep) { form.reset(); form.classList.remove('was-validated'); } }
    catch (errs) {
      (Array.isArray(errs) ? errs : [{ msg: 'Network error' }]).forEach(er => {
        const input = er.field && form.elements[er.field];
        if (input) { input.classList.add('is-invalid'); const d = document.createElement('div'); d.className = 'invalid-feedback d-block server-error'; d.textContent = er.msg; input.after(d); }
        else toast(er.msg, 'danger');
      });
    }
  });
}

function countUp(el, to) {
  const from = +el.textContent || 0, t0 = performance.now();
  (function step(t) { const p = Math.min((t - t0) / 900, 1); el.textContent = Math.round(from + (to - from) * p); if (p < 1) requestAnimationFrame(step); })(t0);
}
async function loadStats() {
  const s = await api('/api/stats').catch(() => null); if (!s) return;
  document.querySelectorAll('[data-key]').forEach(el => countUp(el, s[el.dataset.key]));
  const max = Math.max(1, ...Object.values(s.roles));
  $('#roleBars').innerHTML = Object.keys(ROLE).map(r => `<div class="d-flex align-items-center gap-2 mb-2"><div style="width:110px" class="small">${roleBadge(r)}</div>
    <div class="role-bar flex-grow-1"><div style="width:${(s.roles[r] || 0) / max * 100}%;background:${ROLE[r][1]}"></div></div><b class="small" style="width:24px">${s.roles[r] || 0}</b></div>`).join('');
}

function teamCard(t, extra = '', i = 0) {
  const full = t.members.length >= t.maxSize, b = t.balance || { score: 0, missing: [] };
  return `<div class="col-md-6 col-lg-4"><div class="card team-card h-100" style="animation-delay:${i * 60}ms"><div class="card-body d-flex flex-column">
    <div class="d-flex justify-content-between align-items-start mb-2"><div><h5 class="mb-0">${esc(t.name)}</h5><small class="text-muted"><i class="bi bi-trophy"></i> ${esc(t.hackathon)}</small></div>${ring(b.score)}</div>
    <p class="small">${esc(t.description)}</p>
    <div class="mb-2">${(t.techStack || []).map(s => `<span class="badge badge-skill me-1">${esc(s)}</span>`).join('')}</div>
    ${(t.lookingFor || []).length ? `<div class="small mb-2"><i class="bi bi-search text-primary"></i> Looking for: ${t.lookingFor.map(roleBadge).join(' ')}</div>` : ''}
    ${b.missing.length && !full ? `<div class="small text-warning mb-2"><i class="bi bi-exclamation-triangle"></i> Balance tip: add ${b.missing.map(esc).join(' / ')}</div>` : ''}
    ${extra}
    <div class="mt-auto pt-2"><div class="d-flex align-items-center justify-content-between mb-2"><div class="av-stack d-flex">${t.members.map(m => av(m.name, 36, m.avatar)).join('')}</div>
      <span class="badge ${full ? 'bg-danger' : 'bg-success'}">${t.members.length}/${t.maxSize}</span></div>
      <div class="d-flex gap-2"><button class="btn btn-grad btn-sm flex-fill" ${full ? 'disabled' : ''} data-act="join" data-id="${t._id}" data-name="${esc(t.name)}">${full ? 'Team Full' : 'Join'}</button>
      <button class="btn btn-outline-secondary btn-sm" data-act="leave" data-id="${t._id}" data-name="${esc(t.name)}">Leave</button>${delBtn('team', t._id)}</div></div>
  </div></div></div>`;
}

function renderTeams() {
  const sort = $('#teamSort').value, list = [...teamsCache];
  if (sort === 'bal') list.sort((a, b) => b.balance.score - a.balance.score);
  if (sort === 'spots') list.sort((a, b) => (b.maxSize - b.members.length) - (a.maxSize - a.members.length));
  $('#teamList').innerHTML = list.length ? list.map((t, i) => teamCard(t, '', i)).join('') : '<p class="text-center text-muted py-5"><i class="bi bi-emoji-smile fs-1 d-block"></i>No teams yet. Create the first one!</p>';
}
async function loadTeams() { teamsCache = await api('/api/teams?search=' + encodeURIComponent($('#teamSearch').value)).catch(() => []); renderTeams(); }

async function loadPeople() {
  const people = await api('/api/participants?skill=' + encodeURIComponent($('#skillSearch').value)).catch(() => []);
  $('#peopleList').innerHTML = people.length ? people.map((p, i) => `<div class="col-md-6 col-lg-4"><div class="card person-card h-100" style="animation-delay:${i * 50}ms"><div class="card-body text-center">
    ${av(p.name, 84, p.avatar)}<h5 class="mt-2 mb-1">${esc(p.name)}</h5>${roleBadge(p.role)} <span class="badge bg-secondary">${esc(p.experience)}</span>
    <p class="small text-muted my-2">${esc(p.bio)}</p>${p.skills.map(s => `<span class="badge badge-skill me-1">${esc(s)}</span>`).join('')}${delBtn('participant', p._id)}</div></div></div>`).join('')
    : '<p class="text-center text-muted py-5">No participants yet.</p>';
}
const refresh = () => { loadTeams(); loadPeople(); loadStats(); loadLeader(); loadAdmin(); };

function openModal(act, id, name) {
  if (!me) return loginModal.show();
  if (me.role !== 'user') return toast('Admins manage the portal. Log in as a participant to join teams.', 'info');
  const email = me.email;
  joinAction = act; joinTeamId = id;
  $('#joinMode').textContent = act === 'join' ? 'Join' : 'Leave'; $('#joinTeamName').textContent = name;
  $('#joinForm').elements.email.value = email; $('#joinForm').elements.email.readOnly = true; joinModal.show();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (b) openModal(b.dataset.act, b.dataset.id, b.dataset.name);
  const d = e.target.closest('[data-del]');
  if (d && confirm('Delete this ' + d.dataset.del + '?')) api('/api/' + ({ team: 'teams', participant: 'participants', announcement: 'announcements' })[d.dataset.del] + '/' + d.dataset.id, 'DELETE').then(r => { toast(r.message); refresh(); loadAnnounce(); }).catch(er => toast(er[0].msg, 'danger'));
  if (e.target.closest('#loginBtn')) loginModal.show();
  if (e.target.closest('#logoutBtn')) { setAuth(); toast('Logged out', 'info'); refresh(); }
  const g = e.target.closest('[data-go]'); if (g) document.querySelector(`[data-bs-target="${g.dataset.go}"]`).click();
});

handleForm($('#registerForm'), async d => { const r = await api('/api/participants', 'POST', d); setAuth(r.token, r.user); toast('Registration successful! You are now logged in.'); party(); refresh(); });
handleForm($('#teamForm'), async d => { await api('/api/teams', 'POST', d); toast('Team created!'); party(); refresh(); document.querySelector('[data-bs-target="#teamsTab"]').click(); });
handleForm($('#joinForm'), async d => {
  const r = await api(`/api/teams/${joinTeamId}/${joinAction}`, 'POST', d);
  joinModal.hide(); toast(r.message); if (joinAction === 'join') party(); refresh();
});
handleForm($('#matchForm'), async d => {
  const res = await api('/api/match?email=' + encodeURIComponent(d.email));
  $('#matchList').innerHTML = res.length ? res.map((r, i) => teamCard(r.team, `<div class="mb-2"><div class="d-flex justify-content-between"><b>Match</b><span class="match-pct">${r.match}%</span></div>
    <div class="progress mb-2" style="height:8px"><div class="progress-bar bg-success" style="width:${r.match}%"></div></div>
    <ul class="small ps-3 mb-0">${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`, i)).join('')
    : '<p class="text-center text-muted">No open teams to match right now. Try the Auto Builder!</p>';
}, true);

let autoSave = false;
$('#autoForm').addEventListener('click', e => { const b = e.target.closest('button[data-save]'); if (b) autoSave = b.dataset.save === 'true'; });
handleForm($('#autoForm'), async d => {
  const r = await api('/api/auto-teams', 'POST', { ...d, save: autoSave });
  $('#autoResult').innerHTML = r.teams.map((t, i) => `<div class="col-md-6 col-lg-4"><div class="card team-card h-100" style="animation-delay:${i * 80}ms"><div class="card-body">
    <div class="d-flex justify-content-between"><h5>${esc(t.name)}</h5>${ring(t.balance.score)}</div>
    ${t.members.map(m => `<div class="d-flex align-items-center gap-2 mb-2">${av(m.name, 36, m.avatar)}<div class="small"><b>${esc(m.name)}</b><br>${roleBadge(m.role)} <span class="text-muted">${esc(m.experience)}</span></div></div>`).join('')}</div></div></div>`).join('');
  if (r.saved) { toast(`${r.teams.length} balanced teams created!`); party(); refresh(); } else toast('Preview ready. Press "Build & Save" to create them.', 'info');
}, true);

$('#roleChecks').innerHTML = Object.keys(ROLE).map(r => `<div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" name="lookingFor" value="${r}" id="lf-${r}"><label class="form-check-label" for="lf-${r}">${r}</label></div>`).join('');
$('#themeBtn').addEventListener('click', () => { const h = document.documentElement; h.dataset.bsTheme = h.dataset.bsTheme === 'dark' ? 'light' : 'dark'; });
let timer; const debounce = fn => () => { clearTimeout(timer); timer = setTimeout(fn, 300); };
$('#teamSearch').addEventListener('input', debounce(loadTeams)); $('#teamSort').addEventListener('change', renderTeams);
$('#skillSearch').addEventListener('input', debounce(loadPeople));
// ---------- Auth, roles and new features ----------
const delBtn = (kind, id) => me && me.role === 'admin' ? `<button class="btn btn-outline-danger btn-sm" data-del="${kind}" data-id="${id}" title="Delete (admin)"><i class="bi bi-trash"></i></button>` : '';
function setAuth(t, u) {
  token = t || ''; me = u || null;
  token ? localStorage.setItem('token', token) : localStorage.removeItem('token');
  me ? localStorage.setItem('me', JSON.stringify(me)) : localStorage.removeItem('me');
  renderAuth();
}
function prefill() {
  const e = me && me.role === 'user' ? me.email : null;
  [['#matchForm', 'email'], ['#teamForm', 'leaderEmail']].forEach(([f, n]) => { const i = $(f).elements[n]; if (e) { i.value = e; i.readOnly = true; } else i.readOnly = false; });
}
function renderAuth() {
  const role = me && me.role;
  $('#authArea').innerHTML = me ? `${role === 'admin' ? '<span class="badge bg-danger">ADMIN</span>' : ''}<span class="text-white small d-none d-md-inline">${esc(me.name)}</span>${role === 'user' ? `<button class="btn p-0" data-go="#profileTab" title="My profile">${av(me.name, 34, me.avatar)}</button>` : ''}<button id="logoutBtn" class="btn btn-sm btn-outline-light rounded-pill">Logout</button>`
    : '<button id="loginBtn" class="btn btn-sm btn-grad rounded-pill"><i class="bi bi-box-arrow-in-right"></i> Login</button>';
  [['admin-only', role === 'admin'], ['user-only', role === 'user'], ['guest-only', !me]].forEach(([c, on]) => document.querySelectorAll('.' + c).forEach(el => el.classList.toggle('d-none', !on)));
  prefill();
  const act = document.querySelector('#mainTabs .nav-link.active');
  if (act && act.closest('li').classList.contains('d-none')) document.querySelector('[data-bs-target="#teamsTab"]').click();
  renderTeams(); loadPeople(); loadAdmin(); loadProfile();
}
function picker(box, input) {
  let style = STYLES[0], sel = input.value || 'avataaars:Ava';
  const draw = () => {
    input.value = sel;
    box.innerHTML = `<div class="text-center"><img class="av-big" src="${avUrl(sel)}" alt="Selected avatar"></div>
      <select class="form-select form-select-sm my-2 pk-style">${STYLES.map(s => `<option ${s === style ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <div class="pk-grid">${SEEDS.map(sd => `<button type="button" class="pk-opt ${sel === style + ':' + sd ? 'on' : ''}" data-v="${style}:${sd}"><img src="${avUrl(style + ':' + sd)}" alt=""></button>`).join('')}</div>
      <button type="button" class="btn btn-sm btn-outline-secondary mt-2 w-100 pk-rand"><i class="bi bi-shuffle"></i> Shuffle</button>`;
  };
  box.addEventListener('click', e => {
    const o = e.target.closest('.pk-opt'); if (o) { sel = o.dataset.v; draw(); }
    if (e.target.closest('.pk-rand')) { sel = style + ':' + Math.random().toString(36).slice(2, 8); draw(); }
  });
  box.addEventListener('change', e => { if (e.target.matches('.pk-style')) { style = e.target.value; sel = style + ':' + SEEDS[0]; draw(); } });
  draw();
  return { set(v) { if (v) { sel = v; style = v.split(':')[0]; } draw(); } };
}
document.querySelectorAll('[data-lrole]').forEach(b => b.addEventListener('click', () => {
  loginRole = b.dataset.lrole;
  document.querySelectorAll('[data-lrole]').forEach(x => x.classList.toggle('active', x === b));
  $('#loginHint').textContent = loginRole === 'admin' ? 'Admin: manage participants, teams and announcements.' : 'Participant: join teams, get matched, chat and edit your profile.';
  $('#loginForm').elements.email.type = loginRole === 'admin' ? 'text' : 'email';
}));
handleForm($('#loginForm'), async d => { const r = await api('/api/login/' + loginRole, 'POST', d); setAuth(r.token, r.user); loginModal.hide(); toast('Welcome, ' + r.user.name + '!'); refresh(); });

async function loadAnnounce() {
  const a = await api('/api/announcements').catch(() => []);
  $('#announceList').innerHTML = a.length ? a.map(x => `<div class="card mb-3 ${x.pinned ? 'border-warning' : ''}"><div class="card-body d-flex justify-content-between gap-3"><div><h5 class="mb-1">${x.pinned ? '<i class="bi bi-pin-angle-fill text-warning"></i> ' : ''}${esc(x.title)}</h5><p class="mb-1">${esc(x.body)}</p><small class="text-muted">${new Date(x.createdAt).toLocaleString()}</small></div>${delBtn('announcement', x._id)}</div></div>`).join('')
    : '<p class="text-center text-muted py-5">No announcements yet.</p>';
}
handleForm($('#announceForm'), async d => { await api('/api/announcements', 'POST', { ...d, pinned: !!d.pinned }); toast('Announcement posted'); loadAnnounce(); });

async function loadLeader() {
  const t = await api('/api/teams').catch(() => []);
  const top = [...t].sort((a, b) => b.balance.score - a.balance.score).slice(0, 10);
  $('#leaderList').innerHTML = top.length ? top.map((x, i) => `<div class="card mb-2"><div class="card-body d-flex align-items-center gap-3"><div class="rank rank-${i + 1}">${i + 1}</div><div class="flex-grow-1"><b>${esc(x.name)}</b><div class="small text-muted">${esc(x.hackathon)} &middot; ${x.members.length}/${x.maxSize} members</div></div><div class="av-stack d-flex">${x.members.map(m => av(m.name, 32, m.avatar)).join('')}</div>${ring(x.balance.score)}</div></div>`).join('')
    : '<p class="text-center text-muted py-5">No teams to rank yet.</p>';
}

async function loadAdmin() {
  if (!(me && me.role === 'admin')) return;
  const [p, t] = await Promise.all([api('/api/participants').catch(() => []), api('/api/teams').catch(() => [])]);
  $('#adminPeople').innerHTML = p.map(x => `<tr><td>${av(x.name, 28, x.avatar)} ${esc(x.name)}</td><td>${esc(x.email)}</td><td>${esc(x.role)}</td><td>${esc(x.experience)}</td><td>${delBtn('participant', x._id)}</td></tr>`).join('') || '<tr><td colspan="5" class="text-muted">No participants</td></tr>';
  $('#adminTeams').innerHTML = t.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.hackathon)}</td><td>${x.members.length}/${x.maxSize}</td><td>${x.balance.score}</td><td>${delBtn('team', x._id)}</td></tr>`).join('') || '<tr><td colspan="5" class="text-muted">No teams</td></tr>';
}
$('#exportBtn').addEventListener('click', async () => {
  const r = await fetch('/api/admin/export', { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) return toast('Export failed', 'danger');
  const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'participants.csv'; a.click(); URL.revokeObjectURL(a.href);
});

async function loadProfile() {
  if (!(me && me.role === 'user')) return;
  const r = await api('/api/me').catch(() => null); if (!r) return;
  const u = r.user, f = $('#profileForm').elements;
  f.role.value = u.roleName; f.experience.value = u.experience; f.skills.value = u.skills.join(', '); f.bio.value = u.bio || ''; profPk.set(u.avatar);
  chatTeam = r.team; $('#chatTitle').textContent = r.team ? 'Team chat: ' + r.team.name : 'Team chat';
  $('#chatBox').classList.toggle('d-none', !r.team); $('#chatNone').classList.toggle('d-none', !!r.team);
  if (r.team) loadChat();
}
handleForm($('#profileForm'), async d => { const r = await api('/api/me', 'PUT', d); setAuth(token, { ...me, avatar: r.user.avatar }); toast(r.message); refresh(); }, true);
async function loadChat() {
  if (!chatTeam) return;
  const m = await api(`/api/teams/${chatTeam._id}/messages`).catch(() => []), box = $('#chatMsgs');
  box.innerHTML = m.length ? m.map(x => { const a = x.author || { name: 'Deleted user' }; return `<div class="d-flex gap-2 mb-2">${av(a.name, 30, a.avatar)}<div><b class="small">${esc(a.name)}</b> <small class="text-muted">${new Date(x.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small><div>${esc(x.text)}</div></div></div>`; }).join('') : '<p class="text-muted small mb-0">No messages yet. Say hi!</p>';
  box.scrollTop = box.scrollHeight;
}
handleForm($('#chatForm'), async d => { await api(`/api/teams/${chatTeam._id}/messages`, 'POST', d); loadChat(); });
$('#chatRefresh').addEventListener('click', loadChat);

const regPk = picker($('#regPicker'), $('#regAvatar'));
profPk = picker($('#profPicker'), $('#profAvatar'));
document.addEventListener('reset', () => setTimeout(() => { prefill(); regPk.set(); }, 0), true);
renderAuth(); refresh(); loadAnnounce();
