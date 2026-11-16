# ใช้ LINE OA เดียวร่วมกันหลายระบบ (ส่งต่อ Webhook)

LINE OA ใส่ Webhook URL ได้ช่องเดียว — `line-oa-bot` จึงรับ event จาก LINE แล้ว **ส่งต่อ request เดิมทุกไบต์ พร้อม `x-line-signature` เดิม** ไปยังระบบอื่น (EHP CIS, EHP Vetcare ...) ระบบปลายทางจึงตรวจลายเซ็นผ่านเหมือนรับจาก LINE โดยตรง

```
LINE ──► https://<โดเมน>/webhook/line ──┬─► line-oa-bot (Ticket bot)
                                        ├─► EHP CIS      .../api/line-oa/webhook/42557
                                        └─► EHP Vetcare  .../api/line-oa/webhook/xxxxx
```

## ตั้งค่า

1. **LINE Developers Console** → Messaging API → Webhook URL = `https://<โดเมน>/webhook/line` → Verify
2. **ทุกระบบ** (CIS, Vetcare) กรอก **Channel Access Token + Channel Secret ของ OA เดียวกัน**
3. หน้า `/admin/webhooks` → ส่วน "ส่งต่อ LINE Webhook" → เพิ่มชื่อระบบ + Webhook URL ของระบบนั้น → กด **ทดสอบ**
   - ทดสอบ = ส่ง event ว่างที่เซ็นแล้ว (เหมือนปุ่ม Verify ของ LINE) → ต้องได้ ✅ HTTP 200

## เลือกว่าระบบไหนตอบแชท

แต่ละปลายทางมีสวิตช์ **"รับข้อความแชท"** (`receiveMessages`)

- **เปิด** — ได้รับทุก event รวมข้อความที่ลูกค้าพิมพ์ (ใช้กับระบบที่ตอบแชท เช่น EHP Support / มินนี่)
- **ปิด** — ได้เฉพาะ follow/unfollow, postback, ผูกบัญชี ฯลฯ ไม่ได้รับ event `message` จึงไม่ตอบแชทซ้อน
  - server ตัด event `message` ออกแล้ว **เซ็นใหม่ด้วย Channel Secret เดียวกัน** ปลายทางจึงยังตรวจลายเซ็นผ่าน
  - ถ้า request มีแต่ข้อความแชท ปลายทางนั้นจะถูกข้ามไป

ควรให้มี **ระบบเดียว** ที่เปิดรับข้อความแชท

## พฤติกรรม

- ตอบ LINE 200 ทันที แล้วส่งต่อแบบขนานไปทุกปลายทาง (timeout 10 วินาทีต่อปลายทาง) — ปลายทางหนึ่งล่มไม่กระทบอีกปลายทาง
- ผลล่าสุดของแต่ละปลายทางแสดงในหน้า admin และใน log `[LINE-FORWARD] <ชื่อ> → 200`
- request ที่ลายเซ็นไม่ถูกต้องจะไม่ถูกส่งต่อ
- request ที่มี header `x-ehp-forwarded` จะไม่ถูกส่งต่ออีก (กันวนลูป)
- ไม่มีการส่งซ้ำ (retry) หากปลายทางล่มขณะนั้น event นั้นจะหายสำหรับปลายทางนั้น
- รายการปลายทางเก็บใน `line-forwards.json` (เปลี่ยนได้ด้วย env `LINE_FORWARDS_FILE`)

## ข้อควรระวัง

- **replyToken ใช้ได้ครั้งเดียว** — ถ้าหลายระบบพยายามตอบข้อความเดียวกัน จะสำเร็จแค่ระบบแรก ควรกำหนดให้แต่ละระบบตอบเฉพาะเรื่องของตัวเอง (เช่น keyword/postback ของตัวเอง)
- ข้อความจากทุกระบบออกจาก OA ชื่อเดียวกัน ลูกค้าจะเห็นรวมในแชทเดียว
