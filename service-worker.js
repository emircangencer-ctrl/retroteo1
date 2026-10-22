const CACHE_NAME = 'retroplay-shell-v10';
const EMULATORJS_CACHE_NAME = 'retroplay-emulatorjs-runtime-v2';
const EMULATORJS_ORIGIN = 'https://cdn.emulatorjs.org';
const EMULATORJS_DATA_PREFIX = '/4.2.3/data/';
const CORE = ['/','/index.html','/manifest.webmanifest','/assets/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await cache.addAll(CORE);
    const response=await fetch('/index.html');
    if(response.ok){
      const html=await response.clone().text();
      const assets=[...html.matchAll(/(?:src|href)=[\"']([^\"']+)[\"']/g)]
        .map(m=>m[1])
        .filter(url=>url.startsWith('/assets/'));
      await cache.addAll([...new Set(assets)]);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>
        (key.startsWith('retroplay-shell-')&&key!==CACHE_NAME) ||
        (key.startsWith('retroplay-emulatorjs-runtime-')&&key!==EMULATORJS_CACHE_NAME)
      ).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);

  // Cache only EmulatorJS's runtime/core path, not the rest of the CDN.
  // These opaque cross-origin resources can be replayed for no-cors script/WASM requests.
  // Bump EMULATORJS_CACHE_NAME when deliberately changing the runtime/cache generation.
  if(url.origin===EMULATORJS_ORIGIN && url.pathname.startsWith(EMULATORJS_DATA_PREFIX)){
    event.respondWith((async()=>{
      const cache=await caches.open(EMULATORJS_CACHE_NAME);
      const cached=await cache.match(request);
      if(cached)return cached;
      const response=await fetch(request);
      if(response && (response.ok || response.type==='opaque')){
        try{await cache.put(request,response.clone());}
        catch(error){console.warn('EmulatorJS runtime cache write failed:',error);}
      }
      return response;
    })());
    return;
  }

  if(url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{
      if(response.ok)caches.open(CACHE_NAME).then(cache=>cache.put('/index.html',response.clone()));
      return response;
    }).catch(()=>caches.match('/index.html')));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    if(response.ok&&response.type==='basic')caches.open(CACHE_NAME).then(cache=>cache.put(request,response.clone()));
    return response;
  })));
});
