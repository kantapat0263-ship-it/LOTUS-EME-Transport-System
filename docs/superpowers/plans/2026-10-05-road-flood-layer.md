# ชั้นน้ำท่วมถนน กทม. บนแผนที่หน้าติดตามรถ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มปุ่ม "🌊 น้ำท่วม" บนแผนที่หน้าติดตามรถ (โหมดวันนี้) ที่ปักหมุดจุดวัดน้ำบนถนน กทม. ที่มีน้ำ พร้อมกล่องรายละเอียด แถบสถานะ และเครดิต POPNIX โดยไม่ทำให้ข้อมูลเสีย/เก่าแสดงเหมือน "ไม่มีน้ำท่วม"

**Architecture:** ตรรกะล้วน (`roadFlood.ts`, `floodInfoState.ts`) ทดสอบได้บน node → API route `/api/road-events` ดึง POPNIX แล้วให้ CDN ของ Vercel cache → hook `useRoadFlood` poll ทุก 5 นาที → `useFloodMarkers` วาดหมุด/InfoWindow ชุดแยก + `FloodStatusBar` ใน `TrackingMap`

**Tech Stack:** Next.js 15 App Router (route handler), React 19, `google.maps.Marker`/`InfoWindow` ผ่าน `@googlemaps/js-api-loader` เดิม, vitest (environment `node`), next-pwa (Workbox)

**Spec:** `docs/superpowers/specs/2026-10-05-road-flood-layer-design.md` (ฉบับ 3) — อ่านคู่กับแผนนี้เสมอ ข้อความ/เกณฑ์ที่อ้าง "spec ข้อ N" ให้ยึดตาม spec

## Global Constraints

- ไม่เพิ่ม package · ไม่เพิ่ม env · ไม่เพิ่ม Firestore collection · **ไม่แก้ `src/app/(dashboard)/tracking/page.tsx`**
- ห้ามเปลี่ยน options ของ `new Loader(...)` ใน `TrackingMap.tsx` (Loader เป็น singleton ทั้งแอป — options ต้องตรงกับ GroupingMap เป๊ะ)
- URL ต้นทาง: `https://flood.pop.in.th/api_roads.php` · ลิงก์เครดิต: `https://flood.pop.in.th` (ตายตัว ไม่เอามาจากข้อมูล)
- ข้อความเครดิต (ห้ามย่อ): `ข้อมูล: สำนักการระบายน้ำ กรุงเทพมหานคร ผ่าน POPNIX Flood (flood.pop.in.th)` · คู่กับ `ไม่ใช่ประกาศเตือนภัยทางการ`
- เกณฑ์: สด ≤ 45 นาที · aging > 45 ถึง ≤ 180 นาที · tooOld > 180 นาที · อนาคตยอมได้ ≤ 5 นาที (เทียบ `fetchedAt` ฝั่ง server) · poll 5 นาที · `now` tick 60 วิ · ปิดกล่อง hover หน่วง 300 ms · timeout ต้นทาง 8000 ms
- header สำเร็จ: `Vercel-CDN-Cache-Control: max-age=300, stale-while-revalidate=600` + `Cache-Control: public, max-age=0, must-revalidate` · ล้ม/ตัวอย่าง/400: `Cache-Control: no-store`
- ข้อความจากต้นทางใส่ DOM ด้วย `textContent` เท่านั้น ห้าม `innerHTML`
- โค้ดชั้นน้ำห้ามเรียก `fitBounds` / `setCenter` / `setZoom` / `clearInstanceListeners(map)`
- เวลาที่แสดงทุกจุดใช้ `timeZone: "Asia/Bangkok"`
- **ไม่ push / ไม่ deploy / ไม่ merge main** จนกว่าผู้ใช้สั่ง · commit message ภาษาไทยได้ ลงท้าย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Windows: รัน npx ผ่าน `cmd //c "npx ..."` ใน Bash (PowerShell บล็อก `npx.ps1`) · `npx tsc --noEmit` ต้องผ่านก่อนทุก commit ที่แตะ `.ts/.tsx` (Vercel build พังถ้ามี type error)

## Review Focus

1. **GPS poll ทุก 60 วิ ระหว่างเปิดชั้น** — หมุดน้ำต้องอยู่ครบ และแผนที่ต้องไม่ขยับ/ซูมเอง → Task 7 ขั้นตรวจมือ 7.5(ก)
2. **สลับรถคันอื่นขณะเปิดชั้น** (`fitKey` เปลี่ยน) — ซูมพอดีเฉพาะของรถ หมุดน้ำไม่ถูกนับเข้า bounds และยังอยู่ → Task 7 ขั้น 7.5(ข)
3. **กดปิดชั้นระหว่าง request ค้าง** — ต้องไม่มีหมุดโผล่หลังปิด → Task 6 (abort + guard) และ Task 7 ขั้น 7.5(ค)
4. **ชี้หมุดที่อยู่ติดกันถี่ ๆ (ใจกลาง กทม.)** — กล่องต้องมีทีละอัน ไม่กระพริบ timer ของจุดก่อนหน้าไม่ปิดจุดใหม่ → เทสต์ reducer ใน Task 5 (`hover A → leave A → hover B → timerFired A ไม่ปิด B`) + ตรวจมือ 7.5(ง)
5. **มือถือ 375px** — ปุ่มสองปุ่ม แถบสถานะ และกล่องรายละเอียดไม่ทับกันจนใช้ไม่ได้ → Task 7 ขั้น 7.5(จ)

