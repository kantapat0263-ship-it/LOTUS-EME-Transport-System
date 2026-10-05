# ชั้น "น้ำท่วมถนน กทม." บนแผนที่หน้าติดตามรถ — Design

- วันที่: 2026-10-05 · **ฉบับ 3** (แก้ตามผลตรวจ Codex 2 รอบ `ระบบจัดคิวรถ/AUDIT-2026-10-05-CODEX-road-flood-spec*.md` — ดูข้อ 13)
- สถานะ: ผู้ใช้เคาะแนวทางทีละส่วนในแชทแล้ว (ขอบเขตข้อมูล / หน้าตา / อายุข้อมูล+การดึง) — **รอผู้ใช้ตรวจไฟล์นี้** · ยังไม่มีโค้ด
- branch: `feat/road-flood-layer` (แตกจาก `origin/main` @ `46bd1e4`) · **ยังไม่ deploy** (ผู้ใช้สั่ง: ทำโค้ด+ตัวอย่างให้ตรวจก่อน)
- ระบบที่แตะ: ระบบจัดคิว (repo นี้) เท่านั้น — ไม่มี Firestore collection ใหม่ ไม่มี env ใหม่ ไม่มี package ใหม่ · แตะ `next.config.ts` 1 จุด (กฎ service worker ของ route ใหม่ — ข้อ 6)

---

## 1. ปัญหาและเป้าหมาย

**เป้าหมาย:** คนจัดคิวเปิดดูสถานการณ์น้ำท่วมถนนคร่าว ๆ บนแผนที่หน้าติดตามรถ แล้วใช้ประกอบการบอกคนขับให้พิจารณาเส้นทางอื่นเอง รถส่วนใหญ่วิ่งในกรุงเทพฯ (ผู้ใช้ยืนยัน) ต่างจังหวัดมีบ้าง

**ไม่ทำ (ตั้งใจ):**
- ตรวจว่าเหตุการณ์อยู่ใกล้รถ/เส้นทาง · คำนวณความเสี่ยงต่อทริป · แจ้งเตือน LINE/เสียง/push · แนะนำหรือเปลี่ยนเส้นทางอัตโนมัติ
- ปิดถนน / อุบัติเหตุ / ทางหลวงต่างจังหวัด (→ รุ่นที่ 2 ข้อ 11) · ชั้นพื้นที่น้ำท่วมจากดาวเทียม · โหมดดูย้อนหลัง

## 2. ข้อตกลงที่ผู้ใช้เคาะแล้ว

| เรื่อง | ข้อตกลง |
|---|---|
| ขอบเขตรุ่นแรก | **น้ำท่วมถนนในกรุงเทพฯ จากจุดวัดของ กทม. (ผ่าน POPNIX) อย่างเดียว** — "แค่น้ำท่วมก็ได้" |
| ระบบกลาง | API route ใหม่ + **cache ที่ CDN ของ Vercel** (ไม่ใช้ Firestore, ไม่ผูกกับ cron GPS) |
| หมุด | ปักเฉพาะจุดที่มีน้ำ (ท่วม/ท่วมเล็กน้อย) — จุดแห้งไม่ปัก, จุดขัดข้องนับในแถบสถานะ |
| ปุ่ม | "🌊 น้ำท่วม" ข้าง "🚦 จราจร" · เริ่มต้นปิด · เฉพาะโหมดวันนี้ |
| กล่องรายละเอียด | คอม: ชี้=เปิด, คลิก=ค้าง, X=ปิด · มือถือ: แตะ=เปิด |
| อายุข้อมูล | ≤45 นาที ปกติ · 45 นาที–3 ชม. หมุดเทา "ข้อมูลเก่า" · >3 ชม. ไม่ปัก (นับในแถบ) |
| ส่งงาน | โค้ด + ภาพหน้าจอให้ตรวจ — **ไม่ deploy** |

## 3. แหล่งข้อมูล (ตรวจจริง 2026-10-05)

### 3.1 ที่เลือก: POPNIX Flood — `GET https://flood.pop.in.th/api_roads.php`
- จุดวัดน้ำบนถนน/อุโมงค์ของ **สำนักการระบายน้ำ กทม.** 247 จุด จัดรูปใหม่โดย POPNIX · JSON · ไม่ต้องสมัคร/ไม่มี key · CORS เปิด
- **เงื่อนไข:** ใช้ฟรีรวมเชิงพาณิชย์ · **ต้องให้เครดิตใกล้ข้อมูล + ลิงก์กลับ** `https://flood.pop.in.th` · ไม่ใช่ประกาศเตือนภัยทางการ ห้ามทำให้เข้าใจว่าเป็นข้อมูลรัฐโดยตรง · ไม่รับประกันความถูกต้อง
- **ข้อความเครดิต (ใช้ตัวเดียวกันทุกที่ ห้ามย่อ):** `CREDIT_TEXT = "ข้อมูล: สำนักการระบายน้ำ กรุงเทพมหานคร ผ่าน POPNIX Flood (flood.pop.in.th)"` + ลิงก์ `https://flood.pop.in.th` + ข้อความ `"ไม่ใช่ประกาศเตือนภัยทางการ"` อยู่ใกล้กัน
- **ความถี่:** ต้นทางอัปเดตถนนทุก 5–10 นาที · POPNIX ตอบ `api_roads` ด้วย `max-age` 60 วิ (cache ฝั่งเขา) · จำกัด 300 req/นาที/IP · ขอให้แอปผู้ใช้มากดึงผ่าน server แล้ว cache (TTL 300 วิ ในข้อ 6 คือ cache ของระบบเรา)
- **รูปข้อมูล:** `summary { latest, total, flood, slight, dry, off, generated, age_min, stale, scraped, scrape_failing }` + `roads[] { code, kind, grp, name, road, district, dir, lat, lng, msg_fail, depth, measured_at, flood_max, level, delta, since }`
- **ความหมาย (จากเอกสาร POPNIX):** `level`: `flood` >10 ซม. · `slight` 5–10 · `dry` ≤5 · `off` ขัดข้อง/ไม่ส่งค่าเกิน 30 นาที · `kind` 1 ถนน 2 อุโมงค์ · `grp` 2 = วัดเป็นขั้น 5 ซม. สูงสุด 20 → ค่า 20 = "อย่างน้อย 20 ซม." · `since` เริ่มท่วมเมื่อไร · `summary.stale` = ข้อมูลเก่ากว่า 45 นาที · **เวลาเป็นเวลาไทย `YYYY-MM-DD HH:MM:SS` ไม่มีเขตเวลา** · **`null` = ไม่มีค่า ห้ามแปลงเป็น 0** · ค่าเฉพาะจุดวัด ที่ไม่มีจุดวัดห้ามสรุปว่าไม่มีน้ำ
- ณ เวลาตรวจ: flood 6 · slight 1 · dry 222 · off 18

