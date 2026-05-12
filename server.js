require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

// ============================================================
// CONFIG — เปลี่ยนค่าเหล่านี้ใน .env หรือตรงนี้
// ============================================================
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || 'YOUR_TOKEN_HERE';
const LINE_CHANNEL_SECRET       = process.env.LINE_CHANNEL_SECRET       || 'YOUR_SECRET_HERE';
const TICKET_API_BASE_URL       = process.env.TICKET_API_BASE_URL       || 'http://localhost:4000'; // URL ของระบบ Ticket
const PORT                      = process.env.PORT                      || 3000;

// ============================================================
// MIDDLEWARE
// ============================================================

// ต้องใช้ raw body สำหรับ verify signature ของ Line
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ============================================================
// DEFAULT MESSAGE TEMPLATES (ใช้เมื่อ settings ไม่มีค่า)
// ============================================================
const DEFAULT_MSG_TICKET_OPENED =
  `📋 สถานะ Ticket {id}\n🔴 ปัญหา: {title}\n⚙️ สถานะ: {status}\n` +
  `🔧 วิธีการแก้ไข: {resolution}\n👨‍💻 ผู้ดำเนินการแก้ไข: {resolvedBy}\n` +
  `🕐 อัปเดตล่าสุด: {updatedAt}\nวันที่เวลาในการแก้ไข: {resolvedAt}\n\n` +
  `ติดตามสถานะได้โดยพิมพ์:\n"ตรวจสอบ #{id}"`;

const DEFAULT_MSG_STATUS_CHECK =
  `📋 สถานะ Ticket {id}\n🔴 ปัญหา: {title}\n⚙️ สถานะ: {status}\n` +
  `🔧 วิธีการแก้ไข: {resolution}\n👨‍💻 ผู้ดำเนินการแก้ไข: {resolvedBy}\n` +
  `🕐 อัปเดตล่าสุด: {updatedAt}\nวันที่เวลาในการแก้ไข: {resolvedAt}\n\n` +
  `ติดตามสถานะได้โดยพิมพ์:\n"ตรวจสอบ #{id}"`;

// ============================================================
// HELPER — แทนค่าตัวแปรใน Template {variable}
// ============================================================
function buildMessage(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] !== undefined ? vars[key] : `{${key}}`
  );
}

// ============================================================
// HELPER — จับคู่ข้อความกับ Keyword แบบใกล้เคียง
// ตรวจสอบ 2 ทิศทาง:
//   1. ข้อความมี keyword อยู่      เช่น "ส่งเคลมไม่ได้วันนี้" กับ keyword "ส่งเคลม"
//   2. keyword มีข้อความอยู่       เช่น "ส่งเคลม" กับ keyword "ส่งเคลมไม่ได้"
// เงื่อนไข: ข้อความต้องยาวอย่างน้อย 4 ตัวอักษรสำหรับการจับคู่แบบที่ 2
// ============================================================
function matchesKeyword(text, kw) {
  const t = text.toLowerCase().trim();
  const k = kw.toLowerCase();
  return t.includes(k) || (t.length >= 4 && k.includes(t));
}

// ============================================================
// HELPER — Verify Line Signature
// ============================================================
function verifyLineSignature(req) {
  const signature = req.headers['x-line-signature'];
  if (!signature) return false;
  const hash = crypto
    .createHmac('SHA256', LINE_CHANNEL_SECRET)
    .update(req.rawBody)
    .digest('base64');
  return hash === signature;
}

// ============================================================
// HELPER — Reply Message (ตอบกลับในห้องเดิม — ใช้ได้ทั้ง Group และ 1-on-1)
// ============================================================
async function replyLineMessage(replyToken, messages) {
  await axios.post(
    'https://api.line.me/v2/bot/message/reply',
    { replyToken, messages },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    }
  );
}

// ============================================================
// HELPER — Push Message (ส่งหา userId หรือ groupId โดยตรง)
// ============================================================
async function sendLineMessage(to, messages) {
  await axios.post(
    'https://api.line.me/v2/bot/message/push',
    { to, messages },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    }
  );
}

// ============================================================
// HELPER — ดึง Line userId จาก Ticket (เก็บไว้ใน Ticket DB)
// ============================================================
async function getUserIdFromTicket(ticketId) {
  const res = await axios.get(`${TICKET_API_BASE_URL}/tickets/${ticketId}`);
  return res.data.lineUserId;
}

