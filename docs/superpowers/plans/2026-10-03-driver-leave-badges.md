# ป้ายวันลาคนขับ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ดึงใบลาสดจากระบบใบลาออนไลน์มาแสดงเป็นป้าย + ด่านยืนยันทุกจุดที่มอบงานให้คนขับหรือส่งใบสรุปออกในระบบจัดคิว

**Architecture:** ระบบใบลาเพิ่ม endpoint อ่านอย่างเดียว (ไฟล์ใหม่ `worker/integration.ts`) ล็อกด้วยรหัสลับ → ระบบจัดคิวมี route ตัวกลางตรวจ staff → ฝั่ง client มีตรรกะล้วน (`driverLeave.ts`), ชั้นเรียก API + ด่านยืนยัน (`driverLeaveClient.ts`), hook ดึง/poll (`use-driver-leaves.ts`) แล้วหน้าเดิม 4 หน้าเรียกใช้

**Tech Stack:** ระบบใบลา: Cloudflare Workers + D1, TypeScript, ทดสอบด้วยสคริปต์ `node` + esbuild + `node:sqlite` · ระบบจัดคิว: Next.js 15 (App Router), Firebase (Firestore/Auth), vitest (environment `node`)

**Spec:** `docs/superpowers/specs/2026-10-03-driver-leave-badges-design.md` (ฉบับ 2, อนุมัติแล้ว) — อ่านคู่กับแผนนี้เสมอ

**ที่อยู่โค้ด:**
- ระบบจัดคิว: worktree `C:\Users\kantapat\Desktop\COWORK SPACE\ระบบจัดคิวรถ\driver-leave` branch `feat/driver-leave-badges`
- ระบบใบลา: `C:\Users\kantapat\Desktop\COWORK SPACE\HR\ใบลาออนไลน์\leave-system` (**ไม่มี git** — ใช้สำรองโฟลเดอร์ + ไฟล์ HANDOFF แทน commit)

**ฐานโค้ด:** branch rebase บน `origin/main` @ `6c4bc2f` แล้ว — ซึ่งมีงานแยก 2 ชิ้นที่ merge ไปก่อน: `872e710` (ใบสรุปกันผล query วันเก่าทับ — มี `src/lib/latestRequest.ts`) และ `cc7c069` (รัด Firestore rules: `drivers` เขียนได้เฉพาะ staff ที่ active, `verifyStaffToken` เช็ก `active === true` — **rules ยังต้อง publish ที่ Firebase Console เอง**)

**สภาพแวดล้อมทดสอบในเครื่อง (ไม่แตะ production):**
- ระบบจัดคิว: Firebase Emulator ตาม CLAUDE.md — `npm run emulators` + `npm run seed:emulator` + `.env.development.local` (`NEXT_PUBLIC_FIREBASE_EMULATOR=1`, `FIRESTORE_EMULATOR_HOST`, และเพิ่ม `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` ให้ route ตรวจ token กับ emulator — Task 4) + `LEAVE_API_URL=http://127.0.0.1:8787`, `LEAVE_API_KEY=<ค่าเดียวกับ .dev.vars>` · worktree ที่ junction `node_modules` รัน `next dev` แบบไม่มี `--turbopack`
- ระบบใบลา: `npx wrangler dev` (D1 local) + `TRANSPORT_API_KEY` ใน `.dev.vars` · ข้อมูลใบลาทดสอบใส่ด้วย `npx wrangler d1 execute lotus-leave --local --command "..."` (**ห้าม `--remote`**)

## Global Constraints

- วันที่ทุกตัวเป็นสตริง `YYYY-MM-DD` เวลาไทย เทียบด้วยสตริง — **ห้ามได้วันที่จาก `toISOString()`** · "วันนี้" ใช้ `thaiToday()` เท่านั้น
- สถานะ `unknown` (ตรวจไม่ได้/ยังไม่รู้/นอกช่วง) **ห้ามถูกตีเป็น `free`** ทุกที่
- ใบที่นับ: `pending`, `awaiting_doc`, `approved` · เตือนไม่บล็อก
- รหัสต่อคำขอสูงสุด **50** · ช่วงวันรวมหัวท้ายไม่เกิน **31 วัน** · รหัสพนักงาน `^\d{4,6}$`
- timeout: route → worker **5000 ms** · client รวมทั้งสาย **8000 ms** · poll ทุก **60 วิ** ขณะแท็บมองเห็น
- ข้อความป้าย/ยืนยันใช้ตามตารางใน spec 5.3 / 5.5 ตรงตัว
- ป้ายเป็น element แยก — **ห้ามต่อเข้า `driverName`** หรือตัวแปรที่ใช้ทำข้อความ LINE / รูป A4 · ในใบสรุปต้องอยู่ **นอก `#summary-report`**
- Vercel preview ใช้ Firestore + กลุ่ม LINE **เดียวกับ production** — ห้ามกด ส่ง LINE / คัดลอกข้อความเพื่อส่ง ตอนทดสอบ · push `main` = deploy production ทันที (ต้องได้คำอนุมัติผู้ใช้)
- ก่อน push: `npx tsc --noEmit` + `npx vitest run` ต้องผ่าน (CI รันแค่ vitest แต่ Vercel build พังถ้า type error)
- ระบบใบลา: **ห้ามรัน `npm run build` / `npm run deploy`** (จะ build หน้าเว็บใหม่) — deploy ด้วย `npx wrangler deploy` เท่านั้น และทำใน Task 10 หลังผู้ใช้อนุมัติ
- คุยกับผู้ใช้เป็นภาษาไทย

## Review Focus

1. **แก้ชื่อ/เบอร์คนขับแล้วกดบันทึกโดยไม่แตะช่องรหัส** → รหัสพนักงานเดิมต้องอยู่ครบ (Task 6 ตรวจมือ ขั้น 6)
2. **สลับวันที่เร็ว ๆ ในหน้าจัดคิว/ใบสรุป** → ป้ายต้องเป็นของวันที่แสดงอยู่ ไม่ค้างจากวันก่อน (hook key + seq guard — Task 5 ตรวจมือ ขั้น 4)
3. **ระบบใบลาล่ม/ช้า** → แถบ ⚠️ ขึ้น และด่านถาม "ตรวจไม่ได้ ยืนยันต่อ?" ไม่ผ่านเงียบ ๆ (Task 3 test `confirm: check fails → asks unknown prompt`, Task 5 ตรวจมือด้วยการตั้ง env ผิดบน local)
4. **กด "คัดลอกข้อความ" บน Safari/มือถือของคนจัดรถ** → หลังรอด่าน การคัดลอกต้องสำเร็จ หรือขึ้น error ไม่ใช่ toast สำเร็จหลอก (Task 8 ตรวจมือ ขั้น 7)
5. **เปิดหน้าครั้งแรกขณะ Firebase auth ยังโหลด** → hook ต้องรอแล้วยิงทันทีเมื่อ user พร้อม ไม่ใช่รอ 60 วิ (Task 5 ตรวจมือ ขั้น 4: hard refresh แล้วป้ายขึ้นภายในไม่กี่วินาที)

