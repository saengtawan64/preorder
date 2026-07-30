# DepositTracker — ระบบจัดเก็บและตรวจสอบมัดจำสินค้า

เว็บแอปบันทึกและค้นหารายการมัดจำสินค้า เก็บข้อมูลบน **Firebase Firestore**
(แบบ real-time) และ mirror ลง **Google Sheets** ดีพลอยบน **Cloudflare Pages**

- **หน้าสาธารณะ** — ค้นหารายการมัดจำด้วยชื่อ / ชื่อเล่น / เบอร์โทร และกรอกฟอร์มเพิ่มรายการใหม่
- **หน้าแอดมิน** (ปลดล็อกด้วย PIN) — สรุปยอด, ตารางแยกตามวัน, ค้นหา, ลบรายการ, ส่งออก CSV
- ธีมสว่าง/มืด จำค่าไว้ใน `localStorage`

---

## เริ่มต้นใช้งาน

```bash
npm install
cp .env.example .env     # ใส่ค่าของโปรเจกต์ตัวเอง
npm run dev              # http://localhost:5173
```

```bash
npm run build            # สร้างไฟล์ production ลง dist/
npm run preview          # เปิดดู dist/ ที่ build แล้ว
```

---

## โครงสร้างโปรเจกต์

```
index.html              โครง DOM ทั้งหมด (ทุก view/modal อยู่ในไฟล์นี้ ซ่อน-แสดงด้วยคลาส .hidden)
src/
  main.js               ผูก event, render UI ทั้งหมด
  config.js             อ่านค่า config ตามลำดับ localStorage → env
  state.js              state ของแอป + การ persist ลง localStorage
  firebase.js           Firestore (init / add / delete / subscribe) — โหลดแบบ dynamic
  sheets.js             อ่าน CSV ที่ publish + ส่งข้อมูลเข้า Apps Script
  utils.js              ฟอร์แมต, parse CSV, escape HTML
  icons.js              รายชื่อไอคอน Lucide ที่ใช้จริง
  style.css             สไตล์ทั้งหมด (CSS custom properties + ธีมสว่าง/มืด)
public/
  _headers              security headers ของ Cloudflare Pages
  favicon.svg
  Deposit_Sheet_Template.csv   ไฟล์ชีตตั้งต้นให้ผู้ใช้ดาวน์โหลด
firestore.rules         security rules ตั้งต้นของ Firestore
```

แอปนี้เป็น vanilla JS ไม่มี framework — DOM ทั้งหมดอยู่ใน `index.html`
แล้ว `main.js` ค่อยหา element ด้วย `getElementById` ตอนโหลด
การเพิ่ม UI ใหม่จึงต้องแก้ทั้ง `index.html` และ object `el` ใน `main.js`

---

## การตั้งค่า

ทุกค่าอ่านตามลำดับ: **`localStorage` → ตัวแปร env ตอน build → ค่า default**
ผู้ใช้จึงตั้งค่าเองผ่าน modal ในหน้าเว็บได้ โดยไม่ต้อง build ใหม่

| ตัวแปร | ใช้ทำอะไร |
|---|---|
| `VITE_SHEET_CSV_URL` | URL ของ Google Sheet ที่ publish เป็น CSV (ใช้ "ดึงข้อมูลล่าสุด") |
| `VITE_SHEET_SCRIPT_URL` | Apps Script Web App ที่รับ POST แล้ว append แถวลงชีต |
| `VITE_FIREBASE_*` | Firebase web config (ดูใน `.env.example`) |
| `VITE_ADMIN_PIN` | PIN เข้าหน้าแอดมิน (ถ้าไม่ตั้ง จะเป็น `1234`) |

### Google Sheets

1. เปิด modal **"ตั้งค่า Google Sheets"** แล้วกดดาวน์โหลด `Deposit_Sheet_Template.csv`
2. Import ไฟล์นั้นเข้า Google Sheets — ลำดับคอลัมน์ต้องเป็น
   `วันที่และเวลา, ชื่อจริง, ชื่อเล่น, เบอร์โทร, สินค้าที่มัดจำ, ยอดมัดจำ (บาท)`
   (`src/sheets.js` อ่านตามตำแหน่งคอลัมน์ ถ้าสลับคอลัมน์ข้อมูลจะเพี้ยน)
3. **File → Share → Publish to web** เลือกชีตนั้น ชนิด **CSV** แล้วเอา URL มาใส่
4. ถ้าต้องการให้เขียนกลับเข้าชีตได้ ให้ deploy Apps Script เป็น Web App
   ที่รับ JSON แล้ว `appendRow` จากนั้นใส่ URL ใน `VITE_SHEET_SCRIPT_URL`

> ไฟล์ CSV ที่ **ส่งออก** จากหน้าแอดมินมีคอลัมน์ `ลำดับ` เพิ่มด้านหน้า
> ไฟล์นี้เป็นรายงานสำหรับอ่าน **ไม่ใช่** ฟอร์แมตเดียวกับที่ import กลับเข้าระบบ

### Firebase

วาง `firebaseConfig` จาก Firebase Console ลงใน modal **"ตั้งค่า Firebase"**
(รับได้ทั้ง JSON ล้วนและแบบ `const firebaseConfig = { ... };` ที่ก็อปมาตรง ๆ)
หรือกำหนดผ่าน `VITE_FIREBASE_*` ก็ได้

deploy security rules ด้วย:

```bash
firebase deploy --only firestore:rules
```

