# บริบทโปรเจกต์ DepositTracker — สำหรับวาง AI session ใหม่

วางไฟล์นี้ (หรือเนื้อหาทั้งหมด) เป็นข้อความแรกใน session ใหม่ตอนเปิดโฟลเดอร์นี้
ด้วย Claude Code (หรือ AI ตัวอื่น) เพื่อให้มันเข้าใจบริบททั้งหมดโดยไม่ต้องอธิบายซ้ำ

---

## โปรเจกต์นี้คืออะไร

`DepositTracker` — ระบบ**ภายใน**สำหรับพนักงานร้าน บันทึกและค้นหารายการมัดจำสินค้า
(ชื่อ, ชื่อเล่น, เบอร์โทร, สินค้า, ยอดมัดจำ) ข้อกำหนดหลักจากเจ้าของงาน:

1. ชีต Google Sheets เป็น "กระดาน" บันทึกข้อมูลด้วย — ไม่ใช่แค่ export
2. เว็บดึงข้อมูลมาแสดงสวยงาม (จริง ๆ ดึงจาก Firestore แบบ real-time แทน
   — ตกลงกับเจ้าของงานแล้วว่าผลลัพธ์เหมือนกันแต่ปลอดภัยกว่า ดูเหตุผลด้านล่าง)
3. บันทึกผ่านเว็บ → ต้อง sync เข้าชีตด้วย
4. **ต้องล็อกอินตั้งแต่เข้าเว็บ** — ดูได้เฉพาะพนักงานที่มีรหัสผ่านเท่านั้น
5. บันทึกข้อมูลผ่าน Firebase
6. ดีพลอยด้วย Cloudflare (Pages)
7. **เพิ่มเติมสำคัญ:** "ระบบปิด ห้ามข้อมูลลูกค้ารั่วไหลเด็ดขาด แม้จะมีแค่ชื่อกับเบอร์"
   และ "รหัสเดียวเข้าเว็บ เหมือนปลดล็อกมือถือ ไม่ต้องสมัครบัญชีให้ยุ่งยาก"
8. ต้องการ **sync สองทาง**: แก้ข้อมูลตรงในชีต (พิมพ์เอง) ก็ต้องเด้งกลับเข้าเว็บ/Firestore ด้วย

## ประวัติความเป็นมา (สำคัญ อย่าย้อนกลับไปทำผิดซ้ำ)

โปรเจกต์เริ่มจาก **production build ที่ deploy อยู่แล้ว** (ไม่มีซอร์สโค้ด) ที่
`https://deposit-tracker-app.pages.dev/` — ตอนแกะออกมาพบว่า:

- **Google Sheet ถูก publish เป็น CSV สาธารณะ** ใครมีลิงก์ก็อ่านชื่อ+เบอร์ลูกค้าได้หมด
- **Apps Script deployment เปิดให้ "Anyone" ยิง POST เข้าได้** ใครก็ตามยิงข้อมูลขยะเข้าชีตได้
- หน้าเว็บมี PIN (`1234`) ป้องกันแค่การ**มองเห็น**หน้าแดชบอร์ด แต่ตัวข้อมูลจริงเปิดสาธารณะอยู่ดี
  (PIN ถูก build ติดไปกับ JS ที่ส่งให้เบราว์เซอร์ — ไม่ใช่ access control จริง)

**สิ่งที่ต้องทำและทำไปแล้ว:** เลิก publish ชีต, เลิกให้เบราว์เซอร์คุยกับ Google
Sheets โดยตรงเลย, เปลี่ยนจาก PIN เป็น Firebase Auth จริง

**ยังไม่มีข้อมูลลูกค้าจริงในระบบ** (ยืนยันจากเจ้าของงานแล้ว) — จึงไม่มีขั้นตอน
migrate ข้อมูลเก่า เริ่มจากศูนย์ได้เต็มที่

---

## สถาปัตยกรรมปัจจุบัน (สร้างเสร็จแล้ว รอ deploy จริง)

