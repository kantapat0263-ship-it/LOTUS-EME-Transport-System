# หมายเหตุหลังลบหรือจัดลำดับจุดใหม่

ปุ่มยกเลิกงานในใบสรุปและหน้าต่างแก้ไขประวัติเที่ยววิ่งส่ง `TripStopEdit` ไปกับการแก้ทริป โดยแต่ละแถวเก็บ index ของจุดต้นฉบับ แถวใหม่ใช้ `null` ไม่อนุมานจากชื่อไซต์หรือเลข `order` และไม่เก็บ binding นี้ลงฐานข้อมูล

`updateTripWithQueueGuard` อ่านทริปสดใน transaction แล้วตรวจ `expectedStops` เทียบทุกฟิลด์ยกเว้น `dispatcherNote`/`dispatcherName` ถ้ามีคนเปลี่ยนจุด รายละเอียด หรือผลงานระหว่างเปิดหน้าต่างจะปฏิเสธให้โหลดข้อมูลและเลือกใหม่ แต่อนุญาตให้หมายเหตุเปลี่ยนได้และใช้ค่าล่าสุดของรอบที่ commit ผ่าน

`remapStopNotes` ย้ายค่าที่แสดงอยู่ตาม fallback เดิม `trip.stopNotes.stop_N || stop.dispatcherNote` และชื่อ `trip.stopNoteAuthors.stop_N || stop.dispatcherName` ลงบนจุดที่เก็บไว้ จากนั้นล้างสอง legacy maps เป็น `{}` พร้อมเขียน stops ใน transaction เดียว จุดใหม่เก็บหมายเหตุของตัวเอง ไม่รับค่าของจุดที่ลบหรือ legacy key เกินช่วง Caller ใช้ patch ที่คืนหลัง commit เพื่อให้ใบสรุปแสดงค่าที่บันทึกจริงทันที

History form clone stop objects และแก้ cargo แบบ immutable เพื่อรักษา snapshot ต้นฉบับ เมื่อเพิ่ม/ลบแถวต้องปรับ `originalStopIndexes` คู่กับ stops เสมอ ชื่อไซต์ซ้ำและการ renumber `order` จึงไม่ทำให้ binding เลื่อน

ผู้เรียกที่ไม่แก้ `stops` ยังคงพฤติกรรมเดิม ส่วนการเขียน `stops` ทั้งก้อนต้องส่ง `stopEdit` หรือ full expected snapshot ของการรวมงาน ตาม `docs/trip-write-conflicts.md` สิทธิ์ คิวต่อเนื่อง และ resource guards ไม่เปลี่ยน ไม่มี migration หรือการแก้ข้อมูล production ย้อนหลัง ข้อมูลที่เคยผิดลำดับมาแล้วไม่สามารถอนุมานคืนอัตโนมัติได้

Regression checks ใช้ handlers และ JSX callbacks จริงจากสองหน้าโดย mock ขอบเขตภายนอก ส่วนการบันทึก การ retry และสิทธิ์ตรวจด้วย SDK/Firestore emulator จริงใน demo project เท่านั้น:

```powershell
node node_modules/vitest/vitest.mjs run
firebase emulators:exec --config tests/merge-notes/firebase.json --only firestore --project demo-merge-notes "node node_modules/vitest/vitest.mjs run --config vitest.merge-notes.config.ts"
```

ชุด transaction รวม regression การรวมเที่ยวเดิมและ `stop-order.test.ts` ใช้พอร์ต 8183 และปฏิเสธ host อื่น ไม่ได้ทดสอบการลบ/แก้ทริปจริงใน production ทางเขียน stops ของ daily ถูกเพิ่ม snapshot guard ตาม `docs/trip-write-conflicts.md` แล้ว ส่วน identity ของจุดในใบขอระหว่างเปิดหน้ารวมเที่ยวเป็นงานแยก
