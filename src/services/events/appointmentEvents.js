const { requireString, optionalString } = require('../../utils/validation');
const { isValidDateTime, formatThaiDateTime } = require('../../utils/thaiDateTime');

const THEME = Object.freeze({
  created: '#1DB446',
  updated: '#F5A623',
  cancelled: '#E53935',
  label: '#888888',
});

const ACTIONS = Object.freeze({
  'appointment.created': { title: 'ยืนยันการนัดหมาย', color: THEME.created },
  'appointment.updated': { title: 'มีการเปลี่ยนแปลงนัดหมาย', color: THEME.updated },
  'appointment.cancelled': { title: 'ยกเลิกการนัดหมาย', color: THEME.cancelled },
});

const OPTIONAL_FIELDS = Object.freeze([
  ['patientName', 'ผู้รับบริการ'],
  ['doctor', 'แพทย์'],
  ['location', 'สถานที่'],
  ['note', 'คำแนะนำ'],
]);

const ALT_TEXT_MAX = 400;

function validateAppointment(data) {
  const errors = [];
  requireString(data, 'appointmentId', errors, 64);
  requireString(data, 'clinic', errors);
  if (!isValidDateTime(data.datetime)) errors.push('datetime must be an ISO 8601 date-time');
  for (const [field] of OPTIONAL_FIELDS) optionalString(data, field, errors, 500);
  return errors;
}

function infoRow(label, value) {
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: THEME.label, flex: 2 },
      { type: 'text', text: value, size: 'sm', wrap: true, flex: 5 },
    ],
  };
}

function buildRows(data, datetimeText) {
  const rows = [infoRow('วันเวลา', datetimeText), infoRow('คลินิก', data.clinic)];
  for (const [field, label] of OPTIONAL_FIELDS) {
    if (data[field]) rows.push(infoRow(label, data[field]));
  }
  rows.push(infoRow('เลขที่นัด', data.appointmentId));
  return rows;
}

function buildAppointmentMessage({ title, color }, data) {
  const datetimeText = formatThaiDateTime(data.datetime);
  return {
    type: 'flex',
    altText: `${title}: ${datetimeText} ${data.clinic}`.slice(0, ALT_TEXT_MAX),
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: title, weight: 'bold', size: 'lg', color }],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'md', contents: buildRows(data, datetimeText) },
    },
  };
}

function createAppointmentHandler(action) {
  return Object.freeze({
    validate: validateAppointment,
    buildMessages: (data) => [buildAppointmentMessage(action, data)],
  });
}

module.exports = Object.fromEntries(
  Object.entries(ACTIONS).map(([event, action]) => [event, createAppointmentHandler(action)])
);
