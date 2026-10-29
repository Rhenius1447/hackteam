const crypto = require('crypto');
const secret = () => process.env.AUTH_SECRET || 'dev-secret-change-me';
const sha = v => crypto.createHash('sha256').update(String(v)).digest();
exports.same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
exports.hashPw = pw => { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex'); };
exports.checkPw = (pw, stored) => {
  if (!stored) return false;
  const [salt, h] = stored.split(':'); const hb = Buffer.from(h, 'hex'), t = crypto.scryptSync(pw, salt, 64);
  return hb.length === t.length && crypto.timingSafeEqual(hb, t);
};
const mac = body => crypto.createHmac('sha256', secret()).update(body).digest('base64url');
exports.sign = p => { const body = Buffer.from(JSON.stringify({ ...p, exp: Date.now() + 7 * 864e5 })).toString('base64url'); return body + '.' + mac(body); };
exports.verify = tok => {
  try {
    const [body, sig] = String(tok).split('.'); const good = mac(body);
    if (!sig || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url')); return p.exp > Date.now() ? p : null;
  } catch { return null; }
};
