const CACHE_NAME = 'retroplay-shell-v8';
const CORE = ['/','/index.html','/manifest.webmanifest','/assets/icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await cache.addAll(CORE);
    const response=await fetch('/index.html');
    if(response.ok){
      const html=await response.clone().text();
      const assets=[...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m=>m[1]).filter(u=>u.startsWith('/assets/'));
      await cache.addAll([...new Set(assets)]);
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('retroplay-shell-')&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{if(response.ok)caches.open(CACHE_NAME).then(cache=>cache.put('/index.html',response.clone()));return response;}).catch(()=>caches.match('/index.html')));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(response.ok&&response.type==='basic')caches.open(CACHE_NAME).then(cache=>cache.put(request,response.clone()));return response;})));
});