### 3.2 ที่ไม่เลือก (และเหตุผล)
| แหล่ง | ผลตรวจ | เหตุผล |
|---|---|---|
| Longdo/iTIC `event.longdo.com/feed/json` | ใช้ได้ 190 เหตุการณ์ มีพิกัด/เวลา ครอบคลุมทางหลวงภาคกลาง-ตะวันออก รวมอุบัติเหตุ/ปิดถนน | **สิทธิ์ฟีดสดยังไม่ชัด** (iTIC เปิดเฉพาะข้อมูลย้อนหลังเป็น CC BY 4.0; เงื่อนไข Longdo Map จำกัดธุรกิจใช้ภายใน/ห้ามดึงเป็นชุด) → รุ่นที่ 2 หลังได้อนุญาต |
| POPNIX `api_province.php?p=` (เหตุบนทางหลวง กรมทางหลวง) | ส่ง `hw` แค่ **3 รายการแรก** ทั้งที่ `hw_n` = 19/14/21 | ข้อมูลไม่ครบ ผู้ใช้จะเข้าใจผิดว่ามีแค่นั้น |
| กทม. `weather.bangkok.go.th/floodbangkok` | HTML 3MB, endpoint ภายในของ กทม. (POPNIX ระบุว่าไม่ใช่ API สาธารณะ) | ใช้ผ่าน POPNIX แทน |

## 4. ภาพรวม

```
[ปุ่ม 🌊 เปิด + โหมดวันนี้] → useRoadFlood (ทุก 5 นาที)
        → GET /api/road-events  ──(Vercel CDN cache 300 วิ)──→ POPNIX api_roads.php (timeout 8 วิ)
        ← { ok, snapshot }  (จุดที่มีน้ำ + summary ที่จัดรูปแล้ว)
→ summarizeFlood(snapshot, now)  (คิดอายุ ณ เวลาแสดงผล)
→ TrackingMap: หมุดชุดแยก + InfoWindow + แถบสถานะ + เครดิต
```

## 5. ตรรกะล้วน `src/lib/roadFlood.ts` (+ `roadFlood.test.ts`) — client-safe ไม่มี I/O

```ts
export const FLOOD_FRESH_MAX_MIN = 45   // POPNIX ถือว่าเกิน 45 นาที = เก่า
export const FLOOD_SHOW_MAX_MIN = 180   // เกิน 3 ชม. ไม่ปัก
export const POPNIX_URL = "https://flood.pop.in.th"
export const CREDIT_TEXT = "ข้อมูล: สำนักการระบายน้ำ กรุงเทพมหานคร ผ่าน POPNIX Flood (flood.pop.in.th)"

export interface FloodPoint {
  code: string
  name: string                  // ต้นทางว่าง → "จุดวัด {code}" (ไม่ใช้ null เพื่อให้หัวกล่องมีชื่อเสมอ)
  road: string | null; district: string | null; dir: string | null
  isTunnel: boolean
  lat: number; lng: number
  level: "flood" | "slight"
  depthCm: number | null        // null = ต้นทางไม่ส่งค่า (ห้ามเป็น 0)
  depthAtLeast: boolean         // grp 2 และ depth >= 20 → "≥20"
  measuredAt: number            // epoch ms
  floodingSince: number | null
}
export interface RoadFloodSnapshot {
  fetchedAt: number             // เวลาที่ server เราดึง
  sourceLatest: number | null   // summary.latest (เวลาวัดล่าสุดของต้นทาง)
  sourceStale: boolean          // summary.stale || summary.scrape_failing ณ ตอนดึง (ความเก่าตอนแสดงผลคิดใหม่จาก sourceLatest — ข้อ summarizeFlood)
  points: FloodPoint[]          // จุดที่มีน้ำ ผ่านการตรวจแล้ว (ยังไม่ตัดตามอายุ)
  usable: number                // จุดวัดที่ข้อมูลรูปถูก (ทุกสถานะ wet/dry/off หลังตัดซ้ำ) — ไม่ hardcode 247
  offline: number               // ในนั้นที่ level "off"
  assessable: number            // usable - offline = จุดที่ประเมินระดับน้ำได้จริง (wet/dry)
  invalid: number               // record ที่ใช้ไม่ได้ (code/เวลา/พิกัด/level เสีย)
  sample?: true                 // ข้อมูลตัวอย่าง (dev เท่านั้น ข้อ 6)
}
```