---

## Part A — ระบบใบลา

### Task 1: endpoint `POST /api/integration/driver-leaves`

**Files:**
- Create: `leave-system/worker/integration.ts`
- Modify: `leave-system/worker/index.ts` — `interface Env` (เพิ่ม `TRANSPORT_API_KEY?: string`) และช่อง `/* ---- auth-free ---- */` ใน `handleApi()` (ถัดจาก `/api/access-status` ~บรรทัด 914)
- Test: `leave-system/scripts/verify-driver-leaves.mjs`
- Create: `HR/ใบลาออนไลน์/HANDOFF-2026-10-0x-DRIVER-LEAVES-API.md` (ตามรูปแบบ HANDOFF เดิม)

**Interfaces:**
- Produces (HTTP contract ตาม spec 4.3–4.5):
  ```ts
  // request
  { codes: unknown[]; from: string; to: string }
  // 200
  { employees: Record<string, { name: string; active: boolean } | null>;
    leaves: { code: string; type: string; typeLabel: string; start: string; end: string; days: number;
              status: 'pending' | 'awaiting_doc' | 'approved';
              timing: { mode: 'am' | 'pm' | 'hours'; start: string; end: string } | null;
              edges: { start: { start: string; end: string } | null; end: { start: string; end: string } | null } | null }[] }
  // 400 { error } · 401 { error: "unauthorized" } · 503 { error: "integration_disabled" }
  ```
- `export async function handleDriverLeaves(req: Request, env: Env): Promise<Response>` ใน `worker/integration.ts` (`import type { Env } from "./index"`)

- [ ] **Step 1: เตรียมก่อนแตะไฟล์ (ห้ามข้าม)**
  - ถามผู้ใช้ว่ามี session/Codex อื่นแก้ `leave-system` อยู่ไหม — ถ้ามี หยุด
  - หลักฐานตรงกับ live ตาม spec ข้อ 9 (ก)(ข)(ค): `npx wrangler deployments list` (อ่านอย่างเดียว) · เวลาแก้ไฟล์ `worker/**`, `src/lib/**`, `src/data/**`, `package-lock.json`, `wrangler.jsonc` ต้องเก่ากว่า deployment ที่ active · hash ทุกไฟล์ใน `dist/` เทียบกับ GET `https://lotus-leave.kantapat0263.workers.dev/<path>?t=<ts>` ต้องตรงทั้งชุด — ไม่ผ่าน = หยุด รายงานผู้ใช้
  - สำรอง: คัดลอก `leave-system` (ไม่รวม `node_modules`, `.wrangler`) ไป `HR/ใบลาออนไลน์/backup-2026-10-0x-driver-leaves/`
  - Expected: มีโฟลเดอร์สำรอง + บันทึกเลข version ที่ active ไว้ใน HANDOFF

- [ ] **Step 2: เขียนสคริปต์ทดสอบที่ยังไม่ผ่าน** `scripts/verify-driver-leaves.mjs`

  ใช้โครงเดียวกับ `scripts/verify-fixes.mjs` (คัดลอก `makeD1` ที่จำลองเพดาน 100 ตัวแปร, `bundle("worker/index.ts")`, `freshDb()` จาก `schema.sql`, ฟังก์ชัน `ok(name, cond)`) **และก่อน import worker ให้ polyfill** `crypto.subtle.timingSafeEqual` ด้วย `timingSafeEqual` จาก `node:crypto` (Node ไม่มีตัวนี้บน `subtle`) · `ENV = { DB, TRANSPORT_API_KEY: "test-key", TESTING_MODE: "true" }` (เปิดพักระบบไว้เพื่อพิสูจน์ว่า endpoint ไม่ดับตาม)

  seed: พนักงาน `10001` (active), `10002` (active=0), `10003` (active) · ใบลาของ `10001`:
  `A` approved 2026-10-03→2026-10-07 vacation · `B` approved 2026-10-10 personal history submit `timing:{mode:'am',start:'08:00',end:'12:00',...}` · `C` pending 2026-10-10 vacation `timing mode 'pm'` · `D` cancelled 2026-10-05 · `E` rejected 2026-10-05 · `F` draft 2026-10-05 · `G` approved 2026-10-12 history = `'not json'`
  และของ `10003`: `H` awaiting_doc 2026-10-05 sick

  ```js
  const call = (body, auth = "Bearer test-key", method = "POST") => /* new Request → worker.fetch(req, ENV, ctx) → {status, json} */;
  const r1 = await call({ codes: ["10001","10002","99999","abc",null,{}], from: "2026-10-05", to: "2026-10-05" });
  ok("200", r1.status === 200);
  ok("employees active", r1.json.employees["10001"]?.active === true && r1.json.employees["10001"].name.length > 0);
  ok("employees inactive", r1.json.employees["10002"]?.active === false);
  ok("not found = null", r1.json.employees["99999"] === null);
  ok("bad code = null ไม่พังทั้งก้อน", r1.json.employees["abc"] === null);
  ok("นับเฉพาะ A ของ 10001 วันที่ 5", JSON.stringify(r1.json.leaves.filter(l=>l.code==="10001").map(l=>l.start)) === '["2026-10-03"]');
  ok("ไม่มี D/E/F", !r1.json.leaves.some(l => l.start === "2026-10-05" && l.code === "10001"));
  ok("ไม่มีฟิลด์ต้องห้าม", !/reason|contact|attachment|signature|history|national_id|"id"/.test(JSON.stringify(r1.json)));
  ok("typeLabel", r1.json.leaves[0].typeLabel === "ลาพักร้อน");
  ok("no-store", /* res.headers.get("cache-control") */ === "no-store");

  const r2 = await call({ codes: ["10001"], from: "2026-10-10", to: "2026-10-10" });
  ok("เช้า+บ่ายคนละใบมาครบ 2 ใบ", r2.json.leaves.length === 2);
  ok("timing am", r2.json.leaves.find(l=>l.status==="approved").timing.mode === "am");

  const r3 = await call({ codes: ["10001"], from: "2026-10-12", to: "2026-10-12" });
  ok("history เสีย → ใบยังมา timing null", r3.json.leaves.length === 1 && r3.json.leaves[0].timing === null && r3.json.leaves[0].edges === null);

  const r4 = await call({ codes: ["10003"], from: "2026-10-05", to: "2026-10-05" });
  ok("awaiting_doc นับ", r4.json.leaves[0]?.status === "awaiting_doc");

  ok("ไม่มี key → 401", (await call({codes:["10001"],from:"2026-10-05",to:"2026-10-05"}, null)).status === 401);
  ok("key ผิด → 401", (await call({codes:["10001"],from:"2026-10-05",to:"2026-10-05"}, "Bearer nope")).status === 401);
  ok("ยังไม่ตั้ง secret → 503", /* ENV ไม่มี TRANSPORT_API_KEY */ === 503);
  ok("JSON เสีย → 400", /* body "{" */ === 400);
  ok("51 รหัส → 400", (await call({codes: Array.from({length:51},(_,i)=>String(20000+i)), from:"2026-10-05", to:"2026-10-05"})).status === 400);
  ok("50 รหัสผ่าน (ไม่ชนเพดาน D1)", (await call({codes: Array.from({length:50},(_,i)=>String(20000+i)), from:"2026-10-05", to:"2026-10-05"})).status === 200);
  ok("1–31 ต.ค. ผ่าน", (await call({codes:["10001"],from:"2026-10-01",to:"2026-10-31"})).status === 200);
  ok("1 ต.ค.–1 พ.ย. → 400", (await call({codes:["10001"],from:"2026-10-01",to:"2026-11-01"})).status === 400);
  ok("from > to → 400", (await call({codes:["10001"],from:"2026-10-06",to:"2026-10-05"})).status === 400);
  ok("วันไม่มีจริง → 400", (await call({codes:["10001"],from:"2026-02-30",to:"2026-02-30"})).status === 400);
  ok("ผิดทุกรหัส → 200 null ทั้งหมด", JSON.stringify((await call({codes:["x"],from:"2026-10-05",to:"2026-10-05"})).json) === '{"employees":{"x":null},"leaves":[]}');
  ok("GET ไม่เข้า route", (await call(undefined, "Bearer test-key", "GET")).status !== 200);
  ```
  ปิดท้ายด้วย `process.exit(fail ? 1 : 0)`

