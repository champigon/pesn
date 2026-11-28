import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {updateApplication,DEFAULT_SPEED,migrateSettings,shellRegistration,validCatalog} from '../web/storage.js';
const code=await readFile(new URL('../web/sw.js',import.meta.url),'utf8');
const base='https://user.github.io/pesennik/';
const files=['','index.html','reader.css','reader.js','storage.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png'];
function workerFixture({installed=true,missing=null,fail=false}={}){
  const handlers={},stores=new Map(),requests=[];let network=0,skipped=0,claimed=0;
  if(installed)stores.set('pesennik-shell:/pesennik/:previous',new Map([...files.filter(file=>file!==missing).map(file=>[base+file,new Response('offline '+file)]),[base+'__shell_ready__',new Response('ready')]]));
  const caches={keys:async()=>[...stores.keys()],delete:async key=>stores.delete(key),open:async key=>{
    if(!stores.has(key))stores.set(key,new Map());const store=stores.get(key);
    return {match:async url=>store.get(url)?.clone(),put:async(url,response)=>{store.set(url,response.clone());},addAll:async list=>{
      network+=list.length;requests.push(...list);if(fail)throw new TypeError('offline');
      for(const request of list)store.set(request.url,new Response('new '+request.url));
    }};
  }};
  const self={location:{href:base+'sw.js'},registration:{waiting:null,installing:null},clients:{claim:async()=>{claimed++;}},addEventListener:(name,handler)=>handlers[name]=handler,skipWaiting:async()=>{skipped++;}};
  vm.runInContext(code,vm.createContext({self,URL,Request,Response,caches,fetch:async()=>{network++;throw new Error('Unexpected network');}}));
  return {handlers,stores,requests,self,counts:()=>({network,skipped,claimed}),event:async(name,data={})=>{
    let pending;handlers[name]({...data,waitUntil:promise=>pending=promise});await pending;
  },request:async(file)=>{
    let response;handlers.fetch({request:new Request(new URL(file,base)),respondWith:promise=>response=promise});return response?await response:null;
  }};
}

test('installed app serves launch, scripts, styles, icons and manifest locally',async()=>{
  const f=workerFixture();
  for(const file of files)assert.equal(await(await f.request(file)).text(),'offline '+file);
  assert.equal(f.counts().network,0);
  assert.equal(await f.request('catalog.json?t=123'),null);
});
test('missing files and unexpected requests never fall back to the network',async()=>{
  const f=workerFixture({missing:'reader.css'});
  for(const file of ['reader.css','unknown.js','https://another.example/script.js'])assert.equal((await f.request(file)).status,503);
  assert.equal(f.counts().network,0);
});
test('browser installs and activates a background worker without downloading app assets',async()=>{
  const f=workerFixture();await f.event('install');await f.event('activate');
  assert.deepEqual(f.counts(),{network:0,skipped:0,claimed:1});
  assert.equal(await(await f.request('reader.js')).text(),'offline reader.js');
  assert.equal(f.stores.has('pesennik-shell:/pesennik/:previous'),true);
});
test('first installation downloads a full fresh offline shell',async()=>{
  const f=workerFixture({installed:false});await f.event('install');
  assert.equal(f.counts().network,files.length);assert.ok(f.requests.every(request=>request.cache==='reload'));
  await f.event('activate');assert.equal((await f.request('reader.js')).status,200);
});
test('only explicit preparation downloads an updated shell, then ordinary requests stay local',async()=>{
  const f=workerFixture();await f.event('install');await f.event('activate');let result;
  await f.event('message',{data:'PREPARE_SHELL',ports:[{postMessage:value=>result=value}]});
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{complete:true,changed:true});
  assert.equal(f.counts().network,files.length);assert.equal(f.stores.has('pesennik-shell:/pesennik/:previous'),false);
  assert.match(await(await f.request('reader.js')).text(),/^new /);
  await f.event('message',{data:'PREPARE_SHELL',ports:[{postMessage:value=>result=value}]});
  assert.equal(result.changed,false);assert.equal(f.counts().network,files.length);
});
test('failed manual shell download keeps the previous complete app usable',async()=>{
  const f=workerFixture({fail:true});await f.event('install');await f.event('activate');let result;
  await f.event('message',{data:'PREPARE_SHELL',ports:[{postMessage:value=>result=value}]});
  assert.equal(result.complete,false);assert.equal(await(await f.request('reader.js')).text(),'offline reader.js');
});
test('older update button can still prepare and activate this worker',async()=>{
  const f=workerFixture();await f.event('install');assert.equal(f.counts().network,0);
  await f.event('message',{data:'SKIP_WAITING'});assert.equal(f.counts().skipped,1);assert.equal(f.counts().network,files.length);
});

