'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const nodemailer = require('nodemailer');

const SMTP_PORT = 2527;
const API_PORT = 3027;
const API = `http://localhost:${API_PORT}`;

process.env.SMTP_PORT = SMTP_PORT;
process.env.API_PORT = API_PORT;

const { app, smtp, inboxes } = require('../server');

let transport;

async function api(path) {
  const res = await fetch(API + path);
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

after(() => { smtp.close(); });

beforeEach(async () => {
  for (const addr in inboxes) delete inboxes[addr];
});

describe('Assert API', () => {
  it('matches email by subject', async () => {
    await sendMail({ to: 'a@test.com', subject: 'Welcome', text: 'hello' });

    const { status, body } = await api('/api/assert/a@test.com?subject=Welcome');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.email.subject, 'Welcome');
  });

  it('matches email by from', async () => {
    await sendMail({ to: 'b@test.com', subject: 'Test', from: 'admin@bz.com' });

    const { status, body } = await api('/api/assert/b@test.com?from=admin@bz.com');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.ok, true);
  });

  it('matches email by body content', async () => {
    await sendMail({ to: 'c@test.com', subject: 'Reset', html: '<a href="http://reset.link">Reset password</a>' });

    const { status, body } = await api('/api/assert/c@test.com?contains=reset.link');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.ok, true);
  });

  it('matches with multiple filters', async () => {
    await sendMail({ to: 'd@test.com', subject: 'Invoice #42', text: 'Total: $100' });
    await sendMail({ to: 'd@test.com', subject: 'Invoice #43', text: 'Total: $200' });

    const { status, body } = await api('/api/assert/d@test.com?subject=Invoice&contains=$200');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.email.subject, 'Invoice #43');
  });

  it('returns 408 when no match within timeout', async () => {
    const { status, body } = await api('/api/assert/nobody@test.com?subject=Nope&timeout=500');
    assert.strictEqual(status, 408);
    assert.strictEqual(body.ok, false);
  });

  it('waits for delayed email', async () => {
    setTimeout(() => {
      sendMail({ to: 'delayed@test.com', subject: 'Arrived' });
    }, 300);

    const { status, body } = await api('/api/assert/delayed@test.com?subject=Arrived&timeout=3000');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.ok, true);
  });
});

describe('Assert count API', () => {
  it('passes when count meets min', async () => {
    await sendMail({ to: 'cnt@test.com', subject: 'A' });
    await sendMail({ to: 'cnt@test.com', subject: 'B' });

    const { status, body } = await api('/api/assert/cnt@test.com/count?min=2');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.count, 2);
  });

  it('fails when count below min', async () => {
    await sendMail({ to: 'cnt2@test.com', subject: 'A' });

    const { status, body } = await api('/api/assert/cnt2@test.com/count?min=3');
    assert.strictEqual(status, 417);
    assert.strictEqual(body.ok, false);
  });

  it('passes when count within range', async () => {
    await sendMail({ to: 'cnt3@test.com', subject: 'A' });
    await sendMail({ to: 'cnt3@test.com', subject: 'B' });

    const { status, body } = await api('/api/assert/cnt3@test.com/count?min=1&max=5');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.ok, true);
  });

  it('fails when count exceeds max', async () => {
    await sendMail({ to: 'cnt4@test.com', subject: 'A' });
    await sendMail({ to: 'cnt4@test.com', subject: 'B' });
    await sendMail({ to: 'cnt4@test.com', subject: 'C' });

    const { status, body } = await api('/api/assert/cnt4@test.com/count?max=2');
    assert.strictEqual(status, 417);
    assert.strictEqual(body.ok, false);
  });

  it('returns count 0 for empty inbox', async () => {
    const { status, body } = await api('/api/assert/empty@test.com/count?min=0');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.count, 0);
  });
});

describe('Regex matching', () => {
  it('matches subject by regex', async () => {
    await sendMail({ to: 'rx1@test.com', subject: 'Invoice #1234' });

    const { status, body } = await api('/api/assert/rx1@test.com?subject=/invoice.*%231234/i');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.ok, true);
  });

  it('matches body content by regex', async () => {
    await sendMail({ to: 'rx2@test.com', subject: 'Code', text: 'Your code is ABC-9876' });

    const { status, body } = await api('/api/assert/rx2@test.com?contains=/[A-Z]{3}-[0-9]{4}/');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.ok, true);
  });

  it('fails when regex does not match', async () => {
    await sendMail({ to: 'rx3@test.com', subject: 'Hello' });

    const { status } = await api('/api/assert/rx3@test.com?subject=/goodbye/i&timeout=500');
    assert.strictEqual(status, 408);
  });

  it('falls back to substring when not a regex pattern', async () => {
    await sendMail({ to: 'rx4@test.com', subject: 'Welcome aboard' });

    const { status, body } = await api('/api/assert/rx4@test.com?subject=Welcome');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.ok, true);
  });
});

describe('Link extraction', () => {
  it('extracts links from assert response', async () => {
    await sendMail({
      to: 'link1@test.com', subject: 'Verify',
      html: '<p>Click <a href="https://example.com/verify?token=abc123">here</a> to verify.</p>'
    });

    const { status, body } = await api('/api/assert/link1@test.com?subject=Verify');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.links.length, 1);
    assert.strictEqual(body.links[0].url, 'https://example.com/verify?token=abc123');
    assert.strictEqual(body.links[0].text, 'here');
  });

  it('extracts multiple links', async () => {
    await sendMail({
      to: 'link2@test.com', subject: 'Links',
      html: '<a href="https://a.com">A</a> and <a href="https://b.com">B</a>'
    });

    const { status, body } = await api('/api/assert/link2@test.com?subject=Links');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.links.length, 2);
  });

  it('returns empty links for text-only email', async () => {
    await sendMail({ to: 'link3@test.com', subject: 'Plain', text: 'no html' });

    const { status, body } = await api('/api/assert/link3@test.com?subject=Plain');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.links.length, 0);
  });

  it('gets links from latest email endpoint', async () => {
    await sendMail({
      to: 'link4@test.com', subject: 'Reset',
      html: '<a href="https://example.com/reset?t=xyz">Reset password</a>'
    });

    const { status, body } = await api('/api/inbox/link4@test.com/latest/links');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.links.length, 1);
    assert.strictEqual(body.links[0].url, 'https://example.com/reset?t=xyz');
    assert.strictEqual(body.links[0].text, 'Reset password');
  });

  it('returns 404 for links on empty inbox', async () => {
    const { status } = await api('/api/inbox/nobody@test.com/latest/links');
    assert.strictEqual(status, 404);
  });
});
