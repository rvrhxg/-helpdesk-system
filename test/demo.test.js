import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/database.js';
import { seedDemo } from '../src/demo.js';
test('demo seed refuses existing accounts and preserves all data',()=>{
  const db=openDatabase(':memory:');
  try {
    seedDemo(db,'demo-password-123');
    assert.equal(db.prepare('SELECT count(*) AS n FROM tickets').get().n,7);
    assert.equal(db.prepare("SELECT count(*) AS n FROM users WHERE role='agent'").get().n,1);
    assert.throws(()=>seedDemo(db,'demo-password-123'),/empty database/);
    assert.equal(db.prepare('SELECT count(*) AS n FROM tickets').get().n,7);
  }finally{db.close();}
});
