import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openDatabase } from './database.js';
import { hashPasswordAsync, verifyPasswordAsync, newToken, tokenHash } from './security.js';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const field = (value, max, min = 1) => {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) fail(400, 'Invalid field');
  return value.trim();
};
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32768) fail(413, 'Request too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { const data = JSON.parse(raw); if (!data || Array.isArray(data) || typeof data !== 'object') fail(400, 'Invalid JSON'); return data; }
  catch { fail(400, 'Invalid JSON'); }
}

export function createApp({ db, origin = process.env.APP_ORIGIN || 'http://localhost:3000', secure = process.env.NODE_ENV === 'production' } = {}) {
  let configured;
  try { configured = new URL(origin); } catch { throw new Error('APP_ORIGIN must be an absolute HTTP(S) origin'); }
  if (!['http:','https:'].includes(configured.protocol) || configured.origin !== origin) throw new Error('APP_ORIGIN must contain only scheme, hostname and optional port');
  if (secure && configured.protocol !== 'https:') throw new Error('Production requires an HTTPS APP_ORIGIN');
  const ownsDatabase = !db;
  db ||= openDatabase();
  const attempts = new Map();
  const dummyHash = hashPasswordAsync('dummy-password-value');
  let activeAuth = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, origin);
      const path = url.pathname;
      const assets = { '/': ['index.html','text/html'], '/app.js': ['app.js','text/javascript'], '/style.css': ['style.css','text/css'] };
      if (req.method === 'GET' && assets[path]) {
        const [file, type] = assets[path];
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        const content = await readFile(new URL(`../public/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return res.end(content);
      }
      const write = !['GET', 'HEAD'].includes(req.method);
      if (write && req.headers.origin !== origin) fail(403, 'Origin rejected');
      if (write && !req.headers['content-type']?.startsWith('application/json')) fail(415, 'JSON required');
      if (path === '/api/health' && req.method === 'GET') return send(200, { status: 'ok' });
      if (['/api/auth/register', '/api/auth/login'].includes(path) && req.method === 'POST') {
        if (activeAuth >= 4) fail(503, 'Authentication busy; try again');
        activeAuth++;
        try {
        const now = Date.now();
        for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
        const key = req.socket.remoteAddress;
        const entry = attempts.get(key) || { count: 0, until: now + 60000 };
        attempts.set(key, entry);
        if (++entry.count > 15) fail(429, 'Try again later');
        const data = await body(req);
        const email = field(data.email, 254).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Invalid email');
        if (typeof data.password !== 'string' || data.password.length < 12 || data.password.length > 128) fail(400, 'Password must contain 12–128 characters');
        const password = data.password;
        let user;
        if (path.endsWith('register')) {
          const name = field(data.name, 100);
          if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) fail(409, 'Email unavailable');
          const passwordHash = await hashPasswordAsync(password);
          if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) fail(409, 'Email unavailable');
          const result = db.prepare('INSERT INTO users(email,name,password_hash) VALUES(?,?,?)').run(email, name, passwordHash);
          user = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
        } else {
          user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
          const valid = await verifyPasswordAsync(password, user?.password_hash || await dummyHash);
          if (!user || !valid) fail(401, 'Invalid credentials');
        }
        const token = newToken();
        db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token), user.id, now + 86400000);
        res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secure ? '; Secure' : ''}`);
        return send(path.endsWith('register') ? 201 : 200, { id: user.id, name: user.name, email: user.email, role: user.role });
        } finally { activeAuth--; }
      }
      const token = /(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      const user = token && db.prepare('SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(tokenHash(token), Date.now());
      if (!user) fail(401, 'Authentication required');
      if (path === '/api/auth/me' && req.method === 'GET') return send(200, user);
      if (path === '/api/auth/logout' && req.method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
        res.setHeader('Set-Cookie', `session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
        return send(200, { ok: true });
      }
      const staff = user.role !== 'customer';
      if (path === '/api/stats' && req.method === 'GET') {
        return send(200, db.prepare('SELECT status,count(*) AS count FROM tickets WHERE (? OR customer_id=?) GROUP BY status').all(staff ? 1 : 0,user.id));
      }
      if (path === '/api/tickets' && req.method === 'GET') {
        const search = (url.searchParams.get('q') || '').slice(0, 200);
        const page = Number(url.searchParams.get('page') || 1);
        if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) fail(400, 'Invalid page');
        const status = url.searchParams.get('status') || '';
        if (status && !['open','in_progress','resolved','closed'].includes(status)) fail(400, 'Invalid status');
        const where = `(? OR customer_id=?) AND (subject LIKE ? OR description LIKE ?) AND (?='' OR status=?)`;
        const args = [staff ? 1 : 0,user.id,`%${search}%`,`%${search}%`,status,status];
        res.setHeader('X-Total-Count', String(db.prepare(`SELECT count(*) AS count FROM tickets WHERE ${where}`).get(...args).count));
        return send(200, db.prepare(`SELECT * FROM tickets WHERE ${where} ORDER BY id DESC LIMIT 50 OFFSET ?`).all(...args,(page-1)*50));
      }
      if (path === '/api/tickets' && req.method === 'POST') {
        const data = await body(req);
        const subject = field(data.subject, 200);
        const description = field(data.description, 10000);
        const priority = data.priority || 'normal';
        if (!['low','normal','high','urgent'].includes(priority)) fail(400, 'Invalid priority');
        const result = db.prepare('INSERT INTO tickets(subject,description,priority,customer_id) VALUES(?,?,?,?)').run(subject, description, priority, user.id);
        return send(201, db.prepare('SELECT * FROM tickets WHERE id=?').get(result.lastInsertRowid));
      }
      const match = /^\/api\/tickets\/([1-9]\d*)(\/comments)?$/.exec(path);
      if (match) {
        const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(match[1]);
        if (!ticket || (!staff && ticket.customer_id !== user.id)) fail(404, 'Ticket not found');
        if (req.method === 'GET') return send(200, match[2] ? db.prepare('SELECT c.*,u.name AS author_name FROM comments c JOIN users u ON u.id=c.author_id WHERE ticket_id=? ORDER BY c.id').all(ticket.id) : ticket);
        if (match[2] && req.method === 'POST') {
          const data = await body(req);
          const result = db.prepare('INSERT INTO comments(ticket_id,author_id,body) VALUES(?,?,?)').run(ticket.id, user.id, field(data.body, 5000));
          return send(201, db.prepare('SELECT * FROM comments WHERE id=?').get(result.lastInsertRowid));
        }
        if (!match[2] && req.method === 'PATCH') {
          if (!staff) fail(403, 'Staff access required');
          const data = await body(req);
          if (!['open','in_progress','resolved','closed'].includes(data.status)) fail(400, 'Invalid status');
          db.exec('BEGIN');
          try {
            db.prepare('UPDATE tickets SET status=?,assignee_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(data.status, user.id, ticket.id);
            db.prepare('INSERT INTO audit_events(actor_id,ticket_id,action) VALUES(?,?,?)').run(user.id, ticket.id, `status:${ticket.status}->${data.status}`);
            db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
          return send(200, db.prepare('SELECT * FROM tickets WHERE id=?').get(ticket.id));
        }
      }
      fail(404, 'Not found');
    } catch (error) { if (!error.status) console.error(error); send(error.status || 500, { error: error.status ? error.message : 'Internal server error' }); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  if (ownsDatabase) server.once('close', () => db.close());
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createApp();
  server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log('HelpDesk server started'));
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    server.close();
    const deadline = setTimeout(() => server.closeAllConnections(), 8000);
    deadline.unref();
    server.once('close', () => clearTimeout(deadline));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
