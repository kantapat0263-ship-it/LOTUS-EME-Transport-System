# ป้ายวันลาคนขับในระบบจัดคิว (ดึงจากระบบใบลาออนไลน์) — Design

- วันที่: 2026-10-03 · **ฉบับ 2** (แก้ตามผลตรวจ Codex `ระบบจัดคิวรถ/AUDIT-2026-10-03-CODEX-driver-leave-spec.md` — ดูข้อ 10)
- สถานะ: **ผู้ใช้อนุมัติแล้ว 2026-10-03** (ยังไม่มีโค้ด)
- branch: `feat/driver-leave-badges` (แตกจาก `origin/main` @ `915b031`)
- ระบบที่แตะ: **ระบบจัดคิว** (repo นี้ — Next.js + Firestore บน Vercel) และ **ระบบใบลา** (`HR/ใบลาออนไลน์/leave-system` — Cloudflare Worker + D1, **ไม่มี git**, ใช้งานจริงตั้งแต่ 1 ต.ค. 2569)

---

## 1. ปัญหาและเป้าหมาย

**ปัญหา:** คนจัดรถเป็นหัวหน้าคนขับทั้งหมด และเป็นคนอนุมัติใบลาเอง แต่ลืม → จัดงานให้คนขับที่ลาวันนั้น → คนขับโทรมาบอกว่าลา (เกิดขึ้นจริงแล้ว)

**เป้าหมาย:** ทุกครั้งที่ระบบจะ **มอบงานให้คนขับ** หรือ **ส่งใบสรุปออกไป** คนจัดรถเห็นทันทีว่าคนขับคนไหนลาใน **วันของทริปนั้น** โดยข้อมูลมาจากระบบใบลาแบบสด — ป้ายตามภายในประมาณ 1 นาทีขณะเปิดหน้าอยู่ และ **ด่านยืนยันดึงสดทุกครั้ง** · เพิ่ม/ปลดคนขับไม่ต้องตั้งค่าอะไรในระบบใบลา

**จังหวะงานจริง:** จัดคิวล่วงหน้า 1 วันเป็นส่วนใหญ่ บางครั้ง 2–3 วัน

**ไม่ทำ (ตั้งใจ):**
- ลากะทันหันหลังจัดคิวแล้ว — ใช้วิธีเดิม (คนขับโทรแจ้ง → ทำใบสรุปใหม่ → แจ้งกลุ่ม LINE)
- บล็อกการจัดคิว — เตือนอย่างเดียว ยืนยันต่อได้เสมอ
- เขียนข้อมูลใด ๆ กลับไประบบใบลา
- ระบบใบลาเตือนตอนกดอนุมัติว่า "คนนี้มีทริปแล้ว" (ไอเดียอนาคต)
- คำนวณว่าเวลาลา (รายชั่วโมง/ครึ่งวัน) ชนกับเวลาทริปหรือไม่ — แค่แสดงให้คนจัดรถตัดสินเอง
- ใส่ข้อมูลวันลาลงรูป A4 / ข้อความ LINE ที่ส่งกลุ่ม

## 2. ข้อตกลงที่ผู้ใช้เคาะแล้ว

| เรื่อง | ข้อตกลง |
|---|---|
| ผูกคน 2 ระบบ | คนขับมีช่อง **รหัสพนักงาน** (ตรงกับรหัสล็อกอินระบบใบลา) คนจัดรถกรอกเองตอนเพิ่ม/แก้คนขับในหน้าฟลีท — ห้ามจับคู่ด้วยชื่อ |
| วิธีส่งข้อมูล | **ดึงสด** ผ่าน API (ไม่ sync สำเนาลง Firestore, ไม่ใช้ cron) |
| ใบที่นับ | `pending`, `awaiting_doc`, `approved` · ไม่นับ `draft`, `rejected`, `cancelled` |
| การเตือน | เตือน ไม่บล็อก |
| ความลับของข้อมูล | ผู้ใช้ไม่ถือว่าวันลาเป็นข้อมูลลับระดับสูง → API **ตอบรหัสใดก็ได้ที่ถาม** (ไม่จำกัดเฉพาะตำแหน่งคนขับ) — ไม่ต้องดูแลรายชื่อฝั่งระบบใบลาเมื่อเพิ่ม/ปลดคนขับ |
| ประเภทการลา | แสดงประเภทได้ (คนจัดรถเป็นผู้อนุมัติ เห็นใบอยู่แล้ว) |
| deploy ระบบใบลา | **deploy เฉพาะ worker** ไม่ build หน้าเว็บใหม่ (ต้องพิสูจน์ว่า `dist` เดิมทั้งชุด — ข้อ 9) |

## 3. ภาพรวม

