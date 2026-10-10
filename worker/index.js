// โค้ดเสริมที่ next-pwa รวมเข้า service worker (customWorkerDir = "worker")
// SW รุ่นก่อนเก็บ /api/* ไว้ในแคช "apis" (NetworkFirst 24 ชม. ไม่แยกบัญชี) — ตอนนี้ API เป็น NetworkOnly ทั้งหมดแล้ว
// จึงล้างสำเนาเก่าที่อาจมีข้อมูลส่วนตัวของ staff ทิ้งตอน SW ใหม่เริ่มทำงาน (SEC-06)
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.delete('apis'))
})
