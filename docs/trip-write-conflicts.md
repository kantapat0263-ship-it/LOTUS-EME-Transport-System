# ป้องกันข้อมูลทริปเก่าทับงานและหมายเหตุล่าสุด

หน้าปิดผลงานอ่าน trips เมื่อเลือกวัน/โหลดใหม่ เครื่องที่เปิดค้างจึงอาจถือ stops รุ่นเก่าอยู่ การอ่าน trip สดใน transaction อย่างเดียวไม่พอ หากสุดท้ายยังเขียน array ที่สร้างจากข้อมูลเก่า ทั้งหมายเหตุและผลของจุดอื่นจะถูกทับได้

## การบันทึกของ client รุ่นนี้

- `updateTripWithQueueGuard` ปฏิเสธ patch ที่มี `stops` หากไม่มี `TripStopEdit` หรือ snapshot `sources.expected` ของการรวมงาน ผู้เรียกที่แก้เฉพาะ metadata ไม่ต้องส่ง snapshot
- Daily `applyStops` รับ trip ต้นฉบับ ส่ง expected stops และ original-index bindings ทุกครั้ง จุดที่ต่อท้ายใช้ `null` จุดที่ลบใช้ indexes ที่กรองแล้ว History ใช้ bindings เดิม และ merge ใช้ full expected snapshot เดิม
- Transaction เปรียบเทียบงาน/ผล/เหตุผลกับฐานจริง หากเปลี่ยนให้หยุดและแจ้งโหลดข้อมูลใหม่ หากเปลี่ยนเฉพาะหมายเหตุ/ชื่อผู้แก้ จะอ่านค่าล่าสุดและ remap ลงบนจุดเดิมพร้อมล้าง legacy maps โดยไม่ใช้ค่าบนจอเก่าทับ Transaction retry ใช้ข้อมูลที่อ่านใหม่ในรอบนั้น
- เหตุผลคนขับปฏิเสธเป็น draft แยกจาก trips เก็บ baseline ก่อนพิมพ์ บันทึกเมื่อ blur เท่านั้น การบันทึกล้มเหลวเก็บข้อความไว้ แต่โหลดข้อมูลใหม่จะล้าง draft และเริ่มจากฐานล่าสุด การเปลี่ยนรายการ/ผลที่สำเร็จล้าง draft ของทริปนั้นเพื่อไม่ให้ข้อความติดไปจุดที่เลื่อน index ข้อความที่พิมพ์เพิ่มระหว่างรอ save จะไม่ถูกล้างโดย save รอบก่อน
- การยกเลิกจุดสุดท้ายตรวจ expected stops ก่อนลบทริป หากอีกเครื่องเพิ่มจุดแล้วจะไม่ลบ

## เอกสารที่ต้องบันทึกพร้อมกัน

- เปลี่ยนผลจากเลื่อน: เปลี่ยน stops ต้นทางและ supersede ใบเลื่อนใน transaction เดียว อ่านสถานะใบเก่าภายใน transaction หาก approved/partial ให้หยุดทั้งก้อน ใบเก่ายังอยู่เพื่อตรวจย้อนหลัง
- สร้างคันรับโยก: สร้างทริปว่าง ตรวจรหัสไม่ซ้ำ/วันตรง/ทรัพยากรไม่ติดคิวต่อเนื่อง และบันทึกการโยกของต้นทางพร้อมกัน ไม่เหลือทริปว่างจากการโยกที่ล้มเหลว
- เลื่อน/เลื่อนซ้ำ: transaction เดิมสร้างใบใหม่ + supersede ใบเก่า + แก้ stops ต้นทาง เพิ่มตรวจ snapshot ตอนเปิด dialog และตรวจสถานะใบเก่าภายใน transaction กันการจัดรถระหว่างรอ เมื่อ conflict ให้โหลดข้อมูลใหม่และเปิด dialog ใหม่

การเปลี่ยนคนขับจริง/รถ กับการโยก/คืนงานหรือแก้ทะเบียน snapshot ของทริปอื่น ยังเป็นหลายขั้นตอนตาม flow เดิม หากขั้นตอนต่อมาล้มเหลว ข้อความต้องบอกว่าส่วนหลักบันทึกแล้วและระบุรถที่ต้องตรวจต่อ ไม่อ้างว่าทั้งหมดสำเร็จหรือ rollback แล้ว

## หลักฐานและขอบเขต

จำลองก่อนแก้ด้วย handler จริงและ Firestore SDK บน emulator: เครื่องเก่าทับหมายเหตุ/ผลล่าสุด; ใบเลื่อนถูก supersede แม้ต้นทางขัดแย้ง; ลบจุดสุดท้ายลบทริปที่เพิ่งมีจุดเพิ่ม หลังแก้ใช้ actual handler tests และ transaction retry กับ writes จากอีก client ไม่ใช่การส่งข้อมูลจริงใน production

- Source suite: 543 กรณีผ่าน รวม draft lifecycle, actual outcome/target payload และข้อความผลบางส่วน
- Transaction suite `vitest.merge-notes.config.ts`: 53 กรณีผ่าน รวม retry, conflict, atomic undo/target/postpone, denied viewer และ regression หมายเหตุ/ลำดับจุด ใช้ demo project บน 8183 เท่านั้น
- Queue suite `vitest.queue.config.ts`: 54 กรณีผ่าน รวม source allocation และ concurrency คิวต่อเนื่อง ใช้ demo project บน 8080/9099
- Typecheck และ production build เป็น checks แยกจากการจำลองฐานข้อมูล Build ใช้บัญชี demo ชั่วคราวและปิด LINE ไม่แก้ env ไฟล์

`next lint` ยังไม่ผ่านจาก 46 errors `react/no-unescaped-entities` ในไฟล์เดิมที่ไม่ได้แก้ งานนี้ไม่เพิ่ม lint error ในไฟล์แอปที่แก้ CI จัด lint เป็น informational ตาม config เดิม Build มีคำเตือน Firebase auto-init เดิมแล้วใช้ config fallback สำเร็จ

ไม่มี migration, stop ID ใหม่ หรือการกู้ข้อมูลที่ถูกทับไปแล้ว ไม่เปลี่ยน Firestore rules การป้องกันนี้อยู่ใน client รุ่นใหม่ **แท็บรุ่นเก่าต้องโหลดหน้าใหม่** จึงได้ helper ใหม่ ยังไม่สามารถบังคับ client เก่าหยุดเขียนด้วย rules ในงานนี้ การตรวจ production จำกัดที่ commit/build และไฟล์ JS ที่เสิร์ฟ ไม่ได้สร้าง/ลบ/แก้ทริปจริงหรือส่ง LINE
