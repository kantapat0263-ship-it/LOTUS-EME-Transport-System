# ชั้น "น้ำท่วมถนน กทม." บนแผนที่หน้าติดตามรถ — Design

- วันที่: 2026-10-05 · **ฉบับ 1**
- สถานะ: ผู้ใช้เคาะแนวทางทีละส่วนในแชทแล้ว (ขอบเขตข้อมูล / หน้าตา / อายุข้อมูล+การดึง) — **รอผู้ใช้ตรวจไฟล์นี้** · ยังไม่มีโค้ด
- branch: `feat/road-flood-layer` (แตกจาก `origin/main` @ `46bd1e4`) · **ยังไม่ deploy** (ผู้ใช้สั่ง: ทำโค้ด+ตัวอย่างให้ตรวจก่อน)
- ระบบที่แตะ: ระบบจัดคิว (repo นี้) เท่านั้น — ไม่มี Firestore collection ใหม่ ไม่มี env ใหม่ ไม่มี package ใหม่

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
- **เงื่อนไข:** ใช้ฟรีรวมเชิงพาณิชย์ · **ต้องให้เครดิตใกล้ข้อมูล + ลิงก์กลับ** `https://flood.pop.in.th` ข้อความ: "ข้อมูล: สำนักการระบายน้ำ กรุงเทพมหานคร ผ่าน POPNIX Flood (flood.pop.in.th)" · ไม่ใช่ประกาศเตือนภัยทางการ ห้ามทำให้เข้าใจว่าเป็นข้อมูลรัฐโดยตรง · ไม่รับประกันความถูกต้อง
- **ความถี่:** ต้นทางอัปเดตถนนทุก 5–10 นาที · POPNIX cache 30 วิ/10 นาที · จำกัด 300 req/นาที/IP · ขอให้แอปผู้ใช้มากดึงผ่าน server แล้ว cache
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
        → GET /api/road-events  ──(Vercel CDN cache s-maxage=300)──→ POPNIX api_roads.php (timeout 8 วิ)
        ← { ok, snapshot }  (จุดที่มีน้ำ + summary ที่จัดรูปแล้ว)
→ summarizeFlood(snapshot, now)  (คิดอายุ ณ เวลาแสดงผล)
→ TrackingMap: หมุดชุดแยก + InfoWindow + แถบสถานะ + เครดิต
```

## 5. ตรรกะล้วน `src/lib/roadFlood.ts` (+ `roadFlood.test.ts`) — client-safe ไม่มี I/O

```ts
export const FLOOD_FRESH_MAX_MIN = 45   // POPNIX ถือว่าเกิน 45 นาที = เก่า
export const FLOOD_SHOW_MAX_MIN = 180   // เกิน 3 ชม. ไม่ปัก
export const POPNIX_URL = "https://flood.pop.in.th"