---

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| Create `src/lib/roadFlood.ts` | ค่าคงที่ · type · `parseThaiTime` · `normalizeRoads` · `summarizeFlood` · ป้าย/เวลา · `markerKey` · `parseRoadEventsResponse` · `floodStatusText` (ไม่มี I/O, ไม่มี DOM) |
| Create `src/lib/roadFlood.test.ts` | เทสต์ของข้างบน |
| Create `src/lib/roadFloodSample.ts` | `formatThaiTimestamp` + `buildSampleRoadsPayload(now)` (fixture ตัวอย่าง ใช้ใน route dev + เทสต์) |
| Create `src/lib/roadFloodSample.test.ts` | เทสต์ fixture |
| Create `src/app/api/road-events/route.ts` (+ `route.test.ts`) | GET → POPNIX → normalize → header cache |
| Modify `next.config.ts` | กฎ service worker `NetworkOnly` สำหรับ `/api/road-events` |
| Create `src/components/tracking/floodInfoState.ts` (+ `.test.ts`) | reducer ล้วนของ hover/คลิกค้าง/timer/รอบสร้างหมุด |
| Create `src/hooks/use-road-flood.ts` | poll route + phase + `now` |
| Create `src/components/tracking/useFloodMarkers.ts` | สร้าง/ลบหมุด, InfoWindow, เนื้อหากล่อง (DOM), ผูก reducer |
| Create `src/components/tracking/FloodStatusBar.tsx` | แถบสถานะ + เครดิต |
| Modify `src/components/tracking/TrackingMap.tsx` | ปุ่ม 🌊, ต่อ hook ทั้งสาม, `zIndex: 500` ให้หมุดจุดงาน |

---

### Task 1: แปลงเวลา + จัดรูปข้อมูล POPNIX (`parseThaiTime`, `normalizeRoads`)

**Files:**
- Create: `src/lib/roadFlood.ts`
- Test: `src/lib/roadFlood.test.ts`

**Interfaces:**
- Produces (export จาก `@/lib/roadFlood`):
  - ค่าคงที่ `FLOOD_FRESH_MAX_MIN = 45`, `FLOOD_SHOW_MAX_MIN = 180`, `FUTURE_TOLERANCE_MIN = 5`, `POPNIX_URL`, `POPNIX_ROADS_URL`, `CREDIT_TEXT`, `NOT_OFFICIAL_TEXT`
  - `interface FloodPoint` และ `interface RoadFloodSnapshot` — ฟิลด์ตาม spec ข้อ 5 เป๊ะ (`code, name, road, district, dir, isTunnel, lat, lng, level, depthCm, depthAtLeast, measuredAt, floodingSince` / `fetchedAt, sourceLatest, sourceStale, points, usable, offline, assessable, invalid, sample?`)
  - `class RoadFloodDataError extends Error`
  - `parseThaiTime(s: unknown): number | null`
  - `normalizeRoads(raw: unknown, fetchedAt: number): RoadFloodSnapshot` — throw `RoadFloodDataError`

- [ ] **Step 1: เขียนเทสต์ที่ fail** — ใช้ helper `road(over)` คืน record ดิบค่าเริ่มต้น `{ code:"FL.T.01", kind:1, grp:1, name:"ถ.ทดสอบ", road:"ถนนทดสอบ", district:"บางบอน", dir:null, lat:13.7, lng:100.5, depth:15, measured_at:"2026-10-05 14:05:00", level:"flood", since:"2026-10-05 13:40:00" }` และ `payload(roads, summary = { latest:"2026-10-05 14:10:00", stale:false, scrape_failing:false })` · `FETCHED = Date.parse("2026-10-05T14:13:00+07:00")`

