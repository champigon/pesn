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