export interface FloodPoint {
  code: string; name: string; road: string | null; district: string | null; dir: string | null
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
  sourceStale: boolean          // summary.stale || summary.scrape_failing
  points: FloodPoint[]          // จุดที่มีน้ำ ผ่านการตรวจแล้ว (ยังไม่ตัดตามอายุ)
  offline: number               // level "off"
  invalid: number               // พิกัด/เวลา/level ใช้ไม่ได้
  sample?: true                 // ข้อมูลตัวอย่าง (dev เท่านั้น ข้อ 6)
}
```

ฟังก์ชัน:
- `parseThaiTime(s)` → epoch ms หรือ `null` — ตีความเป็น **+07:00 เสมอ** (`"2026-10-05 14:05:00"` → `Date.parse("2026-10-05T14:05:00+07:00")`); รูปแบบอื่น/ค่าว่าง → `null`
- `normalizeRoads(raw, fetchedAt)` → `RoadFloodSnapshot` หรือ throw ถ้าไม่มี `roads` เป็น array
  - เก็บเฉพาะ `level` เป็น `flood`/`slight` (ใช้ `level` ของต้นทางตรง ๆ ไม่คิดจาก depth เอง) · `off` → นับ `offline` · `dry` → ทิ้ง · level อื่น → `invalid`
  - พิกัดต้องเป็นตัวเลขจำกัด และอยู่ในกรอบประเทศไทย lat 5.5–20.5, lng 97.3–105.7 (กัน 0,0 / สลับแกน) ไม่ผ่าน → `invalid`
  - `measured_at` แปลงไม่ได้ → `invalid` (จุดที่ไม่มีเวลาไม่ปัก)
  - `depth` ไม่ใช่ตัวเลขจำกัด → `depthCm: null`
  - `code` ซ้ำ → เก็บตัวที่ `measuredAt` ใหม่สุด · ไม่มี `code` → `invalid`
  - ข้อความ (`name`/`road`/`district`/`dir`) ตัดช่องว่าง ค่าว่างเป็น `null` · ยาวเกิน 120 ตัวอักษร → ตัดให้เหลือ 120 ตัวอักษร (กันกล่องยาวผิดปกติ)
- `summarizeFlood(snapshot, now)` → `{ visible: (FloodPoint & { aging: boolean })[], flood, slight, offline, tooOld, invalid }`
  - อายุ = `now - measuredAt` · `≤45 นาที` ปกติ · `45 นาที–3 ชม.` `aging: true` · `>3 ชม.` ไม่อยู่ใน `visible` → นับ `tooOld`
  - เวลาวัดอยู่ในอนาคตเกิน 5 นาที (นาฬิกาเพี้ยน) → นับ `invalid` · อนาคตไม่เกิน 5 นาที → ถือว่าอายุ 0
  - `flood`/`slight` = นับจาก `visible`
- `depthLabel(p)` → `"15"` / `"≥20"` / `"?"` (null) · `ageLabel(ms)` → "เพิ่งวัด" / "8 นาทีที่แล้ว" / "1 ชม. 20 นาทีที่แล้ว"

## 6. API route `src/app/api/road-events/route.ts`

- `GET` · `export const dynamic = "force-dynamic"` · runtime Node
- `fetch(POPNIX_URL + "/api_roads.php", { signal: AbortSignal.timeout(8000), cache: "no-store" })` → `normalizeRoads(json, Date.now())`
- **สำเร็จ:** `200 { ok: true, snapshot }` + `Cache-Control: public, s-maxage=300, stale-while-revalidate=600` → ทุกเครื่องได้ชุดเดียวกัน POPNIX โดนเรียก ~1 ครั้ง/5 นาที/region (ตรวจพฤติกรรม header กับเอกสาร Vercel ตอนลงมือ)
- **ล้ม** (timeout / HTTP ≠ 200 / JSON เสีย / ไม่มี `roads`): `502 { ok: false }` + `Cache-Control: no-store` + `console.error` — ไม่ cache ความล้มเหลว
- **ไม่ต้องล็อกอิน:** ข้อมูลสาธารณะ ไม่มีความลับ และ cache ร่วมต้องไม่แยกตามผู้ใช้ · CDN กันไม่ให้ใครใช้ route เราไปยิง POPNIX ถี่
- **ข้อมูลตัวอย่าง:** `?sample=1` ใช้ได้เมื่อ `process.env.NODE_ENV !== "production"` เท่านั้น (Vercel production/preview = production → ปิดเสมอ) คืน fixture ที่ชื่อทุกจุดขึ้นต้น "[ตัวอย่าง]" + `sample: true` + `no-store` — fixture เดียวกับที่ใช้ในเทสต์

## 7. Hook `src/hooks/use-road-flood.ts`

`useRoadFlood(enabled: boolean)` → `{ snapshot, phase, lastFailed, now }`
- `phase`: `"idle" | "loading" | "ready" | "error"` — **แยกสถานะชัด ห้ามให้ "โหลดไม่ได้" แสดงเหมือน "ไม่มีน้ำท่วม"** (บทเรียน PR#46)
- `enabled` = ปุ่มเปิด **และ** โหมดวันนี้ → ดึงทันที แล้วทุก 5 นาที · ปิด → หยุด poll + ยกเลิก request ที่ค้าง (เก็บ snapshot ล่าสุดไว้ เปิดใหม่โชว์ทันทีแล้วดึงใหม่)
- ดึงล้มแต่มีชุดเก่า → เก็บชุดเก่า + `lastFailed: true` · seq guard กันผลที่ตอบช้ามาทับผลใหม่
- `now` เดินทุก 60 วิ (ใช้คิดอายุ/ป้ายเวลา) · `fetch("/api/road-events")` ไม่ต่อ `?t=` (ต้องการ CDN cache)

## 8. แผนที่ `src/components/tracking/TrackingMap.tsx`

- state `floodOn` (เริ่ม false) · ปุ่ม "🌊 น้ำท่วม" อยู่กลุ่มเดียวกับ "🚦 จราจร" มุมขวาบน · แสดงเมื่อ `ready && live` · `useRoadFlood(floodOn && !!live)`
- **หมุดชุดแยก** `floodMarkersRef` + effect ของตัวเอง (deps: `ready`, `floodOn`, `live`, ผล `summarizeFlood`) — effect เดิมของรถ/จุดงานไม่แตะหมุดน้ำ และ effect หมุดน้ำ**ไม่เรียก `fitBounds`/`setCenter`/`setZoom`**
- หมุด: วงกลม label = `depthLabel` · ท่วม `#1d4ed8` · ท่วมเล็กน้อย `#60a5fa` · `aging` = `#6b7280` · `zIndex` 100 — กำหนด `zIndex` 500 ให้หมุดจุดงานเดิมด้วย เพื่อให้หมุดน้ำอยู่ใต้จุดงาน/รถ (รถ 999, จอดนาน 900 เดิม) · ไม่ตั้ง `title` (กัน tooltip ซ้อนกล่อง)
- **InfoWindow ตัวเดียว** `disableAutoPan: true` (ไม่ให้แผนที่ขยับ) `maxWidth: 260`
  - `mouseover` → เปิด (ถ้ายังไม่ได้ค้างจุดอื่น) · `mouseout` → ปิด (ถ้าไม่ได้ค้าง) · `click` → ค้าง (มือถือใช้ click อย่างเดียว) · `closeclick` → เลิกค้าง
  - รอบอัปเดต: ถ้าจุดที่ค้างยังอยู่ → เปิดค้างต่อบนหมุดใหม่ด้วยเนื้อหาใหม่ · หายไป → ปิด
  - ปิดปุ่ม/ออกจากโหมดวันนี้/unmount → ลบหมุด + ปิดกล่อง + ถอด listener ทั้งหมด