```ts
describe("parseThaiTime", () => {
  it("ตีความเป็น +07:00", () => expect(parseThaiTime("2026-10-05 14:05:00")).toBe(Date.parse("2026-10-05T07:05:00Z")))
  it.each([[""], [null], [123], ["2026-10-05T14:05:00"], ["2026-10-05 14:05"], ["2026-02-30 10:00:00"],
           ["2026-02-29 10:00:00"], ["2026-10-05 24:00:00"], ["2026-10-05 23:59:60"], ["2026-13-01 00:00:00"]])
    ("%s → null", (s) => expect(parseThaiTime(s)).toBeNull())
  it("29 ก.พ. ปีอธิกสุรทินผ่าน", () => expect(parseThaiTime("2028-02-29 10:00:00")).not.toBeNull())
})
```
`describe("normalizeRoads")` — แต่ละข้อเป็น `it` ของตัวเอง:
  - flood/slight/dry/off (code ต่างกัน) → `points` = code ของ flood+slight · `usable 4 · offline 1 · assessable 3 · invalid 0`
  - level `"wet"` · lat/lng `0,0` · สลับแกน (`lat:100.5,lng:13.7`) · ไม่มี code · `measured_at:null` (+ dry ปกติ 1 ตัวกัน throw) → `invalid 5`, `usable 1`
  - `depth:null` และ `depth:"15"` → `depthCm === null` (ไม่ใช่ 0)
  - `grp:2, depth:20` → `depthAtLeast true` · `grp:1, depth:20` → `false` · `kind:2` → `isTunnel true`
  - code เดียวกัน: flood เวลา 13:00 + dry 14:00 → `points.length 0`, `usable 1`
  - เวลาเท่ากัน flood มาก่อน dry → จุด flood (ตัวแรกชนะ)
  - code A: dry 14:00 + `level:"???"` 14:10 (+ code B dry) → `usable 1` (B), `invalid 1` — **ไม่ใช้ dry เก่าของ A**
  - code A: dry 14:00 + flood 14:10 พิกัด `0,0` (+ B dry) → A ไม่อยู่ใน points, `invalid 1`
  - code A: dry 14:00 + `measured_at:"bad"` (+ ไม่ต้องมี B) → `usable 1` (ใช้ dry), `invalid 1`
  - `measured_at` = FETCHED+5 นาที → ผ่าน · +5 นาที 1 วิ → invalid
  - ทุก record เวลาอนาคตเกิน 5 นาที → `toThrow(RoadFloodDataError)`
  - ทุกจุด `off` → ไม่ throw, `assessable 0`
  - `summary.latest` = FETCHED+10 นาที → `sourceLatest null` · `stale:true` หรือ `scrape_failing:true` → `sourceStale true`
  - `name:""` → `"จุดวัด FL.T.01"` · `road:"  "` → `null` · `name` ยาว 200 ตัว → ยาว 120
  - `{}` / `{roads:"x"}` / `{roads:[]}` / ทุก record invalid → `toThrow(RoadFloodDataError)`

- [ ] **Step 2: รันให้ fail** — `cmd //c "npx vitest run src/lib/roadFlood.test.ts"` → FAIL (ไม่มีโมดูล)
- [ ] **Step 3: เขียน `parseThaiTime` และ `normalizeRoads`** ตาม spec ข้อ 5 ขั้น 1–5 · ตรวจปฏิทินด้วยการสร้าง `Date.UTC(y, m-1, d, h-7, mi, s)` แล้วเทียบส่วนประกอบกลับ (หรือ regex + ตารางวันในเดือน) · depth รับเฉพาะ `typeof === "number" && Number.isFinite` · ลำดับ: ด่านเวลา → ตัดซ้ำ (เก็บตัวแรกเมื่อเวลาเท่ากัน) → ตรวจ level/พิกัด → นับ
- [ ] **Step 4: รันให้ผ่าน** — คำสั่งเดิม → PASS ทั้งหมด
- [ ] **Step 5: Commit** — `cmd //c "npx tsc --noEmit"` ผ่าน แล้ว `git add src/lib/roadFlood.ts src/lib/roadFlood.test.ts && git commit -m "feat(road-flood): แปลงเวลาไทย + จัดรูปข้อมูลจุดวัดน้ำ POPNIX"`

---

### Task 2: สรุปผล ป้าย ข้อความแถบสถานะ (`summarizeFlood` ฯลฯ)

**Files:**
- Modify: `src/lib/roadFlood.ts`
- Test: `src/lib/roadFlood.test.ts`

**Interfaces:**
- Consumes: Task 1 types
- Produces:
  - `type VisibleFloodPoint = FloodPoint & { aging: boolean }`
  - `interface FloodSummary { visible: VisibleFloodPoint[]; flood: number; slight: number; offline: number; tooOld: number; invalid: number; usable: number; assessable: number; sourceAgeMin: number | null; sourceOld: boolean }`
  - `summarizeFlood(s: RoadFloodSnapshot, now: number): FloodSummary`
  - `depthLabel(p: Pick<FloodPoint, "depthCm" | "depthAtLeast">): string`
  - `ageLabel(ms: number): string` · `formatThaiClock(ms: number): string` (`"14:05"`)
  - `markerKey(visible: VisibleFloodPoint[]): string`
  - `parseRoadEventsResponse(json: unknown): RoadFloodSnapshot | null`
  - `type FloodPhase = "idle" | "loading" | "ready" | "error"`
  - `FLOOD_FOOTNOTE = "ไม่มีหมุด ≠ ถนนปลอดภัย · มีเฉพาะจุดที่ กทม. ติดตั้งเครื่องวัด · ไม่ใช่ประกาศเตือนภัยทางการ"`
  - `floodStatusText(i: { phase: FloodPhase; lastFailed: boolean; snapshot: RoadFloodSnapshot | null; summary: FloodSummary | null; now: number }): { tone: "info" | "warn" | "sample"; text: string }`

