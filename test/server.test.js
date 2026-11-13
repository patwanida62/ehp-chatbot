const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const axios = require('axios');

// Config must be in place before server.js reads it at load time.
const LINE_SECRET = 'line-channel-secret-for-tests';
const TICKET_API = 'http://ticket.test';
process.env.LINE_CHANNEL_SECRET = LINE_SECRET;
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'line-token-for-tests';
process.env.TICKET_API_BASE_URL = TICKET_API;
process.env.WEBHOOK_APPS_FILE = path.join(__dirname, 'no-such-apps.json');

const { app, buildMessage, matchesKeyword, translateStatus } = require('../server');

const LINE_REPLY = 'https://api.line.me/v2/bot/message/reply';
const LINE_PUSH = 'https://api.line.me/v2/bot/message/push';
const USER_ID = `U${'a'.repeat(32)}`;
const GROUP_ID = `C${'b'.repeat(32)}`;

// ------------------------------------------------------------
// Test helpers
// ------------------------------------------------------------

/**
 * Replaces axios.get/post with a route table: "GET url" → data | (body) => data (throw to fail).
 * LINE reply/push/profile succeed by default. Returns the recorded calls.
 */
function fakeHttp(t, routes = {}) {
  const calls = [];
  const table = {
    [`POST ${LINE_REPLY}`]: {},
    [`POST ${LINE_PUSH}`]: {},
    [`GET https://api.line.me/v2/bot/profile/${USER_ID}`]: { displayName: 'คุณทดสอบ' },
    ...routes,
  };
  const handler = (method) => async (url, body) => {
    calls.push({ method, url, body });
    const route = table[`${method} ${url}`];
    if (route === undefined) throw new Error(`Unexpected ${method} ${url}`);
    return { data: typeof route === 'function' ? await route(body) : route };
  };
  t.mock.method(axios, 'get', handler('GET'));
  t.mock.method(axios, 'post', handler('POST'));
  return calls;
}

async function startServer(t) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

function lineSignature(rawBody) {
  return crypto.createHmac('SHA256', LINE_SECRET).update(rawBody).digest('base64');
}

function textEvent(text, { groupId } = {}) {
  return {
    type: 'message',
    replyToken: 'reply-token-1',
    source: groupId ? { type: 'group', userId: USER_ID, groupId } : { type: 'user', userId: USER_ID },
    message: { type: 'text', text },
  };
}

async function postLineWebhook(baseUrl, events, signature) {
  const rawBody = JSON.stringify({ events });
  return fetch(`${baseUrl}/webhook/line`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': signature ?? lineSignature(rawBody) },
    body: rawBody,
  });
}

async function postJson(baseUrl, route, body) {
  return fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** /webhook/line replies after responding 200, so wait for the side effect. */
async function waitFor(check, timeoutMs = 2000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const findCall = (calls, method, url) => calls.find((c) => c.method === method && c.url === url);
const replyText = (calls) => findCall(calls, 'POST', LINE_REPLY).body.messages[0].text;
const pushCall = (calls) => findCall(calls, 'POST', LINE_PUSH);

function silenceLogs(t) {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
}

const ticket42 = {
  id: 42,
  title: 'ส่งเคลมไม่ได้',
  status: 'open',
  resolution: null,
  resolvedBy: null,
  updatedAt: '2026-11-13T03:00:00Z',
  resolvedAt: null,
};

// ------------------------------------------------------------
// Pure helpers
// ------------------------------------------------------------

test('buildMessage replaces known variables and keeps unknown ones', () => {
  const result = buildMessage('Ticket {id}: {title} ({unknown})', { id: 7, title: 'ระบบช้า' });

  assert.equal(result, 'Ticket 7: ระบบช้า ({unknown})');
});

test('buildMessage substitutes falsy-but-defined values such as 0 and empty string', () => {
  assert.equal(buildMessage('[{a}][{b}]', { a: 0, b: '' }), '[0][]');
});

test('matchesKeyword matches when the text contains the keyword (case-insensitive)', () => {
  assert.equal(matchesKeyword('วันนี้ส่งเคลมไม่ได้เลย', 'ส่งเคลมไม่ได้'), true);
  assert.equal(matchesKeyword('  ERROR 500 ', 'error'), true);
});

test('matchesKeyword matches a partial text of 4+ characters contained in the keyword', () => {
  assert.equal(matchesKeyword('ส่งเคลม', 'ส่งเคลมไม่ได้'), true);
  assert.equal(matchesKeyword('ส่ง', 'ส่งเคลมไม่ได้'), false, 'shorter than 4 chars must not match');
});

test('matchesKeyword does not match unrelated text', () => {
  assert.equal(matchesKeyword('สวัสดีครับ', 'ระบบล่ม'), false);
});

test('translateStatus maps known statuses and passes unknown ones through', () => {
  assert.equal(translateStatus('open'), '🟡 เปิดแล้ว รอดำเนินการ');
  assert.equal(translateStatus('in_progress'), '🔵 กำลังดำเนินการ');
  assert.equal(translateStatus('closed'), '🟢 ดำเนินการเสร็จสิ้น');
  assert.equal(translateStatus('cancelled'), '🔴 ยกเลิกแล้ว');
  assert.equal(translateStatus('รอตรวจสอบ'), 'รอตรวจสอบ');
});

// ------------------------------------------------------------
// ROUTE 1 — POST /webhook/line
// ------------------------------------------------------------

test('/webhook/line rejects a missing or wrong signature with 401', async (t) => {
  const calls = fakeHttp(t);
  const baseUrl = await startServer(t);

  const wrong = await postLineWebhook(baseUrl, [textEvent('hi')], 'bad-signature');
  const missing = await fetch(`${baseUrl}/webhook/line`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"events":[]}',
  });

  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  assert.equal(calls.length, 0);
});