ฟังก์ชัน:
- `parseThaiTime(s)` → epoch ms หรือ `null` — ต้องตรง `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$` **และ** ตรวจปฏิทินจริง (เดือน 1–12, วันมีจริงในเดือนนั้นรวมปีอธิกสุรทิน, ชั่วโมง 00–23, นาที/วินาที 00–59) — เพราะ `Date.parse` ยอมรับ `02-30` (เลื่อนเป็น 2 มี.ค.) และ `24:00` (เลื่อนวัน) · ผ่านแล้วตีความเป็น **+07:00 เสมอ** · ค่าว่าง/รูปแบบอื่น → `null`
- `normalizeRoads(raw, fetchedAt)` → `RoadFloodSnapshot` — **throw** ถ้า `roads` ไม่ใช่ array, เป็น array ว่าง, หรือ `usable === 0` (ไม่มีค่าที่ใช้ได้เลย = ล้ม ไม่ใช่ "ไม่มีน้ำท่วม")
  1. **ด่านเวลา (ทุกสถานะ):** ต้องมี `code` (string ไม่ว่าง) และ `measured_at` ผ่าน `parseThaiTime` และ**ไม่อยู่ในอนาคตเกิน 5 นาทีเทียบ `fetchedAt`** (นาฬิกา server เชื่อถือได้) — ไม่ผ่าน → `invalid` และไม่เข้าการตัดซ้ำ (record ที่เวลาอ่านไม่ได้เรียงลำดับไม่ได้ จึงไม่ถือว่าใหม่กว่าตัวอื่น — ถ้า code นั้นมี record เวลาถูกตัวอื่น ใช้ตัวนั้น)
  2. **ตัดซ้ำก่อนตรวจอย่างอื่น:** ต่อ `code` เลือก record ที่ `measuredAt` ใหม่สุดจากที่ผ่านขั้น 1 ทุกสถานะ (wet เก่ากว่า dry/off ใหม่ → หายไป) · เวลาเท่ากัน → ตัวแรกตามลำดับในฟีด · code ซ้ำไม่นับ invalid
  3. **ตรวจตัวที่เลือก:** `level` ∈ `flood`/`slight`/`dry`/`off` (ใช้ `level` ต้นทางตรง ๆ ไม่คิดจาก depth เอง) · wet ต้องมีพิกัดเป็นตัวเลขจำกัดในกรอบไทย lat 5.5–20.5, lng 97.3–105.7 (กัน 0,0/สลับแกน) · dry/off ไม่ต้องใช้พิกัด — ไม่ผ่าน → `invalid` ทั้ง code (**ไม่ย้อนไปใช้ record เก่าของ code นั้น** ไม่ว่าเสียที่ level หรือพิกัด)
  4. `usable` = จำนวน code ที่ผ่าน 1–3 · `offline` = ในนั้นที่ `off` · `assessable` = `usable - offline` · `points` = ในนั้นที่ `flood`/`slight`
  5. `sourceLatest` = `parseThaiTime(summary.latest)` · อนาคตเกิน 5 นาทีเทียบ `fetchedAt` → ถือเป็น `null` (ไม่ทราบเวลา)
  - `depth`: รับเฉพาะ `typeof === "number"` และจำกัด — อย่างอื่น (null, string) → `depthCm: null` · **ห้ามใช้ `Number()`/`|| 0`**
  - ข้อความ (`road`/`district`/`dir`) ตัดช่องว่าง ค่าว่าง → `null` · `name` ว่าง → `"จุดวัด {code}"` · ยาวเกิน 120 ตัวอักษร → ตัดเหลือ 120
- `summarizeFlood(snapshot, now)` → `{ visible: (FloodPoint & { aging: boolean })[], flood, slight, offline, tooOld, invalid, usable, assessable, sourceAgeMin: number | null, sourceOld: boolean }`
  - อายุจุด (ms) = `max(0, now - measuredAt)` (เวลาอนาคตถูกคัดที่ server แล้ว ส่วนต่างเล็กน้อยจากนาฬิกาเครื่องผู้ใช้ปัดเป็น 0) · `≤ 45×60_000` ปกติ · `> 45×60_000 ถึง ≤ 180×60_000` `aging: true` · `> 180×60_000` ไม่อยู่ใน `visible` → นับ `tooOld`
  - **ความเก่าของทั้งชุดคิด ณ เวลาแสดงผล:** `sourceAgeMin = sourceLatest == null ? null : max(0, now - sourceLatest) / 60_000` · `sourceOld = sourceStale || sourceAgeMin == null || sourceAgeMin > 45` — กันชุดเก่าที่ค้างอยู่ฝั่งผู้ใช้
  - `flood`/`slight` = นับจาก `visible`
- `depthLabel(p)` → `"15"` / `"≥20"` / `"?"` (null) · `ageLabel(ms)` → "เพิ่งวัด" / "8 นาทีที่แล้ว" / "1 ชม. 20 นาทีที่แล้ว" · เวลาที่แสดงทุกจุดใช้ `timeZone: "Asia/Bangkok"`

## 6. API route `src/app/api/road-events/route.ts`