- [ ] **Step 1: เขียนเทสต์ที่ fail** — helper `snap(points, over?)` สร้าง `RoadFloodSnapshot` ตรง ๆ · `NOW = Date.parse("2026-10-05T14:20:00+07:00")` · `MIN = 60_000`
  - `summarizeFlood`: อายุ `45*MIN` → `aging false` · `45*MIN+1` → `true` · `180*MIN` → visible aging · `180*MIN+1` → ไม่อยู่ใน visible, `tooOld 1` · `measuredAt = NOW+60_000` → visible `aging false` · `flood`/`slight` นับจาก visible เท่านั้น
  - `sourceAgeMin`: `sourceLatest = NOW-45*MIN` → `45`, `sourceOld false` · `-45*MIN-1` → `sourceOld true` · `null` → `sourceAgeMin null`, `sourceOld true` · `sourceStale true` → `sourceOld true` · `NOW+60_000` → `0`
  - `depthLabel`: `{15,false}` → `"15"` · `{20,true}` → `"≥20"` · `{null,false}` → `"?"`
  - `ageLabel`: `30_000` → `"เพิ่งวัด"` · `8*MIN` → `"8 นาทีที่แล้ว"` · `60*MIN` → `"1 ชม.ที่แล้ว"` · `80*MIN` → `"1 ชม. 20 นาทีที่แล้ว"`
  - `formatThaiClock(Date.parse("2026-10-05T07:05:00Z"))` → `"14:05"`
  - `markerKey`: ชุดเดิมสลับลำดับ → เท่ากัน · `aging` เปลี่ยน → ต่างกัน · `depthAtLeast` เปลี่ยน → ต่างกัน
  - `parseRoadEventsResponse`: `{ok:true,snapshot:<ถูก>}` → snapshot · `{ok:false}` / `null` / `"x"` / snapshot ไม่มี `points` / point ที่ `lat:"13"` → `null`
  - `floodStatusText`:
    - `phase:"loading"` → `{tone:"info"}` text มี `"กำลังโหลดข้อมูลน้ำท่วมถนน"`
    - `phase:"error"` → `tone "warn"`, มี `"โหลดข้อมูลน้ำท่วมไม่ได้"`, **ไม่มี** `"ท่วม 0"`
    - ready + `assessable 0` → `warn`, มี `"ยังประเมินสถานการณ์ไม่ได้"`, ไม่มี `"ท่วม 0"`
    - ready ปกติ (flood 2, slight 1, offline 18, tooOld 0, sourceLatest 14:10, fetchedAt 14:13) → มี `"ท่วม 2"`, `"เล็กน้อย 1"`, `"ขัดข้อง 18"`, `"จุดวัดที่ประเมินได้"`, `"ข้อมูล 14:10"`, `"ดึงเมื่อ 14:13"` · ไม่มี `"เก่าเกิน"` · tooOld 3 → มี `"เก่าเกิน 3 ชม. 3"`
    - `lastFailed` → `warn`, ขึ้นต้น `"⚠ อัปเดตไม่ได้"`
    - `sourceLatest null` → มี `"ไม่ทราบเวลาข้อมูลต้นทาง"`
    - `snapshot.sample` → `tone "sample"`, มี `"ข้อมูลตัวอย่าง — ไม่ใช่สถานการณ์จริง"` (sample ชนะ warn)
- [ ] **Step 2: รันให้ fail** — `cmd //c "npx vitest run src/lib/roadFlood.test.ts"` → FAIL เฉพาะเคสใหม่
- [ ] **Step 3: เขียนฟังก์ชันตาม spec ข้อ 5 และข้อความตาม spec ข้อ 8** · อายุจุด `max(0, now-measuredAt)` · `sourceAgeMin = max(0, now - sourceLatest) / 60_000` · `markerKey` = เรียงตาม code แล้ว join `code|level|depthLabel|aging` · `formatThaiClock` ใช้ `Intl.DateTimeFormat("th-TH", { timeZone:"Asia/Bangkok", hour:"2-digit", minute:"2-digit", hour12:false })` · ลำดับประกอบ text: `[sample] [⚠ อัปเดตไม่ได้ …] [⚠ ข้อมูลต้นทางเก่า … | ⚠ ไม่ทราบเวลาข้อมูลต้นทาง] ข้อความหลัก`
- [ ] **Step 4: รันให้ผ่าน** → PASS ทั้งไฟล์
- [ ] **Step 5: Commit** — tsc ผ่าน · `git commit -m "feat(road-flood): สรุปอายุ/จำนวน ป้ายความลึก และข้อความแถบสถานะ"`

---

### Task 3: fixture ตัวอย่าง + API route `/api/road-events`

**Files:**
- Create: `src/lib/roadFloodSample.ts`, `src/lib/roadFloodSample.test.ts`
- Create: `src/app/api/road-events/route.ts`, `src/app/api/road-events/route.test.ts`

**Interfaces:**
- Consumes: `normalizeRoads`, `RoadFloodDataError`, `POPNIX_ROADS_URL`, `parseThaiTime`
- Produces:
  - `formatThaiTimestamp(ms: number): string` (`"YYYY-MM-DD HH:MM:SS"` เวลาไทย — ผกผันกับ `parseThaiTime`)
  - `buildSampleRoadsPayload(now: number): { summary: {...}; roads: unknown[] }` — 6 record ชื่อขึ้นต้น `"[ตัวอย่าง] "`: flood 25 ซม. (วัด 8 นาทีก่อน, since 40 นาทีก่อน) · slight 7 (20 นาทีก่อน) · grp 2 depth 20 (70 นาทีก่อน → aging) · flood `depth:null` (5 นาทีก่อน) · off · dry · พิกัดในกรุงเทพฯ ต่างกันทุกจุด · `summary.latest` = 3 นาทีก่อน
  - `GET(req: NextRequest): Promise<Response>` + `export const dynamic = "force-dynamic"` — body `{ ok: true, snapshot }` / `{ ok: false, error: string }`

