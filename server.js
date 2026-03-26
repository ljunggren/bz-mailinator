'use strict';

const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
const express = require('express');

// ── Config ──────────────────────────────────────────────────
const SMTP_PORT = process.env.SMTP_PORT || 2525;
const API_PORT = process.env.API_PORT || 3025;
const MAX_EMAILS = process.env.MAX_EMAILS || 1000;
const TTL_MS = process.env.TTL_MS || 3600000; // 1 hour

// ── In-memory store ─────────────────────────────────────────
const inboxes = {};  // { address: [{ id, from, to, subject, text, html, date }] }
let emailCount = 0;

function getInbox(address) {
  return address.toLowerCase().trim();
}

function store(parsed, to) {
  const addr = getInbox(to);
  if (!inboxes[addr]) inboxes[addr] = [];

  const email = {
    id: ++emailCount,
    from: parsed.from ? parsed.from.text : '',
    to: addr,
    subject: parsed.subject || '',
    text: parsed.text || '',
    html: parsed.html || '',
    date: new Date().toISOString()
  };

  inboxes[addr].push(email);

  // Enforce per-inbox limit
  if (inboxes[addr].length > MAX_EMAILS) {
    inboxes[addr] = inboxes[addr].slice(-MAX_EMAILS);
  }

  console.log(`[SMTP] ${email.from} → ${addr}: "${email.subject}"`);
  return email;
}

// ── Cleanup expired emails ──────────────────────────────────
setInterval(() => {
  const cutoff = Date.now() - TTL_MS;
  for (const addr in inboxes) {
    inboxes[addr] = inboxes[addr].filter(e => new Date(e.date).getTime() > cutoff);
    if (inboxes[addr].length === 0) delete inboxes[addr];
  }
}, 60000);

// ── SMTP Server ─────────────────────────────────────────────
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  onData(stream, session, callback) {
    let raw = '';
    stream.on('data', chunk => raw += chunk);
    stream.on('end', async () => {
      try {
        const parsed = await simpleParser(raw);
        const recipients = session.envelope.rcptTo.map(r => r.address);
        recipients.forEach(to => store(parsed, to));
      } catch (err) {
        console.error('[SMTP] Parse error:', err.message);
      }
      callback();
    });
  }
});

// ── REST API ────────────────────────────────────────────────
const path = require('path');
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// List all inboxes
app.get('/api/inboxes', (req, res) => {
  const result = {};
  for (const addr in inboxes) {
    result[addr] = inboxes[addr].length;
  }
  res.json(result);
});

// Get emails for an inbox
app.get('/api/inbox/:address', (req, res) => {
  const addr = getInbox(req.params.address);
  const emails = inboxes[addr] || [];
  res.json(emails);
});

// Get latest email for an inbox
app.get('/api/inbox/:address/latest', (req, res) => {
  const addr = getInbox(req.params.address);
  const emails = inboxes[addr] || [];
  if (emails.length === 0) return res.status(404).json({ error: 'No emails' });
  res.json(emails[emails.length - 1]);
});

// Get specific email by id
app.get('/api/email/:id', (req, res) => {
  const id = parseInt(req.params.id);
  for (const addr in inboxes) {
    const email = inboxes[addr].find(e => e.id === id);
    if (email) return res.json(email);
  }
  res.status(404).json({ error: 'Not found' });
});

// Delete an inbox
app.delete('/api/inbox/:address', (req, res) => {
  const addr = getInbox(req.params.address);
  delete inboxes[addr];
  res.json({ ok: true });
});

// Delete all inboxes
app.delete('/api/inboxes', (req, res) => {
  for (const addr in inboxes) delete inboxes[addr];
  emailCount = 0;
  res.json({ ok: true });
});

// ── Assertion API ───────────────────────────────────────────
// GET /api/assert/:address?subject=...&from=...&contains=...&timeout=5000
// Waits for a matching email, returns it or 408 on timeout
app.get('/api/assert/:address', async (req, res) => {
  const addr = getInbox(req.params.address);
  const { subject, from, contains } = req.query;
  const timeout = parseInt(req.query.timeout) || 5000;
  const start = Date.now();

  function find() {
    const emails = inboxes[addr] || [];
    return emails.find(e => {
      if (subject && !e.subject.includes(subject)) return false;
      if (from && !e.from.includes(from)) return false;
      if (contains && !e.text.includes(contains) && !e.html.includes(contains)) return false;
      return true;
    });
  }

  // Poll until match or timeout
  while (Date.now() - start < timeout) {
    const match = find();
    if (match) return res.json({ ok: true, email: match });
    await new Promise(r => setTimeout(r, 200));
  }

  res.status(408).json({ ok: false, error: 'No matching email within ' + timeout + 'ms' });
});

// GET /api/assert/:address/count?min=1&max=5
// Assert email count in inbox
app.get('/api/assert/:address/count', (req, res) => {
  const addr = getInbox(req.params.address);
  const emails = inboxes[addr] || [];
  const count = emails.length;
  const min = req.query.min !== undefined ? parseInt(req.query.min) : null;
  const max = req.query.max !== undefined ? parseInt(req.query.max) : null;

  if (min !== null && count < min) {
    return res.status(417).json({ ok: false, count, error: 'Expected at least ' + min + ' emails, got ' + count });
  }
  if (max !== null && count > max) {
    return res.status(417).json({ ok: false, count, error: 'Expected at most ' + max + ' emails, got ' + count });
  }
  res.json({ ok: true, count });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', inboxes: Object.keys(inboxes).length, emails: emailCount });
});

// ── Start ───────────────────────────────────────────────────
smtp.listen(SMTP_PORT, () => {
  console.log(`SMTP server listening on port ${SMTP_PORT}`);
});

app.listen(API_PORT, () => {
  console.log(`API server listening on port ${API_PORT}`);
  console.log(`  GET    /api/inboxes              — list all inboxes`);
  console.log(`  GET    /api/inbox/:address        — get emails`);
  console.log(`  GET    /api/inbox/:address/latest — get latest email`);
  console.log(`  GET    /api/email/:id             — get email by id`);
  console.log(`  DELETE /api/inbox/:address        — delete inbox`);
  console.log(`  DELETE /api/inboxes               — delete all`);
  console.log(`  GET    /api/health                — health check`);
});

module.exports = { app, smtp, inboxes };
