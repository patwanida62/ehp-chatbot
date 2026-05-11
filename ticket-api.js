require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const KEYWORDS_FILE = path.join(__dirname, 'keywords.json');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

function loadKeywords() {
  try { return JSON.parse(fs.readFileSync(KEYWORDS_FILE, 'utf-8')); }
  catch { return []; }
}
function saveKeywords(keywords) {
  fs.writeFileSync(KEYWORDS_FILE, JSON.stringify(keywords, null, 2), 'utf-8');
}
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')); }
  catch { return {}; }
}
function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

// GET /settings
app.get('/settings', (req, res) => res.json(loadSettings()));

// PUT /settings
app.put('/settings', (req, res) => {
  const current = loadSettings();
  const updated = { ...current, ...req.body };
  saveSettings(updated);
  res.json(updated);
});

// GET /keywords
app.get('/keywords', (req, res) => {
  res.json(loadKeywords());
});

// POST /keywords
app.post('/keywords', (req, res) => {
  const { keyword } = req.body;
  if (!keyword || !keyword.trim()) {
    return res.status(400).json({ error: 'keyword is required' });
  }
  const keywords = loadKeywords();
  if (keywords.includes(keyword.trim())) {
    return res.status(400).json({ error: 'Keyword นี้มีอยู่แล้ว' });
  }
  keywords.push(keyword.trim());
  saveKeywords(keywords);
  res.status(201).json({ success: true, keywords });
});

// DELETE /keywords/:index
app.delete('/keywords/:index', (req, res) => {
  const keywords = loadKeywords();
  const index = parseInt(req.params.index);
  if (isNaN(index) || index < 0 || index >= keywords.length) {
    return res.status(404).json({ error: 'ไม่พบ Keyword' });
  }
  keywords.splice(index, 1);
  saveKeywords(keywords);
  res.json({ success: true, keywords });
});

// GET /admin — หน้า Admin UI
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// GET /dashboard — หน้า Ticket Dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

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
  const { title, lineUserId, reporterName, service, category, subCategory } = req.body;
  if (!title || !lineUserId) {
    return res.status(400).json({ error: 'title and lineUserId are required' });
  }
  const ticket = {
    id: String(nextId++),
    title,
    status: 'in_progress',
    lineUserId,
    reporterName: reporterName || 'ไม่ทราบชื่อ',
    service: service || 'EHP CIS',
    category: category || 'ปัญหาการใช้งานทั่วไป',
    subCategory: subCategory || 'การใช้งานทั่วไป',
    resolution: '',
    resolvedBy: '',
    resolvedAt: null,
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

  const { status, resolution, resolvedBy } = req.body;
  const validStatuses = ['open', 'in_progress', 'closed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
  }

  ticket.status     = status;
  ticket.updatedAt  = new Date().toISOString();
  if (resolution !== undefined) ticket.resolution = resolution;
  if (resolvedBy !== undefined) ticket.resolvedBy  = resolvedBy;
  if (status === 'closed') ticket.resolvedAt = new Date().toISOString();

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
