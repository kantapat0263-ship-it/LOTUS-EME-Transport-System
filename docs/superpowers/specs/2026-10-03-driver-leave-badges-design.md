# ป้ายวันลาคนขับในระบบจัดคิว (ดึงจากระบบใบลาออนไลน์) — Design

- วันที่: 2026-10-03
- สถานะ: **รอผู้ใช้ทวน + Codex ตรวจ** (ยังไม่มีโค้ด)
- branch: `feat/driver-leave-badges` (แตกจาก `origin/main` @ `915b031`)
- ระบบที่แตะ: **ระบบจัดคิว** (repo นี้ — Next.js + Firestore บน Vercel) และ **ระบบใบลา** (`HR/ใบลาออนไลน์/leave-system` — Cloudflare Worker + D1, **ไม่มี git**, ใช้งานจริงตั้งแต่ 1 ต.ค. 2569)

---

## 1. ปัญหาและเป้าหมาย

**ปัญหา:** คนจัดรถเป็นหัวหน้าคนขับทั้งหมด และเป็นคนอนุมัติใบลาเอง แต่ลืม → จัดงานให้คนขับที่ลาวันนั้น → คนขับโทรมาบอกว่าลา (เกิดขึ้นจริงแล้ว)

**เป้าหมาย:** ตอนเลือกคนขับ / ตอนสร้างทริป / ตอนส่งใบสรุปเข้า LINE คนจัดรถเห็นทันทีว่าคนขับคนไหนลาใน **วันของทริป** โดยข้อมูลมาจากระบบใบลาแบบสด (ช้าสุด ~1 นาที, ตอนกดยืนยันสดเสมอ) และเมื่อเพิ่ม/ปลดคนขับ ไม่ต้องตั้งค่าอะไรในระบบใบลา

**จังหวะงานจริง:** จัดคิวล่วงหน้า 1 วันเป็นส่วนใหญ่ บางครั้ง 2–3 วัน

**ไม่ทำ (ตั้งใจ):**
- ลากะทันหันหลังจัดคิวแล้ว — ใช้วิธีเดิม (คนขับโทรแจ้ง → ทำใบสรุปใหม่ → แจ้งกลุ่ม LINE)
- บล็อกการจัดคิว — เตือนอย่างเดียว ยืนยันต่อได้เสมอ
- เขียนข้อมูลใด ๆ กลับไประบบใบลา
- ระบบใบลาเตือนตอนกดอนุมัติว่า "คนนี้มีทริปแล้ว" (ไอเดียอนาคต ต้องให้ระบบใบลาอ่าน Firestore)
- ใส่ข้อมูลวันลาลงรูป A4 / ข้อความ LINE ที่ส่งกลุ่ม

## 2. ข้อตกลงที่ผู้ใช้เคาะแล้ว

| เรื่อง | ข้อตกลง |
|---|---|
| ผูกคน 2 ระบบ | คนขับมีช่อง **รหัสพนักงาน** (ตรงกับรหัสล็อกอินระบบใบลา) คนจัดรถกรอกเองตอนเพิ่ม/แก้คนขับในหน้าฟลีท — ห้ามจับคู่ด้วยชื่อ |
| วิธีส่งข้อมูล | **ดึงสด** ผ่าน API (ไม่ sync สำเนาลง Firestore, ไม่ใช้ cron) |
| ใบที่นับ | `pending`, `awaiting_doc`, `approved` · ไม่นับ `draft`, `rejected`, `cancelled` |
| การเตือน | เตือน ไม่บล็อก |
| ความลับของข้อมูล | ผู้ใช้ไม่ถือว่าวันลาเป็นข้อมูลลับระดับสูง → **ไม่จำกัด** ว่า API ตอบเฉพาะตำแหน่งคนขับ (ตอบรหัสใดก็ได้ที่ถาม) — ข้อดีคือไม่ต้องดูแลรายชื่อฝั่งระบบใบลาเมื่อเพิ่ม/ปลดคนขับ |
| ประเภทการลา | แสดงประเภทได้ (คนจัดรถเป็นผู้อนุมัติ เห็นใบอยู่แล้ว) |
| deploy ระบบใบลา | **deploy เฉพาะ worker** ไม่ build หน้าเว็บใหม่ → พนักงานไม่เห็นแถบ "มีเวอร์ชันใหม่" |

## 3. ภาพรวม

