# CLAUDE.md — LOTUS EME Transport System

> ไฟล์นี้คือ "ความจำข้ามแชท" สำหรับ Claude Code — อ่านอัตโนมัติทุกครั้งที่เปิด session ใหม่
> เก็บบริบท + เหตุผลเบื้องหลัง design ที่ไม่ได้อยู่ในโค้ด เพื่อให้ต่องานได้ทันทีโดยไม่ต้องเล่าใหม่

---

## ภาพรวมโปรเจกต์
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
- **ไม่มี cron ดึงตำแหน่ง!** ตำแหน่งอัปเดตเฉพาะตอนมีคน (staff) เปิดหน้าที่ **poll `/api/tracking/sync` เองทุก 60 วิ** (หน้า `tracking` + `fleet` ทำแบบนี้) → server login SinoTrack + เขียน `vehiclePositions/{deviceId}` ให้ แล้ว subscription ฝั่ง client อัปเดตเอง
  - **ผลลัพธ์:** ถ้าไม่มีใครเปิดหน้าพวกนี้เลย ข้อมูลจะค้างเก่า → ทุกอย่างขึ้น "ออฟไลน์". หน้าไหนอยากได้สถานะสด **ต้อง poll `/api/tracking/sync` เอง** (ดูตัวอย่างใน `fleet/page.tsx`)
  - **viewer poll ไม่ได้** (API จำกัด staff ผ่าน `requireStaff`) → เห็นแค่ข้อมูลล่าสุดที่ staff sync ไว้
- `vehiclePositions/{deviceId}` เก็บ **ตำแหน่งล่าสุดเท่านั้น** (ไม่ใช่รายวัน) → โหมดดูย้อนหลังไม่ใช้ตำแหน่งสด
- `Vehicle.gpsDeviceId` = ผูกทะเบียนกับ deviceId ของ SinoTrack (ตั้งในหน้า fleet ตอนเพิ่ม/แก้รถ)

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
5. **dialog เลื่อน lost-update:** เดิม snapshot ทั้ง `trip` ตอนเปิด dialog → เก็บแค่ `tripId` แล้วหยิบทริปสดจาก `trips` ตอนยืนยัน (กันเขียนทับการแก้จุดอื่นที่เกิดระหว่างเปิด dialog ค้าง)
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
- **Firebase project เดียว** (`studio-2099625459-19c42`, hardcode ใน `src/firebase/config.ts`) → **preview กับ production ใช้ Firestore + กลุ่ม LINE เดียวกัน** ระวังกดส่ง LINE จริงตอนเทส
- **`trips` อ่านได้แบบ public** (`firestore.rules: allow read: if true`) → หน้าคนขับ (ลิงก์สาธารณะ ไม่ล็อกอิน) ดึงทริปทั้งเดือนมาคำนวณอันดับได้ แต่โชว์แค่ของตัวเอง
- ใบงานคนขับ **ต้องคงปุ่ม "นำทางด้วย Google Maps" + รายละเอียด (cargoDetails/ผู้ขอ/เบอร์โทร/หมายเหตุ) ไว้ครบ** — คนขับจะได้ไม่ต้องโทรถามคนจัดรถ
- **พิกัด = snapshot ไม่ realtime:** lat/lng ถูกก๊อป 2 จุด — `sites` → `vehicleRequest.destinations` (ตอน RequestForm) → `trip.stops` (ตอน grouping `trip-grouping/page.tsx:269-270,330-331`) ใบงานคนขับ (`driver/[tripId]:369-371`) ใช้ `stop.lat/lng` จากทริป → **แอดมินแก้พิกัดใน `sites` ทีหลัง = ทริป/ใบงานที่ออกไปแล้วไม่ตาม** (มีผลแค่ใบที่สร้างใหม่). ถ้าจะให้แก้แล้วตาม ต้องทำปุ่ม "ซิงก์พิกัดจากสถานที่" ที่ทริป (ดู TODO)

---

## Git / Deploy workflow
- พัฒนาบน branch `claude/transport-system-review-QvCtP`
- **push main = deploy production ทันที** (Vercel) — เป็นระบบจริงที่คนใช้งานอยู่ + กลุ่ม LINE จริง → ยืนยันกับผู้ใช้ก่อนเสมอ
- อย่าสร้าง PR เว้นแต่ผู้ใช้ขอ
- รูปแบบ commit: ภาษาไทยได้, อธิบาย "ทำไม" ไม่ใช่แค่ "ทำอะไร"