function updateFixture({installing=false,fail=false,stuck=false,prepared=false}={}){
  const workers=new EventTarget();workers.controller={old:true};
  const worker=new EventTarget();worker.state=installing?'installing':'installed';
  let messages=0,checks=0,reloads=0;
  const registration={installing:installing?worker:null,waiting:installing?null:worker,active:worker,update:async()=>{
    checks++;if(fail)throw new TypeError('offline');
    if(installing)setTimeout(()=>{worker.state='installed';registration.waiting=worker;registration.installing=null;worker.dispatchEvent(new Event('statechange'));},0);
  }};
  workers.getRegistration=async()=>registration;
  worker.postMessage=(message,ports)=>{
    if(message==='PREPARE_SHELL'){ports[0].postMessage({complete:true,changed:prepared});return;}
    assert.equal(message,'SKIP_WAITING');messages++;
    if(!stuck){workers.controller=worker;workers.dispatchEvent(new Event('controllerchange'));workers.dispatchEvent(new Event('controllerchange'));}
  };
  return {workers,registration,worker,apply:()=>{reloads++;},counts:()=>({messages,checks,reloads})};
}
test('startup lookup never calls register or update for an installed app',async()=>{
  const registration={update:()=>assert.fail('Unexpected update')};
  const workers={getRegistration:async()=>registration,register:()=>assert.fail('Unexpected registration')};
  assert.equal(await shellRegistration(workers),registration);
});
test('first setup registers the offline shell once',async()=>{
  let calls=0;const registration={};
  const workers={getRegistration:async()=>undefined,register:async(url,options)=>{calls++;assert.ok(url.href.endsWith('/web/sw.js'));assert.equal(options.updateViaCache,'none');return registration;}};
  assert.equal(await shellRegistration(workers),registration);assert.equal(calls,1);
});
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
test('already activated background worker prepares its files only on the button and reloads',async()=>{
  const f=updateFixture({prepared:true});f.registration.waiting=null;
  assert.equal(await updateApplication(f.workers,f.apply),true);assert.equal(f.counts().reloads,1);assert.equal(f.counts().messages,0);
});
test('network failure or activation timeout does not reload',async()=>{
  for(const options of [{fail:true},{stuck:true}]){
    const f=updateFixture(options);await assert.rejects(updateApplication(f.workers,f.apply,30));
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

test('reader startup, search, opening a song, returning and resuming never request the network',async()=>{
  const source=(await readFile(new URL('../web/reader.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/,'');
  const elements=new Map(),windowEvents={},documentEvents={};let downloads=0,updates=0,registrations=0;
  function element(){return {value:'',hidden:false,children:[],handlers:{},style:{},scrollTop:0,scrollHeight:2000,clientHeight:600,addEventListener(name,handler){this.handlers[name]=handler;},setAttribute(){},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];}};}
  const document={hidden:false,title:'',getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,body:{style:{}},documentElement:{style:{setProperty(){}}},addEventListener:(name,handler)=>documentEvents[name]=handler};
  const catalog={version:1,updatedAt:'2026-11-28T00:00:00Z',songs:[{id:'song',title:'Песня',text:'Куплет\nПрипев'}]};
  class LocalChannel {constructor(){this.port1={};this.port2={postMessage:data=>this.port1.onmessage?.({data})};}}
  const workers={getRegistration:async()=>({active:{postMessage:(_,ports)=>ports[0].postMessage({complete:true})}}),register:()=>{registrations++;assert.fail('Unexpected registration');}};
  const location={hash:'',pathname:'/pesennik/'};
  const context={document,location,history:{replaceState:()=>{location.hash='';}},window:{addEventListener:(name,handler)=>windowEvents[name]=handler},navigator:{serviceWorker:workers,wakeLock:{request:async()=>({release:async()=>{},addEventListener(){}})}},
    get:async key=>key==='snapshot'?{catalog,downloadedAt:catalog.updatedAt}:{font:28,speeds:{},speedResetVersion:1},put:async()=>{},validCatalog,migrateSettings,DEFAULT_SPEED,shellRegistration,
    downloadCatalog:async()=>{downloads++;return {snapshot:{catalog,downloadedAt:catalog.updatedAt},unchanged:true};},updateApplication:async()=>{updates++;return false;},
    fetch:()=>assert.fail('Unexpected fetch'),MessageChannel:LocalChannel,setTimeout:()=>1,clearTimeout(){},requestAnimationFrame(){},URL,performance:{now:()=>0}};
  vm.runInContext(source,vm.createContext(context));await new Promise(resolve=>setImmediate(resolve));
  elements.get('search').value='Пес';elements.get('search').handlers.input();
  elements.get('songs').children[0].handlers.click();windowEvents.hashchange();
  elements.get('back').handlers.click();document.hidden=true;documentEvents.visibilitychange();document.hidden=false;documentEvents.visibilitychange();
  assert.equal(downloads,0);assert.equal(updates,0);assert.equal(registrations,0);
  await elements.get('update').handlers.click();assert.equal(downloads,1);assert.equal(updates,1);
});