- [ ] **Step 1: เขียนเทสต์ fixture ที่ fail** — `parseThaiTime(formatThaiTimestamp(t)) === t` (t ปัดวินาที) · `normalizeRoads(buildSampleRoadsPayload(NOW), NOW)` → `points.length 4`, `offline 1`, ทุก `name` ขึ้นต้น `"[ตัวอย่าง]"` · `summarizeFlood(..., NOW).visible` มี `aging true` 1 จุด
- [ ] **Step 2: เขียนเทสต์ route ที่ fail** — แบบเดียวกับ `src/app/api/driver-leaves/route.test.ts` (`vi.stubGlobal("fetch", fetchMock)`, `vi.stubEnv`, spy `console.error`) · helper `call(qs = "")` = `GET(new NextRequest("http://localhost/api/road-events" + qs))`
  - `dynamic === "force-dynamic"`
  - ต้นทาง 200 + payload ถูก → 200, `body.ok true`, `fetchMock` ถูกเรียกด้วย `POPNIX_ROADS_URL`, `res.headers.get("vercel-cdn-cache-control") === "max-age=300, stale-while-revalidate=600"`, `res.headers.get("cache-control") === "public, max-age=0, must-revalidate"`
  - ต้นทาง reject ด้วย `DOMException("timeout","TimeoutError")` / ตอบ 500 / body `"not json"` / `{roads:[]}` → 502, `cache-control: no-store`, `console.error` ถูกเรียก
  - `?x=1` และ `?sample=1&x=1` → 400, no-store, `fetchMock` **ไม่ถูกเรียก**
  - `vi.stubEnv("NODE_ENV","production")` + `?sample=1` → 400, ไม่เรียก fetch
  - `vi.stubEnv("NODE_ENV","development")` + `?sample=1` → 200, `body.snapshot.sample === true`, no-store, ไม่เรียก fetch
- [ ] **Step 3: รันให้ fail** — `cmd //c "npx vitest run src/lib/roadFloodSample.test.ts src/app/api/road-events"` → FAIL
- [ ] **Step 4: เขียน `roadFloodSample.ts` และ `route.ts`** — fetch ด้วย `{ signal: AbortSignal.timeout(8000), cache: "no-store", headers: { accept: "application/json" } }` · ทุกทางล้ม log 1 บรรทัด `[road-events] upstream_failed: <เหตุสั้น ๆ>` · query ที่รับได้มีแค่ "ไม่มีเลย" กับ "`sample=1` ตัวเดียว"
- [ ] **Step 5: รันให้ผ่าน** → PASS
- [ ] **Step 6: Commit** — tsc ผ่าน · `git commit -m "feat(road-events): API route ดึงจุดวัดน้ำ POPNIX + cache ที่ CDN + ข้อมูลตัวอย่างเฉพาะ dev"`

---

### Task 4: service worker ไม่คืนชุดเก่าของ `/api/road-events`

**Files:**
- Modify: `next.config.ts:2-7` (options ของ `next-pwa`)

**Interfaces:** ไม่มี (config)

- [ ] **Step 1: บันทึก sw.js ก่อนแก้** — `cmd //c "npm run build"` แล้ว `cp public/sw.js "$TEMP/sw.before.js"`; นับกฎเดิม: `grep -o "registerRoute" "$TEMP/sw.before.js" | wc -l` → จดตัวเลข N
- [ ] **Step 2: เพิ่ม `runtimeCaching`** ใน options ของ `require('next-pwa')({...})`:

```ts
// ข้อมูลน้ำท่วมต้องสด — ห้าม SW คืนชุดเก่าจาก Cache Storage ตอนเน็ตล้ม (กฎแรกที่ตรงชนะ จึงต้องอยู่หน้าชุดเดิม)
runtimeCaching: [
  { urlPattern: ({ url }: { url: URL }) => url.pathname === '/api/road-events', handler: 'NetworkOnly', method: 'GET' },
  ...require('next-pwa/cache'),
],
```
- [ ] **Step 3: build แล้วตรวจ sw.js** — `cmd //c "npm run build"` → สำเร็จ · `grep -o "registerRoute" public/sw.js | wc -l` → **N+1** · ตำแหน่งข้อความ `road-events` ใน `public/sw.js` อยู่ก่อน `"apis"` (`grep -bo "road-events\|\"apis\"" public/sw.js`) · มี `NetworkOnly`
- [ ] **Step 4: Commit** — `git add next.config.ts && git commit -m "fix(pwa): service worker ไม่คืนข้อมูลน้ำท่วมชุดเก่า (NetworkOnly เฉพาะ /api/road-events)"` (`public/sw.js` อยู่ใน .gitignore ไม่ commit)

---

### Task 5: reducer ของกล่องรายละเอียด (`floodInfoState.ts`)

**Files:**
- Create: `src/components/tracking/floodInfoState.ts`, `src/components/tracking/floodInfoState.test.ts`

**Interfaces:**
- Produces:
  - `interface FloodInfoState { openCode: string | null; pinned: boolean; pointerInContent: boolean; timerFor: string | null }`
  - `const INITIAL_FLOOD_INFO: FloodInfoState` (ทุกช่อง null/false)
  - `type FloodInfoEvent = { type: "hoverMarker"; code: string } | { type: "leaveMarker"; code: string } | { type: "enterContent" } | { type: "leaveContent" } | { type: "clickMarker"; code: string } | { type: "timerFired"; code: string } | { type: "closeClick" } | { type: "rebuild"; visibleCodes: string[] } | { type: "reset" }`
  - `interface FloodInfoEffect { open: { code: string; autoPan: boolean } | null; close: boolean; startTimer: string | null; clearTimer: boolean }`
  - `floodInfoReducer(state: FloodInfoState, event: FloodInfoEvent): { state: FloodInfoState; effect: FloodInfoEffect }`

