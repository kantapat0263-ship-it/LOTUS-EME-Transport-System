# CLAUDE.md — LOTUS EME Transport System

> ไฟล์นี้คือ "ความจำข้ามแชท" สำหรับ Claude Code — อ่านอัตโนมัติทุกครั้งที่เปิด session ใหม่
> เก็บบริบท + เหตุผลเบื้องหลัง design ที่ไม่ได้อยู่ในโค้ด เพื่อให้ต่องานได้ทันทีโดยไม่ต้องเล่าใหม่

---

## ภาพรวมโปรเจกต์
**คิวต่อเนื่อง deploy แล้ว (2026-10-06, `e68709a`):** ใช้เมนูจัดกลุ่มเที่ยววิ่ง/สรุปคิวเดิม กำหนดช่วงวันที่ ยืม/คืนเฉพาะวัน และนัดชดเชยโดยเก็บช่วงเดิม ดู `docs/continuous-queue.md` สำหรับวิธีใช้และข้อจำกัด ทริปที่มี `queueLink` ต้องปรับด้วย API คิวต่อเนื่อง ไม่แก้ผ่านปุ่มทั่วไป Firestore rules ชุด guard เผยแพร่แล้วเป็น `3cbf074f-86ba-4bdf-abe0-c8968f1c050a`; ข้อความ "ยังไม่ publish" ในบันทึกสิทธิ์วันที่ 2026-10-03 ด้านล่างเป็นสถานะก่อนรุ่นนี้ ผลตรวจรวม 569 กรณีผ่าน มีผู้ตรวจอิสระ และตรวจ production build ID ตรงกับ commit แล้ว ก่อนจัดคิวให้โหลดแท็บแอปรุ่นเก่าใหม่

ระบบจัดรถขนส่ง (transport dispatch) สำหรับ LOTUS GROUP / LOTUS EME

**Tech stack**
- Next.js 15 (App Router) + React 19 + TypeScript
- Firebase **Firestore** (NoSQL, ไม่มี Prisma/SQL) + Firebase Auth
- Tailwind CSS + Radix UI
- LINE Messaging API (ส่งใบงานเข้ากลุ่ม), Google Maps (คำนวณระยะ/นำทาง)
- html2canvas (export ใบงานเป็น JPEG), vitest (เทสต์)
- Deploy: **Vercel** (auto-deploy เมื่อ push `main`)

**คำสั่งหลัก**
- `npm run dev` (port 9002) · `npm run build` · `npm run test:run` · `npm run typecheck`

**Domain glossary**
- คนจัดรถ (dispatcher) / คนขับ (driver) / ใบขอรถ (vehicleRequest) / ทริป (trip) / จุด (stop/TripStop)
- REPORT / ใบงาน A4 = หน้า `daily-summary` ("บันทึกการใช้รถยนต์ประจำวัน") → export JPEG → ส่งกลุ่ม LINE
- 16:00 = เวลาปิดรับใบขอรถ (`companySettings.requestCloseTime`) แล้วคนจัดรถเริ่มจัดรถ

---

## ระบบติดตามรถ GPS (SinoTrack) — subsystem ใหม่ (deploy แล้ว, 2026-07-16)

### ที่มา
ดึงพิกัดรถจาก **SinoTrack** (บัญชี `lotuseme`, server 101) เข้าระบบเราเอง โดย reverse-engineer เว็บ gpsgo (ไม่มี API ทางการ) — พิสูจน์แล้วดึงพิกัดจริงได้ → ทำเมนู "ติดตามรถวันนี้"

### สถาปัตยกรรม (สำคัญ)
- **ดึงตำแหน่ง 2 ทาง:** (1) **cron ภายนอก cron-job.org** (job "LOTUS GPS tracking sync", ทุก 1 นาที, `Bearer CRON_SECRET`) — **server เก็บตลอด 24 ชม. (ผู้ใช้เลือก 2026-10-07)** · cron-job.org job "LOTUS GPS tracking sync" (id 8095765) = Every 1 minute, timezone Asia/Bangkok, ไม่มีวันหมดอายุ (ตรวจในคอนโซล 2026-10-07 ตั้งไว้ถูกอยู่แล้ว) · จุดหลังเที่ยงคืน–03:59 ตกวันเดิม (ตัดวัน 04:00) · ประวัติ: เดิมเก็บ 05:00–19:59 → ขยายถึง 21:59 (2026-10-01 เคส 1ฒษ-4413 กลับ 20:13) → เริ่ม 03:50 (2026-10-06) → 24 ชม. (2026-10-07 เคส ถส-5694 ขับกลับจากอุดร 19:40 ถึงบ้าน ~03:56 เส้นทาง/เวลาถึงหายทั้งช่วง 22:00–03:49) — ค่า Firestore เพิ่มราวหลักสิบบาท/เดือน · log Vercel เก็บสั้น (แพ็กเกจปัจจุบัน) ดูย้อนหลังข้ามคืนไม่ได้ ; (2) staff เปิดหน้า `tracking`/`fleet` → **poll `/api/tracking/sync` ทุก 60 วิ** ได้ทุกเวลา
  - **sync เก็บแค่ "ตำแหน่งล่าสุด" ต่อรอบ ไม่ backfill ประวัติ** → ช่วงที่ cron ไม่ยิง (cron-job.org ล่ม/ตั้งผิด) = จุดหายถาวร · ก่อน 2026-10-07 ช่วง 22:00–03:49 ไม่มีข้อมูล ; เวลา "กลับออฟฟิศ" = เวลา GPS ของจุดแรกในออฟฟิศที่ sync เจอ
  - **วันของระบบติดตามรถ (`trackingDateKey`) = วันที่ไทย ตัดวันตอน 04:00** (`TRACKING_DAY_START_HOUR` ; ตั้งแต่ 2026-10-06 — ช่วง 2026-10-01 ถึงก่อนนั้นตัด 05:00, ก่อน 2026-10-01 ตัดแบบ UTC = 07:00 ไทย) ; หน้า tracking ที่เปิดค้างข้าม 04:00 จะเลื่อนไปวันใหม่เอง
  - โควตา: Firebase เป็น **Blaze** (จ่ายตามใช้ ไม่มีเพดานหยุด) — 1 รอบ sync ≈ อ่าน ~50 / เขียน ~25 (เขียน vehiclePositions ทุกคันทุกรอบแม้จอดนิ่ง)
  - หน้าไหนอยากได้สถานะสด **ต้อง poll `/api/tracking/sync` เอง** (ดูตัวอย่างใน `fleet/page.tsx`)
  - **viewer poll ไม่ได้** (API จำกัด staff ผ่าน `requireStaff`) → เห็นแค่ข้อมูลล่าสุดที่ staff sync ไว้
- `vehiclePositions/{deviceId}` เก็บ **ตำแหน่งล่าสุดเท่านั้น** (ไม่ใช่รายวัน) → โหมดดูย้อนหลังไม่ใช้ตำแหน่งสด
- `Vehicle.gpsDeviceId` = ผูกทะเบียนกับ deviceId ของ SinoTrack (ตั้งในหน้า fleet ตอนเพิ่ม/แก้รถ)
- **เกณฑ์ "ถึงจุดงาน" (ผู้ใช้กำหนด 2026-10-06):** จุดงานห่างออฟฟิศ ≤ 5 กม. (`NEAR_OFFICE_M`) ต้อง**จอดในรัศมี 300 ม. ต่อเนื่อง ≥ 5 นาที** (`NEAR_OFFICE_ARRIVAL_DWELL_MIN`) — งานแถวออฟฟิศ (โรงเก็บของ/ตรอ./ร้านของเก่า) อยู่บนเส้นทางวิ่ง ขับผ่านแล้วเคยถูกนับว่าเสร็จ · จุดไกลกว่านั้นใช้กติกาเดิม เข้าใกล้ = ถึง (ในเมืองจุดห่างกัน) · timeline (`stopTiming`): ถึง = รอบแรกที่ผ่านเกณฑ์ · ออก = จบรอบจอดสุดท้าย · จอด = รวมทุกรอบจอด (รอบในรัศมี < `STAY_MIN` 2 นาที = ขับผ่าน ไม่นับ) — ไม่ใช่จุดแรก-สุดท้ายของทั้งวัน · GPS เงียบช่วงที่หัว-ท้ายอยู่ในรัศมี = จอดต่อเนื่อง (trail ข้ามเวลาซ้ำ ช่องว่างจึงเกิดตอนจอด — อย่าตัดช่องว่าง ไม่งั้นจอดนานไม่เคยนับ) · รอบจอดที่เริ่มหลังถึงจุดงานถัดไปไม่นับให้จุดนี้ (A→B→A: ขาไป B ไม่หาย แต่รอบ A หลังจะไปรวมในเวลาเดินทางไปจุดถัดไป) · หน้าย้อนหลังคิดใหม่เฉพาะเวลาที่จุดงานจาก trail (ออก/กลับออฟฟิศ + กม. ใช้ trackingDaily ของวันนั้น) · ระหว่างจอดยังไม่ครบโชว์ "รอยืนยัน" (`isAwaitingDwell`) · **ไม่ได้แตะ** `atAnyJob` ใน state machine ออก/กลับออฟฟิศ · ข้อจำกัด: จุดงานที่รัศมีทับออฟฟิศ (หมุดห่างได้ถึง ~550 ม.) จอดที่ออฟฟิศ ≥ 5 นาทีก็นับว่าถึง · หลาย stop ไซต์เดียวกันได้เวลาเดียวกัน (นับเวลาจอดซ้ำ — มีมาแต่เดิม) · GPS เงียบข้ามช่วง cron หยุด (22:00–03:50) ที่หัว-ท้ายอยู่ในรัศมีจุดงาน = นับเป็นจอดยาว
- **รถที่ใบสรุปขึ้น "🚫 ไม่ได้วิ่ง" ต้องไม่โชว์ในหน้าติดตาม** (ผู้ใช้กำหนด 2026-10-05 หลังเคส 1ฒล-6100 เลื่อนงานแล้วยังขึ้น "กำลังไป") — ตัดสินด้วย `isTripNotRun` (tracking.ts) + `incomingStopsForTrip` ตัวเดียวกับใบสรุป ; ยกเลิกเลื่อน/โยก = การ์ดกลับมาเอง ; จุด `postponed` ไม่นับเป็นจุดที่ต้องไป (timeline ขีดฆ่า "⏭️ เลื่อนไป ...") · ใบสรุปยังโชว์การ์ดพร้อมป้ายตามเดิม · caveat: `trackingDaily` ฝั่ง server ยังคิดรวมจุด postponed (ตัวเลขย้อนหลังประมาณ)

