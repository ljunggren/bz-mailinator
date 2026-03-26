'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const dns = require('node:dns').promises;

const DOMAIN = process.env.MAIL_DOMAIN || 'testmail.boozang.com';

describe('DNS records for ' + DOMAIN, () => {
  it('A record resolves to an IP', async () => {
    const addrs = await dns.resolve4(DOMAIN);
    assert(addrs.length > 0, 'No A record found for ' + DOMAIN);
    console.log('  A record:', addrs.join(', '));
  });

  it('MX record exists', async () => {
    const mx = await dns.resolveMx(DOMAIN);
    assert(mx.length > 0, 'No MX record found for ' + DOMAIN);
    console.log('  MX record:', mx.map(r => r.priority + ' ' + r.exchange).join(', '));
  });

  it('SMTP port 2525 is reachable', async () => {
    const net = require('node:net');
    const addrs = await dns.resolve4(DOMAIN);
    await new Promise((resolve, reject) => {
      const sock = net.connect({ host: addrs[0], port: 2525, timeout: 5000 });
      sock.on('connect', () => { sock.destroy(); resolve(); });
      sock.on('timeout', () => { sock.destroy(); reject(new Error('SMTP connection timed out')); });
      sock.on('error', reject);
    });
  });
});
