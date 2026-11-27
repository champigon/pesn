import {test} from 'node:test';
import assert from 'node:assert/strict';
import {downloadCatalog,validCatalog} from '../web/storage.js';
const original={version:3,updatedAt:'2026-11-27T12:00:00Z',songs:[{id:'one',title:'Песня',text:'Куплет\n\nПрипев'}]};
test('validates full snapshots, duplicate IDs and missing text',()=>{
  assert.ok(validCatalog(original));assert.ok(validCatalog({...original,songs:[]}));
  assert.equal(validCatalog({...original,songs:[...original.songs,...original.songs]}),false);
  assert.equal(validCatalog({...original,songs:[{id:'one',title:'Песня'}]}),false);
  assert.equal(validCatalog({...original,version:0}),false);
});
test('atomic replacement includes additions, removals and metadata',async()=>{
  let writes=0,saved;const next={...original,version:4,songs:[{id:'new',title:'Новая',text:'Текст'}]};
  const result=await downloadCatalog(original,async(key,value)=>{writes++;assert.equal(key,'snapshot');saved=value;},async(url,options)=>{assert.ok(new URL(url).pathname.endsWith('/catalog.json'));assert.ok(new URL(url).searchParams.has('t'));assert.equal(options.cache,'no-store');return Response.json(next);});
  assert.equal(writes,1);assert.deepEqual(saved.catalog,next);assert.ok(Date.parse(saved.downloadedAt));assert.equal(result.unchanged,false);
});
test('bad data, interrupted JSON and network error never write',async()=>{
  for(const fetcher of [async()=>Response.json({...original,songs:[{}]}),async()=>new Response('{'),async()=>{throw new TypeError('offline')},async()=>new Response('',{status:503})]){
    let writes=0;await assert.rejects(downloadCatalog(original,async()=>{writes++},fetcher));assert.equal(writes,0);
  }
});
test('storage failure does not return a successful update',async()=>{
  await assert.rejects(downloadCatalog(original,async()=>{throw new Error('QuotaExceeded')},async()=>Response.json(original)),/QuotaExceeded/);
});
test('same version reports unchanged after successful storage',async()=>{
  assert.equal((await downloadCatalog(original,async()=>{},async()=>Response.json(original))).unchanged,true);
});