```
พนักงาน ──(รหัสผ่านเดียว, Firebase Auth)──► เว็บแอป (Cloudflare Pages)
                                                  │
                                                  ▼
                                             Firestore  ◄── ฐานข้อมูลจริงเพียงที่เดียว
                                             │        ▲     ที่เว็บคุยด้วยตรง ๆ
                          sync-worker/       │        │
                          (cron ทุก 5 นาที)   ▼        │  functions/api/sheet-webhook.js
                                          Google Sheet ─┘  (Cloudflare Pages Function)
                                          (ส่วนตัว, ไม่ publish)
                                                  ▲
                                          appsscript/onEditSync.gs
                                          (พนักงานพิมพ์แก้ในตารางเอง)
```

**หลักการที่ต้องรักษาไว้เสมอ:** เบราว์เซอร์**ห้าม**มี URL หรือ credential ที่คุย
กับ Google Sheets ได้โดยตรงเด็ดขาด — การ sync ทุกทิศทางต้องผ่านฝั่งเซิร์ฟเวอร์
(Worker / Pages Function / Apps Script) เท่านั้น ถ้าจะเพิ่มฟีเจอร์ใหม่แล้วมัน
ทำให้ต้องเปิดอะไรให้เบราว์เซอร์เข้าถึงชีตตรง ๆ — **หยุดและถามก่อน** เพราะนั่นคือ
รูรั่วเดิมที่เพิ่งปิดไป

## โครงสร้างโปรเจกต์

```
index.html                 เปิดมาเจอ #auth-gate (ช่องรหัสผ่านเดียว) ก่อนเสมอ
src/
  main.js                   ผูก event ทั้งหมด, render UI, ฟัง auth state
  auth.js                   ล็อกอิน/ล็อกเอาท์บัญชีเดียวผ่าน Firebase Auth
                            (browserSessionPersistence — ปิด tab แล้วหลุด)
  config.js                 อ่าน config จาก env เท่านั้น (ไม่มี localStorage
                            override, ไม่มี modal ตั้งค่าในหน้าเว็บแล้ว)
  state.js                  state ของแอป — deposits อยู่ใน memory เท่านั้น
                            (ไม่ cache ลง localStorage โดยตั้งใจ กันข้อมูล
                            ค้างบนเครื่องรวมของร้านหลัง logout)
  firebase.js               Firestore: init / addDeposit / softDeleteDeposit /
                            subscribeDeposits — ใช้ depositId เป็น document id
                            ตรง ๆ (ไม่ใช่ auto-id)
  utils.js                  ฟอร์แมตเบอร์/เงิน, parse CSV, escape HTML
  icons.js                  ไอคอน Lucide ที่ import ทีละตัว (ไม่ import ทั้งชุด
                            เพราะกิน ~380KB) — เพิ่ม data-lucide ใหม่ต้องมาเพิ่มที่นี่ด้วย
  style.css                 สไตล์ทั้งหมด, CSS variables, ธีมสว่าง/มืด
firestore.rules             ทุก read/write ต้อง request.auth != null,
                            depositId ต้องตรงกับ document id, ห้าม hard delete

functions/                  Cloudflare Pages Functions (deploy อัตโนมัติคู่เว็บหลัก)
  api/sheet-webhook.js        รับ POST จาก Apps Script (มี shared secret) → เขียน Firestore
  _lib/google-auth.js          แลก service-account JSON key เป็น OAuth2 access token
                                (เซ็น JWT ด้วย Web Crypto เพราะ Cloudflare ไม่มี Node crypto)
  _lib/firestore-write.js      upsert เอกสาร Firestore ผ่าน REST API ตรง ๆ
                                (ข้าม firestore.rules เพราะเป็น service account —
                                ต้อง validate เองในไฟล์นี้)

sync-worker/                Cloudflare Worker แยกต่างหาก ต้อง deploy เอง
                            (คนละ deploy target จากเว็บหลัก, มี wrangler.toml ของตัวเอง)
  wrangler.toml               ตั้ง cron ทุก 5 นาที
  src/index.js                entrypoint: scheduled handler + manual-trigger fetch (debug)
  src/google-auth.js           เหมือน functions/_lib/google-auth.js (copy แยกเพราะคนละ build)
  src/firestore.js              อ่านรายการ deposits ทั้งหมดจาก Firestore REST API
  src/sheets.js                 เทียบ row เดิมกับใหม่ (skip/update/append) แล้วเขียน Sheets API

appsscript/onEditSync.gs   ต้องเอาไปวางใน Apps Script editor ของชีตเอง
                           (ไม่ได้ deploy อัตโนมัติจากที่นี่ — เป็น manual paste)
```

