/** Optional worker asset; the application never registers it automatically. */
const worker = `self.addEventListener('push', event => {
  let data; try { data = event.data.json(); } catch { return; }
  if (!data || data.title !== 'Portal escolar' || data.body !== 'Tienes un aviso en tu portal escolar. Inicia sesión para consultarlo.' || !/^[A-Za-z0-9_-]{32}$/.test(data.tag)) return;
  let url; try { url = new URL(data.url); } catch { return; }
  if (url.origin !== self.location.origin || url.pathname !== '/' || url.search || url.hash) return;
  event.waitUntil(self.registration.showNotification('Portal escolar', {body:data.body, tag:data.tag, data:{url:url.href}}));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  let url; try { url = new URL(event.notification.data.url); } catch { return; }
  if (url.origin !== self.location.origin || url.pathname !== '/' || url.search || url.hash) return;
  event.waitUntil(self.clients.openWindow(url.href));
});`;
export async function GET() { return new Response(worker,{headers:{"Content-Type":"application/javascript; charset=utf-8","Cache-Control":"no-store","Service-Worker-Allowed":"/","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; script-src 'self'"}}); }
