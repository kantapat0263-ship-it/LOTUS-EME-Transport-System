# หมายเหตุล่าสุดเมื่อรวมเที่ยว

การรวมงานจากใบขอเข้าทริปเดิมอ่านหมายเหตุและชื่อคนจัดรถจากใบขอใน transaction เดียวกับการจัดจุดหมาย ไม่ใช้ข้อความที่ค้างอยู่ในหน้าต่างรวมเที่ยว ถ้ามีการแก้พร้อมกัน Firestore จะ retry และอ่านค่าจากรอบที่บันทึกผ่าน ข้อความที่ล้างแล้วจะไม่กลับมาจาก dialog

`TripSourceAllocation.assignments` ใช้ `tripStopIndexes` คู่กับ `destinationIndexes` เพื่อชี้เฉพาะจุดใหม่ของทริป การรวมหลายใบหรือข้ามใบที่ยกเลิกต้องใช้ลำดับแถวหลังกรองแล้ว งานเดิมในทริปไม่ถูกแก้ ชื่อใช้ `stopNoteAuthors.stop_N` แล้ว fallback ไป `stopNotesUpdatedBy` แบบเดิม

ผู้เรียก `createTripWithQueueGuard` / `updateTripWithQueueGuard` ที่ไม่ส่ง `tripStopIndexes` มีพฤติกรรมเดิม ไม่ได้เปลี่ยน flow สร้างทริปใหม่หรือคิวต่อเนื่อง และไม่เปลี่ยน schema/rules ของ Firestore

## ทดสอบ

Unit tests ปกติรวมกรณี callback จริงของหน้ารวมเที่ยว:

```sh
npm run test:run
```

Transaction tests ใช้ Firestore emulator แยกพอร์ต 8183/project `demo-merge-notes` และโหลด rules จริงจาก repo ต้องมี Firebase CLI กับ Java ที่ติดตั้งอยู่แล้ว:

```sh
firebase emulators:exec --config tests/merge-notes/firebase.json --only firestore --project demo-merge-notes "node node_modules/vitest/vitest.mjs run --config vitest.merge-notes.config.ts"
```

ชุดทดสอบปฏิเสธการรันหาก `FIRESTORE_EMULATOR_HOST` ไม่ตรงกับ `127.0.0.1:8183` ครอบคลุมค่าใหม่/ล้างข้อความ/ชื่อเก่า การรวมหลายใบ retry เมื่ออีก client เปลี่ยนใบขอ สิทธิ์ที่ถูกปฏิเสธ และไม่เขียนข้อมูลครึ่งเดียว

การจับคู่ยังใช้ index ของจุดหมายตาม flow เดิม ไม่ได้เปลี่ยนการระบุตัวตนเมื่อมีการลบ/สลับจุดหมายในใบขอระหว่างเปิด dialog การรักษา legacy หมายเหตุเมื่อลบจุดในใบสรุปหรือแก้ history อยู่ใน [stop-note-order.md](./stop-note-order.md)
