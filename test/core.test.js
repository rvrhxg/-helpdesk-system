import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/database.js';
import { hashPassword, verifyPassword, newToken, tokenHash } from '../src/security.js';

test('passwords use unique salts and reject incorrect credentials', () => {
  const a = hashPassword('strong-password');
  assert.notEqual(a, hashPassword('strong-password'));
  assert.equal(verifyPassword('strong-password', a), true);
  assert.equal(verifyPassword('wrong-password', a), false);
});
test('session tokens have 256 bits and are stored as hashes', () => {
  const token = newToken();
  assert.equal(token.length, 64);
  assert.notEqual(tokenHash(token), token);
});
test('database enforces foreign keys, roles and unique email', () => {
  const db = openDatabase(':memory:');
  db.prepare('INSERT INTO users(email,name,password_hash) VALUES(?,?,?)').run('a@example.com','Alice','hash');
  assert.throws(() => db.prepare('INSERT INTO users(email,name,password_hash) VALUES(?,?,?)').run('A@example.com','Alice','hash'));
  assert.throws(() => db.prepare('INSERT INTO users(email,name,password_hash,role) VALUES(?,?,?,?)').run('b@example.com','Bob','hash','root'));
  assert.throws(() => db.prepare('INSERT INTO tickets(subject,description,customer_id) VALUES(?,?,?)').run('Issue','Details',999));
  db.close();
});