- [ ] **Step 1: เขียนเทสต์ที่ fail** (กติกาตาม spec ข้อ 8 · `run(events)` = พับ reducer คืน state + effect สุดท้าย):
  - `hoverMarker A` → `open {A, autoPan:false}`, `clearTimer true`
  - pinned A แล้ว `hoverMarker B` → ไม่มี open, state ยัง A
  - `hoverMarker A, leaveMarker A` → `startTimer "A"` · pinned แล้ว `leaveMarker` → ไม่ตั้ง timer
  - `hover A, leave A, enterContent` → `clearTimer true`, `pointerInContent true` · ต่อ `timerFired A` → ไม่ปิด
  - `hover A, enterContent, leaveContent` → `startTimer "A"`
  - **`hover A, leave A, hover B, timerFired A`** → ไม่ปิด, `openCode "B"` (Review Focus 4)
  - `hover A, leave A, timerFired A` → `close true`, state = INITIAL
  - `clickMarker A` → `open {A, autoPan:true}`, `pinned true`, `clearTimer true`
  - `click A, closeClick` → `close true`, state = INITIAL
  - `click A, rebuild ["A","B"]` → `open {A, autoPan:false}`, ยัง pinned · `click A, rebuild ["B"]` → `close true`
  - `hover A, rebuild ["A"]` (ไม่ค้าง) → `close true`
  - `click A, reset` → `close true`, `clearTimer true`, state = INITIAL
- [ ] **Step 2: รันให้ fail** — `cmd //c "npx vitest run src/components/tracking/floodInfoState.test.ts"` → FAIL
- [ ] **Step 3: เขียน `floodInfoReducer`** (pure, ไม่มี google/DOM)
- [ ] **Step 4: รันให้ผ่าน** → PASS
- [ ] **Step 5: Commit** — tsc ผ่าน · `git commit -m "feat(road-flood): state ของกล่องรายละเอียด (hover/คลิกค้าง/timer) แบบทดสอบได้"`

---

### Task 6: hook `useRoadFlood`

**Files:**
- Create: `src/hooks/use-road-flood.ts`

**Interfaces:**
- Consumes: `parseRoadEventsResponse`, `RoadFloodSnapshot`, `FloodPhase` (Task 2) · `createLatestRequestGuard` จาก `@/lib/latestRequest`
- Produces: `useRoadFlood(enabled: boolean): { snapshot: RoadFloodSnapshot | null; phase: FloodPhase; lastFailed: boolean; now: number }`

- [ ] **Step 1: เขียน hook ตาม spec ข้อ 7** (`'use client'`, แบบเดียวกับ `src/hooks/use-driver-leaves.ts`):
  - `enabled` false → abort + หยุด interval · **คง snapshot** · phase คงเดิม (ไม่กลับ idle ถ้าเคยมีข้อมูล)
  - `enabled` true → โหลดทันที + `setInterval` 5 นาที · `inflight` กันยิงซ้อน · ทุก setState ผ่าน `isLatest()` และเช็ค `!signal.aborted`
  - URL: `"/api/road-events"` · ถ้า `process.env.NODE_ENV !== "production"` และ `new URLSearchParams(window.location.search).get("floodSample") === "1"` → `"/api/road-events?sample=1"`
  - ผล: `parseRoadEventsResponse(await res.json())` ไม่เป็น null และ `res.ok` → snapshot ใหม่, `lastFailed false`, phase `"ready"` · อย่างอื่น → มี snapshot: `lastFailed true` (phase คง `"ready"`) / ไม่มี: phase `"error"`
  - phase `"loading"` เฉพาะตอนยังไม่มี snapshot
  - `now`: state เริ่ม `Date.now()` อัปเดตทุก 60 วิ ขณะ enabled
- [ ] **Step 2: ตรวจ type/lint** — `cmd //c "npx tsc --noEmit"` และ `cmd //c "npx next lint --file src/hooks/use-road-flood.ts"` → ไม่มี error (พฤติกรรมจริงตรวจใน Task 7–8)
- [ ] **Step 3: Commit** — `git commit -m "feat(road-flood): hook poll ข้อมูลน้ำท่วมทุก 5 นาที แยกสถานะ loading/ready/error"`

---

### Task 7: หมุด + กล่อง + แถบสถานะ บน `TrackingMap`

**Files:**
- Create: `src/components/tracking/useFloodMarkers.ts`, `src/components/tracking/FloodStatusBar.tsx`
- Modify: `src/components/tracking/TrackingMap.tsx` (state/ปุ่ม: บรรทัด ~66-67, 320-337 · หมุดจุดงาน `zIndex`: ~200-213)