test('/webhook/line ignores non-text events', async (t) => {
  const calls = fakeHttp(t);
  const baseUrl = await startServer(t);

  const res = await postLineWebhook(baseUrl, [
    { type: 'follow', replyToken: 'r', source: { type: 'user', userId: USER_ID } },
    { type: 'message', replyToken: 'r', source: { type: 'user', userId: USER_ID }, message: { type: 'sticker' } },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

test('/webhook/line auto-creates a ticket for a keyword and replies with its status', async (t) => {
  silenceLogs(t);
  const calls = fakeHttp(t, {
    [`GET ${TICKET_API}/keywords`]: ['ส่งเคลมไม่ได้'],
    [`GET ${TICKET_API}/settings`]: { service: 'EHP CIS', category: 'ทั่วไป', subCategory: 'ใช้งาน' },
    [`POST ${TICKET_API}/tickets`]: { id: 42 },
    [`GET ${TICKET_API}/tickets/42`]: ticket42,
  });
  const baseUrl = await startServer(t);

  const res = await postLineWebhook(baseUrl, [textEvent(' ส่งเคลมไม่ได้ ', { groupId: GROUP_ID })]);
  await waitFor(() => findCall(calls, 'POST', LINE_REPLY));

  assert.equal(res.status, 200);
  const created = findCall(calls, 'POST', `${TICKET_API}/tickets`).body;
  assert.equal(created.title, 'ส่งเคลมไม่ได้', 'text is trimmed');
  assert.equal(created.lineUserId, USER_ID);
  assert.equal(created.lineGroupId, GROUP_ID);
  assert.equal(created.reporterName, 'คุณทดสอบ');
  assert.equal(created.service, 'EHP CIS');
  assert.match(created.problemDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(created.problemTime, /^\d{2}:\d{2}$/);
  const reply = findCall(calls, 'POST', LINE_REPLY).body;
  assert.equal(reply.replyToken, 'reply-token-1');
  assert.match(reply.messages[0].text, /📋 สถานะ Ticket 42/);
  assert.match(reply.messages[0].text, /🟡 เปิดแล้ว รอดำเนินการ/);
  assert.match(reply.messages[0].text, /วิธีการแก้ไข: -/);
});

test('/webhook/line uses the custom template from settings when present', async (t) => {
  silenceLogs(t);
  const calls = fakeHttp(t, {
    [`GET ${TICKET_API}/keywords`]: ['ระบบล่ม'],
    [`GET ${TICKET_API}/settings`]: { msgTicketOpened: 'รับเรื่อง #{id} แล้ว' },
    [`POST ${TICKET_API}/tickets`]: { id: 42 },
    [`GET ${TICKET_API}/tickets/42`]: ticket42,
  });
  const baseUrl = await startServer(t);

  await postLineWebhook(baseUrl, [textEvent('ระบบล่ม')]);
  await waitFor(() => findCall(calls, 'POST', LINE_REPLY));

  assert.equal(replyText(calls), 'รับเรื่อง #42 แล้ว');
});

test('/webhook/line replies with an apology when ticket creation fails', async (t) => {
  silenceLogs(t);
  const calls = fakeHttp(t, {
    [`GET ${TICKET_API}/keywords`]: ['ระบบล่ม'],
    [`GET ${TICKET_API}/settings`]: {},
    [`POST ${TICKET_API}/tickets`]: () => { throw new Error('ticket system down'); },
  });
  const baseUrl = await startServer(t);

  await postLineWebhook(baseUrl, [textEvent('ระบบล่ม')]);
  await waitFor(() => findCall(calls, 'POST', LINE_REPLY));

  assert.match(replyText(calls), /ไม่สามารถเปิด Ticket ได้/);
});

test('/webhook/line still works when loading keywords fails (treated as no keywords)', async (t) => {
  silenceLogs(t);
  const calls = fakeHttp(t, {
    [`GET ${TICKET_API}/keywords`]: () => { throw new Error('down'); },
    [`GET ${TICKET_API}/tickets/42`]: ticket42,
    [`GET ${TICKET_API}/settings`]: {},
  });
  const baseUrl = await startServer(t);

  await postLineWebhook(baseUrl, [textEvent('ตรวจสอบ #42')]);
  await waitFor(() => findCall(calls, 'POST', LINE_REPLY));

  assert.equal(findCall(calls, 'POST', `${TICKET_API}/tickets`), undefined);
  assert.match(replyText(calls), /Ticket 42/);
});

test('/webhook/line answers "ตรวจสอบ #42" with the ticket status', async (t) => {
  silenceLogs(t);
  const calls = fakeHttp(t, {
    [`GET ${TICKET_API}/keywords`]: [],
    [`GET ${TICKET_API}/tickets/42`]: { ...ticket42, status: 'closed', resolution: 'รีสตาร์ทบริการ', resolvedBy: 'ช่างเอ' },
    [`GET ${TICKET_API}/settings`]: {},
  });
  const baseUrl = await startServer(t);

  await postLineWebhook(baseUrl, [textEvent('ตรวจสอบ 42')]);
  await waitFor(() => findCall(calls, 'POST', LINE_REPLY));

  const text = replyText(calls);
  assert.match(text, /🟢 ดำเนินการเสร็จสิ้น/);
  assert.match(text, /วิธีการแก้ไข: รีสตาร์ทบริการ/);
  assert.match(text, /ผู้ดำเนินการแก้ไข: ช่างเอ/);
});

test('/webhook/line tells the customer when a checked ticket is not found', async (t) => {
  silenceLogs(t);
  const calls = fakeHttp(t, {
    [`GET ${TICKET_API}/keywords`]: [],
    [`GET ${TICKET_API}/tickets/999`]: () => { throw new Error('404'); },
  });
  const baseUrl = await startServer(t);

  await postLineWebhook(baseUrl, [textEvent('ตรวจสอบ #999')]);
  await waitFor(() => findCall(calls, 'POST', LINE_REPLY));

  assert.equal(replyText(calls), 'ไม่พบ Ticket #999 กรุณาตรวจสอบเลขอีกครั้งครับ');
});

test('/webhook/line does not auto-reply to ordinary chat', async (t) => {
  silenceLogs(t);
  const calls = fakeHttp(t, { [`GET ${TICKET_API}/keywords`]: ['ระบบล่ม'] });
  const baseUrl = await startServer(t);

  await postLineWebhook(baseUrl, [textEvent('สวัสดีครับ')]);
  await waitFor(() => findCall(calls, 'GET', `${TICKET_API}/keywords`));
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(findCall(calls, 'POST', LINE_REPLY), undefined);
});

// ------------------------------------------------------------
// ROUTE 2 — POST /notify/ticket-opened
// ------------------------------------------------------------

test('/notify/ticket-opened returns 400 when required fields are missing', async (t) => {
  const calls = fakeHttp(t);
  const baseUrl = await startServer(t);

  const res = await postJson(baseUrl, '/notify/ticket-opened', { ticketId: 1, title: 'x' });

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'ticketId, title, lineUserId are required' });
  assert.equal(calls.length, 0);
});

test('/notify/ticket-opened pushes to the user when there is no group', async (t) => {
  silenceLogs(t);
  const calls = fakeHttp(t);
  const baseUrl = await startServer(t);

  const res = await postJson(baseUrl, '/notify/ticket-opened', { ticketId: 42, title: 'ระบบช้า', lineUserId: USER_ID });

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true });
  const push = pushCall(calls).body;
  assert.equal(push.to, USER_ID);
  assert.match(push.messages[0].text, /เลข Ticket: #42/);
  assert.match(push.messages[0].text, /หัวข้อ: ระบบช้า/);
});

test('/notify/ticket-opened pushes to the group when lineGroupId is given', async (t) => {
  silenceLogs(t);
  const calls = fakeHttp(t);
  const baseUrl = await startServer(t);

  await postJson(baseUrl, '/notify/ticket-opened', { ticketId: 42, title: 'x', lineUserId: USER_ID, lineGroupId: GROUP_ID });

  assert.equal(pushCall(calls).body.to, GROUP_ID);
});

test('/notify/ticket-opened returns 500 when LINE push fails', async (t) => {
  silenceLogs(t);
  fakeHttp(t, { [`POST ${LINE_PUSH}`]: () => { throw new Error('LINE down'); } });
  const baseUrl = await startServer(t);

  const res = await postJson(baseUrl, '/notify/ticket-opened', { ticketId: 42, title: 'x', lineUserId: USER_ID });

  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'Failed to send Line message' });
});