## งานค้าง (TODO)
- [x] ~~**ชั้น 3:** หน้า `report` — completion rate + pattern คนขับปฏิเสธ~~ (เสร็จ `ce699e9`)
- [x] ~~ทำ "เลื่อน" ให้สร้างงานวันใหม่จริง~~ (เสร็จ `7c55b1f` — ดู section ด้านบน)
- [ ] (อาจมี) ปุ่ม "ปิดผลทริปนี้" เพื่อรู้ว่า reconcile ครบหรือยัง
- [ ] **ปุ่ม "ซิงก์พิกัดจากสถานที่" ที่ทริป** — เคสแอดมินแก้หมุด `sites` หลังออกใบ/ส่ง LINE แล้ว งานเดิมไม่ตาม (พิกัดเป็น snapshot ดู gotcha) → ให้กดอัปเดต `stop.lat/lng` จาก `sites` ล่าสุดเฉพาะจุดที่เลือก
- [ ] **ตั้ง ENV เฟส 2 บน Vercel ถ้ายังไม่ได้ตั้ง** (`FIREBASE_SERVICE_ACCOUNT_BASE64`, `CRON_SECRET`, optional `DIESEL_PRICE_SOURCE_URL`) — cron ราคาดีเซล + ยาม auth API ส่ง LINE ถึงจะทำงาน
- [ ] **publish Firestore rules ใหม่ที่ Firebase Console** (commit อยู่บน branch — ทดสอบใน Rules Playground ก่อน publish)
- [ ] **merge ยาม auth API ส่ง LINE** (`a5fce13` บน branch) — รอตั้ง env ก่อน ไม่งั้นปุ่มส่งบอท 401

## งานความปลอดภัย/ค่าใช้จ่าย (2026-06-22)
- **ปัญหา LINE ส่งไม่ได้ปลายเดือน = โควตาเต็ม** — LINE นับ push เข้ากลุ่ม = `1 ข้อความ × จำนวนสมาชิกกลุ่ม` (กลุ่ม ~17 คน → ส่งวันละครั้งกิน 17/วัน) แผนฟรี 300/เดือน เลยตันราววันที่ ~20 ทุกเดือน → แก้ด้วย **ปุ่ม "คัดลอกข้อความ"** (`6c931ff`, deploy แล้ว): คนจัดรถก๊อปข้อความสรุปไปวางในกลุ่มเอง = ข้อความจากคน ไม่กินโควตา OA = ฟรีถาวร (ทางเลือกแทนจ่ายแผนเบสิค ฿1,280/ด.)
- **ยาม auth API ส่ง LINE** (`a5fce13`, **ยังอยู่บน branch**) — เดิม `/api/line/send-summary` ไม่มี auth ใครก็ยิงสั่งบอทส่งกลุ่มได้ แก้: client แนบ Firebase ID token, server verify + เช็ก role staff (`requireStaff` ใน `admin.ts`) **ต้องตั้ง env `FIREBASE_SERVICE_ACCOUNT_BASE64` ก่อน merge** ไม่งั้นปุ่มส่งบอทตอบ 401
- **รัด Firestore rules** (`firestore.rules` ใหม่บน branch) — ปิด fallback `allow if isAuthenticated()` → `if false` (deny by default) + เพิ่มกฎ collection ที่เคยพึ่ง fallback (`vehicleTypes`/`urgentRequests`/`dieselPriceHistory`) คงสิทธิ์เท่าเดิม **zero-impact** แต่ **กฎไม่ deploy ผ่าน git** — ต้อง publish ที่ Firebase Console (Rules Playground เทสก่อน). ⚠️ Firebase project เดียวกัน prod+preview → publish = มีผล prod ทันที, rollback ได้ใน Console

## สถานะ ณ handoff (2026-06-22, อัปเดตหลังรอบแก้บั๊ก)
- main tip = `3311f54` — deploy production แล้ว, typecheck ✅ + test 48/48 ✅
- **ขึ้น production แล้ว:** ปุ่มคัดลอก LINE + เลื่อนจริง + บั๊ก 6 ตัวจากรอบตรวจ (`2984509`, `3311f54`) — ดู section "รอบตรวจ+แก้บั๊ก 6 ตัว"
- หมายเหตุ: main มี commit จาก session อื่นแทรก (โยกงานไปให้ฝั่งต้นทางในใบงาน/LINE, ชื่อคนจัดรถต่อจุด, ค่าน้ำมันโดยประมาณในรูป ฯลฯ `72a1574`..`233d2ce`) — งานเหล่านั้นอยู่บน main ครบ
- **ค้างบน branch `claude/transport-system-review-QvCtP`** (ยังไม่ขึ้น main, ต้องทำเงื่อนไขก่อน): ยาม auth API (รอ env `FIREBASE_SERVICE_ACCOUNT_BASE64`) + Firestore rules (รอ publish ที่ Console)
- ⚠️ **branch ตามหลัง main อยู่เยอะ** (main มี fix บั๊ก + งาน session อื่นที่ branch ยังไม่มี) — ตอนจะเอา auth/rules ขึ้น main ให้ **cherry-pick ทีละ commit** (`a5fce13` auth, `4e974ce` rules) ไม่ใช่ merge ทั้ง branch (จะตีกับ main) หรือ rebase branch ใหม่บน main ก่อน
