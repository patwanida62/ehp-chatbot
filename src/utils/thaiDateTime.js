const formatter = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  dateStyle: 'full',
  timeStyle: 'short',
});

function isValidDateTime(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** Formats an ISO date-time as Thai long date + time in Asia/Bangkok, e.g. "วันพฤหัสบดีที่ 20 พฤศจิกายน พ.ศ. 2569 09:30". */
function formatThaiDateTime(isoString) {
  return `${formatter.format(new Date(isoString))} น.`;
}

module.exports = { isValidDateTime, formatThaiDateTime };
