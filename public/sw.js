// The HTML includes its matching payroll engine, avoiding mixed-version calculations.
const CACHE='wagewise-v12-payslip-import';
const READER='wagewise-reader-v1';
const ASSETS=['/','/index.html','/icon.svg','/manifest.webmanifest','/sync-config.json'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('wagewise-')&&k!==CACHE&&k!==READER).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method==='GET'&&url.origin===self.location.origin&&url.pathname.startsWith('/payslip-reader/v1/')){
    event.respondWith((async()=>{
      const cache=await caches.open(READER),hit=await cache.match(event.request);
      if(hit)return hit;
      const response=await fetch(event.request);
      if(response.ok&&!response.headers.get('Content-Type')?.includes('text/html'))await cache.put(event.request,response.clone());
      return response;
    })());
    return;
  }
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!ASSETS.includes(url.pathname)||url.searchParams.has('code'))return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy)));}
    return response;
  }).catch(()=>caches.match(event.request).then(hit=>hit||(event.request.mode==='navigate'?caches.match('/'):Response.error()))));
});

self.addEventListener('push',event=>{
  const message=event.data?.json();
  if(!message||!/^\d{4}-\d{2}-\d{2}$/.test(message.date))return;
  event.waitUntil(self.registration.showNotification(message.test?'WageWise test notification':'Log your overtime',{
    body:message.test?'Your WageWise reminders are working.':'Add your hours or mark the day as no overtime.',
    icon:'/icon.svg',
    tag:message.test?'wagewise-test':'wagewise-'+message.date,
    data:{date:message.date}
  }));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const date=event.notification.data?.date;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
  event.waitUntil((async()=>{
    const pages=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const page=pages.find(client=>new URL(client.url).origin===self.location.origin);
    if(page){
      await page.focus();
      page.postMessage({type:'wagewise-reminder',date});
    }else await self.clients.openWindow('/?log='+date);
  })());
});