- **ทริปกลับอย่างเดียวข้ามคืน + จอดค้างคืน** (deploy แล้ว 2026-10-07 `81407bd` — ตรวจ Codex 2 รอบ + team-reviewer 2 รอบ): ทริป `return` ลงวันที่ = วันที่รถถึงออฟฟิศ · หน้าติดตามดึง trail วันก่อนเพิ่ม (เฉพาะวันที่มีทริปกลับ) แล้ว `returnTripTrail` ต่อจากจุดสุดท้ายในพื้นที่ไซต์ (รัศมี 2 กม. `RETURN_SITE_AREA_M` — ลานจอดอาจห่างหมุด) · วันนี้ยังมีจุดที่ไซต์ = ไม่ต่อ · ต่อเฉพาะเมื่อวันก่อน "หยุดนิ่ง" ที่ไซต์ ≥ 10 นาที (กลุ่มจุดในรัศมี 300 ม.) หรือ GPS เงียบ ≥ 30 นาทีแล้วโผล่ไกล — คลานช้า/ขับผ่านช่วงดึง GPS ไม่ได้ไม่นับ (10 นาที เดิม 30: เคสจริง ถส-5694 ถึงจุดเปลี่ยนรถ 19:13 ออก 19:40 = 27 นาที ไม่ผ่านเกณฑ์เดิม · เวลาออกไซต์ยังใช้เกณฑ์เงียบ 30 นาทีเหมือนเดิม) และหลังออกไม่ได้ "จอดจริง" ≥ 5 นาทีที่ออฟฟิศก่อน 00:00 ของวันทริป (ขับผ่านออฟฟิศจุดเดียวไม่นับ · ถึงออฟฟิศหลังเที่ยงคืนก่อนตี 4 ยังนับเป็นขากลับของทริปนี้) · ตัด gpsEndAt ก่อนต่อ · จอดในพื้นที่ไซต์รับรถ = จุดงาน (classifier `areas`) · รายงานพักรายสัปดาห์คิดรายวัน: ทริปกลับที่ GPS วันนั้นไม่เข้าพื้นที่ไซต์รับรถเลย = `incomplete` · ไซต์รับรถเลือกตาม order เหมือนหน้าติดตาม · fingerprint ใส่ routeMode เฉพาะทริป return (ใส่ทุกทริป = hash เปลี่ยนทั้งระบบ เหตุผลที่บันทึกไว้ stale หมด) · รัศมีพื้นที่ไซต์ `pickupAreaRadiusM` หดเมื่อไซต์ใกล้ออฟฟิศ (ไม่ครอบออฟฟิศ ต่ำสุด 300 ม.) · งานหลายใบที่ไซต์รับรถเดียวกัน (≤300 ม.) เป็นไซต์รับรถทั้งหมด · เวลาจอดรอที่ไซต์ไม่นับ "ทำงานที่จุด" · เวลาออกไซต์: GPS เงียบ ≥30 นาทีก่อนจุดนอกพื้นที่ = ใช้เวลาจุดนั้น · จุดล่าสุดยังอยู่ไซต์ = ยังไม่ออก · ข้อจำกัด: หลักฐานหยุดนิ่งดูเฉพาะช่วงในไซต์ช่วงสุดท้าย (ขับวนผ่านพื้นที่อีกรอบหลังจอดรอ = ไม่ต่อ เท่ากับก่อนมีฟีเจอร์) · รถออกจากออฟฟิศช่วง 22:00–03:59 ล้างเวลากลับของวัน (ใช้ ✂️ จบการใช้รถ) (ไม่ต่อวันก่อนในรายงาน) · trail cap 2,880 จุด/วัน · ไซต์รับรถ = จุดเริ่ม (เคยอยู่พื้นที่ไซต์ = ผ่าน) แถวโชว์ "🚩 ออกจากไซต์ HH:MM (วันที่)" · กลับถึงออฟฟิศ = returnedOfficeAt ?? vehicleReturnedAt · ต่อ trail แล้วคิดสรุปใหม่เสมอ (trackingDaily ฝั่ง server มีแค่วันนี้) · เวลาคนละวันกับที่ดูต่อท้าย "(6 ต.ค.)" (`clockWithDay`) · ย้อนได้ 1 วัน · จุดจอดคร่อม 22:00–05:00 = `overnight` "🌙 จอดค้างคืน" สีเทา ไม่นับใน "🔴 จอดนอกจุดงาน" และนาทีรอตรวจสอบรายสัปดาห์ (จอดยาวจากกลางคืนถึงกลางวันก็เทาทั้งช่วง — ผู้ใช้รับทราบ) · เหตุผลที่เคยบันทึกกับจุดจอดกลางคืนที่เคยเป็น review จะไม่ถูกใช้แล้ว
- **รูปแบบเส้นทาง `Trip.routeMode` + จบการใช้รถ `Trip.gpsEndAt`** (deploy แล้ว 2026-10-06 `41a7be7` — เคสไม่บ่อย ผู้ใช้ยอมรับความไม่สมบูรณ์):
  - `routeMode` (ไม่มีฟิลด์ = `round` ไป-กลับ) — ตั้งใน dropdown "รูปแบบเส้นทาง" แผงปิดผลงานจริง → คิด กม./ค่าน้ำมันตามแผนใหม่ (`routePlan` ใน `src/lib/routeMode.ts`) · `outbound` = เอารถไปทิ้งที่ไซต์ (เคส 1ฒล-6100 ไปอุดร) → หน้าติดตามโชว์ "ไปอย่างเดียว — รถไม่กลับออฟฟิศ" · `return` = ไปรับรถที่ไซต์ขับกลับ (ทริปวันถัดไป สร้างจากใบขอรถปกติแล้วค่อยเปลี่ยนโหมด) → แผนที่วาดเส้น จุดงาน→ออฟฟิศ + ป้าย "🚩 เริ่มจากไซต์" · รวมจุดในหน้าจัดกลุ่มเคารพโหมดเดิม · **ไม่แตะ state machine** ออก/กลับออฟฟิศ (กม. GPS ยังคิดจาก trail จริง)
  - `gpsEndAt` (ms) — ปุ่ม "✂️ จบการใช้รถ" (staff) ในหน้าติดตาม สำหรับรถที่กลับออฟฟิศแล้วคนอื่นเอาไปใช้ต่อวันเดียวกัน (เคสอภิวัฒน์→สมคิดเอารถไปนอนที่พัก) · ระบบเสนอเวลา = จุดสุดท้ายในออฟฟิศของรอบจอด ≥ 5 นาทีก่อนรถออกอีกรอบ (`suggestHandoverTime` — นับ "ออก" เฉพาะที่มีจุดในออฟฟิศนำหน้า วันตื่นนอกพื้นที่รอบเข้าออฟฟิศแรกจึงไม่ใช่ส่งต่อ) · ไม่แก้เวลาที่เสนอ = บันทึกเวลาเสนอเป๊ะมีวินาที (ปัดนาทีแล้วจุดที่ทำให้จอดครบ 5 นาทีหลุด → เวลากลับหาย) / แก้เอง = สิ้นนาทีนั้น (`handoverCutMs`) · ไม่รับเวลาอนาคต/ก่อนรถออกงาน (`handoverTimeError`) · trail หลังเวลานี้ตัดทิ้ง (`cutTrailAt`) ทั้งหน้าติดตาม + cron sync (`trackingDaily`) + จุดแวะประจำในหน้า report · ซ่อนตำแหน่งสด หัวการ์ดขึ้น "จบการใช้รถแล้ว" · ย้อนหลังที่มีการตัด หรือ `trackingDaily.gpsEndAtApplied` บอกว่า sync เคยตัดไว้ (ยกเลิกทีหลัง) = คิดสรุปทั้งชุดใหม่จาก trail · ยกเลิกการตัดได้ (`deleteField`) · ช่องเวลาผูกกับทริป (สลับคันแล้วไม่ติดไป)
  - `routeMode` เปลี่ยนในใบสรุป = คิดระยะก่อนแล้วบันทึก โหมด+กม.+ค่าน้ำมันพร้อมกัน · คิดไม่ได้ (Directions/เน็ต) = ไม่เปลี่ยนโหมด ให้ลองใหม่ · ไม่มีพิกัดเลย = เปลี่ยนแค่โหมด · dropdown ล็อกระหว่างคิด + ตัวนับรุ่นการคิดระยะต่อทริป (`distGenRef` — แทรก/ลบงานระหว่างเปลี่ยนโหมด ผลที่เริ่มก่อนถูกทิ้ง) · หน้าติดตาม: กลับอย่างเดียวยังไม่ "จบงาน" จนรถถึงออฟฟิศ (ย้อนหลังไม่มีสรุป = ดูจาก trail) + timeline เริ่มที่ไซต์ · ช่องเวลาจบการใช้รถเก็บเวลาตั้งต้นตอนเปิด (`baseMs`) ไม่แก้ = บันทึกค่านั้นเป๊ะ · ข้อจำกัด (โอกาสต่ำมาก ยอมรับ): หน้าจัดกลุ่ม (รวมจุด) คิดระยะพร้อมกับเปลี่ยนโหมดในใบสรุปคนละแท็บยังทับกันได้ · เปลี่ยนรถระหว่างที่การเปลี่ยนโหมดกำลังคิด (~1 วิ) ค่าน้ำมันอาจใช้อัตรารถเดิม
  - **ทดสอบใน emulator:** ถ้า session อื่นใช้ emulator พอร์ต 8080/9099 อยู่ ห้ามใส่ข้อมูลทดสอบปน (เขารีเซ็ตข้อมูลได้/เทสต์เขาพัง) — เปิดตัวใหม่คนละพอร์ต + แก้พอร์ตใน `src/firebase/index.ts` ชั่วคราว (ห้าม commit)
  - ข้อจำกัด: `trackingDaily` เป็น 1 doc ต่อรถต่อวัน + `plateToJob` เก็บทริปเดียวต่อทะเบียน (ทริปสองคนทะเบียนเดียววันเดียวกัน ยังไม่รองรับ — มีมาแต่เดิม)