```
เบราว์เซอร์คนจัดรถ (หน้าจัดคิว / ใบสรุป / ฟลีท / ประวัติการส่ง)
   │  POST /api/driver-leaves  { codes, from, to }      + Firebase ID token
   ▼
ระบบจัดคิว (Vercel route) ── verifyStaffToken() ── admin/dispatcher เท่านั้น
   │  POST {LEAVE_API_URL}/api/integration/driver-leaves  + Bearer LEAVE_API_KEY
   ▼
ระบบใบลา (Cloudflare Worker) ── SELECT employees + requests (อ่านอย่างเดียว)
```

- ทั้ง 2 ทอดเป็น **POST** → service worker ของ PWA (next-pwa / workbox runtime caching จับเฉพาะ GET) ไม่แคชผล → ไม่มีกรณี "ข้อมูลวันลาเก่าจากแคชโผล่เหมือนข้อมูลสด" (ต้องยืนยันกับ config จริงตอน review)
- **วันที่ทุกตัวเป็นสตริง `YYYY-MM-DD` ตามเวลาไทย** ทั้ง 2 ระบบ เทียบด้วยสตริงตรง ๆ — **ห้ามแปลงผ่าน `Date`/`toISOString()`** (เลื่อนวันตาม UTC ช่วง 00:00–07:00)

---

## 4. ระบบใบลา — endpoint ใหม่

### 4.1 ตำแหน่งในโค้ด
`worker/index.ts` ใน `handleApi()` ช่วง `/* ---- auth-free ---- */` (ถัดจาก `/api/access-status`) — **ก่อน** ด่าน session (`getSessionUser`) และด่านพักระบบ (`TESTING_MODE`) เพราะใช้รหัสลับแทน session และไม่ควรดับตามการพักระบบ

### 4.2 การยืนยันตัวตน
- env ใหม่ `TRANSPORT_API_KEY?: string` (wrangler secret) เพิ่มใน `interface Env`
- ไม่ได้ตั้ง secret → `503 { error: "integration_disabled" }` (= สวิตช์ปิดฉุกเฉิน: `wrangler secret delete TRANSPORT_API_KEY` ไม่ต้อง deploy)
- ไม่มี/ผิด `Authorization: Bearer <key>` → `401`
- เทียบด้วย `crypto.subtle.timingSafeEqual` (มีใน Workers) — ความยาวไม่เท่าให้ตอบ 401 ทันที

### 4.3 Request
`POST /api/integration/driver-leaves` body:
```json
{ "codes": ["1234", "5678"], "from": "2026-10-05", "to": "2026-10-05" }
```
- `codes`: array 1–**50** ตัว (D1 จำกัด bound parameter **100 ตัวต่อ query** — 50 รหัส + 2 วันที่ ปลอดภัย) · ตัดซ้ำ + trim
- `from`/`to`: `^\d{4}-\d{2}-\d{2}$`, เป็นวันจริง, `from <= to`, ช่วงไม่เกิน 31 วัน
- รูปแบบผิดระดับทั้งก้อน (ไม่ใช่ array, เกิน 50, วันที่ผิด) → `400`
- **รหัสตัวเดียวรูปแบบผิด (ไม่ใช่ `^\d{4,6}$`) ไม่ทำให้ทั้งก้อนพัง** → ตอบเป็น `null` (ไม่พบ) เฉพาะตัวนั้น — กันคนขับคนเดียวกรอกรหัสผิดแล้วป้ายของทุกคนหาย

### 4.4 Query (อ่านอย่างเดียว ไม่ทำ audit ไม่แตะ session)
```sql
SELECT code, prefix, full_name, active FROM employees WHERE code IN (?,…);

SELECT id, employee_code, type, start_date, end_date, days, status, history
FROM requests
WHERE employee_code IN (?,…)
  AND status IN ('pending','awaiting_doc','approved')
  AND start_date <= ?to AND end_date >= ?from;          -- ทับช่วงแบบรวมหัวท้าย
```
ใช้ index `idx_requests_emp` ที่มีอยู่