- [ ] **Step 3: รันให้เห็นว่าไม่ผ่าน**
  Run: `node scripts/verify-driver-leaves.mjs`
  Expected: มี `❌ FAIL` (route ยังไม่มี → 401/404) exit code 1

- [ ] **Step 4: เขียน `handleDriverLeaves` ใน `worker/integration.ts` และต่อเข้า `index.ts`**
  - ลำดับ: secret ไม่ตั้ง → 503 · เทียบ `Authorization` ด้วย `crypto.subtle.timingSafeEqual` (เทียบ `byteLength` ก่อน) → 401 · `req.json()` พัง/ไม่ใช่ object → 400 · validate ตาม spec 4.3 · ตัดซ้ำหลัง trim · รหัสผิดรูป → `employees[raw] = null` (key ใช้ค่าที่ trim แล้ว ถ้าไม่ใช่ string ใช้ `String(raw)`) · ไม่มีรหัสที่ถูกต้องเหลือ → ตอบเลยไม่ยิง SQL
  - SQL 2 คำสั่งตาม spec 4.4 (bind ไม่เกิน 52 ตัว) · `name = [prefix, full_name].filter(Boolean).join("")` · `typeLabel = LEAVE_TYPE_MAP[type]?.label ?? type`
  - `timing`/`edges`: `JSON.parse(history)` ใน try/catch → หา `kind === 'submit'` → map เหลือ `{mode,start,end}` / `{start,end}` · พัง = `null`
  - ตอบ `cache-control: no-store` ทุกกรณี (รวม error)
  - `index.ts`: เพิ่มบรรทัดเดียวในช่อง auth-free: `if (path === "/api/integration/driver-leaves" && method === "POST") return handleDriverLeaves(req, env);`

- [ ] **Step 5: รันให้ผ่าน + typecheck**
  Run: `node scripts/verify-driver-leaves.mjs` → Expected: ✅ ทุกข้อ exit 0
  Run: `npx tsc -p worker/tsconfig.json --noEmit` → Expected: ไม่มี error
  Run: `node scripts/verify-fixes.mjs` → Expected: ผ่านเท่าเดิม (ไม่กระทบของเดิม)

- [ ] **Step 6: บันทึก** — เขียน `HANDOFF-2026-10-0x-DRIVER-LEAVES-API.md`: สิ่งที่เพิ่ม, ไฟล์ที่แตะ, เลข version ที่ active ก่อนแก้, ผลเทสต์, สถานะ "ยังไม่ deploy"

---

## Part B — ระบบจัดคิว (worktree `driver-leave`)

### Task 2: ตรรกะล้วน `src/lib/driverLeave.ts`