- **เนื้อหากล่องสร้างด้วย DOM + `textContent` ทั้งหมด** (ห้าม `innerHTML` ข้อความภายนอก) · ลิงก์เครดิต = `POPNIX_URL` ตายตัว `target="_blank" rel="noopener noreferrer"`
  ```
  🌊 น้ำท่วม · ค่าจากจุดวัด            (slight → "ท่วมเล็กน้อย", อุโมงค์ → "· อุโมงค์")
  {name} · {road} · เขต{district} · {dir}   (ส่วนที่ null ไม่แสดง)
  ความลึกน้ำ 15 ซม. | อย่างน้อย 20 ซม. | ไม่มีค่าความลึก
  เริ่มท่วม 13:40                       (เฉพาะเมื่อมี since)
  วัดเมื่อ 14:05 (8 นาทีที่แล้ว)         (aging → นำหน้า "⚠ ข้อมูลเก่า")
  ค่าเฉพาะจุดวัด ถนนช่วงอื่นอาจลึกหรือตื้นกว่านี้
  ข้อมูล: สำนักการระบายน้ำ กทม. ผ่าน POPNIX Flood ↗
  ```
- **แถบสถานะ** (เฉพาะตอนเปิดชั้น) มุมซ้ายบน ข้อความเล็ก ไม่ทับปุ่มขวาบนและโลโก้/เงื่อนไข Google ด้านล่าง (ตรวจที่ 375px)
  - loading ครั้งแรก: "🌊 กำลังโหลดข้อมูลน้ำท่วมถนน…"
  - error และไม่มีชุดเก่า (ส้ม): "🌊 โหลดข้อมูลน้ำท่วมไม่ได้ — ยังไม่มีข้อมูลให้แสดง"
  - ready: "🌊 น้ำท่วมถนน กทม.: ท่วม X · เล็กน้อย Y · ขัดข้อง Z [· เก่าเกิน 3 ชม. W] · ข้อมูล 14:10 (3 นาทีก่อน) · ดึงเมื่อ 14:13"
  - `lastFailed` (ส้ม): นำหน้า "⚠ อัปเดตไม่ได้ — แสดงข้อมูลเมื่อ …" · `sourceStale` (ส้ม): "⚠ ต้นทางไม่อัปเดตตั้งแต่ {sourceLatest}"
  - `sample` (แดง): "ข้อมูลตัวอย่าง — ไม่ใช่สถานการณ์จริง"
  - บรรทัด 2 เสมอ: "ไม่มีหมุด ≠ ถนนปลอดภัย · มีเฉพาะจุดที่ กทม. ติดตั้งเครื่องวัด" + เครดิตลิงก์