### 4.5 Response `200` + `cache-control: no-store`
```json
{
  "employees": {
    "1234": { "name": "นายสมศักดิ์ ใจดี", "active": true },
    "9999": null
  },
  "leaves": [
    {
      "code": "1234", "type": "vacation", "typeLabel": "ลาพักร้อน",
      "start": "2026-10-03", "end": "2026-10-07", "days": 5, "status": "approved",
      "timing": null,
      "edges": { "start": null, "end": { "start": "08:00", "end": "12:00" } }
    }
  ]
}
```
- `name` = `prefix + full_name` · `active` = `employees.active === 1`
- `typeLabel` จาก `LEAVE_TYPE_MAP` (`src/data/leaveTypes.ts` — worker import จาก `../src` ได้อยู่แล้ว)
- `timing` / `edges` = ค่าเดียวกับที่ `inflate()` (`worker/index.ts:482-483`) ดึงจาก history รายการ `kind:'submit'` แต่ส่งแค่ `{ mode?, start, end }` (`mode` เฉพาะ `timing`: `am|pm|hours`) ไม่ส่งฟิลด์อื่นของตารางงาน
- **ไม่ส่ง:** เหตุผล, เบอร์/ที่อยู่ติดต่อ, ไฟล์แนบ, ลายเซ็น, steps/history ดิบ, เลขบัตร, id ใบลา

### 4.6 สิ่งที่ไม่เปลี่ยนในระบบใบลา
ไม่มีตาราง/คอลัมน์ใหม่, ไม่แตะหน้าเว็บ (`src/` ฝั่ง UI), ไม่แตะ cron, ไม่แตะ endpoint เดิม

---

## 5. ระบบจัดคิว

### 5.1 ข้อมูล
- `Driver.employeeCode?: string` (`src/types/models.ts:96`) — ว่าง/ไม่มี = ยังไม่ผูก · ไม่ต้อง migrate เอกสารเดิม

### 5.2 API route `src/app/api/driver-leaves/route.ts`
- `POST` body `{ codes, from, to }` (ส่งต่อไปตรง ๆ — ให้ worker validate)
- `verifyStaffToken(req.headers.get('authorization'))` (`src/firebase/admin.ts`) → null = `401`
- env `LEAVE_API_URL`, `LEAVE_API_KEY` — ไม่ครบ = `503 { error: "not_configured" }`
- `fetch(..., { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(5000) })`
- worker ตอบ 200 → ส่ง body ต่อ · อย่างอื่น/timeout → `502 { error }` · ทุกคำตอบใส่ `cache-control: no-store`

### 5.3 ตรรกะล้วน `src/lib/driverLeave.ts` (+ `driverLeave.test.ts`)
```ts
type DriverLeaveStatus =
  | { kind: 'unmapped' }                         // ไม่มี employeeCode
  | { kind: 'not_found' }                        // employees[code] เป็น null/ไม่มี
  | { kind: 'inactive'; name: string }           // พ้นสภาพ
  | { kind: 'free'; name: string }
  | { kind: 'leave'; name: string; approved: boolean; typeLabel: string;
      start: string; end: string; days: number; part: 'am' | 'pm' | 'hours' | null; hours?: string }

driverLeaveOn(employeeCode: string | undefined, date: string, data: LeaveApiResponse): DriverLeaveStatus
formatLeaveRange(start: string, end: string): string     // "5 ต.ค." | "3–7 ต.ค." | "30 ก.ย.–2 ต.ค." | ข้ามปีใส่ปี พ.ศ. 2 หลัก
leaveBadgeText(s: DriverLeaveStatus): string              // ข้อความป้ายสั้น (ว่าง = ไม่มีป้าย)
leaveConfirmText(driverName: string, date: string, s: DriverLeaveStatus): string  // ข้อความกล่องยืนยันแบบละเอียด
```
กติกา:
- ใบทับวันเมื่อ `start <= date && date <= end` (สตริง)
- หลายใบทับวันเดียวกัน → เลือก `approved`/`awaiting_doc` ก่อน `pending`; เท่ากันเลือกใบที่ `start` เก่าสุด
- `approved` และ `awaiting_doc` → `approved: true` (🏖) · `pending` → `approved: false` (⏳ รออนุมัติ)
- `inactive` ชนะทุกกรณี (พ้นสภาพแล้ว ไม่ควรถูกจัดงาน)
- ส่วนของวัน: ใบวันเดียว + `timing` → `part = timing.mode` (`hours` แนบ `"HH:MM–HH:MM"`) · ใบหลายวัน: `date===start && edges.start` → `pm` · `date===end && edges.end` → `am` · อื่น ๆ = เต็มวัน (`null`)

ข้อความป้าย (ตัวอย่างจัดทริปวันที่ 5 ต.ค.):

