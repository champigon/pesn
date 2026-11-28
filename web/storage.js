export const DEFAULT_SPEED=15;
let dbPromise;
function database() {
  if (!dbPromise) dbPromise = new Promise((resolve,reject)=>{
    const request = indexedDB.open('pesennik:'+new URL('./',import.meta.url).pathname,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('state');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error('Не удалось открыть хранилище телефона. Разрешите сохранение данных сайта.'));
    request.onblocked=()=>reject(new Error('Закройте другие вкладки Песенника и попробуйте снова.'));
  });
  return dbPromise;
}
export async function get(key) {
  const db = await database();
  return new Promise((resolve,reject)=>{
    const request = db.transaction('state').objectStore('state').get(key);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
export async function put(key,value) {
  const db = await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('state','readwrite');
    tx.objectStore('state').put(value,key);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(new Error('Не удалось сохранить сборник. Возможно, память телефона заполнена.'));
  });
}
export function migrateSettings(preferences) {
  const changed=preferences?.speedResetVersion!==1;
  const settings={font:Number.isFinite(preferences?.font)?Math.min(44,Math.max(22,preferences.font)):28,speeds:{},speedResetVersion:1};
  for(const [id,speed] of Object.entries(preferences?.speeds??{})){
    if(Number.isFinite(speed))settings.speeds[id]=changed?20:Math.min(40,Math.max(2,speed));
  }
  return {settings,changed};
}
export function validCatalog(c) {
  const versionOk=c&&((Number.isInteger(c.version)&&c.version>=1)||(typeof c.version==='string'&&/^[a-f0-9]{12}$/.test(c.version)));
  if (!versionOk || typeof c.updatedAt !== 'string' || !Number.isFinite(Date.parse(c.updatedAt)) || !Array.isArray(c.songs) || c.songs.length > 2000) return false;
  const ids=new Set();
  return c.songs.every(s=>{
    if (!s || typeof s.id!=='string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(s.id) || ids.has(s.id) || typeof s.title!=='string' || !s.title.trim() || s.title.length>200 || typeof s.text!=='string' || !s.text.trim() || s.text.length>100000) return false;
    ids.add(s.id); return true;
  });
}
export async function downloadCatalog(current, save=put, fetcher=fetch) {
  const url=new URL('catalog.json',import.meta.url);
  url.searchParams.set('t',Date.now().toString());
  const response=await fetcher(url.href,{cache:'no-store',signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error('Сервер временно недоступен. Сохранённые песни остаются на телефоне.');
  const catalog=await response.json();
  if (!validCatalog(catalog)) throw new Error('Получен неполный сборник. Сохранённые песни остаются на телефоне.');
  // A single IndexedDB transaction replaces the entire snapshot, including its metadata.
  const snapshot={catalog,downloadedAt:new Date().toISOString()};
  await save('snapshot',snapshot);
  return {snapshot,unchanged:current?.version===catalog.version};
}

// Called only by the update button, after the catalog has been safely saved.
export async function shellRegistration(workers) {
  const root=new URL('./',import.meta.url);
  // Looking up an existing registration is local; do not register or update it on launch.
  return await workers.getRegistration(root.href)||workers.register(new URL('sw.js',root),{scope:root.href,updateViaCache:'none'});
}
export async function updateApplication(workers,apply=()=>location.reload(),timeout=25000) {
  if(!workers){apply();return true;}
  const previous=workers.controller,cleanup=[];
  let timer;
  const expired=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Не удалось дождаться обновления приложения. Попробуйте ещё раз.')),timeout);});
  const wait=promise=>Promise.race([promise,expired]);
  const listen=(target,event,handler)=>{target.addEventListener(event,handler);cleanup.push(()=>target.removeEventListener(event,handler));};
  try{
    const registration=await wait(shellRegistration(workers));
    await wait(registration.update());
    const installing=registration.installing;
    if(installing)await wait(new Promise((resolve,reject)=>{
      const check=()=>{
        if(installing.state==='redundant')reject(new Error('Не удалось загрузить новую версию приложения. Попробуйте ещё раз.'));
        else if(['installed','activating','activated'].includes(installing.state))resolve();
      };
      listen(installing,'statechange',check);check();
    }));
    const waiting=registration.waiting;
    const target=waiting||registration.active;
    let prepared=false;
    if(target){
      const channel=new MessageChannel();
      cleanup.push(()=>{channel.port1.close();channel.port2.close();});
      const result=await wait(new Promise((resolve,reject)=>{
        channel.port1.onmessage=event=>event.data?.complete?resolve(event.data):reject(new Error(event.data?.error||'Не удалось загрузить приложение. Попробуйте ещё раз.'));
        target.postMessage('PREPARE_SHELL',[channel.port2]);
      }));
      prepared=result.changed;
    }
    if(waiting)await wait(new Promise((resolve,reject)=>{
      const check=()=>{if(workers.controller&&workers.controller!==previous)resolve();};
      listen(workers,'controllerchange',check);
      listen(waiting,'statechange',()=>{if(waiting.state==='redundant')reject(new Error('Не удалось применить обновление приложения. Попробуйте ещё раз.'));});
      waiting.postMessage('SKIP_WAITING');check();
    }));
    if(prepared||(workers.controller&&workers.controller!==previous)){apply();return true;}
    return false;
  }finally{clearTimeout(timer);for(const remove of cleanup)remove();}
}