**Interfaces:**
- Consumes: `useRoadFlood` (Task 6), types `FloodSummary`/`RoadFloodSnapshot`/`FloodPhase`/`VisibleFloodPoint` (Task 1–2), `summarizeFlood`/`markerKey`/`depthLabel`/`ageLabel`/`formatThaiClock`/`floodStatusText`/`FLOOD_FOOTNOTE`/`CREDIT_TEXT`/`NOT_OFFICIAL_TEXT`/`POPNIX_URL` (Task 1–2), `floodInfoReducer`/`INITIAL_FLOOD_INFO` (Task 5)
- Produces:
  - `useFloodMarkers(o: { map: google.maps.Map | null; ready: boolean; active: boolean; summary: FloodSummary | null; now: number }): void`
  - `FloodStatusBar(p: { phase: FloodPhase; lastFailed: boolean; snapshot: RoadFloodSnapshot | null; summary: FloodSummary | null; now: number }): JSX.Element`

- [ ] **Step 1: `useFloodMarkers`** ตาม spec ข้อ 8:
  - effect สร้างหมุด deps `[ready, active, markerKey(summary?.visible ?? [])]` — สร้างใหม่เฉพาะ key เปลี่ยน · `active` false → ลบหมุด + dispatch `reset`
  - หมุด: `SymbolPath.CIRCLE`, scale 11, สี flood `#1d4ed8` / slight `#60a5fa` / aging `#6b7280`, label `depthLabel` สีขาว, `zIndex: 100`, ไม่มี `title`
  - state ของกล่องอยู่ใน `useRef<FloodInfoState>` · ทุก event → `floodInfoReducer` แล้วทำ effect (`open` → `setContent(build(point))` + `setOptions({disableAutoPan: !autoPan})` + `open({map, anchor})`; `close` → `infoWindow.close()`; timer → `setTimeout(..., 300)` เก็บ handle เดียว)
  - hover ลงทะเบียนเมื่อ `matchMedia("(hover: hover) and (pointer: fine)").matches` + ฟัง `change` · click ลงทะเบียนเสมอ · InfoWindow `closeclick` → `closeClick`
  - หลังสร้างหมุดชุดใหม่ → dispatch `rebuild` ด้วย code ใน visible
  - ทุก tick ของ `now` ถ้ามีกล่องเปิด → `setContent` ใหม่ (ไม่ dispatch)
  - เนื้อหากล่อง: สร้าง element ด้วย `document.createElement` + `textContent` ตาม mockup spec ข้อ 8 · ลิงก์ `a.href = POPNIX_URL`, `target="_blank"`, `rel="noopener noreferrer"` · ผูก `pointerenter`/`pointerleave` ที่ root element → `enterContent`/`leaveContent`
  - cleanup: `removeListener` ทีละ handle, `clearTimeout`, ลบ listener media query, `setMap(null)` หมุด, `close()`
- [ ] **Step 2: `FloodStatusBar`** — แสดง `floodStatusText(...)` บรรทัดแรก (สีตาม tone: info = ปกติ, warn = ส้ม, sample = แดง) + บรรทัดสอง `FLOOD_FOOTNOTE` + `CREDIT_TEXT` เป็นลิงก์ `POPNIX_URL` · ตำแหน่ง `absolute left-2 top-2 z-10` กว้างไม่เกิน `calc(100% - 9rem)` (เว้นที่ปุ่มขวาบน) ข้อความ `text-[11px]` ตัดบรรทัดได้
- [ ] **Step 3: ต่อใน `TrackingMap`** — `const [floodOn, setFloodOn] = useState(false)` · `const flood = useRoadFlood(floodOn && !!live)` · `const floodSummary = useMemo(() => flood.snapshot ? summarizeFlood(flood.snapshot, flood.now) : null, [flood.snapshot, flood.now])` · `useFloodMarkers({ map: mapRef.current, ready, active: floodOn && !!live, summary: floodSummary, now: flood.now })` · ห่อปุ่ม 🚦 เดิมกับปุ่มใหม่ใน `<div className="absolute right-2 top-2 z-10 flex gap-1.5">` (ปุ่ม 🚦 เอา `absolute right-2 top-2 z-10` ออก สไตล์อื่นคงเดิม) · ปุ่มใหม่ `🌊 น้ำท่วม{floodOn ? " เปิด" : ""}` สไตล์เดียวกับปุ่ม 🚦 (สีเปิด = น้ำเงิน `border-blue-400/60 bg-blue-600/90 text-white`) `title="แสดง/ซ่อนจุดวัดน้ำท่วมถนน กทม."` · `{ready && live && floodOn && <FloodStatusBar ... />}` · หมุดจุดงานเดิมเพิ่ม `zIndex: 500`
- [ ] **Step 4: ตรวจ type/lint/test** — `cmd //c "npx tsc --noEmit"` · `cmd //c "npm run lint"` (ไม่มี error ใหม่ในไฟล์ที่แตะ) · `cmd //c "npm run test:run"` → ผ่านทั้งหมด
- [ ] **Step 5: ตรวจมือบนแผนที่จริง** (สภาพแวดล้อมตาม Task 8 ขั้น 2) — ใช้ข้อมูลจริง ถ้าไม่มีจุดท่วมให้ต่อ `?floodSample=1` (ใช้ได้เฉพาะ dev):
  - (ก) เปิดชั้น รอ GPS poll ≥ 1 รอบ (60 วิ) → หมุดน้ำยังอยู่ ตำแหน่ง/ซูมแผนที่ไม่เปลี่ยน (เทียบภาพก่อน-หลัง)
  - (ข) สลับไปรถคันอื่น → ซูมพอดีรถคันใหม่ หมุดน้ำยังอยู่
  - (ค) กดเปิดแล้วรีบกดปิดก่อนโหลดเสร็จ → ไม่มีหมุดโผล่ภายหลัง
  - (ง) ชี้หมุดติดกันเร็ว ๆ → กล่องมีทีละอัน · ชี้แล้วเลื่อนเข้ากล่องกดลิงก์เครดิตได้ · คลิกค้าง → ค้างข้าม tick → X ปิด
  - (จ) มือถือ 375px (`resize_window` preset mobile): ปุ่ม/แถบไม่ทับกัน แตะเปิด/ค้างได้ กล่องใกล้ขอบเลื่อนเข้าจอเมื่อแตะ
  - (ฉ) วันนี้ → ย้อนหลัง (ปุ่มหาย ชั้นหาย) → วันนี้ (ชั้นกลับมาเอง)