// ------------------------------------------------------------
// ROUTE 3 — POST /notify/ticket-closed
// ------------------------------------------------------------

test('/notify/ticket-closed returns 400 when required fields are missing', async (t) => {
  fakeHttp(t);
  const baseUrl = await startServer(t);

  const res = await postJson(baseUrl, '/notify/ticket-closed', { title: 'x', lineUserId: USER_ID });

  assert.equal(res.status, 400);
});

test('/notify/ticket-closed builds the full message with all optional fields', async (t) => {
  silenceLogs(t);
  const calls = fakeHttp(t);
  const baseUrl = await startServer(t);

  const res = await postJson(baseUrl, '/notify/ticket-closed', {
    ticketId: 42,
    title: 'ระบบช้า',
    lineUserId: USER_ID,
    lineGroupId: GROUP_ID,
    status: 'เสร็จสิ้น',
    resolvedBy: 'ช่างเอ',
    resolution: 'เพิ่ม RAM',
    cause: 'หน่วยความจำเต็ม',
    resolvedDate: '2026-11-13',
    resolvedTime: '10:58',
    remark: 'ติดตามผล 1 สัปดาห์',
  });

  assert.equal(res.status, 200);
  const push = pushCall(calls).body;
  const text = push.messages[0].text;
  assert.equal(push.to, GROUP_ID);
  assert.match(text, /สถานะ: 🟢 เสร็จสิ้น/);
  assert.match(text, /วิธีการแก้ไข: เพิ่ม RAM/);
  assert.match(text, /ผู้ดำเนินการแก้ไข: ช่างเอ/);
  assert.match(text, /สาเหตุ: หน่วยความจำเต็ม/);
  assert.match(text, /หมายเหตุ: ติดตามผล 1 สัปดาห์/);
  assert.match(text, /วันที่เวลาในการแก้ไข: 2026-11-13 10:58/);
});

