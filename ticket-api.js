require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.TICKET_API_PORT || 4000;

// In-memory storage
let tickets = [
  {
    id: '1',
    title: 'ปัญหาการ Login ไม่ได้',
    status: 'open',
    lineUserId: process.env.TEST_LINE_USER_ID || 'U0df970281236ea540eef7b92ff5ab406',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '2',
    title: 'ระบบช้ามากช่วงเช้า',
    status: 'in_progress',
    lineUserId: process.env.TEST_LINE_USER_ID || 'U0df970281236ea540eef7b92ff5ab406',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

let nextId = 3;

// GET /tickets — ดึงรายการทั้งหมด
app.get('/tickets', (req, res) => {
  res.json(tickets);
});

// GET /tickets/:id — ดึง ticket เดียว
app.get('/tickets/:id', (req, res) => {
  const ticket = tickets.find((t) => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(ticket);
});

// POST /tickets — สร้าง ticket ใหม่
app.post('/tickets', (req, res) => {
  const { title, lineUserId } = req.body;
  if (!title || !lineUserId) {
    return res.status(400).json({ error: 'title and lineUserId are required' });
  }
  const ticket = {
    id: String(nextId++),
    title,
    status: 'open',
    lineUserId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  tickets.push(ticket);
  res.status(201).json(ticket);
});

// PATCH /tickets/:id/status — อัปเดตสถานะ
app.patch('/tickets/:id/status', (req, res) => {
  const ticket = tickets.find((t) => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const { status } = req.body;
  const validStatuses = ['open', 'in_progress', 'closed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
  }

  ticket.status = status;
  ticket.updatedAt = new Date().toISOString();
  res.json(ticket);
});

// DELETE /tickets/:id — ลบ ticket
app.delete('/tickets/:id', (req, res) => {
  const index = tickets.findIndex((t) => t.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Ticket not found' });
  tickets.splice(index, 1);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Ticket API running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  GET    http://localhost:${PORT}/tickets`);
  console.log(`  GET    http://localhost:${PORT}/tickets/:id`);
  console.log(`  POST   http://localhost:${PORT}/tickets`);
  console.log(`  PATCH  http://localhost:${PORT}/tickets/:id/status`);
  console.log(`  DELETE http://localhost:${PORT}/tickets/:id`);
});