- `GET` · `export const dynamic = "force-dynamic"` · runtime Node
- `fetch(POPNIX_URL + "/api_roads.php", { signal: AbortSignal.timeout(8000), cache: "no-store" })` → `normalizeRoads(json, Date.now())`
- **query:** ไม่มี query = ปกติ · `?sample=1` ตามด้านล่าง · query อื่นใด → `400` + `no-store` **ก่อนเรียกต้นทาง** (กันการสร้าง cache key ใหม่เพื่อเลี่ยง CDN)
- **สำเร็จ:** `200 { ok: true, snapshot }` + header:
  - `Vercel-CDN-Cache-Control: max-age=300, stale-while-revalidate=600` — cache ที่ CDN ของ Vercel ([เอกสาร](https://vercel.com/docs/caching/cdn-cache))
  - `Cache-Control: public, max-age=0, must-revalidate` — HTTP cache ของ browser ต้อง revalidate ทุกครั้ง (ไม่ได้ห้าม service worker — ดูด้านล่าง)
  - หมายเหตุ: CDN อาจคืนชุดที่หมดอายุแล้วได้อีกไม่เกิน 600 วิระหว่าง revalidate (ตั้งใจ) → ชุดที่ผู้ใช้เห็นอาจเก่าได้ถึง ~15 นาที ซึ่งแสดงอายุจริงไว้ในแถบอยู่แล้ว
- **service worker (`next.config.ts`):** next-pwa เดิมใช้ `NetworkFirst` กับ `/api/*` (เน็ตล้ม/ช้าเกิน 10 วิ → คืนชุดเก่าจาก Cache Storage แบบ 200) → เพิ่ม `runtimeCaching: [{ urlPattern: /road-events เส้นเดียว, handler: "NetworkOnly" }, ...require("next-pwa/cache")]` — กฎใหม่อยู่**หน้า**ชุดเดิม (Workbox ใช้กฎแรกที่ตรง) และชุดเดิมคงครบเหมือนเดิม route อื่นไม่เปลี่ยนพฤติกรรม · ผล: เน็ตล้ม = hook เห็นว่าล้มจริง → `lastFailed`
  - ผล: **ลด**การเรียก POPNIX เหลือประมาณ 1 ครั้ง/5 นาที/region ภายใต้ URL เดียวกัน (ยังเรียกต้นทางได้เมื่อ cache miss/หมดอายุ/ถูกขับออก/คำตอบล้ม) — ตัวเลขเป็นประมาณการ
- **ล้ม** (timeout / HTTP ≠ 200 / JSON เสีย / `normalizeRoads` throw): `502 { ok: false }` + `Cache-Control: no-store` + `console.error` — ไม่ cache ความล้มเหลว
- **ไม่ต้องล็อกอิน:** ข้อมูลสาธารณะ ไม่มีความลับ และ cache ร่วมต้องไม่แยกตามผู้ใช้
- **ข้อมูลตัวอย่าง:** `?sample=1` เมื่อ `process.env.NODE_ENV !== "production"` → คืน fixture (สร้างเวลาจาก `Date.now()` ตอนเรียก เช่น วัดเมื่อ 8 นาที/1 ชม.ก่อน — ไม่เก่าเกินเกณฑ์ตามวันที่ทำ) ทุกชื่อขึ้นต้น "[ตัวอย่าง]" + `sample: true` + `no-store` · **production (`npm run build` ตั้ง `NODE_ENV=production` → Vercel preview/production) → `400` + `no-store` ก่อนเรียกต้นทาง** · fixture ใช้ร่วมกับเทสต์ · **ห้ามใช้ fixture เป็นตัวสำรองตอน API ล้มเด็ดขาด**
- **วิธีพิสูจน์ CDN cache (ทำได้หลังผู้ใช้อนุญาต preview):** GET URL เดิมซ้ำโดยไม่ส่ง `Pragma: no-cache` → ต้องเห็น `x-vercel-cache: HIT` และ `snapshot.fetchedAt` เดิม · รอบนี้พิสูจน์ได้แค่ header ที่ handler ส่ง (เทสต์ + production build ในเครื่อง)

## 7. Hook `src/hooks/use-road-flood.ts`

`useRoadFlood(enabled: boolean)` → `{ snapshot, phase, lastFailed, now }`
- `phase` — **แยกสถานะชัด ห้ามให้ "โหลดไม่ได้" แสดงเหมือน "ไม่มีน้ำท่วม"** (บทเรียน PR#46):
  - `"idle"` ยังไม่เคยเปิด · `"loading"` กำลังดึงและยังไม่มี snapshot · `"error"` ดึงล้มและ**ไม่มี** snapshot · `"ready"` มี snapshot (ถ้ารอบล่าสุดล้ม → `"ready"` + `lastFailed: true`)
  - กำลังดึงรอบถัดไปขณะมี snapshot = ยัง `"ready"` (ไม่กระพริบ)
- `enabled` = ปุ่มเปิด **และ** โหมดวันนี้ → ดึงทันที แล้วทุก 5 นาที · ไม่ enabled → หยุด poll + abort request ที่ค้าง (เก็บ snapshot ไว้ กลับมา enabled โชว์ทันทีแล้วดึงใหม่)
- response ต้องเป็น `{ ok: true, snapshot }` ที่รูปถูก — อย่างอื่น (4xx/5xx/JSON เสีย/รูปผิด) = ล้ม · seq guard กันผลที่ตอบช้ามาทับผลใหม่
- `now` เดินทุก 60 วิ (คิดอายุ/ป้ายเวลา/`sourceOld`) · `fetch("/api/road-events")` ไม่ต่อ `?t=` (ต้องการ CDN cache)
- **เปิดข้อมูลตัวอย่าง (dev เท่านั้น):** ถ้า `process.env.NODE_ENV !== "production"` และ URL ของหน้ามี `?floodSample=1` → เรียก `/api/road-events?sample=1` แทน · production ไม่อ่าน param นี้เลย

## 8. แผนที่ `src/components/tracking/TrackingMap.tsx`

- state `floodOn` (เริ่ม false) · ปุ่ม "🌊 น้ำท่วม" อยู่กลุ่มเดียวกับ "🚦 จราจร" มุมขวาบน · แสดงเมื่อ `ready && live` · `useRoadFlood(floodOn && !!live)`
- **หมุดชุดแยก** `floodMarkersRef` + effect ของตัวเอง — ผล `summarizeFlood` `useMemo` ด้วย `[snapshot, now]` แต่**สร้างหมุดใหม่เฉพาะเมื่อ `markerKey` เปลี่ยน** (`markerKey` = รายการ `code|level|depthLabel|aging` เรียงตาม code) → `now` เดินทุก 60 วิ ไม่ทำให้หมุดถูกสร้างใหม่ เว้นแต่มีจุดข้ามเกณฑ์อายุ · ข้อความเวลาในกล่องที่เปิดอยู่รีเฟรชทุก tick ด้วย `setContent` (คงสถานะ ref ทั้งหมด) · effect เดิมของรถ/จุดงานไม่แตะหมุดน้ำ · effect หมุดน้ำ**ไม่เรียก `fitBounds`/`setCenter`/`setZoom`** และไม่เพิ่มหมุดน้ำเข้า bounds เดิม
- หมุด: วงกลม label = `depthLabel` · ท่วม `#1d4ed8` · ท่วมเล็กน้อย `#60a5fa` · `aging` = `#6b7280` · `zIndex` 100 — กำหนด `zIndex` 500 ให้หมุดจุดงานเดิมด้วย เพื่อให้หมุดน้ำอยู่ใต้จุดงาน/รถ (รถ 999, จอดนาน 900 เดิม) · ไม่ตั้ง `title` (กัน tooltip ซ้อนกล่อง)
- **InfoWindow ตัวเดียว** `maxWidth: 260` · content = `HTMLElement` ที่เราสร้างเอง (ไม่แตะ DOM ภายในของ Google) · สถานะเก็บใน ref แยกจาก marker (listener อ่านจาก ref ไม่ใช่ closure เก่า):
  `openCodeRef` (จุดที่เปิด) · `pinnedRef` (ค้างไหม) · `pointerInContentRef` (pointer อยู่ในกล่องไหม) · `closeTimerRef` (timer เดียวทั้งชั้น)
  - **hover ลงทะเบียนเมื่อ** `matchMedia("(hover: hover) and (pointer: fine)")` ตรง (ตัดสินจากความสามารถ ไม่ใช่จากการมีจอสัมผัส — notebook จอสัมผัส+เมาส์ได้ทั้ง hover และแตะ) และติดตาม `change` ของ media query · ไม่ตรง → ไม่ลงทะเบียน mouseover/mouseout เลย
    - `mouseover` หมุด X → ล้าง timer · ถ้ามีจุดค้างอยู่ (`pinnedRef`) ไม่ทำอะไร · ไม่งั้นเปิด X (`disableAutoPan: true`)
    - `mouseout` หมุด X → ถ้าไม่ค้าง ตั้ง timer 300 ms
    - `pointerenter` content → ล้าง timer, `pointerInContentRef = true` · `pointerleave` content → `false` + ถ้าไม่ค้าง ตั้ง timer 300 ms
    - timer ทำงาน → ปิด**เฉพาะเมื่อ** `!pinnedRef && !pointerInContentRef` และ `openCodeRef` ยังเป็นจุดเดียวกับตอนตั้ง timer (กัน timer ของ A ปิดกล่อง B)
  - `click`/แตะหมุด → ล้าง timer, เปิด + ค้าง (`pinnedRef = true`) อนุญาตให้แผนที่เลื่อนให้กล่องอยู่ในจอ (`disableAutoPan: false` — ผู้ใช้สั่งเอง)
  - `closeclick` / ปิดด้วยโค้ด → `close()` กลาง: `infoWindow.close()`, ล้าง timer, `openCodeRef = null`, `pinnedRef = false`, `pointerInContentRef = false`
  - **รอบสร้างหมุดใหม่ (`markerKey` เปลี่ยน):** กล่องที่**ค้าง** และจุดยังอยู่ใน `visible` → เปิดต่อบนหมุดใหม่ (`disableAutoPan: true`) · จุดหายไป → `close()` · กล่อง **hover (ไม่ค้าง)** → `close()` เสมอ (กันกล่อง hover ค้างทั้งที่ pointer ออกไปแล้วตรงจังหวะอัปเดต)
  - **cleanup ลบเฉพาะของที่ชั้นน้ำสร้าง:** หมุดใน `floodMarkersRef`, listener ที่เก็บ handle ไว้เอง (`google.maps.event.removeListener` ทีละตัว — **ห้าม `clearInstanceListeners(map)`** เพราะจะลบ `idle` listener ของ fitBounds เดิม), listener ของ media query และของ content element, แล้ว `close()` — ทำเมื่อปิดชั้น / `live=false` / unmount
- **เนื้อหากล่องสร้างด้วย DOM + `textContent` ทั้งหมด** (ห้าม `innerHTML` ข้อความภายนอก) · สูงสุด ~9 บรรทัดสั้น · ลิงก์ = `POPNIX_URL` ตายตัว `target="_blank" rel="noopener noreferrer"`
  ```
  🌊 น้ำท่วม · ค่าจากจุดวัด            (slight → "ท่วมเล็กน้อย", อุโมงค์ → "· อุโมงค์")
  {name} · {road} · เขต{district} · {dir}   (ส่วนที่ null ไม่แสดง)
  ความลึกน้ำ 15 ซม. | อย่างน้อย 20 ซม. | ไม่มีค่าความลึก
  เริ่มท่วม 13:40                       (เฉพาะเมื่อมี since)
  วัดเมื่อ 14:05 (8 นาทีที่แล้ว)         (aging → นำหน้า "⚠ ข้อมูลเก่า")
  ค่าเฉพาะจุดวัด ถนนช่วงอื่นอาจลึกหรือตื้นกว่านี้
  {CREDIT_TEXT} ↗ · ไม่ใช่ประกาศเตือนภัยทางการ
  ```
- **แถบสถานะ** (เมื่อชั้นแสดงอยู่) มุมซ้ายบน ข้อความเล็ก ไม่ทับปุ่มขวาบนและโลโก้/เงื่อนไข Google ด้านล่าง (ตรวจที่ 375px) · ตัดสินตาม `phase` ก่อนเสมอ:
  - `loading`: "🌊 กำลังโหลดข้อมูลน้ำท่วมถนน…"
  - `error` (ส้ม): "🌊 โหลดข้อมูลน้ำท่วมไม่ได้ — ยังไม่มีข้อมูลให้แสดง" (ไม่มีตัวเลข "ท่วม 0")
  - `ready` และ `assessable = 0` (ส้ม): "🌊 ยังประเมินสถานการณ์ไม่ได้ — จุดวัดขัดข้องทั้งหมด (Z จุด)" (ไม่แสดง "ท่วม 0")
  - `ready`: "🌊 น้ำท่วมถนน กทม.: ท่วม X · เล็กน้อย Y · ขัดข้อง Z [· เก่าเกิน 3 ชม. W] [· ข้อมูลใช้ไม่ได้ V] · จุดวัดที่ประเมินได้ A · ข้อมูล 14:10 (3 นาทีก่อน) · ดึงเมื่อ 14:13" (ส่วนใน [] แสดงเมื่อ > 0)
  - `lastFailed` (ส้ม): นำหน้า "⚠ อัปเดตไม่ได้ — แสดงข้อมูลเมื่อ …" · `sourceOld` (ส้ม): "⚠ ข้อมูลต้นทางเก่า วัดล่าสุด {เวลา} ({n} นาทีก่อน)" หรือ "⚠ ไม่ทราบเวลาข้อมูลต้นทาง" ถ้า `sourceLatest` null
  - `sample` (แดง): "ข้อมูลตัวอย่าง — ไม่ใช่สถานการณ์จริง"
  - บรรทัด 2 เสมอ: "ไม่มีหมุด ≠ ถนนปลอดภัย · มีเฉพาะจุดที่ กทม. ติดตั้งเครื่องวัด · ไม่ใช่ประกาศเตือนภัยทางการ" + `CREDIT_TEXT` เป็นลิงก์
- **สถานะปุ่มเมื่อสลับโหมด:** `floodOn` เป็นความตั้งใจของผู้ใช้ — ไปดูย้อนหลัง (`live=false`) → ปุ่มซ่อน ชั้นซ่อน หยุด poll แต่ **คง `floodOn` ไว้** · กลับมาวันนี้ → ชั้นแสดงต่อและดึงใหม่ทันที
- `tracking/page.tsx` ไม่ต้องแก้ (ส่ง `live` อยู่แล้ว)

## 9. กรณีขอบ

| กรณี | ผล |
|---|---|
| POPNIX ล่ม/timeout ตั้งแต่เปิดครั้งแรก | `phase: error` แถบส้ม "โหลดไม่ได้ — ยังไม่มีข้อมูล" ไม่มีตัวเลข ไม่มีหมุด · รถ/แผนที่ปกติ |
| ล่มระหว่างใช้ | เก็บหมุดชุดเดิม + `lastFailed` แถบส้มบอกอายุ · หมุดค่อย ๆ เทา/หายตามกติกาอายุ |
| `roads: []` / ทุก record ใช้ไม่ได้ (`usable = 0`) | route 502 → เหมือนต้นทางล่ม (**ไม่**แสดง "ท่วม 0") |
| บาง record ใช้ไม่ได้ | แสดงตามปกติ + "ข้อมูลใช้ไม่ได้ V" ในแถบ |
| จุดวัดที่ประเมินได้ไม่มีน้ำเลย | ไม่มีหมุด + "ท่วม 0 · เล็กน้อย 0 · จุดวัดที่ประเมินได้ A" + "ไม่มีหมุด ≠ ถนนปลอดภัย" |
| ทุกจุดขัดข้อง (`assessable = 0`) | route 200 · แถบส้ม "ยังประเมินสถานการณ์ไม่ได้ — จุดวัดขัดข้องทั้งหมด" ไม่มี "ท่วม 0" |
| ทุก record เวลาอยู่ในอนาคตเกิน 5 นาที | ขั้น 1 ตัดหมด → `usable = 0` → route 502 (**ไม่**แสดงว่าไม่มีน้ำท่วม) |
| `depth: null` แต่ level wet | ปักหมุด "?" + "ไม่มีค่าความลึก" |
| code เดียวกัน wet เก่า + dry/off ใหม่ | ใช้ record ใหม่สุด → ไม่ปักหมุด wet เก่า (ข้อ 5 ขั้น 2) |
| code เดียวกัน dry เก่า + ตัวใหม่ level/พิกัดเสีย | code นั้นเป็น invalid ทั้งตัว ไม่ย้อนใช้ dry เก่า (ขั้น 3) |
| code เดียวกัน dry เก่า + ตัวใหม่เวลาอ่านไม่ได้ | ตัวเวลาเสียนับ invalid · ใช้ dry เก่า (ลำดับเวลาไม่รู้ จึงไม่ถือว่าใหม่กว่า — ขั้น 1) |
| วันที่ผิดปฏิทิน (`02-30`, `24:00`) | `parseThaiTime` → null → invalid |
| GPS poll ทุก 60 วิ | หมุดน้ำไม่ถูกล้าง แผนที่ไม่เด้ง (effect แยก) |
| วันนี้ → ดูย้อนหลัง → วันนี้ | ย้อนหลัง: ปุ่ม/ชั้นซ่อน หยุด poll (คง `floodOn`) · กลับวันนี้: แสดงต่อ + ดึงใหม่ |
| เปิดหน้าค้างข้ามวัน | วันของหน้าติดตามตัดที่ **05:00** (`trackingDateKey`) และหน้าเลื่อนวันที่เลือกเป็นวันใหม่เอง → ยังเป็นโหมดวันนี้ ชั้นทำงานต่อ (ไม่เกี่ยวกับเที่ยงคืน) |
| เน็ตผู้ใช้ล้ม / ช้า | service worker ใช้ `NetworkOnly` กับ route นี้ (ข้อ 6) → fetch ล้มจริง → `lastFailed` แถบส้ม · ไม่มีชุดเก่าจาก Cache Storage แอบมาแทน |
| CDN คืนชุดเก่าระหว่าง revalidate | ชุดอาจเก่าได้ ~15 นาที → แถบแสดงเวลาข้อมูล/ดึงเมื่อจริง · เกิน 45 นาที → `sourceOld` ส้ม |
| กล่องรายละเอียดใกล้ขอบแผนที่ | hover: อาจล้นขอบ (ยอมรับ — แผนที่ไม่ขยับเอง) · คลิก/แตะ: แผนที่เลื่อนให้กล่องอยู่ในจอ |

## 10. การทดสอบ

- **`roadFlood.test.ts`**:
  - `parseThaiTime`: +07:00 · ค่าว่าง/รูปแบบผิด · `2026-02-30` · `2028-02-29` (ผ่าน) / `2026-02-29` (ไม่ผ่าน) · `24:00:00` · `23:59:60`
  - `normalizeRoads`: wet/dry/off แยกถูก · level แปลก/พิกัดนอกไทย/0,0/สลับแกน/ไม่มีเวลา/ไม่มี code → invalid · depth `null`/`"15"` → `depthCm: null` (ไม่เป็น 0) · grp 2 ที่ 20 → ≥20 · code ซ้ำ wet เก่า + dry ใหม่ → ไม่มีจุด · เวลาเท่ากัน → ตัวแรก · ตัวใหม่สุดพิกัดเสีย → invalid · **ตัวใหม่สุด level เสีย + dry เก่า → invalid (ไม่ใช้ dry)** · **ตัวใหม่เวลาเสีย + dry เก่า → ใช้ dry + invalid 1** · เวลาอนาคต ≤5 นาที (ผ่าน) / >5 นาที (invalid) เทียบ `fetchedAt` · ทุก record อนาคต → throw · ทุกจุด `off` → `assessable = 0` ไม่ throw · `summary.latest` อนาคต → `sourceLatest: null` · ชื่อว่าง → "จุดวัด {code}" · `roads` ไม่มี/ว่าง/`usable=0` → throw
  - `summarizeFlood`: อายุจุด 45 นาทีพอดี (ปกติ) / +1 ms (aging) / 180 นาทีพอดี (aging) / +1 ms (tooOld) · `now` ก่อน `measuredAt` เล็กน้อย → อายุ 0 · `sourceAgeMin` เป็น**นาที** (45 พอดี ไม่ old / +1 ms old) · `sourceLatest` null / `sourceStale` → old · นับถูก
  - `depthLabel`/`ageLabel`
- **route** (`route.test.ts` แบบเดียวกับ `src/app/api/driver-leaves/route.test.ts`, `fetch` จำลอง): สำเร็จ → 200 + header cache ทั้งสองตัวถูก · timeout / HTTP 500 / JSON เสีย / `roads: []` → 502 + no-store · query แปลก → 400 + ไม่เรียก fetch · `?sample=1` ใน production → 400 + ไม่เรียก fetch · `?sample=1` ใน dev → fixture `sample: true` + no-store
- `npx tsc --noEmit` · `npm run lint` · `npm run test:run` · `npm run build` · ตรวจ header จาก production build ในเครื่อง (`next start`) · ตรวจ `public/sw.js` ที่ build ได้ว่ามีกฎ `NetworkOnly` ของ road-events อยู่**ก่อน**กฎ `apis` และกฎเดิมครบ (เทียบจำนวน/ลำดับกับ build ก่อนแก้)
- **บนเครื่อง** (dev server + ข้อมูลจริงจาก POPNIX; `?floodSample=1` เฉพาะเมื่อตอนทดสอบไม่มีจุดท่วม):
  - ปุ่มเปิด-ปิด · hover เปิด → เลื่อนเมาส์เข้ากล่องแล้วกดลิงก์ได้ · hover A แล้วรีบไป B → กล่อง B ไม่ถูก timer ของ A ปิด · คลิกค้าง → ค้างข้ามรอบอัปเดต → X ปิด · hover อยู่ตรงจังหวะสร้างหมุดใหม่ → กล่อง hover ปิด ไม่ค้างลอย
  - notebook จอสัมผัส + เมาส์ (จำลองด้วย media query): hover ใช้ได้ และแตะ = ค้าง
  - มือถือ 375px: แตะเปิด/ค้าง, แถบสถานะไม่ทับปุ่ม, กล่องใกล้ขอบ
  - รอ GPS poll แล้วหมุดน้ำยังอยู่ + ซูม/ตำแหน่งไม่เปลี่ยน · วันนี้→ย้อนหลัง→วันนี้
  - จำลองต้นทางล่ม (ชี้ URL ผิดชั่วคราวในเครื่อง) → แถบส้ม แผนที่ใช้ได้
  - ภาพหน้าจอส่งผู้ใช้
- Codex ตรวจ spec นี้ และตรวจโค้ดก่อนส่งผู้ใช้ (`gpt-6.1-sol` `max`)

## 11. รุ่นที่ 2 (บันทึกไว้ ไม่ทำรอบนี้)

- **Longdo/iTIC event feed** (น้ำท่วมทางหลวง กรมทางหลวง + อุบัติเหตุ/ปิดถนน/เบี่ยงจราจร): ต้องได้อนุญาตเป็นลายลักษณ์อักษรก่อน
- **gotcha เวลา:** รายการ `contributor: "DOH Admin"` ใน Longdo มีเวลา **ช้ากว่า POPNIX พอดี 7 ชม.** (เช่น 02:10:17 vs 09:10:17 รายการเดียวกัน) ขณะที่รายงานผู้ใช้ (`itic_user`) เป็นเวลาไทย → ต้องพิสูจน์เขตเวลาต่อ contributor ก่อนใช้
- Longdo ไม่มีช่องระดับน้ำ/ความรุนแรงที่ใช้ได้ (`severity` ว่างเกือบทั้งหมด) → แสดงข้อความตามต้นทาง ไม่ดึงตัวเลขมาตีความ
- โครง `RoadFloodSnapshot` แยกต่อแหล่ง — แหล่งที่ 2 เพิ่มเป็น type/route/ชุดหมุดของตัวเอง ไม่ต้องรื้อของรุ่นแรก

## 12. ลำดับส่งงาน / ย้อนกลับ

1. ผู้ใช้อนุมัติ spec → เขียนแผนลงมือ (writing-plans) → ลงมือบน branch นี้แบบ TDD
2. ตรวจครบข้อ 10 + Codex → ส่งภาพหน้าจอ + ไฟล์ที่เปลี่ยนให้ผู้ใช้ · push branch เพื่อดู Vercel preview **เฉพาะเมื่อผู้ใช้อนุญาต**
3. **ไม่ merge main จนกว่าผู้ใช้สั่ง** (merge main = deploy production)
4. ย้อนกลับ: ชั้นนี้เริ่มต้นปิดและแยกตัว → revert commit ได้ทันที ไม่มีข้อมูลค้างใน Firestore

## 13. ผลตรวจ Codex (ฉบับ 1 → ฉบับ 2) — `gpt-6.1-sol` · effort `max`

| ข้อ | ระดับ | สิ่งที่แก้ |
|---|---|---|
| 1 CDN cache | กลาง | แยก `Vercel-CDN-Cache-Control` (CDN 300 วิ) กับ `Cache-Control: max-age=0, must-revalidate` (browser) · เขียนว่า "ลด" ไม่ใช่ "กัน" การเรียกต้นทาง · query แปลก → 400 · ระบุวิธีพิสูจน์ `x-vercel-cache: HIT` บน preview |
| 2 hover/ค้าง/มือถือ | กลาง | `openCodeRef`/`pinnedRef` แยกจาก marker · ปิดหน่วง 300 ms + pointer เข้ากล่องยกเลิกการปิด · hover เฉพาะ `(hover: hover) and (pointer: fine)` · สัมผัสใช้ click อย่างเดียว · คลิกอนุญาต auto-pan |
| 3 effect/zIndex | ต่ำ | cleanup ลบเฉพาะ listener/หมุดของชั้นน้ำ ห้าม `clearInstanceListeners(map)` · `useMemo` ผลสรุปด้วย `[snapshot, now]` |
| 4 ข้อมูลเสีย/เก่า/ซ้ำ/วันที่ | **สูง** | `usable` + throw เมื่อ `roads` ว่าง/`usable=0` · แสดง "ข้อมูลใช้ไม่ได้" เมื่อ > 0 · `sourceOld` คิดจาก `now` (กัน SW คืนชุดเก่า) · ตัดซ้ำจากทุกสถานะก่อนแยก wet · ตรวจวันตามปฏิทินจริง · ห้าม `Number()`/`|| 0` กับ depth |
| 5 sample | กลาง | production `?sample=1` → 400 ก่อนเรียกต้นทาง · เปิดใน UI ด้วย `?floodSample=1` เฉพาะ dev · fixture อิงเวลาตอนเรียก · ห้ามเป็นตัวสำรองตอนล้ม |
| 6 เครดิต | กลาง | `CREDIT_TEXT` ข้อความเต็มตัวเดียวทุกที่ + "ไม่ใช่ประกาศเตือนภัยทางการ" · ระบุว่า TTL 300 วิ เป็น cache ของเรา (POPNIX `max-age` 60) |
| 7 กำกวม | กลาง | วันติดตามตัดที่ 05:00 (ไม่ใช่เที่ยงคืน) · คง `floodOn` ข้ามโหมดย้อนหลัง · นิยาม `phase` ตอนล้มแต่มีชุดเก่า · `name` ว่าง → "จุดวัด {code}" · เพิ่ม acceptance cases |

### รอบ 2 (ฉบับ 2 → ฉบับ 3) — ข้อ 3/5/6/7 เดิมปิดแล้ว · ข้อใหม่ที่แก้:

| ข้อ | ระดับ | สิ่งที่แก้ |
|---|---|---|
| R2-1 เวลาอนาคตตรวจหลังนับ `usable` | **สูง** | ตรวจเวลาอนาคตทุกสถานะเทียบ `fetchedAt` ก่อนตัดซ้ำ/นับ · `summary.latest` อนาคต → null · ฝั่งผู้ใช้ปัดอายุติดลบเป็น 0 |
| R2-2 `usable` รวมจุดขัดข้อง | กลาง | เพิ่ม `assessable` · `assessable = 0` → "ยังประเมินสถานการณ์ไม่ได้" ไม่แสดง "ท่วม 0" · แถบใช้ "จุดวัดที่ประเมินได้" |
| R2-3 ย้อนใช้ record เก่าเมื่อตัวใหม่ level เสีย | กลาง | เลือกตัวใหม่สุดด้วย code+เวลาก่อน แล้วค่อยตรวจ level/พิกัด (เสีย = invalid ทั้ง code) · กำหนดนโยบายเวลาเสียให้ชัด |
| R2-4 หน่วย `sourceAgeMin` | กลาง | `/ 60_000` + ปัดติดลบ + เทสต์ขอบ 45 นาที |
| R2-5 service worker คืนชุดเก่า | กลาง | `NetworkOnly` เฉพาะ `/api/road-events` หน้ากฎเดิมของ next-pwa · แก้ข้อความ header ข้อ 6 ให้ตรง · ตรวจ `sw.js` หลัง build |
| R2-6 hover บนอุปกรณ์ hybrid/timer | กลาง | content เป็น element ของเรา (`pointerenter/leave`) · hover ตัดสินจาก media query + ติดตาม change · timer เดียว ตรวจจุดเดิมก่อนปิด · สร้างหมุดใหม่เฉพาะ `markerKey` เปลี่ยน กล่อง hover ปิด กล่องค้างเปิดต่อ · `close()` กลาง |

ครบ 2 รอบตามกติกา checkpoint แล้ว — ฉบับ 3 ไม่ได้ส่งตรวจรอบที่ 3 · โค้ดจริงจะถูก Codex ตรวจอีกครั้งที่ checkpoint "โค้ดเสร็จ" ก่อนส่งผู้ใช้