- **แก้หมายเหตุคนจัดรถรายจุดหลังจัดคิว** (deploy แล้ว 2026-10-06 พร้อม `41a7be7`): ปุ่ม "✏️ หมายเหตุ" ในแผงปิดผลงานจริง (daily-summary) แก้ `stop.dispatcherNote` ใน `runTransaction` + `applyNoteEdit` (`src/lib/stopNote.ts`) — เทียบ `stopFingerprint` ของจุดสดก่อนเขียน (จุดถูกย้าย/แก้ระหว่างเปิด dialog = `StopNoteConflictError` ไม่เขียนทับ) · ชื่อผู้แก้จากโปรไฟล์ `users/{uid}` · เลิก mirror ไป `trip.stopNotes` (key `stop_N` ผิดลำดับได้) · หน้าคำขอรถ: ปลายทางที่จัดคิวแล้วล็อกช่องหมายเหตุ (🔒 ให้ไปแก้ที่ใบสรุป) + เช็คการจัดจากใบสดใน transaction
- **หมายเหตุล่าสุดตอนรวมเที่ยว (2026-10-06):** หน้ารวมเที่ยวส่ง `tripStopIndexes` คู่กับ `destinationIndexes` เฉพาะจุดใหม่ ผ่าน `TripSourceAllocation` แล้ว `tripQueueGuard` อ่านหมายเหตุ/ชื่อจากใบขอภายใน transaction เดียวกับการจัดงาน Retry จะอ่านค่าใหม่ ข้อความที่ล้างไม่ฟื้นจาก dialog ผู้เรียกที่ไม่ส่ง bindings ใช้พฤติกรรมเดิม ดู `docs/merge-notes.md` และ `tests/merge-notes` การระบุตัวตนเมื่อจุดหมายในใบขอถูกลบ/สลับระหว่างเปิด dialog ยังเป็นงานแยก การลบจุดในทริปแก้ตามหัวข้อถัดไป
- **หมายเหตุหลังลบจุด/แก้ลำดับ (2026-10-06):** daily-summary ยกเลิกงานและ history editor ส่ง original-index bindings (`TripStopEdit`) เข้า transaction เพื่อย้าย legacy หมายเหตุ/ชื่อสดลงบน stop ที่เก็บไว้ แล้วล้าง maps พร้อมกัน History แถวใหม่ใช้ null และเก็บ binding คู่กับการเพิ่ม/ลบ แก้ cargo ไม่ mutate snapshot ผู้เรียกที่ไม่แก้ stops ใช้พฤติกรรมเดิม ดู `docs/stop-note-order.md` และ `tests/merge-notes/stop-order.test.ts` ไม่ใช่ migration ย้อนหลัง และมี snapshot guard สำหรับ daily writers เพิ่มตาม docs/trip-write-conflicts.md
- **ป้องกัน stops เก่าทับข้อมูลล่าสุด (2026-10-06):** daily writers ใช้ TripStopEdit ทุกครั้ง whole-array helper ต้องมี snapshot; merge/history ส่ง snapshot เดิม เหตุผลปฏิเสธเก็บ draft แยกและล้างเมื่อโหลดใหม่/เปลี่ยนรายการงาน Undo เลื่อนและสร้างคันรับโยกบันทึกเอกสารที่เกี่ยวข้องพร้อมต้นทางใน transaction เดียว การเปลี่ยนคนขับ/รถหลายทริปยังหลายขั้นตอนและแจ้งผลบางส่วนตรงจริง ดู docs/trip-write-conflicts.md แท็บเก่าต้องโหลดหน้าใหม่ ไม่มี migration/rules change/กู้ข้อมูลย้อนหลัง
- **หมายเหตุคนจัดรถของงานรับโยก (2026-10-06):** `incomingStopsForTrip` พก `dispatcherNote`/`dispatcherName` จากจุดต้นทางไปแสดงในแถวรับโยกของใบสรุปและหน้าคนขับ อ่าน legacy `stopNotes.stop_N`/`stopNoteAuthors.stop_N` ตาม index ต้นทางก่อนค่าบน stop เหมือนแถวต้นทาง ไม่ copy หรือเขียนฐานข้อมูลเพิ่ม รองรับหลายบรรทัดและข้อความยาว ทั้งโยกบางจุด/ทั้งเที่ยว การลบจุดในทริปแก้ตามหัวข้อข้างบน ส่วน daily writers ที่เขียน stops จาก local state ป้องกันแล้วตาม docs/trip-write-conflicts.md คนขับที่เปิดหน้าไว้ต้องโหลดหน้าใหม่เพื่อดึงข้อมูลล่าสุด

### ฟิลด์ที่ ST-902 คืนจริง (ตรวจ 2026-07-16 — สำคัญเวลาจะทำฟีเจอร์เพิ่ม)
GetLastPosition คืน: พิกัด/ความเร็ว/ทิศ/เวลา + `nMileage` (เมตร) + `nAlarmState` (bitmask) — **มีค่าจริง**
**=0/ว่างเสมอ** (อย่าเสียเวลาทำฟีเจอร์จากพวกนี้): `nFuel`, `nTemp`, `nGSMSignal`, `nGPSSignal`, `strOther`
**`nCarState`** เป็น bitmask แต่ **ล็อตนี้ไม่เซ็ตบิตเครื่องติด** (รถวิ่ง 37 กม./ชม. ยัง =0) → **ACC/เครื่องติด-ดับ ดึงไม่ได้**
บิตที่ถอดจาก gpsgo.js: `nAlarmState` → ตัดไฟ/แบตต่ำ=`32768`, overspeed=(speed>120 || bit `64`), น้ำมันรั่ว=1048576

### 3 ฟีเจอร์ค่าเพิ่มจาก GPS (deploy แล้ว — commit `bde9165`, `7031345`)
1. **แจ้งเตือน "GPS ถูกถอด/ตัดไฟ"** (จับคนแอบถอด) — บิต 32768 ค้างในรายงานล่าสุด → จับได้แม้ตอนนี้ offline แล้ว. โชว์ toast แดง + banner + badge + ดันคันขึ้นบนสุด. **caveat: ยังไม่เคยเห็นบิตนี้ยิงจริง** (ตอน capture nAlarmState=0) — ฟีเจอร์พร้อม แต่จะยิงก็ต่อเมื่ออุปกรณ์รายงานจริง
2. **แจ้งเตือน "ความเร็วเกิน"** — เกณฑ์ **ปรับได้ในเมนูตั้งค่าระบบ** (`companySettings.overspeedLimitKmh`, default 90) + honor bit 64 ของอุปกรณ์. via เกณฑ์เราเอง **ทำงานแน่นอน** (มี speed จริง)
3. **เลขไมล์สะสม** (`nMileage` เมตร→กม.) โชว์ในหัวรายละเอียดหน้า tracking

