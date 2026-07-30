# DepositTracker — ระบบจัดเก็บและตรวจสอบมัดจำสินค้า

ระบบ**ภายใน**สำหรับพนักงาน บันทึกและค้นหารายการมัดจำสินค้า
ล็อกอินด้วยรหัสผ่านเดียวตั้งแต่เข้าเว็บ ไม่มีหน้าสาธารณะ

- **Firestore** เป็นฐานข้อมูลจริงเพียงที่เดียวที่เว็บคุยด้วยโดยตรง
- **Google Sheet ส่วนตัว** เป็นกระดานมิเรอร์ข้อมูล sync ทั้งสองทางกับ Firestore
  ผ่านตัวกลางฝั่งเซิร์ฟเวอร์ (เบราว์เซอร์ไม่คุยกับ Google Sheets โดยตรงเลย)
- ดีพลอยบน **Cloudflare Pages**

---

## สถาปัตยกรรม

```
พนักงาน ──(รหัสผ่านเดียว, Firebase Auth)──► เว็บแอป (Cloudflare Pages)
                                                  │
                                                  ▼
                                             Firestore  ◄── ฐานข้อมูลจริง
                                             │        ▲
                          sync-worker/       │        │  functions/api/sheet-webhook.js
                          (cron ทุก 5 นาที)   ▼        │  (Cloudflare Pages Function)
                                          Google Sheet ─┘
                                          (ส่วนตัว, ไม่ publish)
                                                  ▲
                                          appsscript/onEditSync.gs
                                          (พนักงานพิมพ์แก้ในตารางเอง)
```

**กันข้อมูลรั่ว:** Google Sheet ไม่เคย publish เป็นสาธารณะ และเบราว์เซอร์ไม่มี
URL หรือ credential ใด ๆ ที่จะคุยกับ Google Sheets ได้เลย — การ sync ทั้งสองทาง
เกิดขึ้นฝั่งเซิร์ฟเวอร์ทั้งหมด (Cloudflare Worker + Pages Function + Apps Script)

**กันข้อมูลย้อนไปมาไม่รู้จบ:** การเขียนผ่าน Sheets API (ที่ `sync-worker/` ใช้)
**ไม่ทำให้** `onEdit` trigger ทำงาน — Google เว้นไว้ให้เฉพาะการแก้ผ่านหน้าจอ
Sheets เท่านั้น ระบบนี้จึงไม่มีทางวนลูปตัวเอง

---

## เริ่มต้นใช้งาน (เว็บหลัก)

```bash
npm install
cp .env.example .env     # ใส่ค่า Firebase ของโปรเจกต์ตัวเอง
npm run dev              # http://localhost:5173
```

```bash
npm run build            # สร้างไฟล์ production ลง dist/
npm run preview          # เปิดดู dist/ ที่ build แล้ว
```

---

## โครงสร้างโปรเจกต์

```
index.html                 โครง DOM — เปิดมาเจอ #auth-gate ก่อนเสมอ
src/
  main.js                   ผูก event, render UI, ฟัง auth state
  auth.js                   ล็อกอิน/ล็อกเอาท์บัญชีเดียวผ่าน Firebase Auth
  config.js                 อ่านค่า config จาก env (ไม่มี localStorage override แล้ว)
  state.js                  state ของแอป (deposits อยู่ใน memory เท่านั้น)
  firebase.js               Firestore: init / add / soft-delete / subscribe
  utils.js                  ฟอร์แมต, parse CSV, escape HTML
  icons.js                  รายชื่อไอคอน Lucide ที่ใช้จริง
  style.css                 สไตล์ทั้งหมด
public/
  _headers                  security headers ของ Cloudflare Pages (รวม CSP)
  favicon.svg
firestore.rules             ทุก read/write ต้อง request.auth != null

functions/                  Cloudflare Pages Functions (deploy พร้อมเว็บหลัก)
  api/sheet-webhook.js        รับ POST จาก Apps Script → เขียน Firestore
  _lib/google-auth.js          แลก service-account key เป็น access token
  _lib/firestore-write.js      upsert เอกสาร Firestore ผ่าน REST API

sync-worker/                Cloudflare Worker แยกต่างหาก, ต้อง deploy เอง
  wrangler.toml               ตั้ง cron ทุก 5 นาที
  src/index.js                entrypoint (scheduled + manual-trigger fetch)
  src/google-auth.js          เหมือน functions/_lib (คนละ deploy target เลย copy แยก)
  src/firestore.js             อ่านรายการ deposits ทั้งหมด (REST API)
  src/sheets.js                เทียบ/อัปเดต/เพิ่มแถวในชีต (Sheets API)

appsscript/onEditSync.gs    วางใน Apps Script ของชีต (ดูขั้นตอนด้านล่าง)
```

