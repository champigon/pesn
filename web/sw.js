const BASE=new URL('./',self.location.href);
const PREFIX='pesennik-shell:'+BASE.pathname+':';
const CACHE=PREFIX+'__SHELL_VERSION__';
const READY=new URL('__shell_ready__',BASE).href;
const SHELL=['./','index.html','reader.css','reader.js','storage.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png'].map(file=>new URL(file,BASE).href);
let preparing;
async function complete(cache){return (await Promise.all(SHELL.map(url=>cache.match(url)))).every(Boolean);}
async function markedCache(){
  const keys=(await caches.keys()).filter(key=>key.startsWith(PREFIX));
  for(const key of keys.reverse()){
    const cache=await caches.open(key);
    if(await cache.match(READY))return cache;
  }
  return null;
}
async function readableCache(){
  const current=await caches.open(CACHE);
  return await current.match(READY)?current:await markedCache();
}
async function prune(){
  for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);
}
async function prepareCurrentShell(){
  if(preparing)return preparing;
  preparing=(async()=>{
    const cache=await caches.open(CACHE);
    if(await cache.match(READY)&&await complete(cache))return {complete:true,changed:false};
    // Only first installation, the one-time migration, or an explicit button message gets here.
    // Cache.addAll commits the entire download together; mark it ready only after success.
    await cache.addAll(SHELL.map(url=>new Request(url,{cache:'reload'})));
    await cache.put(READY,new Response('ready'));
    return {complete:true,changed:true};
  })();
  try{return await preparing;}finally{preparing=null;}
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  // Browser update checks may install this worker in the background. Keep the previous
  // complete application and fetch no new assets until the user presses the button.
  // Unmarked caches belong to the older release: upgrade them once to this protocol.
  if(!await markedCache())await prepareCurrentShell();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  if(await cache.match(READY))await prune();
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{
  if(event.data==='SKIP_WAITING'){
    event.waitUntil(prepareCurrentShell().then(()=>self.skipWaiting()));return;
  }
  if(event.data==='PREPARE_SHELL'){
    event.waitUntil((async()=>{
      try{
        const result=await prepareCurrentShell();
        if(!self.registration.waiting&&!self.registration.installing)await prune();
        event.ports[0]?.postMessage(result);
      }catch{event.ports[0]?.postMessage({complete:false,error:'Не удалось загрузить новую версию приложения. Сохранённые песни остаются на телефоне. Попробуйте ещё раз.'});}
    })());return;
  }
  if(event.data==='SHELL_STATUS')event.waitUntil((async()=>{
    const cache=await readableCache();
    event.ports[0]?.postMessage({complete:!!cache&&await complete(cache)});
  })());
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url),canonical=url.origin+url.pathname;
  // The reader requests this only on first setup or after pressing the update button.
  if(event.request.method==='GET'&&canonical===new URL('catalog.json',BASE).href)return;
  event.respondWith((async()=>{
    const cache=await readableCache();
    const cached=event.request.method==='GET'&&SHELL.includes(canonical)&&await cache?.match(canonical);
    // Never silently recover a missing asset from the network during normal use.
    return cached?new Response(cached.body,{status:cached.status,statusText:cached.statusText,headers:cached.headers}):new Response('Файл приложения не сохранён. Нажмите «Обновить сборник» с интернетом.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  })());
});