### ป้ายสถานะ GPS ในหน้า fleet (deploy แล้ว — commit `8542525`)
การ์ดรถโชว์ 🟢 GPS ออนไลน์ / ⚪ ออฟไลน์ **เฉพาะคันที่ผูก `gpsDeviceId`** (ไม่ผูก = ไม่โชว์อะไร). ออนไลน์ = มี position ล่าสุด + ไม่ stale (ใช้ `isPositionStale` ตัวเดียวกับหน้า tracking)

### ไฟล์สำคัญ (GPS)
- `src/lib/sinotrack.ts` — login SinoTrack + `toVehiclePositions` (แปลง raw → พร้อม alarmState/mileage) [server-only, มี crypto]
- `src/lib/tracking.ts` (+`tracking.test.ts`, client-safe pure) — helpers: `isPositionStale`, `isPowerCut(32768)`, `isOverspeed(speed,alarmState,threshold)`, `mileageKm`, `OVERSPEED_KMH`, `computeStopStatuses`, `computeDailySummary`, `detectStops` ฯลฯ
- `src/app/api/tracking/sync/route.ts` — poll endpoint (staff only) เขียน `vehiclePositions`
- `src/app/api/tracking/devices/route.ts` — รายชื่อ device จาก SinoTrack (ให้ dropdown ผูกทะเบียน)
- `src/app/(dashboard)/tracking/page.tsx` — หน้าติดตามรถ (แผนที่ + trail + KPI + แจ้งเตือน)
- scripts ตรวจ/ดีบัก: `test-sinotrack-live.ts`, `list-gps-devices.ts`, `dump-gps-fields.ts`

---

## ฟีเจอร์ที่เพิ่งทำ (deploy ขึ้น production แล้ว)

### ปัญหาราก
REPORT ถูก export เป็น JPEG ส่งเข้ากลุ่ม LINE → ระบบ "จบงาน" ตรงนั้น
แต่ความจริง (คนขับปฏิเสธ / โยกงาน / เลื่อน) เกิดใน **chat หลังส่ง** → ไม่เคยถูกบันทึกกลับเข้าระบบ
→ วัด completion / กม.จริง ไม่ได้ และจับ "คนชอบปฏิเสธงาน" ไม่ได้

### หลักคิด (สำคัญที่สุด — ห้ามหลุด)
> **โชว์เชิงบวกในที่สาธารณะ / จัดการคนอู้แบบส่วนตัว — ไม่ประจานในกลุ่ม**

### ทางแก้: บันทึก "ผลจริง" ด้วย friction ต่ำ
คนจัดรถ (ที่จัดการ swap ใน LINE อยู่แล้ว) มาร์คผลรายจุดในแผง "ปิดผลงานจริง" บนหน้า `daily-summary`
- default = "ตามแผน" → **แตะเฉพาะจุดที่ผิดแผน** (ส่วนใหญ่งานผ่าน เลยแตะแค่ 2-3 จุด)
- บันทึกทันทีที่แตะ (Firestore non-blocking)

**4 ผลลัพธ์ (StopOutcome) — แยก 2 มิติ: "งานไปไหน" vs "คนขับผิดไหม"**
| outcome | ความหมาย | กม. | นับโทษคนขับ |
|---|---|---|---|
| `delivered` (ตามแผน, default) | คันเดิมทำเอง | คันเดิม | ❌ |
| `reassigned` (โยกงาน) | คนจัดรถโยกไปคันอื่นเอง → เลือกคันปลายทาง | ลงคันที่ทำจริง | ❌ |
| `postponed` (เลื่อน) | เลื่อนวัน/เหตุภายนอก | ไม่มีใคร | ❌ |
| `driver-refused` (คนขับปฏิเสธ) | คนขับไม่รับ → พิมพ์เหตุผล **+ เลือกคันรับต่อได้** | ลงคันที่รับต่อ | ✅ |

**Insight สำคัญ:** "ปฏิเสธ" มักตามด้วย "ต้องมีคนรับต่อ" → ปุ่ม `driver-refused` เลยมี dropdown เลือกคันปลายทางได้
→ เก็บครบ: รู้ว่าใครปฏิเสธ (จับ pattern) + งานไปเสร็จที่ไหน + กม.ลงคันที่ทำจริง

**กม. = per-stop share** (`totalDistanceKm ÷ จำนวนจุด`) ย้ายตามงาน — **ไม่ยิง Google Maps ใหม่** (คนใช้ยอมรับความละเอียด "คร่าว ๆ")

### การแสดงผล 3 ชั้น (motivation)
1. ✅ **(ทำแล้ว) ส่วนตัว** — แถบสถิติส้ม (Variant A) ในใบงานคนขับ `/driver/[tripId]`: กม.จริง/จุดสำเร็จ/วันออกงาน + อันดับตัวเอง + ตัวกระตุ้น "อีก X กม. แซงอันดับ 1" — **บวกล้วน ไม่มีคำว่าปฏิเสธ**
2. ✅ **(ทำแล้ว) กลุ่ม** — Top 3 "สุดยอดนักขับประจำเดือน" ท้าย A4 (ติดในรูป JPEG ที่ส่งกลุ่ม) — เชิดชูเฉพาะ Top 3 ไม่แตะคนอันดับท้าย
3. ✅ **(ทำแล้ว) แอดมิน** — completion rate หน้า `report` + pattern คนขับปฏิเสธ (เฉพาะแอดมิน ไม่ประจาน) — commit `ce699e9`

**อันดับ/Top 3 นับจาก "กม.ที่วิ่งจริง"** (ผู้ใช้เลือกเอง)

### เพิ่มล่าสุด (deploy ขึ้น production แล้ว — 2026-06-14, commit `c0b3232`)
- **โยกงาน → ฝั่งปลายทางเห็นงานที่ถูกโยกมา** (`c657896`) — แก้ระบบโยกที่เดิมเป็น "ทิศทางเดียว" (คันต้นทางรู้ว่าโยกออก แต่คันปลายทางไม่เห็นงานเข้า) ตอนนี้คันที่รับงานต่อ (`reassigned`/`driver-refused` + เลือกคันปลายทาง) เห็นงานที่โยกเข้ามาในใบงานคนขับแล้ว
- **กม./ค่าน้ำมัน "วิ่งจริงตามงาน" ไหลครบทุกหน้า** (`a40ae1b`) — เดิมกม.วิ่งจริงใช้แค่ตอนคิดอันดับ leaderboard; ตอนนี้ไหลครบทั้ง `report` / `driver/[tripId]` / `daily-summary` / รูป LINE — กม.+ค่าน้ำมันย้ายตามคันที่ทำจริง (per-stop share เดิม ไม่ยิง Maps ใหม่) helper อยู่ใน `src/lib/calculations.ts` (+test)

### "เลื่อน" ให้เลื่อนจริง (deploy แล้ว — 2026-06-22, `7c55b1f`)
- **ปัญหา:** ปุ่ม "เลื่อน" ในแผง "ปิดผลงานจริง" เดิมแค่เซ็ต `stop.outcome='postponed'` (สถิติ) → ใบขอรถต้นทางไม่ขยับ งานไม่ไปโผล่วันใหม่ คนจัดรถต้องสร้างใหม่เอง
- **ทางแก้ (อยู่ที่เดิม — ล่างใบสรุป):** กดเลื่อน → dialog เลือกวัน → **สร้างใบขอรถใหม่ `status='rescheduled'`** วันที่เลือก → ไปโผล่ในกองจัดเที่ยววิ่งวันนั้น (คนจัดรถจัดรถใหม่เอง ไม่พกคันเดิม)
- **gotcha สำคัญ:** หน้าจัดกลุ่ม (`trip-grouping/page.tsx`) query ใบขอรถ `where status in ['in_progress','partial','rescheduled']` → **ตัด `pending` ออก!** ใบที่เลื่อนต้องเป็น `rescheduled` ถึงจะโผล่ (ห้ามใช้ pending)
- **กันงานหาย:** สร้างใบใหม่ให้สำเร็จ **ก่อน** ค่อยติดป้าย postponed · เปลี่ยนผลออกจาก postponed/เลื่อนวันใหม่ → ลบใบเก่าทิ้ง (กันงานงอกค้าง) · เก็บ trail `rescheduledFromDate/TripId` (ใบใหม่) + `postponedToDate/RequestId` (stop)
- **ไม่ทำ:** ผู้ขอเดิมไม่เห็นใน "ใบของฉัน" (stop ไม่มี email ผู้ขอ) — ยอมรับได้ คนจัดรถเห็นในกองจัดอยู่แล้ว