| สถานะ | ป้าย |
|---|---|
| ลาหลายวัน อนุมัติ | `🏖 ลาพักร้อน 3–7 ต.ค.` |
| ลาวันเดียว | `🏖 ลากิจ` |
| ครึ่งวัน / ชั่วโมง | `🏖 ลากิจครึ่งวันบ่าย` · `🏖 ลากิจ 13:00–15:00` |
| รออนุมัติ | `⏳ ยื่นลาพักร้อน 4–6 ต.ค. (รออนุมัติ)` |
| ยังไม่ผูก | `❔ ยังไม่ผูกรหัสพนักงาน` |
| ไม่พบรหัส | `❔ ไม่พบรหัสในระบบใบลา` |
| พ้นสภาพ | `⛔ พ้นสภาพในระบบใบลา` |
| ว่าง | (ไม่มีป้าย) |

ลานานแค่ไหนก็บรรทัดเดียว (แสดงเป็นช่วง ไม่ไล่ทีละวัน) — ไม่ทับวันของทริป = ไม่มีป้าย

### 5.4 Hook `src/hooks/use-driver-leaves.ts`
```ts
useDriverLeaves(drivers: Driver[] | undefined, from: string, to: string): {
  status: 'idle' | 'loading' | 'ready' | 'error'
  data: LeaveApiResponse | null      // ผูกกับ key {from,to,codes} — key เปลี่ยน = ล้างทิ้งทันที
  lastOkAt: Date | null
  forDriver(d: Driver, date: string): DriverLeaveStatus | null   // null = ยังไม่รู้ (loading/error ไม่มีข้อมูล)
  refresh(): Promise<LeaveApiResponse>  // ดึงสดสำหรับด่านยืนยัน — พังให้ throw
}
```
- codes = `employeeCode` ที่ trim แล้ว ไม่ว่าง ไม่ซ้ำ · ไม่มีเลย → `ready` ด้วยข้อมูลว่าง ไม่เรียก API · เกิน 50 → แบ่งยิงทีละ 50 แล้วรวม
- token: `auth.currentUser.getIdToken()`
- ดึงใหม่เมื่อ: key เปลี่ยน · `visibilitychange`→visible / `focus` · **ทุก 60 วินาทีขณะหน้าถูกมองเห็น** (คนจัดรถอาจกดอนุมัติใบลาจากมือถือผ่าน push ขณะหน้าจัดคิวเปิดค้างบนคอม)
- กันผลช้าทับผลใหม่ด้วยเลขลำดับคำขอ (seq guard)
- ดึงรอบใหม่พังแต่ key เดิมเคยสำเร็จ → คงข้อมูลเดิม + `status:'error'` + แถบบอกเวลาที่สำเร็จล่าสุด · key ใหม่ยังไม่เคยสำเร็จ → ไม่มีป้าย + แถบเตือน
- **หลักสำคัญ: "ตรวจไม่ได้" ต้องไม่แสดงเหมือน "ไม่มีใครลา"** (บทเรียน PR#46)

แถบเตือนกลาง (component เล็ก ใช้ซ้ำ): `⚠️ ตรวจวันลาจากระบบใบลาไม่ได้ตอนนี้ — ป้ายวันลาอาจไม่ครบ` (+ `ข้อมูลล่าสุดเมื่อ HH:MM` ถ้ามี)

### 5.5 จุดที่ใช้งาน

**(1) หน้าฟลีท** — `src/app/(dashboard)/fleet/page.tsx`
- `driverSchema` + ฟอร์ม: ช่อง "รหัสพนักงาน (ระบบใบลา)" ไม่บังคับ
- พิมพ์แล้ว (debounce ~500ms) ตรวจผ่าน API เดียวกัน (`codes:[code]`, from=to=วันนี้ไทย) → แสดงใต้ช่อง: `✓ นายสมศักดิ์ ใจดี` / `❔ ไม่พบรหัสนี้ในระบบใบลา` / `⛔ พ้นสภาพ` / `⚠️ ตรวจไม่ได้ตอนนี้` — บันทึกได้ทุกกรณี (เตือนอย่างเดียว)
- เตือนถ้ารหัสซ้ำกับคนขับคนอื่น
- การ์ดคนขับแสดงรหัส · หัวรายการ: `ยังไม่ผูกรหัสพนักงาน N คน`
- `driverForm.reset(...)` ตอนแก้ไขต้องใส่ `employeeCode` ด้วย (ไม่งั้นแก้ชื่อแล้วรหัสหาย)

**(2) หน้าจัดคิว** — `trip-grouping/page.tsx` + `components/trip-grouping/TripControlPanel.tsx`
- วันที่ของป้าย = `requestDate` ของจุดที่เลือกอยู่ (ถ้าเลือกแล้ว — ระบบบังคับวันเดียวอยู่แล้ว `page.tsx:341-352`) ไม่งั้น `targetDateStr`
- dropdown คนขับ: ป้ายต่อท้ายชื่อ ข้าง ✅ "มีงานแล้ว" เดิม
- **ด่านจริงใน `onCreate`:** หลังเช็ค "เลือกข้ามวัน" ก่อนเช็ค "มี Trip แล้ว" (`page.tsx:354`) → `refresh()` สด → สถานะของคนขับที่เลือก ณ `targetDateStrForCheck`:
  - `leave` / `inactive` → `window.confirm(leaveConfirmText(...))` (แบบเดียวกับ `pairConflict` ที่มีอยู่) — ยกเลิก = กลับไปเปลี่ยนคนขับ
  - `refresh()` พัง → `window.confirm("⚠️ ตรวจวันลาไม่ได้ตอนนี้ — ยืนยันสร้างเที่ยววิ่งต่อ?")`
  - `unmapped` / `not_found` / `free` → ผ่าน ไม่ถาม (ป้าย ❔ แสดงอยู่แล้ว — กันเตือนจนชิน)

ตัวอย่างข้อความยืนยัน:
```
⚠️ สมศักดิ์ ลาวันที่ 5 ต.ค.
ลาพักร้อน 3–7 ต.ค. (5 วัน) · อนุมัติแล้ว

ยืนยันจัดงานให้คนนี้?
```

**(3) หน้าใบสรุป** — `daily-summary/page.tsx` (วันที่ = `selectedDate`)
- ป้ายบนการ์ดทริปในส่วนแอดมิน — คนขับที่เช็ค = `actualDriverId || driverId` · **ต้องอยู่นอก `#summary-report`** (ไม่ติดรูป JPEG / ไม่หลุดเข้ากลุ่ม)
- **ก่อน "ส่งเข้า LINE กลุ่ม"** (ฟังก์ชันส่งรอบ `page.tsx:314-355`): `refresh()` → มีคนขับในทริปวันนั้นลา/พ้นสภาพ → `window.confirm` รายชื่อ · พัง → confirm "ตรวจวันลาไม่ได้ ส่งต่อ?" — จับเคสจัดล่วงหน้า 2–3 วันแล้วคนขับยื่นลาทีหลัง
- ป้ายในตัวเลือกคนขับของ: โยกงานไปคน/รถใหม่ (`:2019`), คันช่วย (`:2089`), ขับแทนโดย (`setActualDriver` `:685`) — เป็น `<select>` ธรรมดา ใส่ข้อความป้ายใน `<option>`
- ข้อความ LINE / รูป A4: **ไม่เปลี่ยน**

**(4) ประวัติการส่ง → แก้ทริป** — `trips/history/page.tsx:659` ป้ายใน dropdown คนขับ ตามวันที่ของทริปที่แก้

**ไม่แตะ:** `/trips/plan` (ไม่อยู่ในเมนูแล้ว), ใบงานคนขับ `/driver/[tripId]`, หน้า report, การคำนวณสถิติ/อันดับ

---

## 6. กรณีขอบ / ข้อผิดพลาด

| กรณี | ผล |
|---|---|
| ระบบใบลาล่ม / ช้าเกิน 5 วิ | แถบ ⚠️ · ด่านยืนยันถามว่า "ตรวจไม่ได้ ยืนยันต่อ?" · ยังจัดคิวได้ |
| Secret ฝั่งใบลาถูกลบ (ปิดฉุกเฉิน) | 503 → เหมือนระบบใบลาล่ม |
| Env ฝั่ง Vercel ไม่ครบ | 503 → แถบ ⚠️ |
| พิมพ์รหัสผิดรูปแบบ | ตัวนั้น `not_found` ❔ คนอื่นปกติ |
| HR เปลี่ยนรหัสพนักงาน | รหัสเดิม `not_found` ❔ → คนจัดรถแก้ที่ฟลีท |
| พนักงานใหม่ HR ยังไม่เพิ่ม | ❔ จนกว่า HR เพิ่ม แล้วทำงานเอง |
| เปิดหน้าค้าง / อนุมัติจากมือถือ | ป้ายตามภายใน ≤60 วิ · ด่านยืนยันสดเสมอ |
| คนขับยื่นลาหลังจัดทริปไปแล้ว | เห็นที่ป้ายการ์ดใบสรุป + ด่านก่อนส่ง LINE |
| เปลี่ยนวันที่ระหว่างโหลด | seq guard ทิ้งผลเก่า · ข้อมูลผูกกับ key |

## 7. ข้อจำกัดที่รับได้

- ส่วนของวัน (ครึ่งเช้า/บ่าย/ชั่วโมง) อ้างอิงเวลา **ตอนยื่น** — ถ้า HR "ปรับเวลาลาจริง" ภายหลัง ป้ายอาจยังแสดงตามที่ยื่น
- ใบลากระดาษที่ HR นำเข้าทีหลัง จะไม่ขึ้นจนกว่าจะนำเข้า → กติกา: คนขับยื่นลาในแอป
- ไม่ push แจ้งเตือน — ต้องเปิดหน้าถึงเห็น
- 50 รหัสต่อคำขอ (hook แบ่งยิงให้)

## 8. การทดสอบ

**ระบบจัดคิว**
- `driverLeave.test.ts` (vitest): ทับช่วงรวมหัวท้าย (วันแรก/วันสุดท้าย/วันก่อน/วันหลัง), ไม่นับ status อื่น (API กรองแล้ว แต่ฟังก์ชันต้องไม่พังถ้าได้มา), approved ชนะ pending, inactive ชนะ leave, unmapped / not_found, ครึ่งวันใบเดียว (am/pm/hours), ครึ่งวันหัว/ท้ายใบหลายวัน, `formatLeaveRange` เดือนเดียว/ข้ามเดือน/ข้ามปี/วันเดียว
- `npx tsc --noEmit` + `npx vitest run` ก่อน push (CI รันแค่ vitest — Vercel build พังถ้า type error)
- ทดสอบบน Vercel preview — **preview ใช้ Firestore เดียวกับ production** (บันทึกรหัสพนักงานใน preview = เขียนข้อมูลจริง ซึ่งเป็นข้อมูลที่ต้องกรอกอยู่แล้ว) · **ห้ามกด "ส่งเข้า LINE กลุ่ม" ตอนทดสอบ** (กลุ่มจริง) — ทดสอบด่านก่อนส่งด้วยการกด "ยกเลิก" ที่ confirm

**ระบบใบลา** (ไม่มี unit test runner — ใช้สคริปต์ `.mjs` แบบ `scripts/verify-*.mjs` + `wrangler dev` กับ D1 local)
- ไม่มี key → 401 · key ผิด → 401 · ไม่ตั้ง secret → 503 · 51 รหัส → 400 · ช่วง 32 วัน → 400 · from > to → 400
- รหัสรูปแบบผิดปนมา → ตัวนั้น null คนอื่นปกติ
- ใบ cancelled/rejected/draft ไม่มา · ใบทับช่วงบางส่วนมา · คืน `timing`/`edges` ถูกตัว
- response ไม่มีฟิลด์ต้องห้าม (reason, contact_*, attachments, signature, history, national_id)
- worker `tsc` ผ่าน

## 9. ลำดับขึ้นระบบ / ย้อนกลับ

1. **ระบบใบลา:** ยืนยันว่าไม่มี session อื่นแก้โฟลเดอร์อยู่ → สำรอง `worker/` (+`src/data/leaveTypes.ts`) → เทียบ `dist/version.json` ในเครื่องกับ `/version.json` บน production ต้องตรงกัน (ไม่ตรง = หยุด) → แก้ + ทดสอบ local
2. Codex ตรวจโค้ดทั้ง 2 ฝั่ง
3. **deploy worker อย่างเดียว:** worker `tsc` → `npx wrangler deploy` (**ไม่รัน `npm run build`** → `dist` เดิม → ไม่มีแถบอัปเดต) → จดเลข version ก่อน/หลัง → `npx wrangler secret put TRANSPORT_API_KEY` → curl ตรวจ 401/200 → ตรวจ `/version.json` ยังเป็น buildId เดิม
4. **ระบบจัดคิว:** ตั้ง env Vercel `LEAVE_API_URL`, `LEAVE_API_KEY` → push branch → ทดสอบ preview → ผู้ใช้อนุมัติ → merge main (= deploy production)
5. คนจัดรถผูกรหัสพนักงานให้คนขับครบ (ดูตัวนับ "ยังไม่ผูก N คน")

**ย้อนกลับ:** ระบบจัดคิว revert commit · ระบบใบลา `wrangler rollback <version เดิม>` · ปิดเร็วสุด = `wrangler secret delete TRANSPORT_API_KEY` (ระบบจัดคิวขึ้น ⚠️ ตรวจไม่ได้ ใช้งานต่อได้)
