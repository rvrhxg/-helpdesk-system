import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Minimal DOM harness exercises module startup and event handlers without claiming browser/layout coverage.
class Element {
  constructor(tag='div') { this.tag=tag;this.children=[];this.value='';this.textContent='';this.hidden=false;this.classList={toggle(){}}; }
  append(...nodes){ this.children.push(...nodes); }
  replaceChildren(...nodes){ this.children=nodes; }
}
test('frontend initializes dashboard, renders untrusted titles as text, and opens ticket detail', async () => {
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const ids=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  ids.get('auth-form').elements={name:new Element('input'),password:new Element('input')};
  const footer=new Element('footer');
  const ticket={id:1,subject:'<img src=x onerror=alert(1)>',description:'Details',status:'open',priority:'normal',created_at:'2026-11-15 10:00:00'};
  const requests=[];
  const fetch=async path=>{
    requests.push(path);
    const data=path.endsWith('/auth/me')?{id:1,name:'Alice',role:'customer'}:path.endsWith('/stats')?[{status:'open',count:55}]:path.includes('/tickets?')?[ticket]:path.endsWith('/comments')?[]:ticket;
    return {ok:true,headers:{get:()=> '55'},json:async()=>data};
  };
  const document={getElementById:id=>{assert.ok(ids.has(id),`Missing actual HTML id: ${id}`);return ids.get(id);},createElement:tag=>new Element(tag),querySelector:selector=>{assert.equal(selector,'.panel footer');return footer;},querySelectorAll:()=>[]};
  const context=vm.createContext({document,fetch,URLSearchParams,setTimeout,clearTimeout,console});
  // The browser file is a module with top-level await; async wrapper provides equivalent startup scheduling here.
  await vm.runInContext(`(async()=>{${source}\n})()`,context);
  assert.equal(ids.get('dashboard').hidden,false);
  assert.equal(ids.get('metrics').children[0].children[1].textContent,55);
  const link=ids.get('tickets').children[0].children[0].children[1];
  assert.equal(link.textContent,ticket.subject);
  assert.equal(link.children.length,0);
  assert.equal(footer.children[0].disabled,true);
  assert.equal(footer.children[2].disabled,false);
  link.onclick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ids.get('detail').hidden,false);
  assert.ok(requests.includes('/api/tickets/1/comments'));
  assert.equal(ids.get('detail').children[1].textContent,ticket.subject);
});
