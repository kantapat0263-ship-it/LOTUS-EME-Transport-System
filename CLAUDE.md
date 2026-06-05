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
3. ⬜ **(ยังไม่ทำ — TODO) แอดมิน** — completion rate หน้า `report` ให้แอดมินดู pattern คนปฏิเสธแบบส่วนตัว

**อันดับ/Top 3 นับจาก "กม.ที่วิ่งจริง"** (ผู้ใช้เลือกเอง)

---

## ไฟล์สำคัญ
- `src/types/models.ts` — `TripStop` (มี outcome fields), `StopOutcome`, `Trip`
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
- [ ] **ชั้น 3:** หน้า `report` — completion rate + pattern คนขับปฏิเสธ (เฉพาะแอดมิน, ไม่ประจาน)
- [ ] (อาจมี) ปุ่ม "ปิดผลทริปนี้" เพื่อรู้ว่า reconcile ครบหรือยัง
- [ ] (อาจมี) ทำ "เลื่อน" ให้สร้างงานวันใหม่อัตโนมัติ (ตอนนี้เป็นแค่สถิติ)
