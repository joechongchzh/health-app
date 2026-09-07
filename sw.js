// Static-file cache only. No health records, credentials, or API responses are cached here.
const VERSION = '2.8.4';
const CACHE = 'health-single-html-'+VERSION;
const ROOT = new URL('./', self.location).href;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch(ROOT, {cache:'reload'});
    if(!response.ok || !(await response.clone().text()).includes('content="'+VERSION+'"')) throw Error('New HTML not available');
    await (await caches.open(CACHE)).put(ROOT,response);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Only this app's caches; never clear IndexedDB or localStorage.
    for(const key of await caches.keys()) if(key!==CACHE && (key.startsWith('health-single-html-') || key.includes(self.registration.scope))) await caches.delete(key);
    await self.clients.claim();
    for(const client of await self.clients.matchAll({type:'window'}))if(client.url.startsWith(ROOT))client.postMessage({type:'HEALTH_APP_UPDATE',version:VERSION});
  })());
});
self.addEventListener('fetch', event => {
  const url=new URL(event.request.url);
  if(event.request.mode!=='navigate' || url.origin!==self.location.origin || !url.href.startsWith(ROOT)) return;
  event.respondWith((async () => {
    try {
      const response=await fetch(event.request,{cache:'no-cache'});
      // A newer valid HTML release must not be rejected by an older worker.
      if(response.ok && /<meta name="health-app-version" content="\d+\.\d+\.\d+">/.test(await response.clone().text())){
        await (await caches.open(CACHE)).put(ROOT,response.clone());return response;
      }
    } catch {}
    return (await caches.match(ROOT)) || Response.error();
  })());
});