- `tracking/page.tsx` ไม่ต้องแก้ (ส่ง `live` อยู่แล้ว)

## 9. กรณีขอบ

| กรณี | ผล |
|---|---|
| POPNIX ล่ม/timeout ตั้งแต่เปิดครั้งแรก | แถบส้ม "โหลดไม่ได้ — ยังไม่มีข้อมูล" ไม่มีหมุด · รถ/แผนที่ปกติ |
| ล่มระหว่างใช้ | เก็บหมุดชุดเดิม + แถบส้มบอกอายุ · หมุดค่อย ๆ เทา/หายตามกติกาอายุ |
| ไม่มีจุดไหนท่วม | ไม่มีหมุด + "ท่วม 0 · เล็กน้อย 0" + ข้อความ "ไม่มีหมุด ≠ ถนนปลอดภัย" |
| `depth: null` แต่ level wet | ปักหมุด "?" + "ไม่มีค่าความลึก" |
| พิกัด/เวลาเพี้ยน, code ซ้ำ | ตัดตามข้อ 5 นับ `invalid` — ใช้ตรวจ/เทสต์เท่านั้น ไม่แสดงในแถบสถานะ (code ซ้ำไม่นับ invalid เพราะยังเหลือตัวใหม่สุด) |
| GPS poll ทุก 60 วิ | หมุดน้ำไม่ถูกล้าง แผนที่ไม่เด้ง (effect แยก) |
| เปิดหน้าค้างข้ามเที่ยงคืน/สลับไปดูย้อนหลัง | `live=false` → ปุ่มหาย ชั้นปิด หยุด poll |
| PWA service worker (NetworkFirst `/api/*`) | ออนไลน์ใช้ network ตามปกติ · ออฟไลน์อาจได้ชุดเก่าจาก SW → แถบแสดงอายุตามเวลาข้อมูลจริงอยู่แล้ว |

## 10. การทดสอบ

- **`roadFlood.test.ts`**: `parseThaiTime` (+07:00, รูปแบบผิด, ค่าว่าง) · `normalizeRoads` (เก็บเฉพาะ wet, off→offline, dry ทิ้ง, level แปลก/พิกัดนอกไทย/0,0/สลับแกน/ไม่มีเวลา/ไม่มี code → invalid, depth null ไม่เป็น 0, grp 2 ที่ 20 → ≥20, code ซ้ำเลือกใหม่สุด, ไม่มี roads → throw) · `summarizeFlood` (ขอบ 45 นาที/3 ชม. พอดี, อนาคต ≤5 นาที/เกิน 5 นาที, นับ) · `depthLabel`/`ageLabel`
- **route** (`route.test.ts` แบบเดียวกับ `src/app/api/driver-leaves/route.test.ts`): เทสต์ด้วย `fetch` จำลอง — สำเร็จ (header cache ถูก), timeout, HTTP 500, JSON เสีย → 502 + no-store · `?sample=1` ใน production → ไม่คืนตัวอย่าง
- `npx tsc --noEmit` · `npm run lint` · `npm run test:run` · `npm run build`
- **บนเครื่อง** (dev server + ข้อมูลจริงจาก POPNIX; ใช้ `?sample=1` เฉพาะเมื่อตอนทดสอบไม่มีจุดท่วม): ปุ่มเปิด-ปิด · hover/คลิกค้าง/X บนคอม · แตะบนมือถือ (375px) · รอ GPS poll แล้วหมุดน้ำยังอยู่+ซูมไม่เปลี่ยน · จำลองต้นทางล่ม (ชี้ URL ผิดชั่วคราวในเครื่อง) → แถบส้ม แผนที่ใช้ได้ · ภาพหน้าจอส่งผู้ใช้
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
