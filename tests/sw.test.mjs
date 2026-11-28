import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {updateApplication,DEFAULT_SPEED,migrateSettings} from '../web/storage.js';
const code=await readFile(new URL('../web/sw.js',import.meta.url),'utf8');
test('offline shell works under GitHub project path; catalog always bypasses cache',async()=>{
  const handlers={},lookups=[];let network=0;
  const self={location:{href:'https://user.github.io/pesennik/sw.js'},addEventListener:(name,handler)=>handlers[name]=handler};
  vm.runInContext(code,vm.createContext({self,URL,Response,caches:{open:async()=>({match:async url=>{lookups.push(url);return new Response('offline');}})},fetch:async()=>{network++;throw new Error('offline')}}));
  for(const file of ['','index.html','reader.js','storage.js']){
    let promise;handlers.fetch({request:new Request('https://user.github.io/pesennik/'+file),respondWith:value=>promise=value});assert.equal(await(await promise).text(),'offline');
  }
  assert.equal(network,0);assert.ok(lookups.every(url=>url.startsWith('https://user.github.io/pesennik/')));
  for(const url of ['https://user.github.io/pesennik/catalog.json','https://user.github.io/pesennik/catalog.json?t=123','https://user.github.io/another/index.html']){
    let intercepted=false;handlers.fetch({request:new Request(url),respondWith:()=>intercepted=true});assert.equal(intercepted,false);
  }
});

test('activation requires an explicit update message; installation downloads fresh shell',async()=>{
  const handlers={};let skipped=0,requests;
  const self={location:{href:'https://example.org/sw.js'},addEventListener:(name,handler)=>handlers[name]=handler,skipWaiting:async()=>{skipped++;}};
  vm.runInContext(code,vm.createContext({self,URL,Request,caches:{open:async()=>({addAll:async list=>{requests=list;}})}}));
  let pending;handlers.install({waitUntil:promise=>pending=promise});await pending;
  assert.equal(skipped,0);assert.ok(requests.length>5);assert.ok(requests.every(request=>request.cache==='reload'));
  handlers.message({data:'SKIP_WAITING',waitUntil:promise=>pending=promise});await pending;assert.equal(skipped,1);
});

function updateFixture({installing=false,fail=false,stuck=false}={}){
  const workers=new EventTarget();workers.controller={old:true};
  const worker=new EventTarget();worker.state=installing?'installing':'installed';
  let messages=0,checks=0,reloads=0;
  const registration={installing:installing?worker:null,waiting:installing?null:worker,update:async()=>{
    checks++;if(fail)throw new TypeError('offline');
    if(installing)setTimeout(()=>{worker.state='installed';registration.waiting=worker;registration.installing=null;worker.dispatchEvent(new Event('statechange'));},0);
  }};
  workers.getRegistration=async()=>registration;
  worker.postMessage=message=>{
    assert.equal(message,'SKIP_WAITING');messages++;
    if(!stuck){workers.controller=worker;workers.dispatchEvent(new Event('controllerchange'));workers.dispatchEvent(new Event('controllerchange'));}
  };
  return {workers,registration,worker,apply:()=>{reloads++;},counts:()=>({messages,checks,reloads})};
}
test('button applies a waiting worker and reloads once after control changes',async()=>{
  const f=updateFixture();assert.equal(await updateApplication(f.workers,f.apply),true);
  assert.deepEqual(f.counts(),{messages:1,checks:1,reloads:1});
});
test('button waits for the complete installation before activating',async()=>{
  const f=updateFixture({installing:true});assert.equal(await updateApplication(f.workers,f.apply),true);
  assert.deepEqual(f.counts(),{messages:1,checks:1,reloads:1});
});
test('unchanged application does not reload',async()=>{
  const f=updateFixture();f.registration.waiting=null;
  assert.equal(await updateApplication(f.workers,f.apply),false);assert.equal(f.counts().reloads,0);
});
test('network failure or activation timeout does not reload',async()=>{
  for(const options of [{fail:true},{stuck:true}]){
    const f=updateFixture(options);await assert.rejects(updateApplication(f.workers,f.apply,20));
    assert.equal(f.counts().reloads,0);
    f.workers.controller=f.worker;f.workers.dispatchEvent(new Event('controllerchange'));
    assert.equal(f.counts().reloads,0);
  }
});
test('failed installation cannot activate or reload',async()=>{
  const f=updateFixture({installing:true});f.worker.state='redundant';
  await assert.rejects(updateApplication(f.workers,f.apply),/загрузить/);
  assert.equal(f.counts().messages,0);assert.equal(f.counts().reloads,0);
});
test('default is 15; saved individual speeds and font survive the update',()=>{
  assert.equal(DEFAULT_SPEED,15);
  const settings={font:34,speeds:{one:20,two:26},speedResetVersion:1};
  assert.deepEqual(migrateSettings(settings),{settings,changed:false});
});
