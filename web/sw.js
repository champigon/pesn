const BASE=new URL('./',self.location.href);
const PREFIX='pesennik-shell:'+BASE.pathname+':';
const CACHE=PREFIX+'__SHELL_VERSION__';
const SHELL=['./','index.html','reader.css','reader.js','storage.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png'].map(file=>new URL(file,BASE).href);
// Fetch a coherent fresh shell, bypassing HTTP-cached files from a previous release.
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL.map(url=>new Request(url,{cache:'reload'}))))));
// Updates wait until all readers are closed. Never reload an open song.
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{
  if(event.data==='SHELL_STATUS')event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    const complete=(await Promise.all(SHELL.map(url=>cache.match(url)))).every(Boolean);
    event.ports[0]?.postMessage({complete});
  })());
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  // catalog.json is deliberately absent: only the update button or first download fetches it.
  const canonical=url.origin+url.pathname;
  if(event.request.method!=='GET'||!SHELL.includes(canonical))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE),cached=await cache.match(canonical);
    return cached?new Response(cached.body,{status:cached.status,statusText:cached.statusText,headers:cached.headers}):fetch(event.request);
  })());
});
