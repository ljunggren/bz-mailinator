'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const nodemailer = require('nodemailer');

const SMTP_PORT = 2526;
const API_PORT = 3026;
const API = `http://localhost:${API_PORT}`;

process.env.SMTP_PORT = SMTP_PORT;
process.env.API_PORT = API_PORT;

const { app, smtp, inboxes } = require('../server');

let transport;

async function api(path, method) {
  const res = await fetch(API + path, { method: method || 'GET' });
  return { status: res.status, body: await res.json() };
}

async function sendMail(opts) {
  return transport.sendMail({ from: 'sender@test.com', ...opts });
}

before(async () => {
  transport = nodemailer.createTransport({
    host: 'localhost', port: SMTP_PORT, secure: false,
    tls: { rejectUnauthorized: false }
  });
});

after(() => {
  smtp.close();
});

beforeEach(async () => {
  for (const addr in inboxes) delete inboxes[addr];
});

describe('Health', () => {
  it('returns ok', async () => {
    const { status, body } = await api('/api/health');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.status, 'ok');
  });
});

describe('SMTP + API', () => {
  it('receives an email and serves it via API', async () => {
    await sendMail({ to: 'user1@test.com', subject: 'Hello', text: 'body text', html: '<b>body</b>' });

    const { body } = await api('/api/inbox/user1@test.com');
    assert.strictEqual(body.length, 1);
    assert.strictEqual(body[0].subject, 'Hello');
    assert.strictEqual(body[0].text, 'body text');
    assert.strictEqual(body[0].html, '<b>body</b>');
    assert.strictEqual(body[0].from, 'sender@test.com');
  });

  it('stores multiple emails in same inbox', async () => {
    await sendMail({ to: 'multi@test.com', subject: 'First' });
    await sendMail({ to: 'multi@test.com', subject: 'Second' });

    const { body } = await api('/api/inbox/multi@test.com');
    assert.strictEqual(body.length, 2);
  });

  it('returns latest email', async () => {
    await sendMail({ to: 'latest@test.com', subject: 'Old' });
    await sendMail({ to: 'latest@test.com', subject: 'New' });

    const { body } = await api('/api/inbox/latest@test.com/latest');
    assert.strictEqual(body.subject, 'New');
  });

  it('returns 404 for empty inbox latest', async () => {
    const { status } = await api('/api/inbox/nobody@test.com/latest');
    assert.strictEqual(status, 404);
  });

  it('gets email by id', async () => {
    await sendMail({ to: 'byid@test.com', subject: 'Find me' });

    const { body: inbox } = await api('/api/inbox/byid@test.com');
    const { body } = await api('/api/email/' + inbox[0].id);
    assert.strictEqual(body.subject, 'Find me');
  });

  it('returns 404 for missing email id', async () => {
    const { status } = await api('/api/email/99999');
    assert.strictEqual(status, 404);
  });

  it('lists all inboxes with counts', async () => {
    await sendMail({ to: 'a@test.com', subject: 'A' });
    await sendMail({ to: 'b@test.com', subject: 'B1' });
    await sendMail({ to: 'b@test.com', subject: 'B2' });

    const { body } = await api('/api/inboxes');
    assert.strictEqual(body['a@test.com'], 1);
    assert.strictEqual(body['b@test.com'], 2);
  });

  it('handles case-insensitive addresses', async () => {
    await sendMail({ to: 'CamelCase@Test.com', subject: 'Case' });

    const { body } = await api('/api/inbox/camelcase@test.com');
    assert.strictEqual(body.length, 1);
  });
});

describe('Delete', () => {
  it('deletes an inbox', async () => {
    await sendMail({ to: 'del@test.com', subject: 'Gone' });
    await api('/api/inbox/del@test.com', 'DELETE');

    const { body } = await api('/api/inbox/del@test.com');
    assert.strictEqual(body.length, 0);
  });

  it('deletes all inboxes', async () => {
    await sendMail({ to: 'x@test.com', subject: 'X' });
    await sendMail({ to: 'y@test.com', subject: 'Y' });
    await api('/api/inboxes', 'DELETE');

    const { body } = await api('/api/inboxes');
    assert.deepStrictEqual(body, {});
  });
});

describe('Static UI', () => {
  it('serves index.html', async () => {
    const res = await fetch(API + '/');
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert(html.includes('BZ Mailinator'));
  });
});
