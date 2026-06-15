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

---

## Git / Deploy workflow
- พัฒนาบน branch `claude/transport-system-review-QvCtP`
- **push main = deploy production ทันที** (Vercel) — เป็นระบบจริงที่คนใช้งานอยู่ + กลุ่ม LINE จริง → ยืนยันกับผู้ใช้ก่อนเสมอ
- อย่าสร้าง PR เว้นแต่ผู้ใช้ขอ
- รูปแบบ commit: ภาษาไทยได้, อธิบาย "ทำไม" ไม่ใช่แค่ "ทำอะไร"

## งานค้าง (TODO)
- [x] ~~**ชั้น 3:** หน้า `report` — completion rate + pattern คนขับปฏิเสธ~~ (เสร็จ `ce699e9`)
- [ ] (อาจมี) ปุ่ม "ปิดผลทริปนี้" เพื่อรู้ว่า reconcile ครบหรือยัง
- [ ] (อาจมี) ทำ "เลื่อน" ให้สร้างงานวันใหม่อัตโนมัติ (ตอนนี้เป็นแค่สถิติ)
- [ ] **ตรวจหลัง deploy `c0b3232`:** ลองเปิด `report` + ใบงานคนขับ ดูว่ากม./ค่าน้ำมัน "วิ่งจริง" ตรงงานที่ทำจริง และฝั่งคันปลายทางเห็นงานที่โยกมาครบ
- [ ] **ตั้ง ENV เฟส 2 บน Vercel ถ้ายังไม่ได้ตั้ง** (`FIREBASE_SERVICE_ACCOUNT_BASE64`, `CRON_SECRET`, optional `DIESEL_PRICE_SOURCE_URL`) — cron ราคาดีเซลถึงจะทำงานจริง

## สถานะ ณ handoff (2026-06-15)
- branch `claude/transport-system-review-QvCtP` **merge เข้า main ครบแล้ว** (`c0b3232`), working tree สะอาด, typecheck ✅ + test 48/48 ✅
- main tip = `c0b3232` (deploy production แล้ว) — ไม่มีงานค้างใน working tree
- งานต่อไปที่คุยกันไว้: เลือกหยิบจาก TODO ด้านบน (ปุ่ม "ปิดผลทริปนี้" หรือ "เลื่อน→สร้างงานวันใหม่อัตโนมัติ")