แอปหลักเป็น vanilla JS ไม่มี framework — DOM ทั้งหมดอยู่ใน `index.html`
แล้ว `main.js` หา element ด้วย `getElementById` ตอนโหลด

---

## Data model

ทุก deposit เก็บที่ `deposits/{depositId}` ใน Firestore — **`depositId` คือ
document id ตรง ๆ** (ไม่ใช่ auto-id) เพื่อให้ทั้งเว็บ, Worker, และ Apps Script
Function อ้างอิงเอกสารเดียวกันด้วย path เดียวกันได้ทันที ไม่ต้อง query หา

| ฟิลด์ | ใช้ทำอะไร |
|---|---|
| `depositId` | UUID สร้างตอนบันทึก — เป็น document id ด้วย |
| `firstName`, `nickname`, `phoneNumber`, `depositItem`, `depositAmount` | ข้อมูลธุรกิจ |
| `timestamp` | สตริงแสดงผลภาษาไทย (พ.ศ.) — ใช้แสดงผลเท่านั้น |
| `createdAtIso` / `createdAt` | เวลาสร้างจริง (ISO / Firestore Timestamp) — **ไม่เปลี่ยนหลังสร้าง** |
| `updatedAtIso` | แก้ทุกครั้งที่มีการเปลี่ยนแปลง (รวมถึงตอน soft-delete) |
| `source` | `'web'` หรือ `'sheet'` — ระบบล่าสุดที่เขียนทับ |
| `deletedAt` | soft-delete marker — ลบจริงจะทำให้ id ถูกใช้ซ้ำได้ ซึ่งพังทั้งสอง sync |

**การลบเป็น soft-delete เสมอ** ทั้งจากเว็บ (ปุ่มลบ) และจากชีต (พิมพ์
"ลบแล้ว" ในคอลัมน์สถานะ) — ไม่มี hard delete จากที่ไหนเลย

---

## Console setup checklist

ส่วนนี้มีแค่คุณทำได้ (ต้องมีสิทธิ์เข้า Firebase / Google Cloud / Cloudflare)
ทำตามลำดับ เพราะแต่ละขั้นใช้ค่าที่ได้จากขั้นก่อนหน้า

### 1. Firebase Auth (บัญชีเดียว)

1. Firebase Console → **Authentication** → เปิด provider **Email/Password**
2. **Authentication → Users** → Add user → ตั้งอีเมล (จำไว้ ต้องตรงกับ
   `VITE_STAFF_LOGIN_EMAIL`) และรหัสผ่านที่แข็งแรง (16 ตัวอักษรขึ้นไป)
   เก็บรหัสนี้ใน password manager — **หน้าเว็บไม่เคยถามอีเมล เห็นแค่ช่องรหัสผ่าน**
3. **Authentication → Settings → Authorized domains** → เพิ่มโดเมน Cloudflare
   Pages ของคุณ (เช่น `deposit-tracker-app.pages.dev`) — ลืมขั้นนี้แล้ว
   login จะพังบน production แต่ใช้ได้ปกติตอน `npm run dev`

### 2. Firestore rules

```bash
firebase deploy --only firestore:rules
```

### 3. Google Cloud service account (ให้ Worker กับ Function ใช้)