### รอบตรวจ+แก้บั๊ก 6 ตัว (deploy แล้ว — 2026-06-22, `2984509` + `3311f54`)
สั่งตรวจบั๊ก (subagent) ฟีเจอร์ใหม่ เจอ+แก้ 6 ตัว:
1. **ปุ่มส่ง LINE แคป A4 เป็น JPEG แล้วส่ง `imageBase64` ไปทั้งที่ route ไม่ใช้** → payload หลาย MB เสี่ยงชนลิมิต body Vercel ~4.5MB (ปุ่มพังทั้งปุ่มวันทริปเยอะ) → ตัดการแคป/ส่งรูปออก (ส่งเร็วขึ้นด้วย)
4. **วันที่ปุ่มคัดลอกไม่ตรงบอท** (`22/06/2026` ค.ศ. vs `วันจันทร์ที่ 22 มิถุนายน 2569` พ.ศ.) → เพิ่ม `thaiLongDate()` logic เดียวกับ route.ts
2. **"งานผี":** เลิกเลื่อน/เลื่อนซ้ำ หลังใบ `rescheduled` ถูกจัดเข้าทริปวันใหม่แล้ว → เดิมลบใบเงียบ ๆ แต่จุดที่ copy เข้า `trip.stops` ยังค้าง → เพิ่ม guard `isPostponedReqGrouped` (status `approved`/`partial` = จัดแล้ว → เตือนให้ไปลบจุดจากทริปก่อน ไม่ลบให้)
3. **leaderboard นับทริป Cancelled** (query เดือนไม่กรอง status) → เพิ่ม filter `status !== 'Cancelled'` (ใบสรุป + หน้าคนขับ)
5. **dialog เลื่อน lost-update:** เก็บ tripId/stopIdx และ expectedStops ตอนเปิด dialog ตรวจ stops/สถานะใบเลื่อนสดใน transaction ก่อนเขียนทั้งก้อน หากงานเปลี่ยนให้โหลดใหม่และเปิด dialog ใหม่ ดู docs/trip-write-conflicts.md
6. **เลข VR ชน = `setDoc` เขียนทับใบเดิม** (seq วนกลับหลังลบใบ) → `genUniqueRequestId` เช็ก `getDoc` ว่า id ว่างจริงก่อนเขียน (ทั้ง `handlePostpone` + `RequestForm.tsx`)

---

## คนขับแทน + เปลี่ยนรถ ในแผง "ปิดผลงานจริง" (deploy แล้ว — 2026-07-17, merge `ed47eff`)

### ที่มา
เคสจริง: คนขับประจำ (อ๊อฟ) ลากะทันหัน รถอ๊อฟใส่ของเต็มแล้ว → พี่เจมาขับรถอ๊อฟทำภารกิจอ๊อฟ + เอางานตัวเองมาทำด้วยรถอ๊อฟด้วย → เดิมระบบล็อค `Trip.driverName` ตายตัว เครดิต กม./อันดับเข้าคนลาผิด ๆ

### ขับแทนโดย (actual driver)
- `Trip.actualDriverId/actualDriverName` — dropdown "ขับแทนโดย:" ต่อทริปในแผงปิดผลงานจริง (daily-summary), ค่าว่าง = คนขับประจำ
- **เครดิตย้ายตามคนขับจริง:** `computeDriverLeaderboard` ใช้ `creditDriverOf()` = `actualDriverId || driverId` → กม./จุด/วันทำงาน/อันดับ เข้าคนที่ขับจริง คนลาไม่ถูกนับ (มี unit test)
- **แสดงผลตามทุกที่:** ใบสรุป A4+รูป JPEG ("คนขับ: เจ 🔁 ขับแทน อ๊อฟ" + เบอร์คนขับจริง) / ข้อความ LINE ("เจ (ขับแทน อ๊อฟ)") / ใบงานคนขับ `/driver/[tripId]` (ชื่อ+เบอร์+แถบสถิติส้มของคนขับจริง) / หน้าติดตามรถ (รายการ+toast ตัดไฟ)
- **ลิงก์อัตโนมัติ:** เลือกขับแทน → ถ้าคนนั้นมีทริปตัวเองวันเดียวกันที่ยังมีงาน "ตามแผน" → confirm เดียวโยกงานทั้งหมดมาลงรถคันนี้ (`outcome='reassigned'`) · ยกเลิกขับแทน → เสนอคืนงานกลับทริปเดิม (strip outcome) — มี dialog ถามเพราะมีเคสที่ห้ามโยกอัตโนมัติ (รถของคนขับแทนอาจมีคนอื่นมาขับต่อ)