**Files:**
- Create: `src/lib/driverLeave.ts`, `src/lib/driverLeave.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface LeaveApiResponse { employees: Record<string, { name: string; active: boolean } | null>; leaves: ApiLeave[] }
  export interface ApiLeave { code: string; type: string; typeLabel: string; start: string; end: string; days: number;
    status: 'pending' | 'awaiting_doc' | 'approved';
    timing: { mode: 'am' | 'pm' | 'hours'; start: string; end: string } | null;
    edges: { start: { start: string; end: string } | null; end: { start: string; end: string } | null } | null }
  export interface Coverage { from: string; to: string }
  export type LeaveItem = { approved: boolean; typeLabel: string; start: string; end: string; days: number; part: 'am' | 'pm' | 'hours' | null; hours?: string }
  export type DriverLeaveStatus =
    | { kind: 'unknown' } | { kind: 'unmapped' } | { kind: 'driver_missing' } | { kind: 'not_found' }
    | { kind: 'inactive'; name: string } | { kind: 'free'; name: string }
    | { kind: 'leave'; name: string; items: LeaveItem[] }
  export function thaiToday(now?: Date): string
  export function validateLeaveResponse(x: unknown): LeaveApiResponse          // throw Error เมื่อผิด schema
  export function leaveStatusOn(code: string | undefined, date: string, res: LeaveApiResponse | null, coverage: Coverage | null): DriverLeaveStatus
  export function formatLeaveRange(start: string, end: string): string
  export function leaveBadgeText(s: DriverLeaveStatus): string
  export function leaveConfirmLines(driverName: string, date: string, s: DriverLeaveStatus): string[]
  ```

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน** `src/lib/driverLeave.test.ts`
  ```ts
  const res = (leaves: Partial<ApiLeave>[], employees = { "10001": { name: "สมศักดิ์", active: true } }) => ({ employees, leaves: leaves.map(l => ({ code: "10001", type: "vacation", typeLabel: "ลาพักร้อน", start: "2026-10-03", end: "2026-10-07", days: 5, status: "approved", timing: null, edges: null, ...l })) }) as LeaveApiResponse
  const cov = { from: "2026-10-01", to: "2026-10-31" }

  describe("leaveStatusOn", () => {
    it("ทับวันแรก/วันสุดท้าย นับ · วันก่อน/หลังไม่นับ", ...)  // 03,07 → leave ; 02,08 → free
    it("unmapped เมื่อไม่มีรหัส", () => expect(leaveStatusOn(undefined, "2026-10-05", res([]), cov).kind).toBe("unmapped"))
    it("unknown เมื่อ res null / วันนอก coverage / code ไม่มี key", ...)       // 3 กรณี → "unknown"
    it("not_found เมื่อ employees[code] === null", ...)
    it("inactive ชนะ leave", ...)                                             // active:false + มีใบ → inactive
    it("awaiting_doc = approved:true · pending = approved:false", ...)
    it("เก็บทุกใบในวันเดียว: เช้า approved + บ่าย pending", () => {
      const s = leaveStatusOn("10001", "2026-10-10", res([
        { start: "2026-10-10", end: "2026-10-10", type: "personal", typeLabel: "ลากิจ", days: 0.5, timing: { mode: "am", start: "08:00", end: "12:00" } },
        { start: "2026-10-10", end: "2026-10-10", status: "pending", days: 0.5, timing: { mode: "pm", start: "13:00", end: "17:00" } },
      ]), cov)
      expect(s.kind).toBe("leave"); expect((s as any).items.map((i: any) => [i.part, i.approved])).toEqual([["am", true], ["pm", false]])
    })
    it("hours แนบช่วงเวลา", ...)                                              // part "hours", hours "13:00–15:00"
    it("ใบหลายวัน: วันแรก edges.start = pm · วันสุดท้าย edges.end = am · วันกลาง null", ...)
  })
  describe("validateLeaveResponse", () => {
    it("ผ่านเมื่อรูปถูก", ...)
    it("throw: ไม่ใช่ object / ไม่มี employees / leaves ไม่ใช่ array / status แปลก / วันที่ผิดรูป / ได้สตริง HTML", ...)
  })
  describe("formatLeaveRange", () => {
    it("วันเดียว", () => expect(formatLeaveRange("2026-10-05", "2026-10-05")).toBe("5 ต.ค."))
    it("เดือนเดียว", () => expect(formatLeaveRange("2026-10-03", "2026-10-07")).toBe("3–7 ต.ค."))
    it("ข้ามเดือน", () => expect(formatLeaveRange("2026-09-30", "2026-10-02")).toBe("30 ก.ย.–2 ต.ค."))
    it("ข้ามปี ใส่ พ.ศ. 2 หลัก", () => expect(formatLeaveRange("2026-12-30", "2027-01-02")).toBe("30 ธ.ค. 69–2 ม.ค. 70"))
  })
  describe("leaveBadgeText", () => {
    // ทุกแถวในตาราง spec 5.3 — ตัวอย่าง:
    it("หลายวันอนุมัติ", ...)       // "🏖 ลาพักร้อน 3–7 ต.ค."
    it("วันเดียว", ...)            // "🏖 ลากิจ"
    it("ครึ่งวันบ่าย / ชั่วโมง", ...) // "🏖 ลากิจครึ่งวันบ่าย" · "🏖 ลากิจ 13:00–15:00"
    it("รออนุมัติ", ...)           // "⏳ ยื่นลาพักร้อน 4–6 ต.ค. (รออนุมัติ)"
    it("หลายใบ", ...)              // มี approved → "🏖 ลา 2 ช่วง" · pending ทั้งหมด → "⏳ ลา 2 ช่วง (รออนุมัติ)"
    it("unmapped/not_found/driver_missing/inactive", ...) // "❔ ยังไม่ผูกรหัสพนักงาน" · "❔ ไม่พบรหัสในระบบใบลา" · "❔ ไม่พบข้อมูลคนขับ" · "⛔ พ้นสภาพในระบบใบลา"
    it("free และ unknown = ''", ...)
  })
  describe("leaveConfirmLines", () => {
    it("แจกแจงทุกใบ", () => expect(leaveConfirmLines("สมศักดิ์", "2026-10-10", twoItemStatus)).toEqual([
      "⚠️ สมศักดิ์ ลาวันที่ 10 ต.ค.", "• ลากิจ ครึ่งวันเช้า · อนุมัติแล้ว", "• ลาพักร้อน ครึ่งวันบ่าย · รออนุมัติ"]))
    it("หลายวัน แสดงช่วง+จำนวนวัน", ...) // "• ลาพักร้อน 3–7 ต.ค. (5 วัน) · อนุมัติแล้ว"
    it("inactive", ...)                 // ["⛔ สมศักดิ์ พ้นสภาพในระบบใบลาแล้ว"]
  })
  describe("thaiToday", () => {
    it("00:30 ไทย = วันไทย ไม่ใช่วัน UTC", () => expect(thaiToday(new Date("2026-10-04T17:30:00Z"))).toBe("2026-10-05"))
  })
  ```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน** — Run: `npx vitest run src/lib/driverLeave.test.ts` → Expected: FAIL (module not found)