// ============================================================
// HELPER — ดึงชื่อ Display Name จาก LINE Profile
// ============================================================
async function getLineDisplayName(userId) {
  try {
    const res = await axios.get(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    return res.data.displayName;
  } catch {
    return 'ไม่ทราบชื่อ';
  }
}

// ============================================================
// ROUTE 1 — Webhook จาก Line Platform
// รับข้อความจากลูกค้า และเก็บ userId ไว้ใน Ticket เมื่อสร้างใหม่
// ============================================================
app.post('/webhook/line', async (req, res) => {
  // ตรวจสอบว่า request มาจาก Line จริง
  if (!verifyLineSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Line ต้องการ 200 OK เร็วๆ ก่อนเสมอ
  res.status(200).end();

  const events = req.body.events || [];

  for (const event of events) {
    if (event.type !== 'message' || event.message.type !== 'text') continue;

    const sourceType = event.source.type;           // "user" | "group" | "room"
    const userId     = event.source.userId;
    const groupId    = event.source.groupId || null; // มีเฉพาะใน Group
    const replyToken = event.replyToken;
    const text       = event.message.text;

    console.log(`[LINE] source=${sourceType} | userId=${userId}${groupId ? ` | groupId=${groupId}` : ''} | message="${text}"`);

    // keyword ที่ทำให้เปิด Ticket อัตโนมัติ — โหลดจาก API ทุกครั้ง
    let AUTO_TICKET_KEYWORDS = [];
    try {
      const kwRes = await axios.get(`${TICKET_API_BASE_URL}/keywords`);
      AUTO_TICKET_KEYWORDS = kwRes.data;
    } catch {
      AUTO_TICKET_KEYWORDS = [];
    }

    const matchedKeyword = AUTO_TICKET_KEYWORDS.find((kw) => matchesKeyword(text, kw));

    if (matchedKeyword) {
      try {
        const [displayName, settings] = await Promise.all([
          getLineDisplayName(userId),
          axios.get(`${TICKET_API_BASE_URL}/settings`).then((r) => r.data),
        ]);
        // 1. สร้าง Ticket → ส่งข้อมูลครบตาม form Ticket จริง
        const now = new Date();
        const problemDate = now.toISOString().split('T')[0];
        const problemTime = now.toTimeString().slice(0, 5);
        const createRes = await axios.post(`${TICKET_API_BASE_URL}/tickets`, {
          title:        text.trim(),
          detail:       text.trim(),
          lineUserId:   userId,
          lineGroupId:  groupId,   // เก็บ groupId ด้วยเพื่อใช้ส่ง notify กลับกลุ่ม
          reporterName: displayName,
          service:      settings.service,
          category:     settings.category,
          subCategory:  settings.subCategory,
          sla:          settings.sla || '',
          problemDate,
          problemTime,
        });
        const ticketId = createRes.data.id;

        // 2. ดึงข้อมูลเต็มจาก Ticket System ด้วย ID ที่ได้มา
        const ticketRes = await axios.get(`${TICKET_API_BASE_URL}/tickets/${ticketId}`);
        const ticket = ticketRes.data;

        // 3. ตอบลูกค้าด้วยข้อมูลจาก GET /tickets/:id
        const template = settings.msgTicketOpened || DEFAULT_MSG_TICKET_OPENED;
        const msgText = buildMessage(template, {
          id:         ticket.id,
          title:      ticket.title,
          status:     translateStatus(ticket.status),
          resolution: ticket.resolution || '-',
          resolvedBy: ticket.resolvedBy || '-',
          updatedAt:  new Date(ticket.updatedAt).toLocaleString('th-TH'),
          resolvedAt: ticket.resolvedAt ? new Date(ticket.resolvedAt).toLocaleString('th-TH') : '',
        });
        await replyLineMessage(replyToken, [{ type: 'text', text: msgText }]);
        console.log(`[TICKET] Auto-created #${ticket.id} for "${displayName}" source=${sourceType} keyword="${matchedKeyword}"`);
      } catch {
        await replyLineMessage(replyToken, [
          { type: 'text', text: 'ขออภัยครับ ไม่สามารถเปิด Ticket ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง' },
        ]);
      }
      continue;
    }

    // ตัวอย่าง: ลูกค้าพิมพ์ "ตรวจสอบ #0042" → ดึงสถานะ Ticket
    const trackMatch = text.match(/ตรวจสอบ\s*#?(\d+)/);
    if (trackMatch) {
      const ticketId = trackMatch[1];
      try {
        const res2 = await axios.get(`${TICKET_API_BASE_URL}/tickets/${ticketId}`);
        const ticket = res2.data;
        const settingsRes = await axios.get(`${TICKET_API_BASE_URL}/settings`);
        const settings2   = settingsRes.data;
        const template2   = settings2.msgStatusCheck || DEFAULT_MSG_STATUS_CHECK;
        const msgText2    = buildMessage(template2, {
          id:         ticket.id,
          title:      ticket.title,
          status:     translateStatus(ticket.status),
          resolution: ticket.resolution || '-',
          resolvedBy: ticket.resolvedBy || '-',
          updatedAt:  new Date(ticket.updatedAt).toLocaleString('th-TH'),
          resolvedAt: ticket.resolvedAt ? new Date(ticket.resolvedAt).toLocaleString('th-TH') : '',
        });
        await replyLineMessage(replyToken, [{ type: 'text', text: msgText2 }]);
      } catch {
        await replyLineMessage(replyToken, [
          { type: 'text', text: `ไม่พบ Ticket #${ticketId} กรุณาตรวจสอบเลขอีกครั้งครับ` },
        ]);
      }
      continue;
    }

    // กรณีอื่น: เก็บข้อความไว้ให้เจ้าหน้าที่อ่านใน Line OA Manager ตามปกติ
    // (ไม่ต้อง auto-reply ทุกข้อความ)
  }
});

// ============================================================
// ROUTE 2 — เปิด Ticket ใหม่ (เรียกจากระบบ Ticket ของคุณ)
// Body: { ticketId, title, lineUserId, lineGroupId? }
// ============================================================
app.post('/notify/ticket-opened', async (req, res) => {
  const { ticketId, title, lineUserId, lineGroupId } = req.body;

  if (!ticketId || !title || !lineUserId) {
    return res.status(400).json({ error: 'ticketId, title, lineUserId are required' });
  }

  // ส่งไปที่กลุ่มถ้ามี groupId ไม่งั้นส่งหา userId โดยตรง
  const sendTo = lineGroupId || lineUserId;

  try {
    await sendLineMessage(sendTo, [
      {
        type: 'text',
        text:
          `✅ เปิด Ticket เรียบร้อยแล้วครับ\n\n` +
          `🔢 เลข Ticket: #${ticketId}\n` +
          `📌 หัวข้อ: ${title}\n\n` +
          `ทีมงานกำลังดำเนินการให้ครับ\n` +
          `สามารถติดตามสถานะได้โดยพิมพ์:\n"ตรวจสอบ #${ticketId}"`,
      },
    ]);

    console.log(`[NOTIFY] Opened ticket #${ticketId} → ${lineGroupId ? `groupId=${lineGroupId}` : `userId=${lineUserId}`}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[NOTIFY] Failed to send Line message:', err.message);
    res.status(500).json({ error: 'Failed to send Line message' });
  }
});

// ============================================================
// ROUTE 3 — ปิด/อัปเดตสถานะ Ticket (เรียกจากระบบ Ticket)
// Body: {
//   ticketId      — รหัส Ticket (required)
//   title         — หัวข้อปัญหา (required)
//   lineUserId    — LINE User ID ลูกค้า (required)
//   lineGroupId   — LINE Group ID (optional — ส่งแจ้งกลุ่มถ้ามี)
//   status        — สถานะใหม่ เช่น "เสร็จสิ้น"
//   resolvedBy    — ผู้แก้ปัญหา
//   resolution    — วิธีแก้ไข
//   cause         — สาเหตุ
//   resolvedDate  — วันที่เสร็จสิ้น เช่น "2026-05-12"
//   resolvedTime  — เวลาเสร็จสิ้น เช่น "10:58"
//   remark        — หมายเหตุ
// }
// ============================================================
app.post('/notify/ticket-closed', async (req, res) => {
  const {
    ticketId, title, lineUserId, lineGroupId,
    status, resolvedBy, resolution, cause,
    resolvedDate, resolvedTime, remark,
  } = req.body;

  if (!ticketId || !title || !lineUserId) {
    return res.status(400).json({ error: 'ticketId, title, lineUserId are required' });
  }

  // ส่งไปที่กลุ่มถ้ามี groupId ไม่งั้นส่งหา userId โดยตรง
  const sendTo = lineGroupId || lineUserId;

  const resolvedAt = (resolvedDate && resolvedTime)
    ? `${resolvedDate} ${resolvedTime}`
    : resolvedDate || '-';

  const lines = [
    `📋 สถานะ Ticket ${ticketId}`,
    `🔴 ปัญหา: ${title}`,
    `⚙️ สถานะ: 🟢 ${status || 'ดำเนินการเสร็จสิ้น'}`,
    `🔧 วิธีการแก้ไข: ${resolution || '-'}`,
    `👨‍💻 ผู้ดำเนินการแก้ไข: ${resolvedBy || '-'}`,
    cause   ? `📌 สาเหตุ: ${cause}`       : null,
    remark  ? `📝 หมายเหตุ: ${remark}`    : null,
    `วันที่เวลาในการแก้ไข: ${resolvedAt}`,
    ``,
    `หากยังมีปัญหาหรือข้อสงสัย สามารถแจ้งกลับมาได้เลยนะครับ 😊`,
  ].filter(l => l !== null).join('\n');

  try {
    await sendLineMessage(sendTo, [{ type: 'text', text: lines }]);
    console.log(`[NOTIFY] Closed ticket #${ticketId} → ${lineGroupId ? `groupId=${lineGroupId}` : `userId=${lineUserId}`}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[NOTIFY] Failed to send Line message:', err.message);
    res.status(500).json({ error: 'Failed to send Line message' });
  }
});

// ============================================================
// HELPER — แปลงสถานะ Ticket เป็นภาษาไทย
// ============================================================
function translateStatus(status) {
  const map = {
    open:        '🟡 เปิดแล้ว รอดำเนินการ',
    in_progress: '🔵 กำลังดำเนินการ',
    closed:      '🟢 ดำเนินการเสร็จสิ้น',
    cancelled:   '🔴 ยกเลิกแล้ว',
  };
  return map[status] || status;
}

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
});