```
เบราว์เซอร์คนจัดรถ (หน้าจัดคิว / ใบสรุป / ฟลีท / ประวัติการส่ง)
   │  POST /api/driver-leaves  { codes, from, to }      + Firebase ID token   (client timeout รวม 8 วิ)
   ▼
ระบบจัดคิว (Vercel route) ── verifyStaffToken() ── admin/dispatcher
   │  POST {LEAVE_API_URL}/api/integration/driver-leaves  + Bearer LEAVE_API_KEY   (timeout 5 วิ)
   ▼
ระบบใบลา (Cloudflare Worker) ── SELECT employees + requests (อ่านอย่างเดียว)
```

- ทั้ง 2 ทอดเป็น **POST** → next-pwa 5.6.0 (ค่า default) จับ `/api/*` เฉพาะ GET จึงไม่แคชผล (Codex ยืนยันจาก `cache.js` + Workbox default) · ยังใส่ `cache-control: no-store` ทุกคำตอบ
- **วันที่ทุกตัวเป็นสตริง `YYYY-MM-DD` ตามเวลาไทย** เทียบด้วยสตริงตรง ๆ — **ห้ามได้วันที่จาก `toISOString()`** (ช่วง 00:00–07:00 ไทยได้วันเมื่อวาน) · ต้องการ "วันนี้" ให้ใช้ helper วันไทยตัวเดียว (`src/lib/driverLeave.ts` → `thaiToday()`)
- **หลักสูงสุด: "ตรวจไม่ได้ / ยังไม่รู้" ห้ามแสดงหรือตัดสินเหมือน "ไม่ได้ลา"** (บทเรียน PR#46) — ทุกที่ที่ข้อมูลไม่ครบ ต้องเป็นสถานะ `unknown` ไม่ใช่ `free`

---

## 4. ระบบใบลา — endpoint ใหม่

### 4.1 ตำแหน่งในโค้ด
`worker/index.ts` ใน `handleApi()` ช่วง `/* ---- auth-free ---- */` (ถัดจาก `/api/access-status`) — **ก่อน** ด่าน session และด่านพักระบบ (`TESTING_MODE`) · ต้องจับ path ตรงตัว + `POST` เท่านั้น · ตรวจ secret **ก่อน** อ่าน body · ไม่แตะ session/audit (audit ครอบเฉพาะ mutation หลัง session — Codex ตรวจแล้ว)

### 4.2 การยืนยันตัวตน
- env ใหม่ `TRANSPORT_API_KEY?: string` (wrangler secret) เพิ่มใน `interface Env`
- ไม่ได้ตั้ง secret → `503 { error: "integration_disabled" }`
- ไม่มี/ผิด `Authorization: Bearer <key>` → `401`
- เทียบด้วย `crypto.subtle.timingSafeEqual` บน bytes จาก `TextEncoder` — `byteLength` ไม่เท่าให้ตอบ 401 ก่อนเรียก
- **สวิตช์ปิดฉุกเฉิน:** `wrangler secret delete TRANSPORT_API_KEY` — ไม่ต้องแก้ source แต่ **คำสั่งนี้สร้าง version ใหม่และ deploy ทันที** (เช่นเดียวกับ `secret put`) → จดเลข version ทุกครั้ง

### 4.3 Request
`POST /api/integration/driver-leaves` body `{ "codes": ["12345"], "from": "2026-10-05", "to": "2026-10-05" }`

| ตรวจ | ผิดแล้ว |
|---|---|
| body เป็น JSON object | `400` |
| `codes` เป็น array ยาว 1–**50** (D1 จำกัด 100 bound parameter ต่อ query — Codex ยืนยัน) | `400` |
| `from`/`to` รูป `YYYY-MM-DD` เป็นวันจริง, `from <= to`, ช่วง **รวมหัวท้าย ≤ 31 วัน** (1–31 ต.ค. ผ่าน · 1 ต.ค.–1 พ.ย. ไม่ผ่าน) | `400` |
| สมาชิกแต่ละตัวของ `codes`: ไม่ใช่ string หรือไม่ตรง `^\d{4,6}$` หลัง trim | **ตัวนั้นตอบ `null`** ตัวอื่นปกติ (ไม่ throw ไม่ 500) · ถ้าผิดทุกตัว ข้าม SQL ตอบ null ทั้งหมด |

ตัดซ้ำหลัง trim

### 4.4 Query (อ่านอย่างเดียว)
```sql
SELECT code, prefix, full_name, active FROM employees WHERE code IN (?,…);

SELECT employee_code, type, start_date, end_date, days, status, history
FROM requests
WHERE employee_code IN (?,…)
  AND status IN ('pending','awaiting_doc','approved')
  AND start_date <= ?to AND end_date >= ?from;          -- ทับช่วงแบบรวมหัวท้าย
```
(`start_date`/`end_date` เป็น `NOT NULL` ISO date — Codex ตรวจข้อมูลจริงที่นำเข้าแล้วไม่พบวันว่าง/กลับด้าน)

### 4.5 Response `200` + `cache-control: no-store`
```json
{
  "employees": {
    "12345": { "name": "นายสมศักดิ์ ใจดี", "active": true },
    "99999": null
  },
  "leaves": [
    {
      "code": "12345", "type": "personal", "typeLabel": "ลากิจ",
      "start": "2026-10-05", "end": "2026-10-05", "days": 0.5, "status": "approved",
      "timing": { "mode": "am", "start": "08:00", "end": "12:00" },
      "edges": null
    }
  ]
}
```
- `employees` มี key **ครบทุกรหัสที่ถาม** — `null` = ตรวจแล้วไม่พบ (ต่างจาก "ไม่มี key" ซึ่งฝั่งจัดคิวถือว่า `unknown`)
- `name` = `prefix + full_name` · `active` = `employees.active === 1`
- `typeLabel` จาก `LEAVE_TYPE_MAP` (`src/data/leaveTypes.ts`)
- `timing` / `edges` = จาก history รายการ `kind:'submit'` แบบเดียวกับ `inflate()` (`worker/index.ts:482-483`) ส่งแค่ `{ mode?, start, end }` · **history แปลไม่ได้ / ไม่มี submit → ส่งใบนั้นด้วย `timing:null, edges:null`** (= ถือเป็นเต็มวัน เตือนเกินดีกว่าหาย) ห้ามข้ามใบ
- **ไม่ส่ง:** เหตุผล, เบอร์/ที่อยู่ติดต่อ, ไฟล์แนบ, ลายเซ็น, steps/history ดิบ, เลขบัตร, id ใบลา
- 1 คนมี **หลายใบในวันเดียวได้** (เช่น ลากิจเช้า + ลาพักร้อนบ่าย — `overlapClause` ที่ `worker/index.ts:174` อนุญาตเมื่อเวลาไม่ทับ) → คืนทุกใบ

### 4.6 สิ่งที่ไม่เปลี่ยนในระบบใบลา
ไม่มีตาราง/คอลัมน์ใหม่, ไม่แตะหน้าเว็บ (`src/` ส่วน UI), ไม่แตะ cron, ไม่แตะ endpoint เดิม

---

## 5. ระบบจัดคิว

### 5.1 ข้อมูล
- `Driver.employeeCode?: string` (`src/types/models.ts:96`) — ว่าง/ไม่มี = ยังไม่ผูก · ไม่ต้อง migrate

### 5.2 API route `src/app/api/driver-leaves/route.ts`
- `POST` body `{ codes, from, to }` ส่งต่อตรง ๆ (worker validate)
- `verifyStaffToken(req.headers.get('authorization'))` → null = `401`
- env `LEAVE_API_URL`, `LEAVE_API_KEY` — ไม่ครบ = `503 { error: "not_configured" }`
- fetch worker `method:'POST', cache:'no-store', signal: AbortSignal.timeout(5000)` → 200 ส่ง body ต่อ · อย่างอื่น/timeout → `502 { error }`
- `verifyStaffToken` เองไม่มี timeout (ยิง identitytoolkit + อ่าน Firestore) — **ไม่แก้ helper กลาง** (มี route อื่นใช้) แต่ hook ฝั่ง client ตั้ง timeout รวม 8 วิ ครอบทั้งสาย (5.4)

### 5.3 ตรรกะล้วน `src/lib/driverLeave.ts` (+ `driverLeave.test.ts`)
```ts
type LeaveItem = { approved: boolean; typeLabel: string; start: string; end: string; days: number;
                   part: 'am' | 'pm' | 'hours' | null; hours?: string }   // part ของ "วันที่ถาม"
type DriverLeaveStatus =
  | { kind: 'unknown' }                          // ข้อมูลไม่ครอบรหัส/วันนี้ (loading, error, นอกช่วง, key หาย)
  | { kind: 'unmapped' }                         // คนขับไม่มี employeeCode
  | { kind: 'driver_missing' }                   // ทริปอ้าง driverId ที่หาใน drivers ไม่เจอ
  | { kind: 'not_found' }                        // employees[code] === null
  | { kind: 'inactive'; name: string }
  | { kind: 'free'; name: string }
  | { kind: 'leave'; name: string; items: LeaveItem[] }   // items ≥ 1 เรียงตามเวลาในวัน

thaiToday(now?: Date): string
validateLeaveResponse(x: unknown): LeaveApiResponse          // ผิด schema → throw (ไม่ fallback เป็น {leaves:[]})
leaveStatusOn(code: string | undefined, date: string, res: LeaveApiResponse | null, coverage: {from,to} | null): DriverLeaveStatus
formatLeaveRange(start: string, end: string): string        // "5 ต.ค." | "3–7 ต.ค." | "30 ก.ย.–2 ต.ค." | ข้ามปีใส่ พ.ศ. 2 หลัก
leaveBadgeText(s: DriverLeaveStatus): string                // ว่าง = ไม่มีป้าย
leaveConfirmLines(driverName: string, date: string, s: DriverLeaveStatus): string[]
```
กติกา:
- `res` เป็น null หรือ `date` อยู่นอก `coverage` หรือ `code` ไม่มี key ใน `res.employees` → `unknown` (ห้าม `free`)
- ใบทับวันเมื่อ `start <= date && date <= end` (สตริง) · **เก็บทุกใบที่ทับ** ไม่ตัดทิ้ง
- `approved`, `awaiting_doc` → `approved: true` · `pending` → `false`
- ลำดับตัดสิน: `unmapped` → `unknown` → `not_found` → `inactive` → `leave` → `free`
- part ของวันที่ถาม: ใบวันเดียว + `timing` → `timing.mode` (`hours` แนบ `"HH:MM–HH:MM"`) · ใบหลายวัน: `date===start && edges.start` → `pm` · `date===end && edges.end` → `am` · อื่น ๆ `null` (เต็มวัน)

ป้าย (ตัวอย่างวันที่ 5 ต.ค.):

| สถานะ | ป้าย |
|---|---|
| ลาหลายวัน อนุมัติ | `🏖 ลาพักร้อน 3–7 ต.ค.` |
| ลาวันเดียว | `🏖 ลากิจ` |
| ครึ่งวัน / ชั่วโมง | `🏖 ลากิจครึ่งวันบ่าย` · `🏖 ลากิจ 13:00–15:00` |
| รออนุมัติ | `⏳ ยื่นลาพักร้อน 4–6 ต.ค. (รออนุมัติ)` |
| หลายใบในวันเดียว | `🏖 ลา 2 ช่วง` (มีใบอนุมัติอย่างน้อย 1 = 🏖 · รออนุมัติทั้งหมด = ⏳) — รายละเอียดแจกแจงในกล่องยืนยัน |
| ยังไม่ผูก | `❔ ยังไม่ผูกรหัสพนักงาน` |
| ไม่พบรหัส | `❔ ไม่พบรหัสในระบบใบลา` |
| ไม่พบข้อมูลคนขับ | `❔ ไม่พบข้อมูลคนขับ` |
| พ้นสภาพ | `⛔ พ้นสภาพในระบบใบลา` |
| ไม่รู้ (กำลังโหลด/ตรวจไม่ได้) | ไม่มีป้ายรายคน — แสดงแถบรวมแทน (5.4) |
| ว่าง | (ไม่มีป้าย) |

ลานานแค่ไหนก็บรรทัดเดียว · ไม่ทับวันของทริป = ไม่มีป้าย

### 5.4 Hook `src/hooks/use-driver-leaves.ts`
```ts
useDriverLeaves(drivers: Driver[] | undefined, from: string, to: string): {
  status: 'loading' | 'ready' | 'error'
  forDriver(driverId: string, date: string): DriverLeaveStatus     // driverId หาไม่เจอ → driver_missing
  lastOkAt: Date | null
  check(driverIds: string[], from: string, to: string): Promise<CheckResult>   // ดึงสดสำหรับด่าน — คืนผลของคำขอนั้นเอง
}
```
สัญญา:
- **เริ่มยิงเมื่อ** Firebase auth พร้อม (`user` ไม่ null) **และ** `drivers !== undefined` — `drivers === []` จริงเท่านั้นที่ ready แบบว่าง
- key = `from|to|codes` (trim, ไม่ซ้ำ, **เรียง**) — key เปลี่ยน = ล้างข้อมูลเดิมทันที
- \>50 รหัสแบ่งยิงทีละ 50 — **batch ใดพัง = ทั้งรอบพัง** (ไม่รวมเป็น ready ครึ่ง ๆ)
- ทุก response ผ่าน `validateLeaveResponse` — JSON เสีย / ได้ HTML / ผิด schema = error
- timeout รวมฝั่ง client **8 วิ** (`AbortController`) ครอบ token + route + worker
- ดึงใหม่: key เปลี่ยน · กลับมาที่แท็บ (`visibilitychange`/`focus`) · ทุก 60 วิขณะแท็บมองเห็น (หยุด timer ตอนซ่อน/unmount) · คำขอที่ชนกันรวมเป็นคำขอเดียว
- seq guard ครอบ **data, error, status, lastOkAt** ทั้งหมด — response เก่า (รวมที่ abort/พัง) ห้ามทับผลใหม่
- รอบใหม่พังแต่ key เดิมเคยสำเร็จ → คงป้ายเดิม + แถบ "ข้อมูลล่าสุดเมื่อ HH:MM" · key ใหม่ยังไม่เคยสำเร็จ → ไม่มีป้ายรายคน + แถบเตือน
- `check()` **ไม่อ่าน state ของ hook** — ยิงคำขอใหม่ด้วยพารามิเตอร์ของตัวเอง แล้วคืน `{ ok: true, res, coverage } | { ok: false }` ให้ผู้เรียกใช้ตัดสินทันที
- logout = layout unmount → state หายไปพร้อม hook

แถบรวม (component เดียวใช้ซ้ำ): `⏳ กำลังตรวจวันลา…` / `⚠️ ตรวจวันลาจากระบบใบลาไม่ได้ตอนนี้ — ป้ายวันลาอาจไม่ครบ (ข้อมูลล่าสุดเมื่อ HH:MM)`

### 5.5 ด่านยืนยันกลาง `confirmLeaveBeforeAssign`
helper เดียวใช้ทุกจุดที่ **มอบงานให้คนขับ** (ปุ่มส่งออกใบสรุป LINE/คัดลอก/รูปไม่ใช้ — ดู 5.6) (ไม่คัดลอก logic ไปทีละหน้า):
```ts
confirmLeaveBeforeAssign(check, targets: { driverId: string; date: string }[]): Promise<boolean>
```
1. `await check(...)` สด ครอบทุก `date` ใน targets
2. `ok:false` → `window.confirm("⚠️ ตรวจวันลาไม่ได้ตอนนี้ — ยืนยันทำต่อ?")`
3. รวมสถานะ `leave` / `inactive` (ตัดชื่อซ้ำ) → มี → `window.confirm(รายการละเอียด + "ยืนยันทำต่อ?")` · ไม่มี → `true`
4. `unmapped` / `not_found` / `driver_missing` / `free` → ไม่ถาม (มีป้ายแล้ว กันเตือนจนชิน)

ผู้เรียกต้อง: ใช้ **คนขับจริงของทริปปลายทาง** = `actualDriverId || driverId` (อ่านทริปล่าสุดก่อนตัดสิน) · ระหว่างรอ `check` ปุ่มกดซ้ำไม่ได้ (ใช้ state processing เดิมของจุดนั้น) · ถ้าการเลือก (คนขับ/วัน/จุด) เปลี่ยนระหว่างรอ ให้ยกเลิกการดำเนินการนั้น

ตัวอย่างข้อความ:
```
⚠️ สมศักดิ์ ลาวันที่ 5 ต.ค.
• ลากิจ ครึ่งวันเช้า · อนุมัติแล้ว
• ลาพักร้อน ครึ่งวันบ่าย · รออนุมัติ

ยืนยันทำต่อ?
```

### 5.6 จุดที่ใช้งาน

| หน้า / handler | ป้าย | ด่านยืนยัน (`confirmLeaveBeforeAssign`) | คนขับ / วันที่ที่ตรวจ |
|---|---|---|---|
| **ฟลีท** ฟอร์มคนขับ | ผลตรวจรหัสใต้ช่อง | — | รหัสที่พิมพ์ / `thaiToday()` |
| **จัดคิว** dropdown คนขับ (`TripControlPanel`) | ✓ | — | ทุกคน / `requestDate` ของจุดที่เลือก (ไม่มี = `targetDateStr`) |
| จัดคิว `confirmCreateTrip` (`trip-grouping:372`) | | ✓ ก่อนเขียน | คนขับที่เลือก / `requestDate` ของจุดที่จะลงทริป |
| จัดคิว `handleMergeTrip` (`:540`) | | ✓ ก่อนเขียน | ทริปปลายทาง `actualDriverId \|\| driverId` / `tripDate` ของทริปนั้น |
| **ใบสรุป** การ์ดทริป (ส่วนแอดมิน **นอก `#summary-report`**) | ✓ | — | `actualDriverId \|\| driverId` / **`trip.tripDate` ของแต่ละทริป** (ไม่ใช่ `selectedDate`) |
| ใบสรุป ส่งเข้า LINE กลุ่ม · คัดลอกข้อความ (`handleCopyMessage`) · บันทึกรูปภาพ (`handleSaveImage`) | | — **ตั้งใจไม่มีด่าน** (ผู้ใช้ตัดสินใจ 2026-10-04: คัดลอกต้องเสถียร · ป้ายบนการ์ดทริปยังอยู่) | — |
| ใบสรุป ขับแทนโดย (`setActualDriver :685`) | ✓ ใน select | ✓ เมื่อเลือกคนใหม่ (ไม่ถามตอนล้างกลับเป็นคนขับประจำ) | คนที่เลือก / `trip.tripDate` |
| ใบสรุป โยกไปทริปเดิม (`setReassignTarget :989`) | | ✓ | ทริปปลายทาง `actualDriverId \|\| driverId` |
| ใบสรุป โยกให้คน/รถใหม่ (`createReassignTarget :1007`) | ✓ ใน select | ✓ | คนที่เลือก |
| ใบสรุป คันช่วย (`addAssistStop :1045`) ทั้งทริปเดิม/ใหม่ | ✓ ใน select | ✓ | ทริปปลายทางหรือคนที่เลือก |
| ใบสรุป แทรกงานด่วน → ทริปรถใหม่ (`:607`) | | ✓ | คนขับของทริปที่รับงาน |
| **ประวัติการส่ง** แก้ทริป (`handleSaveEdit :205`, dropdown `:659`) | ✓ | ✓ เมื่อ `driverId` เปลี่ยน | คนที่เลือก / `tripDate` ของทริป |

ไม่ถามซ้ำตอนแก้ข้อความ/ปิดผลงาน/บันทึกผลตามเดิม — ถามเฉพาะตอนเปลี่ยนผู้รับงานหรือสร้างงาน · การเลื่อนงาน (สร้างใบขอวันใหม่) ไม่ต้องมีด่าน เพราะต้องผ่านจัดคิวอีกรอบอยู่แล้ว

**คัดลอกข้อความหลังรอด่าน (ยกเลิกแล้ว 2026-10-04 — ปุ่มส่งออกไม่มีด่าน `writeText` เริ่มซิงก์ใน click ทันที):** การเขียน clipboard หลัง `await` (ดึงสด + confirm) อาจถูกเบราว์เซอร์บางตัวปฏิเสธเพราะหลุดจังหวะที่ผู้ใช้กด (โดยเฉพาะ Safari) — ต้องทดสอบจริงบนเครื่องที่คนจัดรถใช้ ถ้าคัดลอกพังให้แสดง error เดิมของหน้า ไม่ใช่ toast สำเร็จ

**ห้าม** ต่อข้อความป้ายเข้ากับ `driverName` หรือตัวแปรที่ใช้ร่วมกับ payload LINE / A4 — ป้ายเป็น element แยกเสมอ

**ฟลีท (`fleet/page.tsx`) รายละเอียด:**
- `driverSchema` + `defaultValues` + ทุก `driverForm.reset(...)` มี `employeeCode` (แก้ไข = `d.employeeCode ?? ''`) — แก้แค่ชื่อแล้วรหัสต้องคงอยู่ · ลบรหัสในช่องแล้วบันทึก = ตั้งใจล้าง
- พิมพ์รหัส (debounce ~500ms) → ตรวจผ่าน route เดียวกัน → `✓ นายสมศักดิ์ ใจดี` / `❔ ไม่พบรหัสนี้ในระบบใบลา` / `⛔ พ้นสภาพ` / `⚠️ ตรวจไม่ได้ตอนนี้` — บันทึกได้ทุกกรณี · เตือนถ้ารหัสซ้ำกับคนขับคนอื่น
- **บันทึกคนขับเปลี่ยนเป็น `await setDoc/updateDoc`** (เดิม non-blocking แล้ว toast สำเร็จทันที — `non-blocking-updates.tsx:59` ไม่คืน Promise) → toast สำเร็จหลัง Firestore ยืนยันเท่านั้น · พัง = คงฟอร์มไว้ + แจ้ง error
- การ์ดคนขับแสดงรหัส · หัวรายการ `ยังไม่ผูกรหัสพนักงาน N คน`

**ไม่แตะ:** ใบงานคนขับ `/driver/[tripId]`, หน้า report, สถิติ/อันดับ, `/trips/plan` (ดูข้อ 7)

---

## 6. กรณีขอบ

| กรณี | ผล |
|---|---|
| ระบบใบลาล่ม / ทั้งสายช้าเกิน 8 วิ | แถบ ⚠️ · ด่านถาม "ตรวจไม่ได้ ยืนยันต่อ?" · ยังทำงานได้ |
| ปิดฉุกเฉิน (ลบ secret) / env Vercel ไม่ครบ | 503 → เหมือนระบบใบลาล่ม |
| รหัสผิดรูปแบบ 1 ตัว | ตัวนั้น ❔ ไม่พบ คนอื่นปกติ |
| HR เปลี่ยนรหัสพนักงาน | ❔ ไม่พบ → แก้ที่ฟลีท |
| พนักงานใหม่ HR ยังไม่เพิ่ม | ❔ จนกว่า HR เพิ่ม แล้วทำงานเอง |
| ลาเช้า + ลาบ่าย คนละใบ | `🏖 ลา 2 ช่วง` + กล่องยืนยันแจกแจงทุกใบ |
| history ใบลาเสีย | ใบนั้นถือเป็นเต็มวัน (เตือนเกิน ไม่หาย) |
| เปิดกล่องยืนยัน/หน้าค้างแล้วมีใบลาใหม่ | ด่านอยู่ใน handler ที่เขียนจริง ดึงสดทุกครั้ง |
| merge เข้าทริปที่มีคนขับแทน | ตรวจคนขับแทน (`actualDriverId`) |
| คนขับยื่นลาหลังจัดทริปแล้ว (ล่วงหน้า 2–3 วัน) | ป้ายการ์ดใบสรุป (ปุ่มส่ง/คัดลอก/บันทึกรูปไม่มีด่าน ตั้งแต่ 2026-10-04) |
| ทริปอ้างคนขับที่ถูกลบ | ❔ ไม่พบข้อมูลคนขับ |
| ใบสรุปสลับวันเร็ว ๆ แล้วผลวันเก่ามาทับ (บั๊กเดิม ข้อ 7) | ป้าย/ด่านใช้ `trip.tripDate` ของแต่ละทริป จึงยังตรวจวันถูกกับทริปที่เห็น |

## 7. ข้อจำกัดที่รับได้ / เรื่องที่แยกเป็นงานอื่น

- ส่วนของวัน (เช้า/บ่าย/ชั่วโมง) อ้างอิงเวลา **ตอนยื่น** — HR "ปรับเวลาลาจริง" แก้แค่ `days`/history ไม่แก้ช่วงวัน/timing ตอนยื่น (Codex ยืนยัน)
- ใบลากระดาษที่ HR นำเข้าทีหลัง ไม่ขึ้นจนกว่าจะนำเข้า → กติกา: คนขับยื่นลาในแอป
- ไม่ push แจ้งเตือน · "ประมาณ 1 นาที" เป็นค่าโดยประมาณ (เบราว์เซอร์อาจหน่วงแท็บพื้นหลัง) — ด่านยืนยันสดเสมอ
- `/trips/plan` (หน้าต้นแบบเก่า ไม่อยู่ในเมนู ไม่มีลิงก์ชี้มา) ยังพิมพ์ URL เข้าไปสร้างทริปได้ — **ไม่ใส่ด่าน (ผู้ใช้ยืนยัน 2026-10-03)**
- **แยกเป็นงานอื่น (บั๊กเดิม ไม่ได้เกิดจากฟีเจอร์นี้) — แก้บน main แล้ว 2026-10-03:**
  - `firestore.rules` เดิมให้ viewer ยกตัวเองเป็น admin และเขียน `drivers` ได้ → `cc7c069` รัดแล้ว (`drivers` เขียนได้เฉพาะ staff ที่ active, `verifyStaffToken` เช็ก active) — **มีผลจริงเมื่อ publish rules ที่ Firebase Console**
  - `daily-summary fetchTrips` ไม่มียามกันผลวันเก่าทับ → `872e710` แก้แล้ว (`src/lib/latestRequest.ts`) — ป้าย/ด่านยังใช้ `trip.tripDate` ตามเดิม

## 8. การทดสอบ

**ระบบจัดคิว (vitest)** — `driverLeave.test.ts` + test ของ `confirmLeaveBeforeAssign` (mock `check` และ `window.confirm`)
- ทับช่วงรวมหัวท้าย (วันแรก/สุดท้าย/วันก่อน/วันหลัง) · approved/awaiting_doc/pending · inactive ชนะ leave
- หลายใบวันเดียว: เช้า approved + บ่าย approved · เช้า approved + บ่าย pending · รายชั่วโมงหลายช่วง · ใบหลายวันหัว/ท้าย + อีกใบไม่ทับเวลา → ไม่หายจากป้าย/ข้อความยืนยัน
- `unknown`: res null · วันนอก coverage · code ไม่มี key · ต่างจาก `not_found` (null)
- `validateLeaveResponse`: JSON ผิด schema / HTML / ขาดฟิลด์ → throw
- `formatLeaveRange` วันเดียว/เดือนเดียว/ข้ามเดือน/ข้ามปี · `thaiToday` ที่ 00:30 ไทย = วันไทย ไม่ใช่วัน UTC
- `confirmLeaveBeforeAssign`: ok:false → ถาม "ตรวจไม่ได้" · ลา/พ้นสภาพ → ถาม + ชื่อไม่ซ้ำ · unmapped/not_found/free → ไม่ถาม · ใช้ `actualDriverId || driverId`
- hook (ถ้าทดสอบได้ด้วย fake timers): สลับ key A→B แล้ว response A มาทีหลัง → ยังเป็น B · batch หลังพัง → error ไม่ ready · drivers undefined → ไม่ยิง
- `npx tsc --noEmit` + `npx vitest run` ก่อน push

**ทดสอบบน Vercel preview** — preview ใช้ Firestore + กลุ่ม LINE **เดียวกับ production**
- **ห้ามกด "ส่งเข้า LINE กลุ่ม" / "คัดลอกข้อความ" ที่จะนำไปส่ง / ใด ๆ ที่ออกสู่กลุ่มจริงตอนทดสอบ** — ปุ่มส่งออกไม่มีด่านวันลาแล้ว (ตัดสินใจ 2026-10-04) กดแล้วส่งจริงทันที
- ทดสอบได้: ป้ายใน dropdown/การ์ด, ด่านตอนสร้างทริป (กด "ยกเลิก" ที่ confirm), ฟลีท ใส่/แก้ชื่อ/ล้างรหัส (= กรอกข้อมูลจริงที่ต้องกรอกอยู่แล้ว)

**ระบบใบลา** (ไม่มี unit test runner — สคริปต์ `scripts/verify-*.mjs` แบบเดิม + `wrangler dev` กับ D1 local)
- ไม่มี key/ผิด → 401 · ไม่ตั้ง secret → 503 · GET → ไม่เข้า route นี้
- JSON เสีย → 400 · 51 รหัส → 400 · 1–31 ต.ค. ผ่าน · 1 ต.ค.–1 พ.ย. → 400 · from > to → 400 · วันที่ไม่มีจริง → 400
- codes มี `null`/object/รหัสผิดรูป 1 ตัว → ตัวนั้น null คนอื่นปกติ · ผิดทุกตัว → ไม่ยิง SQL
- cancelled/rejected/draft ไม่มา · ทับช่วงบางส่วนมา · เช้า+บ่ายคนละใบมาครบ 2 ใบ · history เสีย → ใบยังมา timing null
- response ไม่มีฟิลด์ต้องห้าม · worker `tsc` ผ่าน

## 9. ลำดับขึ้นระบบ / ย้อนกลับ

1. **ระบบใบลา — เตรียม:**
   - ยืนยันกับผู้ใช้ว่าไม่มี session/Codex อื่นแก้โฟลเดอร์อยู่
   - สำรองทั้ง `leave-system` (ไม่รวม `node_modules`) แบบ `backup-2026-10-0x`
   - **หลักฐานว่าในเครื่องตรงกับที่ deploy อยู่** (ไม่มี git จึงพิสูจน์ 100% ไม่ได้ ใช้หลักฐานรวม):
     (ก) `npx wrangler deployments list` → เวลาของ version ที่ active
     (ข) เวลาแก้ไฟล์ล่าสุดของ `worker/**`, ไฟล์ใน `src/` ที่ worker import, `package-lock.json`, `wrangler.jsonc` ต้อง **เก่ากว่า** เวลานั้น
     (ค) hash ทุกไฟล์ใน `dist/` เทียบกับไฟล์เดียวกันบน production (GET สาธารณะ) ต้องตรงทั้งชุด
     ข้อใดไม่ผ่าน → หยุด รายงานผู้ใช้ ไม่เดา
2. แก้ + ทดสอบ local → **Codex ตรวจโค้ดทั้ง 2 ฝั่ง**
3. **deploy worker อย่างเดียว:** worker `tsc` → `npx wrangler deploy` (**ไม่รัน `npm run build`**) → ตรวจ hash `dist` บน production ยังตรงชุดเดิม → `npx wrangler secret put TRANSPORT_API_KEY` → จดเลข version ทุกขั้น (ก่อน deploy / หลัง deploy / หลังตั้ง secret) → curl ตรวจ 401/200
4. **ระบบจัดคิว:** ตั้ง env Vercel `LEAVE_API_URL`, `LEAVE_API_KEY` → push branch → ทดสอบ preview ตามข้อ 8 → ผู้ใช้อนุมัติ → merge main (= deploy production)
5. คนจัดรถผูกรหัสพนักงานให้คนขับครบ (ดูตัวนับ "ยังไม่ผูก N คน")

**ย้อนกลับ:** ระบบจัดคิว revert commit · ระบบใบลา `npx wrangler rollback <version ก่อน deploy>` · ปิดเร็วสุด = `wrangler secret delete TRANSPORT_API_KEY` (สร้าง version ใหม่ทันที, ระบบจัดคิวขึ้น ⚠️ ใช้งานต่อได้)

---

## 10. ผลตรวจ Codex (ฉบับ 1 → ฉบับ 2)

| ข้อ | ระดับ | ตัดสิน | แก้ที่ |
|---|---|---|---|
| F1 เลือกใบเดียว ช่วงลาอื่นหาย | สูง | รับ | 4.5, 5.3 (`items[]`, ป้าย "ลา N ช่วง") |
| F2 rules ให้ viewer แก้ role/drivers | สูง | รับว่าจริง — **แยกเป็นงานอื่น** (บั๊กเดิม ใหญ่กว่าฟีเจอร์นี้) | 7 |
| F3 ใบสรุป race ของทริป | สูง | รับ — ป้าย/ด่านใช้ `trip.tripDate` · ตัว race เดิม **แยกเป็นงานอื่น** | 5.6, 6, 7 |
| F4 ด่านอยู่ก่อนปุ่มยืนยันจริง + merge ผิดคน | สูง | รับ | 5.5, 5.6 |
| F5 จุดมอบงาน/ส่งออกอื่นไม่มีด่าน | กลาง | รับ — helper กลาง + ตาราง call site · `/trips/plan` เป็นข้อจำกัด | 5.5, 5.6, 7 |
| F6 ฟลีท toast สำเร็จก่อน Firestore ยืนยัน | กลาง | รับ | 5.6 ฟลีท |
| F7 timeout ไม่ครอบ verifyStaffToken | กลาง | รับ — timeout รวมฝั่ง client 8 วิ ไม่แก้ helper กลาง | 3, 5.2, 5.4 |
| F8 หลักฐาน worker ตรง live ไม่พอ + secret ทำให้ deploy | กลาง | รับ | 4.2, 9 |
| สัญญา hook/API 1–10 | — | รับเป็น acceptance criteria | 4.3, 4.5, 5.3, 5.4 |
| Acceptance tests เพิ่ม | — | รับ (ด่าน LINE ทดสอบด้วย unit test ไม่กดบน preview) | 8 |