- [ ] **Step 3: เขียน `src/lib/driverLeave.ts`** ตาม Interfaces + กติกา spec 5.3 · ชื่อเดือนย่อไทย `ม.ค. … ธ.ค.` · พ.ศ. = ค.ศ.+543 เอา 2 หลักท้าย · `thaiToday` = เลื่อน +7 ชม. แล้วอ่าน `getUTC*` · `items` เรียง `am` < เต็มวัน/`hours` ตาม `start` < `pm`
- [ ] **Step 4: รันให้ผ่าน** — Run: `npx vitest run src/lib/driverLeave.test.ts` → Expected: PASS ทั้งหมด
- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/driverLeave.ts src/lib/driverLeave.test.ts
  git commit -m "feat(driver-leave): ตรรกะสถานะวันลาคนขับ + ข้อความป้าย/ยืนยัน"
  ```

### Task 3: ชั้นเรียก API + ด่านยืนยันกลาง `src/lib/driverLeaveClient.ts`

**Files:**
- Create: `src/lib/driverLeaveClient.ts`, `src/lib/driverLeaveClient.test.ts`
- Modify: `src/types/models.ts:96` — เพิ่ม `employeeCode?: string` ใน `interface Driver`

**Interfaces:**
- Consumes: `LeaveApiResponse`, `Coverage`, `validateLeaveResponse`, `leaveStatusOn`, `leaveConfirmLines` (Task 2) · `Driver` (มี `employeeCode?` แล้วจากไฟล์ที่แก้ใน Task นี้)
- Produces:
  ```ts
  export type CheckResult = { ok: true; res: LeaveApiResponse; coverage: Coverage } | { ok: false }
  export type CheckFn = (codes: string[], from: string, to: string) => Promise<CheckResult>
  export function normalizeCodes(codes: (string | undefined)[]): string[]          // trim, ตัดว่าง, ตัดซ้ำ, เรียง
  export async function fetchDriverLeaves(opts: { codes: string[]; from: string; to: string;
    getToken: () => Promise<string>; fetchImpl?: typeof fetch; timeoutMs?: number /* 8000 */; signal?: AbortSignal }): Promise<LeaveApiResponse>
  export function makeCheck(getToken: () => Promise<string>, fetchImpl?: typeof fetch): CheckFn
  export async function confirmLeaveBeforeAssign(check: CheckFn, targets: { driverId: string; date: string }[],
    drivers: Driver[], confirmFn?: (msg: string) => boolean /* window.confirm */): Promise<boolean>
  ```

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน** (ใช้ `fetchImpl` ปลอม + `confirmFn` ปลอม)
  ```ts
  it("normalizeCodes", () => expect(normalizeCodes([" 2 ", "1", "", undefined, "1"])).toEqual(["1", "2"]))
  it("ไม่มีรหัส → ไม่ยิง fetch คืนข้อมูลว่าง", ...)              // fetchImpl ไม่ถูกเรียก, {employees:{},leaves:[]}
  it("ส่ง POST /api/driver-leaves พร้อม Bearer token", ...)
  it("51 รหัส → แบ่ง 2 คำขอ (50+1) แล้วรวมผล", ...)
  it("batch ใดพัง → throw ทั้งรอบ", ...)                        // คำขอที่ 2 ตอบ 502
  it("ได้ HTML/ผิด schema → throw", ...)
  it("เกิน timeoutMs → throw", ...)                             // fetchImpl ไม่ resolve, timeoutMs 50
  it("confirm: ทุกคนว่าง → true ไม่ถาม", ...)
  it("confirm: check fails → asks unknown prompt", async () => {
    const asked: string[] = []
    const r = await confirmLeaveBeforeAssign(async () => ({ ok: false }), [{ driverId: "d1", date: "2026-10-05" }], drivers, m => (asked.push(m), false))
    expect(r).toBe(false); expect(asked[0]).toBe("⚠️ ตรวจวันลาไม่ได้ตอนนี้ — ยืนยันทำต่อ?")
  })
  it("confirm: ลา → ข้อความแจกแจง + 'ยืนยันทำต่อ?' · ตอบ true คืน true", ...)
  it("confirm: คนเดียวกันหลาย target → ชื่อไม่ซ้ำในข้อความ", ...)
  it("confirm: unmapped / not_found / driver_missing → ไม่ถาม คืน true", ...)
  it("confirm: หลายวัน → check ถูกเรียกด้วย from=min to=max", ...)
  ```
- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน** — `npx vitest run src/lib/driverLeaveClient.test.ts` → FAIL
- [ ] **Step 3: เขียน `driverLeaveClient.ts`** — timeout ด้วย `AbortController` + `setTimeout` (รวม `opts.signal` ถ้ามี) · `res.ok` ไม่จริง → throw · `validateLeaveResponse(await res.json())` · รวม batch ด้วย `Object.assign` ของ `employees` และต่อ `leaves` · `confirmLeaveBeforeAssign`: map `driverId → Driver` (ไม่เจอ = `driver_missing`), ข้อความ = `leaveConfirmLines` ของทุกคน (ตัดซ้ำตาม driverId+date) ต่อด้วยบรรทัดว่าง + `"ยืนยันทำต่อ?"` · `makeCheck` ห่อ `fetchDriverLeaves` คืน `{ok:false}` เมื่อ throw
- [ ] **Step 4: รันให้ผ่าน** — `npx vitest run src/lib/driverLeaveClient.test.ts` → PASS
- [ ] **Step 5: Commit** — `git add src/lib/driverLeaveClient.ts src/lib/driverLeaveClient.test.ts src/types/models.ts` · `git commit -m "feat(driver-leave): ชั้นเรียก API (แบ่ง batch/timeout/validate) + ด่านยืนยันกลาง"`

### Task 4: route `src/app/api/driver-leaves/route.ts`

**Files:**
- Create: `src/app/api/driver-leaves/route.ts`, `src/app/api/driver-leaves/route.test.ts`

- Modify: `src/firebase/admin.ts` — `verifyStaffToken` (URL ของ `accounts:lookup`)
- Test: `src/firebase/admin.test.ts` (สร้างใหม่)

**Interfaces:**
- Consumes: `verifyStaffToken` (`src/firebase/admin.ts`) · env `LEAVE_API_URL`, `LEAVE_API_KEY`
- Produces: `export async function POST(req: NextRequest): Promise<NextResponse>` · `export const dynamic = 'force-dynamic'` (แบบ `tracking/devices/route.ts`) · `export function identityToolkitLookupUrl(apiKey: string, emulatorHost?: string): string` ใน `admin.ts`

- [ ] **Step 0: ให้ `verifyStaffToken` ตรวจ token กับ Auth emulator ได้ (เพื่อทดสอบในเครื่องโดยไม่แตะ production)**
  - เทสต์ใน `admin.test.ts`: `identityToolkitLookupUrl("k")` → `"https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=k"` · `identityToolkitLookupUrl("k", "127.0.0.1:9099")` → `"http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:lookup?key=k"`
  - รัน → FAIL · แยก URL ออกเป็น `identityToolkitLookupUrl` แล้ว `verifyStaffToken` เรียกด้วย `process.env.FIREBASE_AUTH_EMULATOR_HOST` · รัน → PASS · `npx vitest run` ทั้งหมดผ่าน (route อื่นที่ใช้ helper นี้ไม่เปลี่ยนพฤติกรรมเมื่อไม่ตั้ง env — **ห้ามตั้ง env นี้บน Vercel**)

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน** (`vi.mock('@/firebase/admin', () => ({ verifyStaffToken: vi.fn() }))`, `vi.stubGlobal('fetch', ...)`, `vi.stubEnv`)
  ```ts
  it("ไม่ผ่าน staff → 401", ...)
  it("env ไม่ครบ → 503 not_configured", ...)
  it("ส่งต่อ body + Bearer LEAVE_API_KEY ไปที่ `${LEAVE_API_URL}/api/integration/driver-leaves` แล้วคืน 200 body เดิม", ...)
  it("worker ตอบ 401/500 หรือ fetch throw → 502", ...)
  it("ทุกคำตอบมี cache-control: no-store", ...)
  ```
- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน** — `npx vitest run src/app/api/driver-leaves/route.test.ts` → FAIL
- [ ] **Step 3: เขียน `route.ts`** ตาม spec 5.2 · `AbortSignal.timeout(5000)` · ตัด `/` ท้าย `LEAVE_API_URL`
- [ ] **Step 4: รันให้ผ่าน** — PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(driver-leave): route ตัวกลาง /api/driver-leaves (staff only, no-store)"`

