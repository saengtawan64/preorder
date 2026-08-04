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
  firebase.js               Firestore: init / add / soft-delete / mark received / subscribe
  sales.js                  ดึง+แปลงชีตยอดขาย + อ่าน/บันทึกเป้าผ่าน API
  sales-view.js             แสดงผลแดชบอร์ดยอดขาย (กราฟแท่งเป็น CSS ล้วน)
  installment.js            คำนวณค่างวดผ่อน (ดอกเบี้ยคงที่)
  utils.js                  ฟอร์แมต, parse CSV, escape HTML, timestamp มาตรฐาน
  icons.js                  รายชื่อไอคอน Lucide ที่ใช้จริง
  style.css                 สไตล์ทั้งหมด (ธีมสิ่งพิมพ์ ครีม-หมึก + โหมดการ์ดบนมือถือ)
public/
  _headers                  security headers ของ Cloudflare Pages (รวม CSP)
  logo.svg                  โลโก้ BSD (ไซด์บาร์ + หน้าล็อกอิน)
  favicon.svg               โลโก้บนกระเบื้องดำ (แท็บเบราว์เซอร์)
firestore.rules             ทุก read/write ต้อง request.auth != null

functions/                  Cloudflare Pages Functions (deploy พร้อมเว็บหลัก)
  api/sheet-webhook.js        รับ POST จาก Apps Script → เขียน Firestore
  api/sync-now.js             เว็บสั่ง sync ทันที (ไม่ต้องรอ cron)
  api/update-deposit.js       แก้ไขรายการจากเว็บ (ดู "ทำไมการแก้ไขต้องผ่านเซิร์ฟเวอร์")
  api/pin-login.js            ตรวจรหัส 5 หลัก → คืน Firebase custom token
  api/pins.js                 เพิ่ม/ตั้งชื่อ/ลบรหัส (ต้องล็อกอินอยู่ก่อน)
  api/follow-up.js            บันทึกว่าติดต่อลูกค้าแล้ว (ไม่แตะข้อมูลรายการ)
  _lib/pins-store.js          รูปแบบของ settings/pins + การอ่านของเก่า
  api/sales-targets.js        อ่าน/บันทึกเป้ายอดขาย (ใช้ร่วมทั้งร้าน)
  _lib/firestore-doc.js        อ่าน/เขียนเอกสาร settings/* ด้วย service account
  _lib/google-auth.js          แลก service-account key เป็น access token
  _lib/firestore-write.js      upsert / update เอกสาร Firestore ผ่าน REST API
  _lib/verify-firebase-token.js  ตรวจ ID token ของผู้ใช้ก่อนยอมให้เขียน

sync-worker/                Cloudflare Worker แยกต่างหาก, ต้อง deploy เอง
  wrangler.toml               ตั้ง cron ทุก 5 นาที
  src/index.js                entrypoint (scheduled + manual-trigger fetch)
  src/google-auth.js          เหมือน functions/_lib (คนละ deploy target เลย copy แยก)
  src/firestore.js             อ่านรายการ deposits ทั้งหมด (REST API)
  src/sheets.js                เขียนแถวลงชีตแท็บเดียว (ระบุตำแหน่งแถว ไม่ใช้ append)

appsscript/onEditSync.gs    วางใน Apps Script ของชีต (ดูขั้นตอนด้านล่าง)

cleanup-test-data.mjs       ล้างข้อมูลทดสอบ (gitignored — มีพาธไปไฟล์กุญแจ)
backup.mjs / backup.bat     สำรองระบบเป็น zip (gitignored, ปิดการรันอัตโนมัติแล้ว)
```

> สคริปต์ที่ถูก gitignore ทั้งหมดต้องใช้ไฟล์กุญแจ service account — ถ้าไฟล์นั้น
> ไม่อยู่ในเครื่อง สคริปต์จะรันไม่ได้ ตั้ง env `GCP_KEY_PATH` ให้ชี้ไปที่ไฟล์ได้

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
| `timestamp` | สตริงแสดงผลภาษาไทย (พ.ศ.) เช่น `2/8/2569 11:07` — ใช้แสดงผลเท่านั้น |
| `status` | `'pending'` (รอลูกค้ามารับ) หรือ `'received'` (รับของแล้ว) |
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
   `วันที่และเวลา, ชื่อจริง, ชื่อเล่น, เบอร์โทร, สินค้าที่มัดจำ, ยอดมัดจำ (บาท), สถานะ, depositId, อัปเดตล่าสุด`

   แท็บเดียวเก็บทุกสถานะ — ไม่มีแท็บ archive และไม่มีการย้าย/ลบแถว
   คอลัมน์ H (`depositId`) กับ I (`อัปเดตล่าสุด`) ถูกซ่อนไว้ ระบบจัดการเอง
   สร้างรูปแบบทั้งหมดได้ด้วยการรัน `setupSheet()` ใน Apps Script หนึ่งครั้ง
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

## แดชบอร์ดยอดขาย (ส่วนหลังร้าน)

ระบบนี้ไม่ได้มีแค่มัดจำแล้ว — ไซด์บาร์แบ่งเป็น **มัดจำ** (รอรับของ / รับแล้ว /
ลบแล้ว / สรุปยอด) และ **ยอดขาย** (แดชบอร์ด)

แดชบอร์ดอ่านชีตยอดขายของร้านตรงจากเบราว์เซอร์ **อ่านอย่างเดียว ไม่เขียนกลับ**
ชีตนั้นเปิดสาธารณะและ publish to web ไว้ (เจ้าของงานตัดสินใจเอง) จึงไม่ต้องมี
credential ใด ๆ ฝั่งเบราว์เซอร์

> ⚠️ **อย่าสลับหลักการกับชีตมัดจำ** — ชีตมัดจำมีชื่อกับเบอร์ลูกค้า ต้องเป็น
> ส่วนตัวและแตะผ่านฝั่งเซิร์ฟเวอร์เท่านั้น ชีตยอดขายเป็นตัวเลขรวมจึงเปิดได้

**โครงชีตยอดขาย** (`src/sales.js` แปลงให้): แถว 3 = หัวตาราง · คอลัมน์ 0 =
มาร์กเกอร์เดือน (`เดือน มกราคม 2569` — เว้นวรรคไม่สม่ำเสมอ จึงจับด้วยชื่อเดือน
ไม่ใช่รูปแบบตายตัว) · คอลัมน์ 1 = วันที่ หรือ `รวม` · **คอลัมน์ 2–17 = 8 แบรนด์
มือถือ แบรนด์ละ 2 ช่อง `[ยอดขาย, จำนวนเครื่อง]`** · คอลัมน์ 18+ เป็นแท็บเล็ต/
อุปกรณ์เสริม/ยอดนอกระบบ/สินเชื่อ ซึ่งแดชบอร์ดยังไม่ใช้

**ยอดรวมคำนวณจากแถวรายวันเอง ไม่อ่านจากแถว "รวม" ของชีต** เพื่อไม่ให้สูตรที่ค้าง
หรือถูกแก้มือทำให้ตัวเลขเพี้ยนเงียบ ๆ (ตรวจข้ามแล้ว 64 ค่า ตรงกันหมด)

**ไม่ใช้ Chart.js** — CSP เป็น `script-src 'self'` สคริปต์จาก CDN จึงถูกบล็อก
กราฟแท่งวาดด้วย CSS ล้วนแทน ซึ่งคุ้มกว่าการผ่อนกฎความปลอดภัย

---

## กฎเหล็ก — เคยพังมาแล้วทุกข้อ

**1. ห้ามใช้ `values.append` ของ Sheets API** — ให้เขียนระบุตำแหน่งแถว `A{n}:I{n}` เท่านั้น
append ทำพังพร้อมกัน 3 อย่าง: ก๊อปรูปแบบหัวตาราง (สีเข้ม) ลงแถวใหม่, ดันช่วง banding
กับกฎ conditional format ให้เลื่อน, และไป **ยึดคอลัมน์แรกที่ "มองเห็น"** — พอซ่อน
คอลัมน์ A ทุกแถวใหม่จึงเลื่อนไปขวาหนึ่งช่อง คอลัมน์ id ว่างตลอด ระบบจับคู่แถวเดิม
ไม่ได้ แล้วเพิ่มแถวซ้ำทุก ๆ 5 นาทีไม่รู้จบ

**2. ห้ามซ่อนคอลัมน์ A** — ซ่อนได้เฉพาะ H (`depositId`) และ I (`อัปเดตล่าสุด`)
ซึ่งอยู่ท้ายสุดจึงไม่กระทบตำแหน่งเขียน

**3. ห้าม `setValue()` สตริงที่หน้าตาเหมือนวันที่ โดยไม่ `setNumberFormat('@')` ก่อน**
Sheets จะ parse เป็นค่าวันที่จริง แล้วรอบหน้าที่สคริปต์อ่านกลับมาจะได้ `Date`
ซึ่ง `String(date)` ออกมาเป็น `"Wed Aug 02 2569 11:07:00 GMT+0700 (Indochina Time)"`
แล้วไหลเข้า Firestore ต่อ (แถวที่มาจากเว็บไม่โดน เพราะ Worker เขียนแบบ `RAW`)

**4. ตอนล้างข้อมูล: ลบ Firestore ก่อน แล้วค่อยเคลียร์ชีต**
ไม่งั้น worker จะ sync ข้อมูลกลับเข้าชีตภายใน 5 นาที — `cleanup-test-data.mjs`
ทำลำดับนี้ให้แล้ว

**5. เวลาแก้ CSP ให้ทดสอบจาก origin ที่ deploy จริง แล้ว hard reload**
ตอนต่อแดชบอร์ดยอดขาย การ fetch ล้มด้วย `Failed to fetch` เพราะ Google ตอบ CSV
ด้วย **307 redirect ไป `doc-XX-XX-sheets.googleusercontent.com` (โฮสต์เปลี่ยนทุก
ครั้ง)** ซึ่งไม่อยู่ใน `connect-src` — ต้องใส่ `https://*.googleusercontent.com`
แบบ wildcard สองจุดที่หลอกให้หาไม่เจอ: **CSP รายงาน violation เป็น URL ก่อน
redirect** (คือ `docs.google.com` ที่อนุญาตอยู่แล้ว) และ **CSP ที่บังคับใช้มากับ
ตัวเอกสาร** ถ้าหน้าอยู่ในแคชจะยังถือกฎเก่าแม้ deploy ใหม่แล้ว

**รูปแบบเวลาต้องตรงกันทั้งระบบ** (`2/8/2569 11:07`) — `bangkokTimestamp()` ใน
`src/utils.js` กับ `formatThai()` ใน `appsscript/onEditSync.gs` ต้องสร้างสตริง
เดียวกันเป๊ะ ถ้าแก้ที่หนึ่งต้องแก้อีกที่ด้วย (อย่าใช้ `toLocaleString` — ผลลัพธ์
ต่างกันตามเบราว์เซอร์)

---

## การเข้าใช้งาน — รหัส 5 หลัก

หน้าจอเป็นแป้นตัวเลขเหมือนปลดล็อกมือถือ แต่ **รหัสไม่เคยอยู่ในโค้ดฝั่งเบราว์เซอร์**
`/api/pin-login` เทียบรหัสกับ `settings/pins` ใน Firestore แล้วคืน **Firebase custom
token** ให้เบราว์เซอร์แลกเป็น session จริง — `firestore.rules` จึงยังเห็น
`request.auth` เป็นผู้ใช้จริงเหมือนตอนใช้รหัสผ่าน

⚠️ **repo นี้เป็น public — ห้ามใส่รหัสลงในโค้ดเด็ดขาด** รหัสตั้งต้นมาจาก secret
`STAFF_PINS` (คั่นด้วยจุลภาค) ซึ่งถูก seed ลง Firestore ครั้งแรกที่มีคนล็อกอิน

```bash
npx wrangler pages secret put STAFF_PINS --project-name=deposit-tracker-app
```

รหัส 5 หลักมีแค่ 100,000 ความเป็นไปได้ จึงจำกัดการเดา: ผิด 8 ครั้งล็อก 15 นาที
นับแยกตาม IP ที่เก็บเป็นค่าแฮช

### จัดการรหัสจากในเว็บ (เมนู "จัดการรหัส")

เพิ่ม / ตั้งชื่อ / ลบรหัสได้จากหน้าเว็บ **ไม่ต้อง deploy ใหม่** เก็บสูงสุด 10 รหัส

`settings/pins` เก็บเป็น `entries: [{pin, label, addedAtIso}]` — ของเดิมเป็น
`pins: [...]` เฉยๆ `readEntries()` ใน `_lib/pins-store.js` อ่านได้ทั้งสองแบบ และ
การเขียนครั้งแรกจะ**ล้าง `pins` เก่าทิ้ง** ไม่งั้นรหัสที่ลบไปแล้วจะยังค้างในฟิลด์เก่า

ข้อจำกัดที่ตั้งใจ:
- **เบราว์เซอร์ไม่เคยได้รับรหัส** เห็นแค่ `{index, label, hint}` (`hint` = `3•••7`)
  จึงส่ง "ทั้งรายการ" กลับไปไม่ได้ — API เลยรับเป็น**คำสั่งทีละอย่าง**
  (`add` / `remove` / `rename`) ไม่ใช่การเขียนทับทั้งก้อน
- **ลบต้องแนบ `hint` ที่หน้าจอเห็นอยู่** ถ้ามีคนอื่นแก้รายการไปแล้ว ลำดับจะเลื่อน
  และการลบตาม index เก่าจะลบผิดตัวแบบเงียบๆ
- **เหลือรหัสสุดท้ายลบไม่ได้** ไม่งั้นจะไม่มีใครเข้าระบบได้อีกเลย
- รหัสที่ mask แล้วอาจซ้ำกัน (เช่น 10005 กับ 19995 เป็น `1•••5` ทั้งคู่) **ให้ตั้งชื่อกำกับ**
  ถ้าไม่รู้ว่าแถวไหนคือรหัสอะไร ให้ลองเพิ่มรหัสนั้นซ้ำ — ระบบจะตอบว่ามันคือแถวไหน

---

## มัดจำค้างนาน + การติดตามลูกค้า

**อายุของมัดจำ** (`src/aging.js`) นับจาก `createdAtIso` เป็น**จำนวนวันที่ผ่านไป**
ไม่ใช่วันตามปฏิทิน — "ค้าง 45 วัน" คืออายุ ไม่ใช่วันที่ โซนเวลาจึงไม่มีผล
เกณฑ์: **30 วัน = เหลือง · 60 วัน = แดง** · นับเฉพาะรายการ "รอรับของ"

การ์ด "ค้างเกิน 30 วัน" จะ**เป็นสีเทาเมื่อไม่มีรายการค้าง** ตั้งใจให้เป็นแบบนั้น —
การ์ดที่แดงตลอดเวลาจะถูกมองข้ามภายในสัปดาห์เดียว

เมนู "รอรับของ" เรียง**เก่าสุดขึ้นก่อน** (ต่างจากเมนูอื่นที่เรียงใหม่สุดก่อน)
เพราะเป็นรายการที่ต้องลงมือทำ ไม่ใช่รายการว่าเกิดอะไรขึ้นล่าสุด

**การติดตาม** (`src/follow-up.js` + `functions/api/follow-up.js`)
ปุ่มส่งข้อความจะ**คัดลอกข้อความก่อน แล้วค่อยบันทึกว่าติดตามแล้ว** — ถ้าคัดลอกไม่สำเร็จ
จะไม่บันทึก เพราะยังไม่ได้ส่งอะไรให้ลูกค้าจริง การบันทึกว่า "แจ้งแล้ว" ทั้งที่ยังไม่ได้แจ้ง
อันตรายกว่าไม่บันทึกเลย

`followedUpAtIso` / `followUpCount` **เป็นฟิลด์ของเว็บอย่างเดียว ไม่ขึ้นชีต** —
ผังคอลัมน์ของชีตเป็นเรื่องเปราะบาง (worker เขียนช่วงตายตัว คอลัมน์เลื่อน = บั๊กแถวซ้ำ)
และไม่มีตัวเขียนไหนไปทับกัน: `upsertDepositFromSheet` กับ `updateDepositFromWeb`
ใช้ updateMask ที่ไม่มี 2 ฟิลด์นี้ แก้จากชีตหรือแก้จากเว็บจึงไม่ลบประวัติการติดตาม

⚠️ `/api/follow-up` **แยกจาก `/api/update-deposit` โดยตั้งใจ** — ตัวนั้นต้องส่งข้อมูล
ธุรกิจมาทั้งชุดเพราะเป็นการแก้ไข ส่วนตัวนี้ไม่รับข้อมูลธุรกิจเลย จึงแก้ชื่อหรือยอดเงิน
ไม่ได้แม้โดยบังเอิญ

---

## ทำไมการแก้ไขต้องผ่านเซิร์ฟเวอร์

`firestore.rules` ตั้งใจ**ไม่ยอมให้เบราว์เซอร์แก้ฟิลด์ข้อมูลธุรกิจ** — จากเว็บทำได้
แค่ soft-delete กับเปลี่ยนสถานะ เพื่อไม่ให้ session ที่หลุดไปเขียนทับประวัติได้

การกดแก้ไขในเว็บจึงยิงไปที่ `functions/api/update-deposit.js` ซึ่งตรวจ Firebase ID
token ของผู้ใช้ก่อน แล้วค่อยเขียนด้วย service account (ซึ่งข้าม rules ได้) โดยแตะ
เฉพาะฟิลด์ที่แก้ได้ — `depositId`, `createdAtIso`, `createdAt` ไม่เคยถูกแตะ

ผลพลอยได้: ไม่ต้องติดตั้ง/ล็อกอิน firebase CLI เพื่อ deploy rules ใหม่

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
