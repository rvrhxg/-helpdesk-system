// CI acceptance against a disposable Docker volume; no user database or container is touched.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const suffix=randomBytes(8).toString('hex');
const name=`relay-ci-${suffix}`,volume=`relay-ci-data-${suffix}`;
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
let containerCreated=false,volumeCreated=false;
try {
  docker('volume','create',volume);volumeCreated=true;
  docker('run','-d','--name',name,'-p','127.0.0.1::3000','-v',`${volume}:/data`,'helpdesk-test');containerCreated=true;
  let base;
  const wait=async()=>{
    base=`http://${docker('port',name,'3000/tcp').split('\n')[0]}`;
    for(let i=0;i<40;i++){
      try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)});if(r.ok)return;}catch{}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw new Error('Container did not become healthy');
  };
  await wait();
  const request=(path,data,cookie)=>fetch(base+'/api'+path,{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(data)});
  const credentials={email:'ci@example.test',name:'CI Client',password:randomBytes(24).toString('hex')};
  const registered=await request('/auth/register',credentials);assert.equal(registered.status,201);
  const cookie=registered.headers.get('set-cookie').split(';')[0];
  const ticket=await request('/tickets',{subject:'Container persistence',description:'Created before restart'},cookie);assert.equal(ticket.status,201);
  const {id}=await ticket.json();
  docker('restart',name);await wait();
  const loggedIn=await request('/auth/login',credentials);assert.equal(loggedIn.status,200);
  const recovered=await fetch(base+`/api/tickets/${id}`,{headers:{cookie:loggedIn.headers.get('set-cookie').split(';')[0]}});
  assert.equal(recovered.status,200);assert.equal((await recovered.json()).subject,'Container persistence');
  assert.equal(docker('exec',name,'id','-u'),'1000');
  console.log('Container HTTP, non-root user and persistent-volume checks passed.');
}catch(error){
  if(containerCreated) console.error(docker('logs',name));
  throw error;
}finally{
  if(containerCreated)docker('rm','-f',name);
  if(volumeCreated)docker('volume','rm',volume);
}
