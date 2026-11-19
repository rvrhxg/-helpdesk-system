import test from 'node:test';
import assert from 'node:assert/strict';
import { sla, analytics, policy } from '../src/sla.js';
import { openDatabase } from '../src/database.js';
test('all SLA priorities, exact boundary, completed late and null averages',()=>{
 const start=Date.parse('2026-01-01T00:00:00Z');
 for(const priority of Object.keys(policy)){
  const t={priority,created_at:'2026-01-01 00:00:00'};
  assert.equal(sla(t,start+policy[priority][0]*3600000).first_response.overdue,false);
  assert.equal(sla(t,start+policy[priority][0]*3600000+1).first_response.overdue,true);
  assert.equal(sla(t,start+policy[priority][1]*3600000+1).resolution.overdue,true);
 }
 const t={priority:'urgent',created_at:'2026-01-01 00:00:00',first_response_at:'2026-01-01 01:00:00',resolved_at:'2026-01-01 03:00:00'};
 const a=analytics([t],start+86400000);assert.equal(a.first_response.average_minutes,60);assert.equal(a.first_response.on_time_percent,0);assert.equal(a.resolution.on_time_percent,100);assert.equal(a.resolution.overdue_pending,0);
 assert.equal(analytics([]).resolution.average_minutes,null);
});
test('schema reopen retains SLA history',()=>{const db=openDatabase(':memory:');assert.ok(db.prepare('PRAGMA table_info(tickets)').all().some(c=>c.name==='resolved_at'));db.close();});
