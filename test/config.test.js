import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';

test('deployment configuration rejects unsafe or nonmatching origins before listening', () => {
  const db=openDatabase(':memory:');
  try {
    for(const origin of ['invalid','file:///tmp','https://example.com/','https://example.com/path','https://user:secret@example.com']) {
      assert.throws(()=>createApp({db,origin}),/APP_ORIGIN/);
    }
    assert.throws(()=>createApp({db,origin:'http://localhost:3000',secure:true}),/HTTPS/);
    assert.ok(createApp({db,origin:'https://example.com',secure:true}));
  } finally {db.close();}
});