### Task 5: hook + แถบเตือน + ป้าย

**Files:**
- Create: `src/hooks/use-driver-leaves.ts`, `src/components/driver-leave/LeaveCheckBanner.tsx`, `src/components/driver-leave/LeaveBadge.tsx`

**Interfaces:**
- Consumes: `fetchDriverLeaves`, `makeCheck`, `normalizeCodes`, `CheckFn` (Task 3) · `leaveStatusOn`, `leaveBadgeText` (Task 2) · `useUser` (`@/firebase`)
- Produces:
  ```ts
  export function useDriverLeaves(drivers: Driver[] | undefined, from: string, to: string): {
    status: 'loading' | 'ready' | 'error'; lastOkAt: Date | null;
    forDriver(driverId: string, date: string): DriverLeaveStatus; check: CheckFn }
  export function LeaveCheckBanner(props: { status: 'loading' | 'ready' | 'error'; lastOkAt: Date | null }): JSX.Element | null
  export function LeaveBadge(props: { status: DriverLeaveStatus }): JSX.Element | null   // span สั้น ใช้ leaveBadgeText; '' = null
  ```

- [ ] **Step 1: เขียน hook** ตามสัญญา spec 5.4 ทุกข้อ — รอ `user && drivers !== undefined` · key = `from|to|normalizeCodes(...).join(",")` · กันผลเก่าทับด้วย `createLatestRequestGuard()` จาก `src/lib/latestRequest.ts` (มีอยู่แล้วจาก `872e710` — เก็บใน `useRef`) ครอบ data/error/status/lastOkAt · poll `setInterval(60_000)` เฉพาะ `document.visibilityState === "visible"` + ฟัง `visibilitychange`/`focus` · คำขอค้างอยู่ให้ใช้ promise เดิม · `forDriver`: หา driver ไม่เจอ → `driver_missing`, ข้อมูลไม่ผูก key ปัจจุบัน → `unknown`
- [ ] **Step 2: เขียน `LeaveCheckBanner`** — `loading` → `⏳ กำลังตรวจวันลา…` · `error` → `⚠️ ตรวจวันลาจากระบบใบลาไม่ได้ตอนนี้ — ป้ายวันลาอาจไม่ครบ` + ` (ข้อมูลล่าสุดเมื่อ HH:MM)` ถ้ามี `lastOkAt` · `ready` → null · สไตล์แถบเตือนแบบเดียวกับแถบเหลือง/แดงในหน้าใกล้เคียง
- [ ] **Step 3: Typecheck** — Run: `npx tsc --noEmit` → Expected: ไม่มี error
- [ ] **Step 4: ตรวจมือ (ทำหลัง Task 7 ต่อเข้าหน้าจัดคิวแล้ว — จดผลไว้ในรายงาน Task 7)** — `npm run dev` + `.env.local` ชี้ `LEAVE_API_URL` ไปที่ `wrangler dev` ของระบบใบลา: (ก) hard refresh → ป้ายขึ้นภายในไม่กี่วินาที (ข) สลับวันเร็ว 3 ครั้ง → ป้ายตรงวันสุดท้าย (ค) ปิด `wrangler dev` → แถบ ⚠️ ขึ้นใน ≤ 70 วิ ป้ายเดิมคงพร้อมเวลา (ง) เปลี่ยนแท็บแล้วกลับ → ยิงใหม่ทันที
- [ ] **Step 5: Commit** — `git commit -m "feat(driver-leave): hook ดึง/poll วันลา + แถบเตือน + ป้าย"`

### Task 6: หน้าฟลีท — รหัสพนักงาน

**Files:**
- Modify: `src/app/(dashboard)/fleet/page.tsx` — `driverSchema` (`:61`), `defaultValues` (`:188`), `onDriverSubmit` (`:295`), ทุก `driverForm.reset(...)` (`:466`, `:494`), การ์ดคนขับ (`:476-515`), ฟอร์ม (`:694-700`)

**Interfaces:**
- Consumes: `fetchDriverLeaves`, `thaiToday`, `leaveStatusOn`, `normalizeCodes`