ถ้ายัง**ไม่**ตั้งค่า Firebase แอปยังใช้งานได้ปกติโดยอ่านจาก Google Sheet
อย่างเดียว — และไม่ต้องโหลด Firebase SDK เลย (ประหยัด ~140 kB gzip)

---

## Security model — อ่านก่อนเอาไปใช้กับข้อมูลลูกค้าจริง

ตัวหนังสือในหน้าเว็บเคลมว่า *"ความปลอดภัยสูงสุด / เข้ารหัส 100%"*
ของจริงตอนนี้ยังไม่ถึงระดับนั้น ขอสรุปให้ตรงไปตรงมา:

1. **PIN แอดมินไม่ใช่ระบบยืนยันตัวตน**
   PIN ถูก build ติดไปกับ JS ที่ส่งให้เบราว์เซอร์ ใครกด View Source ก็เห็น
   และสถานะ "ล็อกอินแล้ว" เก็บเป็น `localStorage.admin_logged_in = "true"`
   ซึ่งแก้เองได้ใน DevTools → **PIN แค่ซ่อนหน้าจอ ไม่ได้ป้องกันข้อมูล**

2. **ข้อมูลอ่านได้แบบ public**
   ฟีเจอร์ค้นหาสาธารณะจำเป็นต้องให้ `allow read` เปิดไว้ ใครที่รู้
   Firebase project id หรือ URL ของ CSV ก็ดึงรายชื่อและเบอร์โทรลูกค้าได้ทั้งหมด
   ข้อมูลชุดนี้เป็นข้อมูลส่วนบุคคลตาม PDPA

3. **ตัวแปร `VITE_*` ทุกตัวเป็นข้อมูลสาธารณะ**
   Vite แปะค่าลงในไฟล์ bundle ตอน build อย่าใส่ความลับจริงลงไป
   (Firebase web API key เปิดเผยได้ตามปกติ — ตัวคุมสิทธิ์คือ security rules)

4. **ลบรายการต้องล็อกอิน Firebase**
   `firestore.rules` ตั้ง `allow delete: if request.auth != null` ไว้
   เมื่อยังไม่มี Firebase Auth ปุ่มลบจะลบไม่ผ่านและขึ้นข้อความแจ้ง —
   ตั้งใจให้เป็นอย่างนั้น ดีกว่าเปิดให้ใครก็ลบข้อมูลทิ้งได้
   (ของเดิมกดลบแล้วแถวหายแค่ในเครื่อง เดี๋ยวก็เด้งกลับมาตอน sync)

**ถ้าจะใช้กับข้อมูลจริง ควรทำ:** เพิ่ม Firebase Auth (Email/Google) →
เปลี่ยน `allow read` ให้เช็ค `request.auth` → ย้ายการค้นหาสาธารณะไปอยู่หลัง
Cloudflare Function ที่คืนเฉพาะ field ที่จำเป็น → เอา PIN ออก

---

## Deploy บน Cloudflare Pages

| ตั้งค่า | ค่า |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variables | ใส่ `VITE_*` ตามตาราง config ด้านบน |

`public/_headers` จะถูกคัดลอกไปที่ root ของ `dist/` และ Cloudflare อ่านไฟล์นี้
เพื่อตั้ง security headers รวมถึง Content-Security-Policy

CSP ที่ตั้งไว้อนุญาต: Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`),
Firestore (`*.googleapis.com`) และ Google Sheets/Apps Script
ยังต้องใช้ `'unsafe-inline'` ใน `style-src` เพราะมี `style="..."` ใน markup
และมีการ set `element.style` ใน JS — ถ้าจะรัดกุมกว่านี้ต้องย้ายส่วนนั้นไปเป็นคลาส CSS ก่อน

**ถ้าเพิ่ม third-party ตัวใหม่ (เช่น analytics) ต้องแก้ CSP ใน `public/_headers` ด้วย
ไม่งั้นเบราว์เซอร์จะบล็อกเงียบ ๆ**

---

## หมายเหตุสำหรับคนพัฒนาต่อ

- **ไอคอน** — เพิ่ม `data-lucide="foo-bar"` ที่ไหนก็ต้องเพิ่ม `FooBar` ใน
  `src/icons.js` ด้วย ไม่งั้นไอคอนจะไม่ขึ้นและมี warning ใน console
  (ที่ทำแบบนี้เพราะ import ไอคอนทั้งชุดกินไป ~380 kB)
- **เวลา** — timestamp เก็บเป็น**สตริง** จาก `toLocaleString('th-TH')` เช่น
  `"30/7/2569 17:22:05"` (พ.ศ.) การจัดกลุ่มตามวันใช้ส่วนหน้าช่องว่าง
  ถ้าจะทำรายงานย้อนหลังหรือกรองช่วงวัน ควรเก็บ ISO timestamp เพิ่มอีกฟิลด์
- **การเขียนข้อมูล** — Apps Script ถูกเรียกแบบ `mode: 'no-cors'`
  จึงอ่าน response ไม่ได้เลย ถือว่าชีตเป็น mirror ส่วน Firestore เป็นตัวจริง
  ถ้า Firestore เขียนไม่ผ่านจะขึ้น error ไม่แสดงว่าสำเร็จ
- **แหล่งข้อมูล** — ถ้าต่อ Firestore อยู่ Firestore ชนะเสมอ
  การ sync จากชีตจะไม่ทับข้อมูล (ดู `syncFromSheet` ใน `src/main.js`)
- **`localStorage`** เก็บ deposits ไว้เป็น cache ให้หน้าเปิดเร็วและใช้งานได้ตอนเน็ตหลุด
  ไม่ใช่แหล่งข้อมูลหลัก
