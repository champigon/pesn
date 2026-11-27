import {createHash} from 'node:crypto';
import {readdir,readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {icons} from './icons.mjs';

export function parseSong(filename,raw){
  const normalized=raw.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const lines=normalized.split('\n'),title=lines.shift().trim(),text=lines.join('\n').trim();
  if(!title||title.length>200||!text||text.length>100000)throw new Error(`${filename}: в первой строке нужно название (до 200 символов), далее непустой текст песни (до 100 000 символов).`);
  const stem=filename.slice(0,-4);
  const id=/^[a-zA-Z0-9_-]{1,80}$/.test(stem)?stem:'song-'+createHash('sha256').update(filename.normalize('NFC')).digest('hex').slice(0,24);
  return {id,title,text};
}
export function makeCatalog(songs,updatedAt=new Date().toISOString()){
  const sorted=[...songs].sort((a,b)=>a.id.localeCompare(b.id,'en'));
  if(new Set(sorted.map(s=>s.id)).size!==sorted.length)throw new Error('Два файла имеют одинаковый идентификатор песни. Измените имя одного файла.');
  if(sorted.length>2000)throw new Error('Слишком много песен (максимум 2000).');
  const version=createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0,12);
  return {version,updatedAt,songs:sorted};
}
export async function build(root=fileURLToPath(new URL('../',import.meta.url))){
  const source=path.join(root,'web'),destination=path.join(root,'dist');
  const entries=await readdir(path.join(root,'songs'),{withFileTypes:true});
  const songs=[];
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    if(entry.isFile()&&entry.name.toLowerCase().endsWith('.txt')){
      const raw=await readFile(path.join(root,'songs',entry.name),'utf8');
      if(!raw.trim()){
        console.warn(`Пропущен пустой файл songs/${entry.name}. Заполните название и текст, чтобы добавить песню.`);
        continue;
      }
      songs.push(parseSong(entry.name,raw));
    }
  }
  const catalog=makeCatalog(songs);
  // Validate all songs before touching the previous successful build.
  await mkdir(destination,{recursive:true});
  const files=(await readdir(source,{withFileTypes:true})).filter(e=>e.isFile()&&!Object.hasOwn(icons,e.name)).map(e=>e.name).sort();
  const hash=createHash('sha256');
  hash.update(JSON.stringify(icons));
  for(const file of files){hash.update(file);hash.update(await readFile(path.join(source,file)));}
  const shellVersion=hash.digest('hex').slice(0,16);
  for(const file of files){
    if(file==='sw.js'){
      const script=(await readFile(path.join(source,file),'utf8')).replaceAll('__SHELL_VERSION__',shellVersion);
      await writeFile(path.join(destination,file),script);
    }else await copyFile(path.join(source,file),path.join(destination,file));
  }
  for(const [name,base64] of Object.entries(icons))await writeFile(path.join(destination,name),Buffer.from(base64,'base64'));
  await writeFile(path.join(destination,'catalog.json'),JSON.stringify(catalog));
  await writeFile(path.join(destination,'.nojekyll'),'');
  return catalog;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{const catalog=await build();console.log(`Собрано песен: ${catalog.songs.length}. Версия сборника: ${catalog.version}. Файлы: dist/`);}catch(error){console.error(error.message);process.exitCode=1;}
}