1. Google Cloud Console (โปรเจกต์เดียวกับ Firebase) → **IAM & Admin → Service Accounts**
   → Create service account (เช่น `deposit-sync@<project>.iam.gserviceaccount.com`)
2. เปิด API: **Firestore API** และ **Google Sheets API**
3. ให้สิทธิ์ role **Cloud Datastore User** (พอสำหรับอ่าน/เขียน Firestore
   โดยไม่ผ่าน security rules — เพราะนี่คือ service account ไม่ใช่ Firebase Auth user)
4. สร้าง Key → JSON → ดาวน์โหลดไฟล์ (นี่คือค่า `GCP_SERVICE_ACCOUNT_KEY`
   ทั้งไฟล์แบบ JSON string เดียว — **เป็นความลับ ห้ามใส่ในโค้ด**)

### 4. ชีต

1. สร้าง Google Sheet ใหม่ ชื่อแท็บ **`Deposits`**
2. แถวหัวตาราง (row 1) 9 คอลัมน์:
   `depositId, วันที่และเวลา, ชื่อจริง, ชื่อเล่น, เบอร์โทร, สินค้าที่มัดจำ, ยอดมัดจำ (บาท), สถานะ, อัปเดตล่าสุด`
3. **File → Share** → แชร์ให้อีเมล service account (ขั้น 3) เป็น **Editor**
4. **ห้าม Publish to web เด็ดขาด** — นี่คือสิ่งที่ทำให้ข้อมูลรั่วในเวอร์ชันก่อนหน้า

### 5. Cloudflare Pages (เว็บหลัก)

Environment variables:

| ตัวแปร | ค่า |
|---|---|
| `VITE_FIREBASE_*` | จาก Firebase Console → Project settings → SDK config |
| `VITE_STAFF_LOGIN_EMAIL` | อีเมลบัญชีจากขั้น 1 |

Secrets (Pages → Settings → Environment variables → เข้ารหัส):

| Secret | ค่า |
|---|---|
| `SYNC_SHARED_SECRET` | สตริงสุ่มยาว ๆ ที่คุณตั้งเอง — Apps Script ต้องใช้ค่าเดียวกัน |
| `GCP_SERVICE_ACCOUNT_KEY` | JSON ทั้งไฟล์จากขั้น 3 |
| `FIRESTORE_PROJECT_ID` | project id ของ Firebase |

Build command `npm run build`, output directory `dist` — `functions/` ถูก
ตรวจจับและ deploy อัตโนมัติ ไม่ต้องตั้งค่าเพิ่ม

### 6. sync-worker/ (Firestore → ชีต, cron ทุก 5 นาที)

```bash
cd sync-worker
npm install
npx wrangler secret put GCP_SERVICE_ACCOUNT_KEY   # วาง JSON ทั้งไฟล์
npx wrangler secret put MANUAL_TRIGGER_SECRET     # สตริงสุ่ม สำหรับ debug endpoint
```

แก้ `wrangler.toml` ใส่ `FIRESTORE_PROJECT_ID` กับ `SHEET_ID` (ID ในลิงก์ของชีต)
ให้ตรงของจริง แล้ว:

```bash
npx wrangler deploy
```

### 7. Apps Script (ชีต → Firestore, ตอนพิมพ์แก้เอง)

1. เปิดชีต → **Extensions → Apps Script**
2. วางเนื้อหาจาก `appsscript/onEditSync.gs` เป็นไฟล์สคริปต์
3. **Project Settings (รูปเฟือง) → Script Properties** เพิ่ม:
   - `SYNC_WEBHOOK_URL` = `https://<โดเมนเว็บของคุณ>/api/sheet-webhook`
   - `SYNC_SHARED_SECRET` = ค่าเดียวกับ Cloudflare secret ในขั้น 5
4. **Triggers (รูปนาฬิกา) → Add Trigger** → เลือกฟังก์ชัน `onEditInstallable`
   → event type **On edit** (ต้องเป็น installable trigger ไม่ใช่ simple trigger)
   → Save แล้วกด authorize ตอนที่ระบบถาม

---

## Security model

