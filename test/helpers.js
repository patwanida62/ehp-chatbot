const { buildAppRegistry } = require('../src/config/appRegistry');

const HMAC_SECRET = 'hmac-secret-for-tests-0123456789';
const API_KEY = 'api-key-for-tests-0123456789';
const USER_ID = `U${'a'.repeat(32)}`;
const GROUP_ID = `C${'b'.repeat(32)}`;
const NOW_MS = Date.UTC(2026, 10, 13, 3, 0, 0);

function buildTestApps() {
  return buildAppRegistry([
    {
      id: 'ehp-cis',
      name: 'EHP CIS',
      auth: { type: 'hmac', secret: HMAC_SECRET },
      allowedEvents: ['appointment.created', 'appointment.cancelled', 'notification.text'],
    },
    {
      id: 'lab-system',
      auth: { type: 'apiKey', secret: API_KEY },
      allowedEvents: ['notification.text'],
      defaultTarget: { lineGroupId: GROUP_ID },
    },
    {
      id: 'disabled-app',
      enabled: false,
      auth: { type: 'apiKey', secret: API_KEY },
      allowedEvents: ['notification.text'],
    },
  ]);
}

/** Records pushes instead of calling LINE; set `failWith` to simulate an API error. */
function createFakeLineClient() {
  const pushes = [];
  return {
    pushes,
    failWith: null,
    async push(to, messages) {
      if (this.failWith) throw this.failWith;
      pushes.push({ to, messages });
    },
  };
}

const silentLogger = { info() {}, error() {} };

function appointmentPayload(overrides = {}) {
  return {
    event: 'appointment.created',
    eventId: 'APT-0001-created',
    to: { lineUserId: USER_ID },
    data: {
      appointmentId: 'APT-0001',
      datetime: '2026-11-20T09:30:00+07:00',
      clinic: 'คลินิกเบาหวาน',
      doctor: 'นพ.ทดสอบ',
    },
    ...overrides,
  };
}

module.exports = {
  HMAC_SECRET,
  API_KEY,
  USER_ID,
  GROUP_ID,
  NOW_MS,
  buildTestApps,
  createFakeLineClient,
  silentLogger,
  appointmentPayload,
};
