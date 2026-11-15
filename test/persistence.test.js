import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/database.js';
import { verifyPassword } from '../src/security.js';

test('staff provisioning and database persistence survive reopen without exposing password', async () => {
  const directory=await mkdtemp(fileURLToPath(new URL('../.relay-test-',import.meta.url)));
  const path=join(directory,'test.sqlite');
  const cli=fileURLToPath(new URL('../src/create-agent.js',import.meta.url));
  const password='  private-staff-password  ';
  const run=(input=password+'\n')=>spawnSync(process.execPath,[cli,'agent@example.com','Support Agent'],{input,encoding:'utf8',env:{...process.env,DATABASE_PATH:path}});
  try {
    const result=run(); assert.equal(result.status,0,result.stderr);
    assert.equal((result.stdout+result.stderr).includes(password),false);
    let db=openDatabase(path);
    const user=db.prepare('SELECT * FROM users').get();
    assert.equal(user.role,'agent');
    assert.equal(verifyPassword(password,user.password_hash),true);
    db.prepare('INSERT INTO tickets(subject,description,customer_id) VALUES(?,?,?)').run('Persistent ticket','Saved on disk',user.id);
    db.close();
    assert.notEqual(run().status,0);
    db=openDatabase(path);
    assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n,1);
    assert.equal(db.prepare('SELECT subject FROM tickets').get().subject,'Persistent ticket');
    db.close();
    assert.notEqual(run('short').status,0);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
