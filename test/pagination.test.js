import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { hashPassword,tokenHash } from '../src/security.js';

test('pagination, filtering and statistics cover all owned records without leaking other customers', async () => {
  const db=openDatabase(':memory:');
  const insertUser=db.prepare('INSERT INTO users(email,name,password_hash) VALUES(?,?,?)');
  insertUser.run('alice@example.com','Alice',hashPassword('test-password-123'));
  insertUser.run('bob@example.com','Bob',hashPassword('test-password-123'));
  const token='a'.repeat(64);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),1,Date.now()+60000);
  const insert=db.prepare('INSERT INTO tickets(subject,description,customer_id,status) VALUES(?,?,?,?)');
  for(let i=0;i<55;i++) insert.run(`Owned ${i}`,'Details',1,i<5?'resolved':'open');
  insert.run('Secret ticket','Private',2,'open');
  const server=createApp({db}); server.listen(0,'127.0.0.1'); await once(server,'listening');
  const get=path=>fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{headers:{cookie:`session=${token}`}});
  try {
    const first=await get('/tickets?page=1');
    assert.equal(first.headers.get('x-total-count'),'55');
    const page1=await first.json(); assert.equal(page1.length,50);
    const page2=await (await get('/tickets?page=2')).json(); assert.equal(page2.length,5);
    assert.equal(new Set([...page1,...page2].map(t=>t.id)).size,55);
    assert.equal((await (await get('/tickets?status=resolved')).json()).length,5);
    assert.equal((await (await get('/tickets?q=Secret')).json()).length,0);
    const summary=await (await get('/stats')).json();
    assert.equal(summary.reduce((n,s)=>n+s.count,0),55);
    assert.equal((await get('/tickets?page=-1')).status,400);
    assert.equal((await get('/tickets?page=1.5')).status,400);
    assert.equal((await get('/tickets?status=unknown')).status,400);
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));db.close(); }
});