1. **รหัสผ่านคือสิ่งที่ป้องกันข้อมูลจริง ไม่ใช่แค่บังหน้าจอ**
   ต่างจาก PIN เดิมที่ตรวจในเบราว์เซอร์ (ใครก็ View Source เห็น) รหัสผ่านนี้
   ถูกตรวจโดย Firebase Auth และ `firestore.rules` ปฏิเสธทุก read/write ที่
   ไม่มี `request.auth` — ต่อให้แก้ localStorage ใน DevTools ก็เข้าไม่ได้

2. **ชีตไม่เคยเปิดสาธารณะ** เบราว์เซอร์ไม่มีทางคุยกับ Google Sheets ได้เลย
   (ไม่มี URL, ไม่มี credential ฝังอยู่) การ sync ทั้งสองทางผ่านเซิร์ฟเวอร์
   ที่ถือ service-account key ซึ่งเก็บเป็น secret ไม่ใช่ `VITE_*`

3. **`VITE_*` ทุกตัวยังเป็นข้อมูลสาธารณะ** (ฝังในบันเดิลตอน build) — แต่ตอนนี้
   ไม่มีตัวไหนเป็นความลับแล้ว (อีเมลบัญชี ไม่ใช่รหัสผ่าน, Firebase web config
   ปกติเปิดเผยได้) ความลับจริงทั้งหมดอยู่ใน Cloudflare/Wrangler secrets

4. **การลบเป็น soft-delete เสมอ** ป้องกัน `depositId` ถูกใช้ซ้ำ ซึ่งจะทำให้
   ทั้งสอง sync direction สับสนว่ากำลังอ้างถึงเอกสารไหน

5. **Service account เขียน Firestore ได้โดยไม่ผ่าน `firestore.rules`** —
   `functions/_lib/firestore-write.js` จึงต้อง validate รูปแบบข้อมูลเองทั้งหมด
   ก่อนเขียน (ดูโค้ด) เพราะไม่มี rules มาช่วยกรองให้ในเส้นทางนี้

**ยังไม่ได้ทำ ถ้าจะขยายต่อ:** ทุกคนใช้บัญชีเดียว จึงไม่รู้ว่าใครทำอะไร
(ไม่มี audit trail รายบุคคล) — ถ้าพนักงานเริ่มเข้าออกบ่อยหรือมีหลายสาขา
ควรแยกเป็นบัญชีต่อคน โครงจาก Firebase Auth ที่มีอยู่รองรับได้โดยไม่ต้องรื้อ

---

## หมายเหตุสำหรับคนพัฒนาต่อ

- **ไอคอน** — เพิ่ม `data-lucide="foo-bar"` ที่ไหนก็ต้องเพิ่ม `FooBar` ใน
  `src/icons.js` ด้วย ไม่งั้นไอคอนจะไม่ขึ้นและมี warning ใน console
- **เวลา** — `timestamp` เป็นสตริงแสดงผลภาษาไทย (พ.ศ.) ใช้แสดงผลเท่านั้น
  ตัวที่ใช้ sort/กรองจริงคือ `createdAtIso`/`updatedAtIso` (ISO 8601, ค.ศ.)
- **คอลัมน์ในชีตห้ามสลับ** — ทั้ง `sync-worker/src/sheets.js` และ
  `appsscript/onEditSync.gs` อ้างอิงตำแหน่งคอลัมน์ A–I ตรง ๆ
- **แก้ column layout ต้องแก้ 3 ที่พร้อมกัน**: `sync-worker/src/sheets.js`,
  `appsscript/onEditSync.gs`, และแถวหัวตารางในชีตจริง
- **Session persistence** — ล็อกอินอยู่แค่ระหว่างแท็บเปิด (`browserSessionPersistence`
  ใน `src/auth.js`) ปิดเบราว์เซอร์แล้วต้องกรอกรหัสใหม่ ตั้งใจให้เป็นแบบนี้
  เพราะเป็นเครื่องรวมที่ร้าน — ถ้าอยากให้จำนานกว่านั้นแก้ได้ที่ไฟล์เดียวกัน
