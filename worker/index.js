// โค้ดเสริมที่ next-pwa รวมเข้า service worker (customWorkerDir = "worker")
// SW รุ่นก่อนเก็บ /api/* ไว้ในแคช "apis" และคำขอข้ามโดเมน (Firestore/Firebase Auth) ไว้ใน "cross-origin"
// (NetworkFirst ไม่แยกบัญชี) — ตอนนี้ไม่ผ่านแคชแล้ว จึงล้างสำเนาเก่าที่อาจมีข้อมูลส่วนตัวทิ้งตอน SW ใหม่เริ่มทำงาน (SEC-06)
// ชื่อต้องตรงกับ PRIVATE_CACHE_NAMES ใน src/lib/privateCache.ts
// หน้าใบงาน /driver/{tripId}?t=token ที่กฎ "others" (NetworkFirst) อาจเคยเก็บไว้ — URL มี token จึงลบทิ้งด้วย
async function dropDriverTicketPages() {
  const cache = await caches.open('others')
  const requests = await cache.keys()
  await Promise.all(requests.filter((req) => new URL(req.url).pathname.startsWith('/driver/')).map((req) => cache.delete(req)))
}

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([...['apis', 'cross-origin'].map((name) => caches.delete(name)), dropDriverTicketPages()]))
})

// แตะ popup "ฝากของไปไซต์" ที่สร้างผ่าน service worker (Android) → โฟกัสแท็บที่เปิดอยู่แล้วไปหน้าฝากของ หรือเปิดหน้าต่างใหม่
self.addEventListener('notificationclick', (event) => {
  const url = event.notification.data && event.notification.data.url
  if (!event.notification.tag.startsWith('parcel-watch') || !url) return
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
      // แท็บที่ SW ยังไม่คุม navigate ไม่ได้ → เปิดหน้าต่างใหม่แทน
      if (open) return open.focus().then((w) => w.navigate(url)).catch(() => self.clients.openWindow(url))
      return self.clients.openWindow(url)
    })
  )
})