- [ ] **Step 1: schema/ฟอร์ม** — `employeeCode: z.string().trim().regex(/^(\d{4,6})?$/, "รหัสพนักงานเป็นตัวเลข 4–6 หลัก")` · default `""` · reset ตอนแก้ไข `employeeCode: d.employeeCode ?? ""` · ช่อง "รหัสพนักงาน (ระบบใบลา)" ใต้เบอร์โทร
- [ ] **Step 2: ตรวจรหัสสด** — debounce 500ms เมื่อค่าตรงรูปแบบ → `fetchDriverLeaves({codes:[code], from: thaiToday(), to: thaiToday(), ...})` → ใต้ช่อง: `✓ <name>` / `❔ ไม่พบรหัสนี้ในระบบใบลา` / `⛔ พ้นสภาพ` / `⚠️ ตรวจไม่ได้ตอนนี้` · ทิ้งผลที่ตอบช้า (เทียบรหัสปัจจุบัน) · รหัสซ้ำกับคนขับอื่น → `⚠️ รหัสนี้ผูกกับ <ชื่อ> อยู่แล้ว` · บันทึกได้ทุกกรณี
- [ ] **Step 3: บันทึกแบบรอผล** — `onDriverSubmit` เป็น `async` ใช้ `await updateDoc` / `await setDoc(..., { merge: true })` (import จาก `firebase/firestore`) · toast สำเร็จ + ปิด dialog **หลัง** await · catch → toast error เดิม ไม่ปิดฟอร์ม · ค่า `""` = ตั้งใจล้าง (บันทึก `employeeCode: ""`)
- [ ] **Step 4: การ์ด + ตัวนับ** — การ์ดแสดง `รหัสพนักงาน: <code>` หรือ `❔ ยังไม่ผูกรหัส` · หัวรายการคนขับ: `ยังไม่ผูกรหัสพนักงาน N คน` (ซ่อนเมื่อ N=0)
- [ ] **Step 5: Typecheck + เทสต์เดิม** — `npx tsc --noEmit` และ `npx vitest run` → ผ่าน
- [ ] **Step 6: ตรวจมือบน local** — เพิ่มคนขับพร้อมรหัส → การ์ดแสดงรหัส · แก้ชื่ออย่างเดียวแล้วบันทึก → **รหัสยังอยู่** · ล้างรหัสแล้วบันทึก → กลับเป็น "ยังไม่ผูก" · ปิดเน็ต (DevTools offline) แล้วบันทึก → ไม่มี toast สำเร็จ ฟอร์มยังเปิด
- [ ] **Step 7: Commit** — `git commit -m "feat(driver-leave): ฟลีท — ช่องรหัสพนักงาน ตรวจชื่อจากระบบใบลา และบันทึกแบบรอผล"`

### Task 7: หน้าจัดคิว

**Files:**
- Modify: `src/app/(dashboard)/trip-grouping/page.tsx` — เรียก hook, `confirmCreateTrip` (`:372`), `handleMergeTrip` (`:540`), ส่ง prop ให้ panel (`:773`)
- Modify: `src/components/trip-grouping/TripControlPanel.tsx` — dropdown คนขับ (`:82-97`) รับ prop `leaveFor: (driverId: string) => DriverLeaveStatus`

**Interfaces:**
- Consumes: `useDriverLeaves`, `LeaveCheckBanner`, `LeaveBadge` (Task 5) · `confirmLeaveBeforeAssign` (Task 3)

- [ ] **Step 1: ป้าย** — `badgeDate = selectedDestinations[0]?.requestDate ?? targetDateStr` · `useDriverLeaves(drivers, badgeDate, badgeDate)` · `<LeaveBadge>` ต่อท้ายชื่อใน `SelectItem` ข้าง "(มีงานแล้ว)" · `<LeaveCheckBanner>` เหนือ panel
- [ ] **Step 2: ด่านใน `confirmCreateTrip`** — หลังคำนวณ `dests` (ก่อนเขียนอะไร): `if (!(await confirmLeaveBeforeAssign(check, [{ driverId, date: dests[0].requestDate }], drivers ?? []))) return` (อยู่ใน try ที่ `finally` ปลด `isProcessing` อยู่แล้ว) · เก็บ `driverId` ไว้ในตัวแปรก่อน await แล้วเทียบหลัง await ถ้าเปลี่ยน → return
- [ ] **Step 3: ด่านใน `handleMergeTrip`** — หลัง `validNewStops`: `getDoc(doc(db, "trips", existingTrip.id))` → `fresh.actualDriverId || fresh.driverId` + `fresh.tripDate` → `confirmLeaveBeforeAssign` · ยกเลิก = return
- [ ] **Step 4: Typecheck + เทสต์** — `npx tsc --noEmit` · `npx vitest run` → ผ่าน
- [ ] **Step 5: ตรวจมือบน local** (Firebase Emulator + ข้อมูลใบลาใน D1 local ของ `wrangler dev` — ดู "สภาพแวดล้อมทดสอบ") — dropdown แสดงป้ายตามตาราง spec · สร้างทริปให้คนลา → confirm ขึ้น ยกเลิกได้/ยืนยันได้ · รวมเข้าทริปที่มีคนขับแทนซึ่งลา → confirm ชื่อคนขับแทน · ทำ Task 5 Step 4 (ก)–(ง) ที่หน้านี้
- [ ] **Step 6: Commit** — `git commit -m "feat(driver-leave): หน้าจัดคิว — ป้ายใน dropdown + ด่านก่อนสร้าง/รวมทริป"`

### Task 8: หน้าใบสรุป

**Files:**
- Modify: `src/app/(dashboard)/daily-summary/page.tsx`

**Interfaces:**
- Consumes: `useDriverLeaves`, `LeaveCheckBanner`, `LeaveBadge`, `confirmLeaveBeforeAssign`, `leaveBadgeText`

> หมายเหตุ: `fetchTrips` มียามกันผลวันเก่าทับแล้ว (`872e710`) — เลขบรรทัดในไฟล์นี้อาจเลื่อนจากที่ระบุไว้ 5–10 บรรทัด ให้หาจากชื่อฟังก์ชัน

