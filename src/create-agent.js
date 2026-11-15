import { openDatabase } from './database.js';
import { hashPassword } from './security.js';

// Password comes from stdin; never expose it through argv or logs.
const [email, name] = process.argv.slice(2);
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 100) {
  console.error('Usage: node src/create-agent.js agent@example.com "Agent name" < password-file');
  process.exit(1);
}
let password = '';
for await (const chunk of process.stdin) {
  password += chunk;
  if (password.length > 256) { console.error('Password too long'); process.exit(1); }
}
password = password.replace(/\r?\n$/, '');
if (password.length < 12 || password.length > 128) { console.error('Password must contain 12–128 characters'); process.exit(1); }
const db = openDatabase();
try {
  db.prepare("INSERT INTO users(email,name,password_hash,role) VALUES(?,?,?,'agent')").run(email.toLowerCase(), name, hashPassword(password));
  console.log('Support agent created.');
} catch (error) { console.error(error.code?.startsWith('ERR_SQLITE') ? 'Could not create agent; check whether email is already registered.' : 'Agent creation failed.'); process.exitCode = 1; }
finally { db.close(); }