- [ ] **Step 6: Commit** — `git commit -m "feat(tracking): ปุ่ม 🌊 น้ำท่วม — หมุดจุดวัดน้ำ กทม. กล่องรายละเอียด และแถบสถานะบนแผนที่ติดตามรถ"`

---

### Task 8: ตรวจรวม + Codex + ส่งงานให้ผู้ใช้ (ไม่ deploy)

**Files:** ไม่มีไฟล์โค้ดใหม่ (แก้เฉพาะถ้าพบปัญหา — กลับไป task เจ้าของ)

- [ ] **Step 1: ตรวจอัตโนมัติ** — `cmd //c "npx tsc --noEmit"` · `cmd //c "npm run lint"` · `cmd //c "npm run test:run"` · `cmd //c "npm run build"` → ผ่านทั้งหมด · เปิด production build ด้วย `preview_start` (เพิ่ม launch config ชั่วคราวใน `ระบบจัดคิวรถ/.claude/launch.json`: `cmd /c "cd /d LOTUS-EME-Transport-System && node node_modules/next/dist/bin/next start -p 3100"` แล้วลบออกหลังตรวจ — ห้ามรันเซิร์ฟเวอร์ผ่าน Bash) แล้ว `curl -s -D - -o /dev/null http://localhost:3100/api/road-events` → 200 + header สองตัวตาม Global Constraints · `curl "...?sample=1"` → 400 (production build)
- [ ] **Step 2: จุดตัดสินใจ — สภาพแวดล้อมสำหรับตรวจมือ/ภาพหน้าจอ** (Google Maps key มาจาก env บน Vercel หรือ `companySettings` ใน Firestore จริง — บนเครื่องไม่มีแผนที่) **ถามผู้ใช้เลือก:**
  - ก. push branch `feat/road-flood-layer` → Vercel preview (ข้อมูล/ล็อกอินจริง ฟีเจอร์นี้อ่านอย่างเดียว ไม่เขียน Firestore) → ตรวจ Task 7 ขั้น 5 + พิสูจน์ CDN: GET URL เดิมซ้ำ (ไม่ส่ง `Pragma: no-cache`) ต้องได้ `x-vercel-cache: HIT` และ `snapshot.fetchedAt` เดิม · **preview เป็น production build → `?floodSample=1` ใช้ไม่ได้** ใช้ข้อมูลจริงเท่านั้น
  - ข. ผู้ใช้ใส่ `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` ใน `.env.development.local` เอง + emulator (บัญชีทดสอบจาก `scripts/seed-emulator.ts`) + ทริปจำลองวันนี้ → dev server (ใช้ `?floodSample=1` ได้) · CDN พิสูจน์ไม่ได้ในทางนี้
- [ ] **Step 3: ตรวจมือ Task 7 ขั้น 5 ครบ (ก)–(ฉ)** ในสภาพแวดล้อมที่เลือก + ถ่ายภาพหน้าจอ: ปุ่มปิด/เปิด, กล่อง hover, กล่องค้าง, แถบสถานะปกติ, แถบส้มตอนต้นทางล่ม (ทาง ข.: ชี้ `POPNIX_ROADS_URL` ผิดชั่วคราวในเครื่องแล้ว revert / ทาง ก.: ข้าม แล้วระบุในรายงาน), มือถือ 375px
- [ ] **Step 4: Codex ตรวจโค้ด** — brief ตามโครงของ skill `codex-audit` (อ้าง spec ฉบับ 3 + แผนนี้ + `git diff origin/main...HEAD`) · `bash ~/.claude/skills/codex-audit/scripts/run-audit.sh "<repo>" "<brief>" "<AUDIT-...-road-flood-code.md>" gpt-6.1-sol max` · ประเมินทีละข้อ แก้ข้อที่รับ (กลับไป task เจ้าของ, เทสต์ก่อน) · ตรวจซ้ำได้ไม่เกิน 2 รอบ
- [ ] **Step 5: รายงานผู้ใช้** — แหล่งข้อมูลที่เลือก+เหตุผล · พื้นที่ครอบคลุม · รอบอัปเดต/ข้อจำกัด · เครดิต/API key/ค่าใช้จ่าย (ไม่มี) · ไฟล์ที่เปลี่ยน · ผลตรวจทั้งหมด · ภาพหน้าจอ · ผล Codex (โมเดล/ระดับ) · **ไม่ merge main จนกว่าผู้ใช้สั่ง**