test('/notify/ticket-closed uses defaults and omits empty optional lines', async (t) => {
  silenceLogs(t);
  const calls = fakeHttp(t);
  const baseUrl = await startServer(t);

  await postJson(baseUrl, '/notify/ticket-closed', { ticketId: 42, title: 'x', lineUserId: USER_ID });

  const text = pushCall(calls).body.messages[0].text;
  assert.match(text, /สถานะ: 🟢 ดำเนินการเสร็จสิ้น/);
  assert.match(text, /วิธีการแก้ไข: -/);
  assert.match(text, /วันที่เวลาในการแก้ไข: -/);
  assert.doesNotMatch(text, /สาเหตุ/);
  assert.doesNotMatch(text, /หมายเหตุ/);
});

test('/notify/ticket-closed shows only the date when time is missing', async (t) => {
  silenceLogs(t);
  const calls = fakeHttp(t);
  const baseUrl = await startServer(t);

  await postJson(baseUrl, '/notify/ticket-closed', { ticketId: 42, title: 'x', lineUserId: USER_ID, resolvedDate: '2026-11-13' });

  assert.match(pushCall(calls).body.messages[0].text, /วันที่เวลาในการแก้ไข: 2026-11-13\n/);
});

test('/notify/ticket-closed returns 500 when LINE push fails', async (t) => {
  silenceLogs(t);
  fakeHttp(t, { [`POST ${LINE_PUSH}`]: () => { throw new Error('LINE down'); } });
  const baseUrl = await startServer(t);

  const res = await postJson(baseUrl, '/notify/ticket-closed', { ticketId: 42, title: 'x', lineUserId: USER_ID });

  assert.equal(res.status, 500);
});