## Data model

`deposits/{depositId}` ใน Firestore — **`depositId` (UUID) คือ document id ตรง ๆ**
เพื่อให้ Worker, Pages Function, และเว็บ อ้างอิงเอกสารเดียวกันด้วย path เดียวกัน
โดยไม่ต้อง query หา

ฟิลด์: `depositId, firstName, nickname, phoneNumber, depositItem, depositAmount,
timestamp (สตริงไทยแสดงผล พ.ศ.), createdAtIso/createdAt (ตั้งครั้งเดียวตอนสร้าง
ห้ามแก้ทีหลัง), updatedAtIso, source ('web'|'sheet'), deletedAt (soft-delete,
ไม่มี hard delete จากที่ไหนเลย)`

คอลัมน์ในชีต (แท็บชื่อ `Deposits`, 9 คอลัมน์ A–I):
`depositId, วันที่และเวลา, ชื่อจริง, ชื่อเล่น, เบอร์โทร, สินค้าที่มัดจำ, ยอดมัดจำ (บาท), สถานะ, อัปเดตล่าสุด`
— ถ้าแก้ layout ต้องแก้พร้อมกัน 3 ที่: `sync-worker/src/sheets.js`,
`appsscript/onEditSync.gs`, และแถวหัวตารางในชีตจริง

## ทำไม onEdit ไม่วนลูปตัวเอง

Google ไม่ยิง `onEdit` trigger ให้กับการแก้ที่มาจาก Sheets API (ซึ่งเป็นวิธีที่
`sync-worker` เขียน) — ยิงให้เฉพาะตอนแก้ผ่านหน้าจอ Sheets UI เท่านั้น จึงไม่มี
ทางที่ Worker เขียนแล้ว trigger ทำงานย้อนกลับมาเขียน Firestore ซ้ำ

---

## สถานะปัจจุบัน: โค้ดเสร็จ, ยังไม่ได้ deploy จริง

**เขียนโค้ดและ verify ตรรกะเสร็จหมดแล้ว 2 commits** แต่ยังไม่เคยรันกับของจริง
เพราะ session ก่อนหน้าอยู่ใน sandbox ที่ **เข้า Google/Firebase/Cloudflare APIs
จริงไม่ได้เลย** (network policy บล็อก) ตรวจได้แค่:

- Playwright 21 เช็ค กับ Firebase/auth ที่ mock ไว้ชั่วคราว (สลับกลับเป็นของจริงแล้ว)
  → ครอบคลุม: gate บล็อกก่อน login, รหัสผิด/throttled, login สำเร็จ, ไม่มี UI
  เก่า (PIN/modal) หลงเหลือ, submit ฟอร์ม, escape HTML (XSS), สลับ view,
  metrics, soft delete, export CSV, logout
- generate RSA keypair จริงในเครื่อง แล้ว verify ว่า JWT signing logic ใน
  `google-auth.js` เซ็นถูกต้อง (เซ็นแล้ว verify ผ่านด้วย public key)
- mock `fetch` ทดสอบตรรกะ diff/upsert ของ `sync-worker/src/sheets.js` และ
  `functions/_lib/firestore-write.js` ครบทั้ง 3 เคส (unchanged/update/create)

**ยังไม่เคย login จริงกับ Firebase project จริง, ยังไม่เคย sync กับชีตจริง**
ต้องทดสอบ end-to-end ในเครื่อง local ก่อนใช้งานจริง

