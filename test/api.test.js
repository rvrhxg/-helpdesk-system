import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';

test('authentication, ownership, staff workflow, CSRF and logout', async () => {
  const db = openDatabase(':memory:');
  const origin = 'http://localhost:3000';
  const server = createApp({ db, origin });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', data, cookie, requestOrigin = origin) => fetch(base + path, { method, headers: { origin: requestOrigin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  try {
    assert.equal((await request('/api/tickets')).status, 401);
    const register = async email => {
      const r = await request('/api/auth/register','POST',{ email, name: 'Tester', password: 'long-test-password', role: 'admin' });
      assert.equal(r.status, 201);
      assert.equal((await r.json()).role, 'customer');
      assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
      return r.headers.get('set-cookie').split(';')[0];
    };
    const alice = await register('alice@example.com');
    const bob = await register('bob@example.com');
    const created = await request('/api/tickets','POST',{ subject: 'Cannot sign in', description: 'Account is locked' },alice);
    assert.equal(created.status, 201);
    const ticket = await created.json();
    assert.equal((await request(`/api/tickets/${ticket.id}`,'GET',null,bob)).status,404);
    assert.deepEqual(await (await request('/api/tickets','GET',null,bob)).json(),[]);
    assert.equal((await request(`/api/tickets/${ticket.id}`,'PATCH',{status:'resolved'},alice)).status,403);
    assert.equal((await request('/api/tickets','POST',{subject:'x',description:'y'},alice,'https://evil.example')).status,403);
    db.prepare("UPDATE users SET role='agent' WHERE email=?").run('bob@example.com');
    assert.equal((await request(`/api/tickets/${ticket.id}`,'PATCH',{status:'resolved'},bob)).status,200);
    assert.equal(db.prepare('SELECT count(*) AS n FROM audit_events').get().n,1);
    assert.equal((await request('/api/analytics','GET',null,alice)).status,403);
    assert.ok(db.prepare('SELECT resolved_at FROM tickets WHERE id=?').get(ticket.id).resolved_at);
    await request(`/api/tickets/${ticket.id}/comments`,'POST',{body:'Customer follow-up'},alice);
    assert.equal(db.prepare('SELECT first_response_at FROM tickets WHERE id=?').get(ticket.id).first_response_at,null);
    await request(`/api/tickets/${ticket.id}/comments`,'POST',{body:'Support response'},bob);
    const first=db.prepare('SELECT first_response_at FROM tickets WHERE id=?').get(ticket.id).first_response_at;
    assert.ok(first);
    await request(`/api/tickets/${ticket.id}/comments`,'POST',{body:'Support response again'},bob);
    assert.equal(db.prepare('SELECT first_response_at FROM tickets WHERE id=?').get(ticket.id).first_response_at,first);
    const metrics=await (await request('/api/analytics','GET',null,bob)).json();
    assert.equal(metrics.first_response.completed,1);
    await request(`/api/tickets/${ticket.id}`,'PATCH',{status:'open'},bob);
    assert.equal(db.prepare('SELECT resolved_at FROM tickets WHERE id=?').get(ticket.id).resolved_at,null);

    assert.equal((await request(`/api/tickets/${ticket.id}/comments`,'POST',{body:'Thank you'},alice)).status,201);
    assert.equal((await request('/api/auth/logout','POST',{},alice)).status,200);
    assert.equal((await request('/api/auth/me','GET',null,alice)).status,401);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); }
});