- [ ] **Step 1: ป้ายบนการ์ด** — `useDriverLeaves(driversData, selectedDate, selectedDate)` (ทริปในหน้าเป็นวันเดียว) · แต่ `forDriver(trip.actualDriverId || trip.driverId, trip.tripDate)` ใช้วันของทริปเอง (ถ้าไม่ตรง coverage จะได้ `unknown` = ไม่มีป้าย ไม่ใช่ว่าง) · วาง `<LeaveBadge>` ในแถบหัวการ์ด "ปิดผลงานจริง" ข้างทะเบียนรถ (`:1724-1730`, นอก `#summary-report`) · `<LeaveCheckBanner>` เหนือแผงปุ่มส่ง
- [ ] **Step 2: ป้ายใน `<option>`** — select "ขับแทนโดย" (`:1744-1754`), โยกงานให้คนใหม่ (`:2019`), คันช่วย (`:2089`): ข้อความ option = `` `${d.name}${t ? "  " + t : ""}` `` โดย `t = leaveBadgeText(forDriver(d.id, trip.tripDate))`
- [ ] **Step 3: ด่านส่งออก 3 ทาง** — ต้น `handleSendLine` (`:310`), `handleCopyMessage` (`:415`), `handleSaveImage` (`:280`): `targets = trips.filter(t => !isFullyMovedOut(t)).map(t => ({ driverId: t.actualDriverId || t.driverId, date: t.tripDate }))` → ไม่ยืนยัน = return ก่อนตั้ง state loading/ส่งอะไร
- [ ] **Step 4: ด่านมอบงาน** — `setActualDriver` (`:685`, เฉพาะ `driverId` ไม่ว่าง) · `setReassignTarget` (`:989`, ทริปปลายทาง) · `createReassignTarget` (`:1007`, คนที่เลือก) · `addAssistStop` (`:1045`, ทริปปลายทางหรือคนที่เลือก) · `handleInsertJob` (`:552`, เฉพาะเมื่อทริปที่รับงาน ≠ ทริปต้นทาง) — ฟังก์ชันที่เป็น sync ให้เปลี่ยนเป็น `async` แล้ว `if (!(await confirmLeaveBeforeAssign(...))) return` เป็นบรรทัดแรกหลังหา target · select ที่ผูก `value` กับข้อมูลทริปจะเด้งกลับค่าเดิมเองเมื่อยกเลิก
- [ ] **Step 5: ตรวจว่าป้ายไม่หลุด** — Run: `npx vitest run` + `npx tsc --noEmit` → ผ่าน · ค้นในไฟล์: `buildSummaryText` และ JSX ภายใน `id="summary-report"` ต้องไม่มี `LeaveBadge`/`leaveBadgeText`
- [ ] **Step 6: ตรวจมือบน local** — การ์ดแสดงป้ายถูกคน (ขับแทน = คนขับแทน) · บันทึกรูปภาพ → รูปไม่มีป้าย · ทุกด่านขึ้น confirm และยกเลิกแล้วไม่มีอะไรเปลี่ยน · **ห้ามกดส่ง LINE ของจริง**: ทดสอบ `handleSendLine` ด้วยการกด "ยกเลิก" ที่ confirm บน local ที่ **ไม่ได้ตั้ง** `LINE_CHANNEL_ACCESS_TOKEN`
- [ ] **Step 7: ตรวจมือ clipboard** — บน local กด "คัดลอกข้อความ" → ยืนยัน → วางในโน้ตได้จริง (Chrome) · ขอผู้ใช้ทดสอบบนเครื่อง/มือถือที่คนจัดรถใช้จริงตอน preview (Task 10) — ถ้าคัดลอกพังต้องขึ้น error ไม่ใช่ "คัดลอกแล้ว ✅"
- [ ] **Step 8: Commit** — `git commit -m "feat(driver-leave): ใบสรุป — ป้ายการ์ด/ตัวเลือก + ด่านก่อนส่งออกและมอบงาน"`

### Task 9: ประวัติการส่ง → แก้ทริป

**Files:**
- Modify: `src/app/(dashboard)/trips/history/page.tsx` — `handleSaveEdit` (`:205`), dropdown (`:659-665`)

- [ ] **Step 1: ป้าย** — `useDriverLeaves(drivers, editingTrip?.tripDate ?? "", editingTrip?.tripDate ?? "")` (ยังไม่เปิดแก้ = ไม่ยิง: hook รอ `from` ไม่ว่าง) · `<LeaveBadge>` ใน `SelectItem`
- [ ] **Step 2: ด่าน** — ใน `handleSaveEdit` หลังเช็คหมายเหตุ: ถ้า `editFormData.driverId !== editingTrip.driverId` → `confirmLeaveBeforeAssign(check, [{ driverId: editFormData.driverId, date: editingTrip.tripDate }], drivers ?? [])` ยกเลิก = return
- [ ] **Step 3: Typecheck + เทสต์** — ผ่าน · ตรวจมือ: เปลี่ยนคนขับเป็นคนลา → confirm ขึ้น · แก้แค่หมายเหตุ → ไม่ถาม
- [ ] **Step 4: Commit** — `git commit -m "feat(driver-leave): ประวัติการส่ง — ป้าย + ด่านเมื่อเปลี่ยนคนขับ"`

---

## Part C — ตรวจและขึ้นระบบ (ทุกขั้นที่แตะ production ต้องได้คำอนุมัติผู้ใช้ก่อน)

### Task 10: Codex ตรวจโค้ด → deploy → ทดสอบ preview → merge

- [ ] **Step 1: ตรวจทั้ง branch** — `npx tsc --noEmit` · `npx vitest run` · `node scripts/verify-driver-leaves.mjs` (ระบบใบลา) → ผ่านทั้งหมด
- [ ] **Step 2: Codex ตรวจโค้ด** — เขียน `ระบบจัดคิวรถ/CODEX-REVIEW-driver-leave-code.md` (กติกาเดียวกับรอบ spec: ตรวจอย่างเดียว) ชี้ไปที่ `git diff origin/main...feat/driver-leave-badges` + ไฟล์ใหม่ในระบบใบลา · รอผล → แก้ตามข้อที่รับ (มีเทสต์ใหม่ทุกข้อที่เป็นบั๊ก)
- [ ] **Step 3: deploy ระบบใบลา (ขออนุมัติผู้ใช้ก่อน)** — ทำ Task 1 Step 1 (หลักฐาน live) ซ้ำ · `npx tsc -p worker/tsconfig.json --noEmit` · `npx wrangler deploy` (ไม่ build) → จดเลข version · ตรวจ hash `dist` บน production ยังตรงชุดเดิม · `npx wrangler secret put TRANSPORT_API_KEY` (สุ่มยาว ≥32 ตัว) → จดเลข version · `curl` POST ไม่มี key → 401, มี key → 200 · อัปเดต HANDOFF
- [ ] **Step 4: ตั้ง env บน Vercel (ขออนุมัติ)** — `LEAVE_API_URL=https://lotus-leave.kantapat0263.workers.dev`, `LEAVE_API_KEY=<ค่าเดียวกัน>` ทั้ง Production และ Preview
- [ ] **Step 5: push branch → ทดสอบบน preview** — ตามสเปค 8 (ห้ามกดส่ง LINE/คัดลอกเพื่อส่ง) + ให้ผู้ใช้ลอง "คัดลอกข้อความ" บนเครื่องคนจัดรถ **แล้ววางในแชตส่วนตัวเท่านั้น**
- [ ] **Step 6: merge `main` (ขออนุมัติ)** → ตรวจ production เปิดหน้าจัดคิวได้ ป้ายขึ้น
- [ ] **Step 7: ส่งมอบ** — แจ้งคนจัดรถผูกรหัสพนักงานให้ครบ (ตัวนับในหน้าฟลีท) · อัปเดต `CLAUDE.md` ของ repo (หัวข้อฟีเจอร์ + gotcha: env 2 ตัว, สวิตช์ปิด, ป้ายต้องอยู่นอก `#summary-report`) · ย้อนกลับตาม spec ข้อ 9
