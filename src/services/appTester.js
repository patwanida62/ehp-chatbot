const { resolveRecipient } = require('./recipientResolver');
const { describeLineError } = require('./lineClient');
const { AppStoreError } = require('./appStore');

/** Sends a "connection test" message on behalf of an app, so the admin can check LINE delivery from the UI. */
function createAppTester({ appStore, lineClient }) {
  async function sendTestMessage(appId, to) {
    const app = appStore.get(appId);
    if (!app) throw new AppStoreError(404, `app "${appId}" not found`);

    const recipient = resolveRecipient(to, app.defaultTarget);
    if (!recipient.ok) throw new AppStoreError(400, recipient.reason);

    const text = `🔔 ทดสอบการเชื่อมต่อจาก ${app.name}\nหากได้รับข้อความนี้ แสดงว่าระบบส่ง LINE ทำงานปกติ`;
    try {
      await lineClient.push(recipient.to, [{ type: 'text', text }]);
    } catch (err) {
      throw new AppStoreError(502, `LINE ส่งไม่สำเร็จ: ${describeLineError(err)}`);
    }
    return { sentTo: recipient.to };
  }

  return { sendTestMessage };
}

module.exports = { createAppTester };
