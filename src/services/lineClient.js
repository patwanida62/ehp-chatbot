const axios = require('axios');

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

/** Thin wrapper over the LINE Messaging API push endpoint. `http` is injectable for tests. */
function createLineClient({ accessToken, http = axios }) {
  async function push(to, messages) {
    await http.post(
      LINE_PUSH_URL,
      { to, messages },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
  }

  return { push };
}

/** Short, PHI-free description of a LINE API failure for logs. */
function describeLineError(err) {
  const status = err && err.response && err.response.status;
  const message = err && err.response && err.response.data && err.response.data.message;
  return status ? `HTTP ${status} ${message || ''}`.trim() : String(err && err.message);
}

module.exports = { createLineClient, describeLineError };