## ต้องทำต่อ (ตามลำดับ ใน README.md หัวข้อ "Console setup checklist")

1. Firebase Console → เปิด Email/Password auth → สร้าง 1 บัญชี → เพิ่มโดเมน
   Cloudflare Pages ใน Authorized domains
2. `firebase deploy --only firestore:rules`
3. Google Cloud → สร้าง service account → เปิด Firestore API + Sheets API →
   role Cloud Datastore User → สร้าง JSON key
4. สร้างชีตใหม่ (แท็บชื่อ `Deposits`, ห้าม publish) → แชร์ให้ service account
   เป็น Editor
5. Cloudflare Pages: ตั้ง env vars (`VITE_FIREBASE_*`, `VITE_STAFF_LOGIN_EMAIL`)
   และ secrets (`SYNC_SHARED_SECRET`, `GCP_SERVICE_ACCOUNT_KEY`, `FIRESTORE_PROJECT_ID`)
6. Deploy `sync-worker/` แยกต่างหากด้วย `wrangler deploy` (ต้องตั้ง secrets
   ของตัวเองด้วย `wrangler secret put`)
7. วาง `appsscript/onEditSync.gs` ใน Apps Script editor ของชีต → ตั้ง Script
   Properties (`SYNC_WEBHOOK_URL`, `SYNC_SHARED_SECRET`) → ตั้ง installable
   onEdit trigger

**ขั้นตอนแบบละเอียดทุกตัวอยู่ใน `README.md`** — ให้ AI อ่านไฟล์นั้นประกอบเมื่อ
ช่วยตั้งค่าแต่ละขั้น

## เมื่อทดสอบ local ได้แล้ว ควรทำต่อ

- ทดสอบ end-to-end จริง: login → บันทึกจากเว็บ → เช็คว่าเข้าชีตภายใน 5 นาที →
  พิมพ์แก้ในชีต → เช็คว่าเด้งกลับเข้าเว็บ (ผ่าน webhook)
- โฟลเดอร์นี้**ยังไม่มี `.git`** (ตัดออกตอนแพ็กให้ดาวน์โหลด) — ของจริงอยู่ที่
  GitHub repo `saengtawan64/preorder` branch `claude/continuation-work-ltiifc`
  (ตอนนี้เป็น **default branch** ของ repo — repo เริ่มจากว่างเปล่า พอ push
  ครั้งแรก GitHub เลยตั้งเป็น default ไปเลย ยังไม่เคยมี PR ให้ merge)
  ถ้าจะทำงานต่อแบบมี git history ให้ `git clone` จาก repo นั้นแทนการใช้โฟลเดอร์นี้ตรง ๆ
  หรือถ้าจะใช้โฟลเดอร์นี้ต่อ ให้ `git init` แล้วตั้ง remote เอง
- โฟลเดอร์นี้มี `.env.example` — copy เป็น `.env` แล้วใส่ค่า Firebase project
  จริงก่อนรัน `npm run dev`

## ข้อจำกัดที่ตกลงกันไว้แล้ว (อย่าเสนอเปลี่ยนโดยไม่ถาม)

- **รหัสเดียวใช้ร่วมกันทั้งร้าน ไม่มีบัญชีแยกต่อคน** — ตกลงแล้วว่ายอมรับ
  trade-off นี้ (ไม่รู้ว่าใครทำอะไร) เพื่อความง่ายในการใช้งาน ถ้าจะเสนอ
  เปลี่ยนเป็นบัญชีแยกคน ต้องถามก่อนเพราะกระทบ workflow พนักงาน
- **ไม่มีหน้าค้นหาสาธารณะ** — พนักงานเป็นคนเปิดดูให้ลูกค้าเท่านั้น ตัดสินใจแล้ว
- **แค่มัดจำ ไม่ใช่ order lifecycle เต็มรูปแบบ** — ไม่ต้องมี status/payment
  ติดตามหลายงวด เว้นแต่เจ้าของงานขอเพิ่ม
