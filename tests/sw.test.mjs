import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
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