### เปลี่ยนรถ (รถเสีย/ใช้ไม่ได้ — งาน+คนขับเดิม)
- dropdown "เปลี่ยนรถเป็น:" ต่อทริปในแผงเดียวกัน → เขียน `vehicleId/vehiclePlate/vehicleType` ใหม่ลงทริป
- ทุกหน้าตามอัตโนมัติเพราะผูกกับทะเบียน (ใบงาน/LINE/**ติดตาม GPS ใช้ GPS คันใหม่ทันที**) + ค่าน้ำมันคิดใหม่ตาม `fuelRate` คันใหม่ (ราคาดีเซลใช้ค่า freeze เดิม) + อัปเดต snapshot `reassignedToVehiclePlate` ของงานที่โยกเข้ามา
- เก็บ `Trip.vehicleChangedFromPlate` (ครั้งแรกครั้งเดียว) ไว้ดูย้อนหลังว่าตอนจัดใช้คันไหน

### รวมใบสรุปเหลือคันเดียว (deploy แล้ว — `846d6b5`)
- รถที่ **โยกงานออกครบทุกจุด** (ทุก stop มี `reassignedToTripId` + ไม่มีงานโยกเข้า) = `isFullyMovedOut()` → **ไม่โชว์ในใบสรุป A4 / ข้อความ LINE เลย** + "รวม: X เที่ยว" ไม่นับ — งานไปแสดงเป็นแถว "🔄 รับโยกงานต่อ" ใต้คันที่วิ่งจริงแทน (ผู้ใช้ขอเอง: 2 การ์ดคนขับเดียวกันมันงง)
- เพื่อให้แทนกันได้จริง `incomingStopsForTrip`/`IncomingJob` ถูก enrich ให้พก **requestTime/requestedBy/requestedByPhone/note/address** ครบ และแถวรับโยกงานต่อใน A4 โชว์ เวลา/ผู้ขอ/เบอร์/หมายเหตุ เท่าแถวปกติ (เดิมมีแค่ชื่อสถานที่+ของ — ซ่อนทื่อ ๆ เบอร์ผู้ขอจะหายจากรูป)
- จุดที่แค่ "เลื่อน" (postponed ไม่มี reassignedToTripId) **ไม่ทำให้ซ่อน** — การ์ดยังโชว์พร้อมป้ายแดง "🚫 รถคันนี้ไม่ได้ออกวิ่ง" (คงบันทึกประจำวัน) · แผงปิดผลงานจริงเห็นทุกคันเสมอ (badge 🚫 ไม่ได้วิ่ง) ไว้ undo
- **gotcha ข้อมูลค้าง:** เลือก "ขับแทนโดย" ไว้ก่อนมีระบบลิงก์อัตโนมัติ → งานไม่ถูกโยก (dropdown ค่าเดิม ไม่ trigger) ต้องสลับเป็นคนขับประจำแล้วเลือกใหม่

### gotcha
- ฟีเจอร์ทั้งคู่อยู่**นอก** `#summary-report` (ไม่ติดรูป JPEG) ยกเว้นบรรทัด "🔁 ขับแทน" ในช่องคนขับที่**ตั้งใจ**ให้ติดรูป
- `computeDriverReliability` (pattern ปฏิเสธ) ยังผูกกับคนขับที่มอบหมาย (ตั้งใจ — ลา ≠ ปฏิเสธ)
- Vercel preview ของ branch ใช้ **Firestore เดียวกับ production** → เทสใน preview = เขียนข้อมูลจริง (เตือนผู้ใช้แล้วตอนเทส)

---

## ข้อมูลประจำรถ + พ.ร.บ./ภาษี (deploy แล้ว — 2026-09-26)

- **collection แยก ไม่แตะ `vehicles`:** `vehicleDetails/{vehicleId}` (ข้อมูลเล่ม ทุกช่องไม่บังคับ) · `vehicleCompliance/{vehicleId}` (`tax`/`act` = expiry+confirmed+workStatus, `responsibleName`) · `vehicleComplianceHistory` (ยืนยัน/ต่ออายุ ผู้บันทึก เวลา) · `vehicleComplianceEvidence` (รูปหลักฐานย่อเป็น dataUrl ≤900KB — ไม่มี Storage)
- **กติกา (ผู้ใช้กำหนด ห้ามหลุด):** ไม่มีวัน = "ยังไม่มีข้อมูล" ไม่ใช่ปกติ · ต้อง "ยืนยัน" ก่อนถึงนับสถานะ/เตือน · ห้ามเลื่อนปีเอง (เลยวันแล้วไม่บันทึกต่อ = เกินกำหนด) · ต่ออายุเสนอรอบเดิม+1ปี (ไม่ใช่วันจ่ายเงิน)
- **ภาษี = ครบรอบวันจดทะเบียนทุกปี และ พ.ร.บ. ต่อวันเดียวกัน** (ผู้ใช้ยืนยัน 2026-09-26) → ปุ่ม "ตั้งวันหมดอายุจากวันจดทะเบียน" = `nextRegistrationAnniversary()` ตั้งทีเดียวทุกคันที่ยังไม่มีวัน · รายละเอียดรถติ๊ก "พ.ร.บ. ตรงกับภาษี" เป็นค่าเริ่มต้น
- **ผู้ใช้อยากให้คนจัดรถกดน้อยที่สุด:** flow จริง = เห็นเตือน → บอกคนรถไปต่อ → คนรถเอาเอกสารมา → กด "บันทึกการต่ออายุ" (ติ๊กภาษี+พ.ร.บ. ไว้ให้, ไม่มีช่องติ๊กตรวจซ้ำ) → ยืนยัน · **ตัด "สถานะงาน" (รับทราบ/กำลังดำเนินการ) ออกแล้วตามผู้ใช้สั่ง** — doc เก่าอาจยังมี field `workStatus` ค้าง ไม่มีผลอะไร
- **แจ้งเตือนในแอปเท่านั้น — ผู้ใช้ไม่เอา LINE:** ตัวเลขบนเมนู "ฟลีทรถและคนขับ" + แท็บ (แดง=เกิน/ครบวันนี้, ส้ม=≤30 วัน) ผ่าน `attentionLevel()` · ผู้ใช้เลือกจุดแดงที่เมนู ไม่เอา pop-up
- **นำเข้า Excel** (แท็บ พ.ร.บ./ภาษี): วางจาก Excel รวมหัวตาราง → preview → เติมเฉพาะช่องว่าง (transaction อ่านซ้ำก่อนเขียน) · ทะเบียนซ้ำ/ไม่พบ/จังหวัด-เลขตัวรถไม่ตรง = ข้ามแถว · เลขตัวรถ/เครื่องซ้ำหลายแถว, VIN มี O/I/Q, ปีรุ่นเพี้ยน = ข้ามช่อง · "-" = ว่าง · ไม่นำเข้าราคา
- **ไฟล์ `รายการรถ 2569.xlsx` (37 แถว):** จับคู่ได้ครบ 20 คันในระบบ · ข้อมูลน่าสงสัยในไฟล์: แถว 27↔30 และ 28↔31 เลขตัวรถ+เครื่องซ้ำกัน, แถว 36 VIN "MRO…", แถว 37 ปีรุ่น 2050
- **ไฟล์:** `src/lib/vehicle-compliance.ts`, `src/lib/vehicle-import.ts` (+test) · `src/components/fleet/*` · badge ใน `app-sidebar.tsx`
- **ทดสอบในเครื่องแบบแยกจาก prod:** Firebase Emulator (`npm run emulators` + `npm run seed:emulator`, project `demo-lotus-eme`) + `.env.development.local` ที่มี `NEXT_PUBLIC_FIREBASE_EMULATOR=1` และ `FIRESTORE_EMULATOR_HOST` (ห้ามตั้งบน Vercel) · worktree ที่ junction `node_modules` ต้องรัน `next dev` แบบไม่มี `--turbopack`
- **gotcha สิทธิ์:** กฎ staff-only ของ collection เหล่านี้มีผลจริงเมื่อ publish rules ชุด `cc7c069` แล้วเท่านั้น (ดู section "สิทธิ์ Firestore")

---

## ราคาน้ำมัน: freeze ต่อทริป + อัปเดตอัตโนมัติ (เฟส 1+2)

### ปัญหา
หน้า `report` คำนวณค่าน้ำมันทริปเก่าด้วย `companySettings.dieselPrice` **ปัจจุบัน** → พอแก้ราคา ต้นทุนย้อนหลังเปลี่ยนหมด ดูต้นทุนจริงของวันนั้นไม่ได้

### เฟส 1 — freeze ราคาต่อทริป (ทำแล้ว)
- ตอนสร้างทริป (`trip-grouping`) บันทึก `dieselPriceUsed` + `fuelRateUsed` ติดไปกับทริป (นอกจาก `fuelCost` ที่มีอยู่)
- หน้า `report` ทุก aggregation ใช้ helper `tripFuelCost(t)` = ใช้ `t.fuelCost` ที่ freeze ไว้ก่อน, ถ้าไม่มี (ทริปเก่า) ค่อย fallback ด้วย `dieselPriceUsed`/`fuelRateUsed` หรือราคาปัจจุบัน
- `GroupingMap.tsx` เก็บ `dieselPrice`/`fuelRate` เพิ่มลง `window.__lastTripStats`

### เฟส 2 — ดึงราคา B7 อัตโนมัติรายวัน (ทำแล้ว — ต้องตั้ง env บน Vercel ก่อนถึงทำงาน)
- **Vercel Cron** (`vercel.json`) เรียก `GET /api/cron/update-diesel-price` ทุกวัน 06:00 ไทย (`0 23 * * *` UTC)
- route ดึงราคาจากแหล่ง JSON → `extractB7Price()` แกะ defensive (เดินทุก node หา B7/ดีเซล + sanity 20-60 บาท)
  - **แกะ/ดึงพลาด → ไม่เขียนทับราคาเดิม** (กันค่าเพี้ยน) แต่ยังบันทึกประวัติไว้ตรวจ
  - อัปเดต `companySettings/default.dieselPrice` เฉพาะตอนราคาเปลี่ยน (`fuelSettingsUpdatedBy: 'auto:diesel-cron'`)
  - บันทึก `dieselPriceHistory/{YYYY-MM-DD}` ทุกครั้ง (audit: fetchedPrice/previousPrice/status/note/source)
- เขียน Firestore ฝั่ง server ผ่าน **firebase-admin** (`src/firebase/admin.ts`, bypass rules อย่างถูกต้อง)

**ENV ที่ต้องตั้งบน Vercel (เฟส 2):**
- `FIREBASE_SERVICE_ACCOUNT_BASE64` — base64 ของ service account JSON (Firebase Console → Project settings → Service accounts → Generate key → `base64 -w0 file.json`)
- `CRON_SECRET` — สุ่ม 1 ค่า (Vercel แนบ `Authorization: Bearer <CRON_SECRET>` ให้ cron เอง) ถ้าไม่ตั้ง route เปิด public
- `DIESEL_PRICE_SOURCE_URL` *(optional)* — default `https://gas.itorbenz.com`; ถ้า shape ไม่ตรง ปรับ regex ใน `extractB7Price` หรือเปลี่ยน URL
- **ทดสอบ:** Vercel → Functions log; หรือ `curl -H "Authorization: Bearer <CRON_SECRET>" <url>/api/cron/update-diesel-price` → ดู JSON `{ ok, status, price, changed }`

## ป้ายวันลาคนขับ (ดึงสดจากระบบใบลาออนไลน์) — branch `feat/driver-leave-badges` (2026-10-04)

- **ที่มา:** คนจัดรถ = ผู้อนุมัติใบลาคนขับ แต่ลืม → จัดงานให้คนที่ลา · spec `docs/superpowers/specs/2026-10-03-driver-leave-badges-design.md` · plan `docs/superpowers/plans/2026-10-03-driver-leave-badges.md`
- **สาย:** browser → `POST /api/driver-leaves` (`verifyStaffToken` = admin/dispatcher ที่ active) → Worker ระบบใบลา `POST /api/integration/driver-leaves` (Bearer secret) — อ่านอย่างเดียว ไม่ sync สำเนา
- **ไฟล์:** `src/lib/driverLeave.ts` (ตรรกะล้วน+ข้อความป้าย) · `src/lib/driverLeaveClient.ts` (เรียก API แบ่ง 50 รหัส/timeout 8 วิ/ตรวจ key ครบ + ด่านกลาง `confirmLeaveBeforeAssign`) · `src/hooks/use-driver-leaves.ts` (poll 60 วิ) · `src/components/driver-leave/*` · `src/components/fleet/EmployeeCodeHint.tsx` · ฝั่งระบบใบลา `HR/ใบลาออนไลน์/leave-system/worker/integration.ts`
- **ข้อมูล:** `Driver.employeeCode` (คนจัดรถกรอกในหน้าฟลีท — ห้ามจับคู่ด้วยชื่อ) · ยังไม่ผูก = ป้าย ❔ ไม่บล็อก
- **ประเภทคนขับ `Driver.driverType`:** ไม่มีฟิลด์ = `regular` (คนขับประจำ, คนขับเดิมทุกคน ไม่ต้อง migrate) · `occasional` = **คนขับไม่ประจำ** (คนที่เรียกมาช่วยขับ / พนักงานที่ขอรถแล้วขับเอง เช่น วิศวกร / คนนอก) → **ไม่ตรวจวันลา** ป้าย `🚗 คนขับไม่ประจำ` (ป้ายกลาง ไม่ใช่ "ว่าง") · ไม่นับใน "ยังไม่ผูกรหัสพนักงาน" · `confirmLeaveBeforeAssign` ข้าม · รหัสพนักงานที่มีอยู่เก็บไว้แต่ไม่ใช้ (ไม่ส่งไปถาม API) · ตัดสินผ่าน `isOccasionalDriver()` / `driverLeaveStatus()` / `leaveCheckCodes()` ใน `driverLeave.ts` เท่านั้น · **เปลี่ยนประเภทได้ทางเดียวคือฟอร์มคนขับในหน้าฟลีท** (รหัสไม่พบ/ระบบใบลาล่มห้ามทำให้กลายเป็นไม่ประจำ)
- **ENV Vercel:** `LEAVE_API_URL`, `LEAVE_API_KEY` (= secret `TRANSPORT_API_KEY` ของ Worker `lotus-leave`) — **ห้ามตั้ง `FIREBASE_AUTH_EMULATOR_HOST` บน Vercel** (ใช้ทดสอบกับ Auth emulator ในเครื่องเท่านั้น)
- **หลักห้ามหลุด:** "ตรวจไม่ได้/ยังไม่รู้" (`unknown`) ห้ามแสดง/ตัดสินเหมือน "ไม่ได้ลา" · เตือนไม่บล็อก · ทุกจุดมอบงาน (จัดทริป/รวมทริป/ขับแทน/โยก/คันช่วย/แทรกงาน/แก้ในประวัติ) ต้องผ่าน `confirmLeaveBeforeAssign` · ปุ่มส่งออก (LINE/คัดลอก/รูป) **ตั้งใจไม่ตรวจวันลา** (ผู้ใช้ตัดสินใจ 2026-10-04: ความเสถียรของการคัดลอก — `writeText` ต้องเริ่มซิงก์ใน click · ป้ายบนการ์ดทริปในใบสรุปยังอยู่) · ป้ายเป็น element แยก **นอก `#summary-report`** ห้ามต่อเข้า `driverName`/ข้อความ LINE · ใช้ `trip.tripDate` + `actualDriverId || driverId` ของแต่ละทริป · `useDriverLeaves` ต้องได้ `drivers ?? undefined` (ไม่ใช่ `?? []`)
- **ปิดฉุกเฉิน:** `npx wrangler secret delete TRANSPORT_API_KEY` ในโฟลเดอร์ระบบใบลา → แอปขึ้น ⚠️ ตรวจวันลาไม่ได้ และถามก่อนทำรายการ ใช้งานต่อได้
- **ทดสอบในเครื่อง:** emulator + `wrangler dev` ระบบใบลา (D1 แยก `--persist-to`) + `.env.development.local` (`FIREBASE_AUTH_EMULATOR_HOST`, `LEAVE_API_URL=http://127.0.0.1:8787`, `LEAVE_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_BASE64` ปลอมที่ project `demo-lotus-eme`) · `/trips/plan` ตั้งใจไม่ใส่ด่าน (หน้าเก่าไม่อยู่ในเมนู)

## ไฟล์สำคัญ
- `src/firebase/admin.ts` — firebase-admin (server write) · `src/lib/diesel-price.ts` (+test) — แกะราคา B7
- `src/app/api/cron/update-diesel-price/route.ts` — cron อัปเดตราคา · `vercel.json` — schedule
- `src/types/models.ts` — `TripStop` (มี outcome fields), `StopOutcome`, `Trip` (มี `dieselPriceUsed`/`fuelRateUsed`)
- `src/lib/calculations.ts` — pure helpers (มี unit test ใน `calculations.test.ts`):
  - `computeOutcomeStats` (นับผล + กม.จริงต่อทริป), `stopShareKm`
  - `computeDriverLeaderboard` + `monthRange` (อันดับรายเดือนนับ กม.จริง)
- `src/app/(dashboard)/daily-summary/page.tsx` — A4 + แผง "ปิดผลงานจริง" + Top 3
- `src/app/driver/[tripId]/page.tsx` — ใบงานคนขับ + แถบสถิติส้ม
- `src/app/api/line/send-summary/route.ts` — ส่งรูปเข้ากลุ่ม LINE (ใช้ env `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_GROUP_ID`)

---

## ข้อควรระวัง (gotchas)
- **Firestore ห้าม `serverTimestamp()` ใน array** → `outcomeAt` ใช้ ISO string; `updatedAt` ระดับ doc ใช้ serverTimestamp ได้
- **html2canvas จับเฉพาะ element `#summary-report`** → UI โต้ตอบ (ปุ่มมาร์คผล) ต้องอยู่**นอก** `#summary-report` ไม่งั้นจะติดไปในรูป JPEG (ใช้ `no-print` อย่างเดียวไม่พอ)
- **public-safe tag:** ในใบงาน/รูปที่ส่งกลุ่ม ถ้ามีคันรับต่อ → โชว์ "🔄 โยกไปทะเบียน X" เสมอ (แม้เป็น `driver-refused`) — **คำว่า "ปฏิเสธ" ห้ามโผล่ในกลุ่ม** เก็บไว้แค่แผง/รายงานแอดมิน
- **คีย์ Google Maps บน production อยู่ที่ `companySettings/default.googleMapsApiKeyReference` (เมนูตั้งค่าระบบ) — env `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` ไม่ได้ตั้งบน Vercel** → โค้ดฝั่ง client ที่ใช้ Maps/Directions ต้อง fallback ไปคีย์ใน settings เสมอ (ใบสรุปเคยอ่าน env อย่างเดียว → คิด กม. ตอนแทรกงาน/เปลี่ยนรูปแบบเส้นทางไม่เคยทำงานบน production จนแก้ `a16045a`)
- **Firebase project เดียว** (`studio-2099625459-19c42`, hardcode ใน `src/firebase/config.ts`) → **preview กับ production ใช้ Firestore + กลุ่ม LINE เดียวกัน** ระวังกดส่ง LINE จริงตอนเทส
- **`trips` อ่านได้แบบ public** (`firestore.rules: allow read: if true`) → หน้าคนขับ (ลิงก์สาธารณะ ไม่ล็อกอิน) ดึงทริปทั้งเดือนมาคำนวณอันดับได้ แต่โชว์แค่ของตัวเอง
- ใบงานคนขับ **ต้องคงปุ่ม "นำทางด้วย Google Maps" + รายละเอียด (cargoDetails/ผู้ขอ/เบอร์โทร/หมายเหตุ) ไว้ครบ** — คนขับจะได้ไม่ต้องโทรถามคนจัดรถ
- **พิกัด = snapshot ไม่ realtime:** lat/lng ถูกก๊อป 2 จุด — `sites` → `vehicleRequest.destinations` (ตอน RequestForm) → `trip.stops` (ตอน grouping `trip-grouping/page.tsx:269-270,330-331`) ใบงานคนขับ (`driver/[tripId]:369-371`) ใช้ `stop.lat/lng` จากทริป → **แอดมินแก้พิกัดใน `sites` ทีหลัง = ทริป/ใบงานที่ออกไปแล้วไม่ตาม** (มีผลแค่ใบที่สร้างใหม่). ถ้าจะให้แก้แล้วตาม ต้องทำปุ่ม "ซิงก์พิกัดจากสถานที่" ที่ทริป (ดู TODO)

---

## Git / Deploy workflow
- **บทบาท (ผู้ใช้กำหนด 2026-10-07):** Claude = เขียนโค้ด + deploy คนเดียว (ขออนุมัติทุกครั้ง) · Codex = ตรวจหาบั๊กอ่านอย่างเดียว ห้ามแก้/commit/deploy — รายละเอียดใน `AGENTS.md` (repo) และ `../AGENTS.md`
- พัฒนาบน branch `claude/transport-system-review-QvCtP`
- **push main = deploy production ทันที** (Vercel) — เป็นระบบจริงที่คนใช้งานอยู่ + กลุ่ม LINE จริง → ยืนยันกับผู้ใช้ก่อนเสมอ
- อย่าสร้าง PR เว้นแต่ผู้ใช้ขอ
- รูปแบบ commit: ภาษาไทยได้, อธิบาย "ทำไม" ไม่ใช่แค่ "ทำอะไร"

## งานค้าง (TODO)
- [ ] **(พักไว้ — ผู้ใช้ให้ "คิดก่อน ยังไม่ทำ" 2026-07-18) สรุปรายสัปดาห์ต่อคนขับ + กติกาแยก "พักปกติ" ออกจาก "นอกจุดงานน่าสงสัย"** — ดีไซน์คุยจบแล้ว รอไฟเขียว:
  - ปัญหา: เทียบ "นาทีนอกจุดงาน" ดิบ ๆ ไม่แฟร์ — คนวิ่งไกลต้องพักตามปกติ (ความปลอดภัย) คนวิ่งในเมืองไม่ต้อง
  - กติกาเสนอ: (1) พักหลังขับต่อเนื่อง ≥2 ชม. + จอด ≤45 นาที = "🅿 พักระหว่างทาง" สีเทา (2) จอด 11:30–13:00 ≤1 ชม. = "🍚 พักเที่ยง" สีเทา — ที่เหลือแดงเหมือนเดิม + ปุ่มแอดมินมาร์ค "มีเหตุ" ตัดออกจากสถิติ
  - สรุปสัปดาห์ (E): ใช้เฉพาะนาทีสีแดง normalize เป็น "ต่อ 100 กม." · โครง 3 ชั้นตามหลักเดิม — กลุ่ม=บวกล้วน (Top 3 กม. เดิม) / ใบงานคนขับ=เห็นของตัวเองเทียบค่ากลางทีมไม่ระบุชื่อ / หน้า report=แอดมินเห็นหมด
  - ลำดับที่ตกลง: ทำกติกาแยกพักก่อน → ใช้จริง 1-2 สัปดาห์ → ค่อยสร้างสรุปสัปดาห์ทับตัวเลขที่เชื่อได้
  - ที่ทำไปแล้ว (A, deploy `8bee6ef`): เวลาภารกิจรวม + สัดส่วน ขับ/ที่จุดงาน/นอกจุดงาน ต่อคันต่อวัน ในหน้า tracking
- [x] ~~**ชั้น 3:** หน้า `report` — completion rate + pattern คนขับปฏิเสธ~~ (เสร็จ `ce699e9`)
- [x] ~~ทำ "เลื่อน" ให้สร้างงานวันใหม่จริง~~ (เสร็จ `7c55b1f` — ดู section ด้านบน)
- [ ] (อาจมี) ปุ่ม "ปิดผลทริปนี้" เพื่อรู้ว่า reconcile ครบหรือยัง
- [ ] **ปุ่ม "ซิงก์พิกัดจากสถานที่" ที่ทริป** — เคสแอดมินแก้หมุด `sites` หลังออกใบ/ส่ง LINE แล้ว งานเดิมไม่ตาม (พิกัดเป็น snapshot ดู gotcha) → ให้กดอัปเดต `stop.lat/lng` จาก `sites` ล่าสุดเฉพาะจุดที่เลือก
- [ ] **ยืนยัน ENV เฟส 2 บน Vercel สำหรับ cron ราคาดีเซล** (`FIREBASE_SERVICE_ACCOUNT_BASE64`, `CRON_SECRET`, optional `DIESEL_PRICE_SOURCE_URL`) — รายการนี้ไม่ใช่งาน merge ยาม auth LINE อีกแล้ว
- [ ] **publish Firestore rules ชุด `cc7c069` (อยู่บน main แล้ว)** — ก่อน publish: เช็กใน Console ว่า users ที่เป็น admin/dispatcher เป็นตัวจริงทุกคน + staff ทุกคนมี `active: true` (ดู section "สิทธิ์ Firestore")
- [x] **ยาม auth API ส่ง LINE (2026-10-06):** API ใช้ `verifyStaffToken` ตัวเดียวกับ GPS/ใบลา ตรวจโปรไฟล์ล่าสุดว่าเป็น admin/dispatcher และ `active: true` ก่อนอ่าน body หรือส่ง LINE; ปุ่มส่งแนบ Firebase ID token แล้ว ไม่ต้อง cherry-pick `a5fce13` จาก branch เก่า

## งานความปลอดภัย/ค่าใช้จ่าย (2026-06-22)
- **ปัญหา LINE ส่งไม่ได้ปลายเดือน = โควตาเต็ม** — LINE นับ push เข้ากลุ่ม = `1 ข้อความ × จำนวนสมาชิกกลุ่ม` (กลุ่ม ~17 คน → ส่งวันละครั้งกิน 17/วัน) แผนฟรี 300/เดือน เลยตันราววันที่ ~20 ทุกเดือน → แก้ด้วย **ปุ่ม "คัดลอกข้อความ"** (`6c931ff`, deploy แล้ว): คนจัดรถก๊อปข้อความสรุปไปวางในกลุ่มเอง = ข้อความจากคน ไม่กินโควตา OA = ฟรีถาวร (ทางเลือกแทนจ่ายแผนเบสิค ฿1,280/ด.)
- **ยาม auth API ส่ง LINE (แก้แล้ว 2026-10-06):** `/api/line/send-summary` ตรวจ Firebase ID token และสิทธิ์ล่าสุดผ่าน `verifyStaffToken`; คนจัดรถ/แอดมินที่ active ส่งได้ตามเดิม ผู้ใช้ทั่วไป บัญชีระงับ และผู้ไม่ล็อกอินได้ 401 โดยไม่ส่ง LINE ใช้ Firebase Admin config ที่ระบบ GPS/ใบลาใช้อยู่ การทดสอบ mock ขอบเขต Firebase/LINE ทั้งหมดและไม่ส่งกลุ่มจริง
- ~~**รัด Firestore rules** (`4e974ce` บน branch)~~ — **ถูกแทนด้วย `cc7c069` บน main แล้ว (รวมงานนี้ไว้ ไม่ต้อง cherry-pick)** — เดิม: ปิด fallback `allow if isAuthenticated()` → `if false` (deny by default) + เพิ่มกฎ collection ที่เคยพึ่ง fallback (`vehicleTypes`/`urgentRequests`/`dieselPriceHistory`) คงสิทธิ์เท่าเดิม **zero-impact** แต่ **กฎไม่ deploy ผ่าน git** — ต้อง publish ที่ Firebase Console (Rules Playground เทสก่อน). ⚠️ Firebase project เดียวกัน prod+preview → publish = มีผล prod ทันที, rollback ได้ใน Console

## สถานะ ณ handoff (2026-06-22, อัปเดตหลังรอบแก้บั๊ก)
- main tip = `3311f54` — deploy production แล้ว, typecheck ✅ + test 48/48 ✅
- **ขึ้น production แล้ว:** ปุ่มคัดลอก LINE + เลื่อนจริง + บั๊ก 6 ตัวจากรอบตรวจ (`2984509`, `3311f54`) — ดู section "รอบตรวจ+แก้บั๊ก 6 ตัว"
- หมายเหตุ: main มี commit จาก session อื่นแทรก (โยกงานไปให้ฝั่งต้นทางในใบงาน/LINE, ชื่อคนจัดรถต่อจุด, ค่าน้ำมันโดยประมาณในรูป ฯลฯ `72a1574`..`233d2ce`) — งานเหล่านั้นอยู่บน main ครบ
- **รายการค้างใน handoff มิถุนายนนี้ปิดแล้วเมื่อ 2026-10-06:** ยาม auth LINE ใช้ verifier ปัจจุบันตามหัวข้อด้านบน และ Firestore rules เผยแพร่พร้อมคิวต่อเนื่องแล้ว
- ⚠️ **branch เก่าตามหลัง main อยู่เยอะ** อย่า merge ทั้ง branch หรือ cherry-pick `a5fce13`/`4e974ce` ซ้ำ เพราะ main มีงานทดแทนแล้ว
- (อัปเดต 2026-10-03) ส่วน rules ไม่ต้อง cherry-pick `4e974ce` แล้ว — `cc7c069` บน main รวมไว้แล้ว เหลือแค่ publish

## สิทธิ์ Firestore (rules) — รัดแล้วบน main 2026-10-03 (`cc7c069`), **ยังไม่ publish**
- **ที่มา (Codex audit):** rules ที่ live = ruleset `86aa1529…` publish 2026-05-15 (เก่ากว่า repo — กฎ GPS/พ.ร.บ. + `4e974ce` ไม่เคย publish) → user แก้ `users/{ตัวเอง}.role` เป็น admin ได้ + fallback เปิดอ่าน/เขียนทุก collection + หน้าสมัครเปิดให้ทุกคน = **ใครบนเน็ตก็สมัครแล้วตั้งตัวเองเป็น admin ได้** (server เชื่อ role ผ่าน `verifyStaffToken`)
- **กติกาใหม่:** สมัครเองได้แค่ viewer `active:false` · แก้ users ตัวเองได้แค่ name/phone (role/active/pending = admin เท่านั้น) · เขียนต้อง active: staff เขียนข้อมูลหลัก, viewer แค่งานตัวเอง (ใบขอรถ pending / ยกเลิกใบตัวเอง / urgent pending / เพิ่ม site `isUserAdded`) · GPS+ราคาน้ำมัน = server เท่านั้น · fallback ปฏิเสธ · อีเมล `ADMIN_EMAIL` ใน login/page.tsx ตั้งตัวเองเป็น admin ได้ (bootstrap)
- **ตั้งใจไม่รัดสิทธิ์อ่าน** (ยัง login แล้วอ่านได้ ยกเว้น users = ตัวเอง/staff): listener ที่โดนปฏิเสธ → `FirebaseErrorListener` throw ทั้งแอป + layout render หน้าลูกให้บัญชีรออนุมัติชั่วครู่ · `vehicleRequests` ต้องอ่านได้ทั้งวันเพราะ RequestForm นับใบเพื่อออกเลข VR (รัดได้เมื่อย้ายออกเลขไป server)
- **โค้ดคู่กัน:** login สร้างโปรไฟล์ที่หายไปเป็น "รออนุมัติ" (เดิม active:true เอง) · `verifyStaffToken` เช็ก active
- **เทสต์:** `npm run test:rules` (emulator `demo-lotus-eme`, 27 เคส) — ใช้ `tests/rules/firebase.json` เพราะ emulator (Java) อ่านไฟล์ rules จาก path ภาษาไทยไม่ได้; test ส่ง rules ให้ emulator เอง
- **rollback:** Console → Firestore → Rules → เลือก ruleset 2026-05-15 (`86aa1529…`)
- **ค้าง/ต่อยอด:** `/trips/history/[id]` โชว์เมนูเปลี่ยนสถานะทริปให้ viewer (rules ปฏิเสธแล้ว แต่ UI ยังโชว์) · `vehicleComplianceHistory/Evidence` ตั้งใจ append-only แต่ยังเปิด update/delete ให้ staff (ยังไม่ได้ยืนยันว่า VehicleDetailsDialog ไม่ลบ)
