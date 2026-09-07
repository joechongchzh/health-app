// Static-file cache only. No health records, credentials, or API responses are cached here.
const CACHE = 'health-single-html-2.8.0';
const ROOT = new URL('./', self.location).href;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch(ROOT, {cache:'reload'});
    if(!response.ok || !(await response.clone().text()).includes('content="2.8.0"')) throw Error('New HTML not available');
    await (await caches.open(CACHE)).put(ROOT,response);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Only this app's caches; never clear IndexedDB or localStorage.
    for(const key of await caches.keys()) if(key!==CACHE && (key.startsWith('health-single-html-') || key.includes(self.registration.scope))) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url=new URL(event.request.url);
  if(event.request.mode!=='navigate' || url.origin!==self.location.origin || !url.href.startsWith(ROOT)) return;
  event.respondWith((async () => {
    try {
      const response=await fetch(event.request,{cache:'no-cache'});
      if(response.ok && (await response.clone().text()).includes('content="2.8.0"')){
        await (await caches.open(CACHE)).put(ROOT,response.clone());return response;
      }
    } catch {}
    return (await caches.match(ROOT)) || Response.error();
  })());
});
