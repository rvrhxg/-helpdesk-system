import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../src/server.js';
import { openDatabase } from '../src/database.js';
import { tokenHash } from '../src/security.js';

test('split UTF-8 request chunks preserve Cyrillic and emoji in stored tickets', async () => {
  const db=openDatabase(':memory:');
  db.prepare('INSERT INTO users(email,name,password_hash) VALUES(?,?,?)').run('unicode@example.com','Tester','unused');
  const token='b'.repeat(64);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),1,Date.now()+60000);
  const server=createApp({db});server.listen(0,'127.0.0.1');await once(server,'listening');
  const payload={subject:'Ошибка подключения 🛰️',description:'Здравствуйте! Не удаётся подключиться.'};
  try {
    const bytes=Buffer.from(JSON.stringify(payload));
    const result=await new Promise((resolve,reject)=>{
      const req=http.request({host:'127.0.0.1',port:server.address().port,path:'/api/tickets',method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json',cookie:`session=${token}`}},res=>{
        const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(chunks))}));
      });req.on('error',reject);
      // Split inside the first Cyrillic code point and force distinct writes.
      const split=bytes.indexOf(Buffer.from('О'))+1;
      req.write(bytes.subarray(0,split));setTimeout(()=>req.end(bytes.subarray(split)),20);
    });
    assert.equal(result.status,201);
    assert.equal(result.data.subject,payload.subject);
    assert.equal(result.data.description,payload.description);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
});
