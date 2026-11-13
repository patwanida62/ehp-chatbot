# App Webhook — ส่งข้อความเข้า LINE OA จากหลาย Application

ทุกระบบ (EHP CIS, ระบบแล็บ, ระบบคิว ฯลฯ) ส่งเข้าที่ endpoint เดียว:

```
POST https://<your-domain>/webhooks/apps/{appId}
Content-Type: application/json
```

Gateway จะยืนยันตัวตนของ app → ตรวจสิทธิ์ event → ตรวจข้อมูล → กันส่งซ้ำ → Push เข้า LINE

---

## 1. ลงทะเบียน Application (ผู้ดูแลระบบ)

แก้ไฟล์ `apps.json` (คัดลอกจาก `apps.example.json`; ไฟล์นี้ **ไม่ถูก commit**) แล้ว restart server

| field | ความหมาย |
|---|---|
| `id` | รหัส app ใช้ใน URL (`a-z`, `0-9`, `-`) |
| `name` | ชื่อแสดงผล |
| `enabled` | `false` = ปิดชั่วคราว (ได้ 404) |
| `auth.type` | `hmac` (แนะนำ) หรือ `apiKey` |
| `auth.secret` | อย่างน้อย 16 ตัวอักษร — แนะนำเขียนเป็น `"env:ชื่อตัวแปร"` แล้วเก็บค่าจริงใน `.env`/Secret Manager |
| `allowedEvents` | event ที่ app นี้ส่งได้ |
| `defaultTarget` | (ไม่บังคับ) `{ "lineGroupId": "C..." }` หรือ `{ "lineUserId": "U..." }` ใช้เมื่อ payload ไม่ระบุ `to` |

สร้าง secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

ตำแหน่งไฟล์เปลี่ยนได้ด้วย env `WEBHOOK_APPS_FILE`

---

## 2. การยืนยันตัวตน (ฝั่ง Application)

### แบบ `hmac` (แนะนำ — กันปลอมแปลงและกันยิงซ้ำ)

```
X-Webhook-Timestamp: <unix time วินาที>
X-Webhook-Signature: sha256=<hex( HMAC_SHA256(secret, "<timestamp>.<raw body>") )>
```

- ลงลายเซ็นบน **body ที่ส่งจริงทุกไบต์** (อย่า serialize JSON ซ้ำหลังเซ็น)
- timestamp ต้องห่างจากเวลา server ไม่เกิน 5 นาที

ตัวอย่าง (Node.js) — ดูโค้ดเต็มใน `scripts/send-app-webhook.js`:
```js
const ts = Math.floor(Date.now() / 1000).toString();
const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
```

ตัวอย่าง (PHP):
```php
$ts  = (string) time();
$sig = 'sha256=' . hash_hmac('sha256', $ts . '.' . $body, $secret);
```

### แบบ `apiKey` (สำหรับระบบที่คำนวณ HMAC ไม่ได้)

```
X-Api-Key: <secret>
```

---

## 3. รูปแบบ Payload

```json
{
  "event": "appointment.created",
  "eventId": "APT-2026-000123-created",
  "to": { "lineUserId": "U..." },
  "data": { ... }
}
```

- `eventId` **ต้องไม่ซ้ำ** ต่อ app (สูงสุด 128 ตัวอักษร) — ส่งซ้ำด้วย id เดิมจะได้ `duplicate` และไม่ส่ง LINE ซ้ำ จึง retry ได้อย่างปลอดภัย
- `to` ถ้ามีทั้ง `lineGroupId` และ `lineUserId` จะส่งเข้ากลุ่ม; ถ้าไม่ระบุใช้ `defaultTarget` ของ app

### Events ที่รองรับ

| event | `data` |
|---|---|
| `appointment.created` / `appointment.updated` / `appointment.cancelled` | **จำเป็น:** `appointmentId`, `datetime` (ISO 8601 เช่น `2026-11-20T09:30:00+07:00`), `clinic` · **ไม่บังคับ:** `patientName`, `doctor`, `location`, `note` → ส่งเป็น Flex Message |
| `notification.text` | `text` (≤ 5000 ตัวอักษร) |
| `message.push` | `messages`: array ของ [LINE message object](https://developers.line.biz/en/reference/messaging-api/#message-objects) 1–5 รายการ |

> PDPA: ส่งเท่าที่จำเป็น ไม่ควรใส่ชื่อโรค ผลแล็บ หรือเลขบัตรประชาชนในข้อความ

---

## 4. Response

| HTTP | body | ความหมาย / ควรทำอย่างไร |
|---|---|---|
| 200 | `{"status":"sent"}` | ส่งเข้า LINE แล้ว |
| 200 | `{"status":"duplicate"}` | eventId นี้ส่งไปแล้ว — ไม่ต้องทำอะไร |
| 400 | `invalid_payload` (+`details`), `unsupported_event`, `missing_recipient`, `invalid_recipient` | แก้ข้อมูล — **อย่า retry** |
| 401 | `missing_signature`, `invalid_signature`, `timestamp_out_of_range`, `invalid_api_key` ... | ตรวจ secret / นาฬิกาเครื่อง |
| 403 | `event_not_allowed` | ขอผู้ดูแลเพิ่ม event ใน `allowedEvents` |
| 404 | `unknown_app` | appId ผิด หรือ app ถูกปิด |
| 502 | `line_push_failed` | LINE ขัดข้อง/โควตาเต็ม — **retry ได้** ด้วย eventId เดิม (แนะนำ backoff) |

---

## 5. ทดสอบ

```bash
APP_SECRET=<secret> npm run send-webhook -- http://localhost:3000/webhooks/apps/ehp-cis docs/examples/appointment.json
# API key:  ... docs/examples/appointment.json apiKey
```

## 6. เพิ่ม event ใหม่ (นักพัฒนา)

สร้าง handler `{ validate(data) => string[], buildMessages(data) => LineMessage[] }` ใน `src/services/events/` แล้วรวมใน `eventRegistry.js` พร้อมเขียน test

## ข้อจำกัดปัจจุบัน

- ตัวกันส่งซ้ำเก็บในหน่วยความจำ (24 ชม.) — ถ้า restart หรือรันหลาย instance บน cloud ควรเปลี่ยนเป็น Redis
- ส่งแบบ synchronous (รอ LINE ตอบก่อนตอบ app) — ถ้าปริมาณสูงมากควรเพิ่ม queue
