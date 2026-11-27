import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {build,parseSong,makeCatalog} from '../scripts/build.mjs';
import {validCatalog} from '../web/storage.js';

test('first line is title; BOM, CRLF and verse breaks survive parsing',()=>{
  const song=parseSong('song-001.txt','\uFEFFПервая песня\r\n\r\nКуплет\r\nСтрока\r\n\r\nПрипев\r\n');
  assert.deepEqual(song,{id:'song-001',title:'Первая песня',text:'Куплет\nСтрока\n\nПрипев'});
});
test('stable filename preserves ID when title changes; Cyrillic names are supported',()=>{
  assert.equal(parseSong('Песня.txt','Название\nТекст').id,parseSong('Песня.txt','Другое\nИной текст').id);
  assert.ok(validCatalog(makeCatalog([parseSong('Песня.txt','Название\nТекст')])));
});
test('empty titles or lyrics reject publication',()=>{
  for(const text of ['','\nТекст','Название\n\n','x'.repeat(201)+'\nТекст'])assert.throws(()=>parseSong('broken.txt',text));
});
test('version depends on content, not build time or file order; empty catalog allowed',()=>{
  const a=parseSong('a.txt','А\nТекст'),b=parseSong('b.txt','Б\nТекст');
  const first=makeCatalog([a,b],'2026-01-01T00:00:00Z');
  assert.equal(first.version,makeCatalog([b,a],'2026-02-01T00:00:00Z').version);
  assert.notEqual(first.version,makeCatalog([a,{...b,text:'Новый текст'}]).version);
  assert.notEqual(first.version,makeCatalog([a]).version);
  assert.ok(validCatalog(makeCatalog([])));
  assert.throws(()=>makeCatalog([a,a]));
});
test('production build contains a validated snapshot and only relative public links',async()=>{
  const catalog=await build();
  const files=(await readdir(new URL('../songs/',import.meta.url))).filter(name=>name.toLowerCase().endsWith('.txt'));
  assert.equal(catalog.songs.length,files.length);assert.ok(validCatalog(catalog));
  const built=JSON.parse(await readFile(new URL('../dist/catalog.json',import.meta.url),'utf8'));
  assert.deepEqual(built,catalog);
  const page=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.equal(/(?:href|src)="\//.test(page),false);
  const manifest=JSON.parse(await readFile(new URL('../dist/manifest.webmanifest',import.meta.url),'utf8'));
  assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');
  const sw=await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');
  assert.equal(sw.includes('__SHELL_VERSION__'),false);
  for(const name of ['reader.js','storage.js','icon-192.png','icon-512.png'])assert.ok((await readFile(new URL('../dist/'+name,import.meta.url))).byteLength>0);
});
