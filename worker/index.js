// โค้ดเสริมที่ next-pwa รวมเข้า service worker (customWorkerDir = "worker")
// SW รุ่นก่อนเก็บ /api/* ไว้ในแคช "apis" และคำขอข้ามโดเมน (Firestore/Firebase Auth) ไว้ใน "cross-origin"
// (NetworkFirst ไม่แยกบัญชี) — ตอนนี้ไม่ผ่านแคชแล้ว จึงล้างสำเนาเก่าที่อาจมีข้อมูลส่วนตัวทิ้งตอน SW ใหม่เริ่มทำงาน (SEC-06)
// ชื่อต้องตรงกับ PRIVATE_CACHE_NAMES ใน src/lib/privateCache.ts
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all(['apis', 'cross-origin'].map((name) => caches.delete(name))))
})
