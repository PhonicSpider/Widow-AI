'use strict';

// ============================================================
// EMAIL — SMTP send + IMAP read/manage
//
// Multi-account support: use numbered suffixes for extra accounts.
//
// Primary account (no suffix):
//   IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASS, IMAP_TLS, IMAP_NAME
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_NAME
//
// Additional accounts (_2, _3, ...):
//   IMAP_HOST_2, IMAP_PORT_2, IMAP_USER_2, IMAP_PASS_2, IMAP_NAME_2
//   SMTP_HOST_2, SMTP_PORT_2, SMTP_USER_2, SMTP_PASS_2, SMTP_FROM_2, SMTP_NAME_2
//
// Gmail setup: enable 2FA → myaccount.google.com → Security → App Passwords
//   IMAP_HOST=imap.gmail.com  IMAP_PORT=993  IMAP_USER=you@gmail.com  IMAP_PASS=<app-password>
//   SMTP_HOST=smtp.gmail.com  SMTP_PORT=587  SMTP_USER=you@gmail.com  SMTP_PASS=<same app-password>
// ============================================================

function getNodemailer()   { try { return require('nodemailer');              } catch { return null; } }
function getImapFlow()     { try { return require('imapflow').ImapFlow;       } catch { return null; } }
function getSimpleParser() { try { return require('mailparser').simpleParser; } catch { return null; } }

// ── Multi-account config readers ─────────────────────────────────────────────

function getImapAccounts() {
  const accounts = [];
  if (process.env.IMAP_HOST) {
    accounts.push({
      name: process.env.IMAP_NAME || 'primary',
      host: process.env.IMAP_HOST,
      port: parseInt(process.env.IMAP_PORT || '993', 10),
      user: process.env.IMAP_USER || '',
      pass: process.env.IMAP_PASS || '',
      tls:  process.env.IMAP_TLS !== 'false',
    });
  }
  for (let i = 2; i <= 10; i++) {
    const host = process.env[`IMAP_HOST_${i}`];
    if (!host) break;
    accounts.push({
      name: process.env[`IMAP_NAME_${i}`] || `account${i}`,
      host,
      port: parseInt(process.env[`IMAP_PORT_${i}`] || '993', 10),
      user: process.env[`IMAP_USER_${i}`] || '',
      pass: process.env[`IMAP_PASS_${i}`] || '',
      tls:  process.env[`IMAP_TLS_${i}`] !== 'false',
    });
  }
  return accounts;
}

function getSmtpAccounts() {
  const accounts = [];
  if (process.env.SMTP_HOST) {
    accounts.push({
      name: process.env.SMTP_NAME || 'primary',
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
      from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    });
  }
  for (let i = 2; i <= 10; i++) {
    const host = process.env[`SMTP_HOST_${i}`];
    if (!host) break;
    accounts.push({
      name: process.env[`SMTP_NAME_${i}`] || `account${i}`,
      host,
      port: parseInt(process.env[`SMTP_PORT_${i}`] || '587', 10),
      user: process.env[`SMTP_USER_${i}`] || '',
      pass: process.env[`SMTP_PASS_${i}`] || '',
      from: process.env[`SMTP_FROM_${i}`] || process.env[`SMTP_USER_${i}`] || '',
    });
  }
  return accounts;
}

// Resolve an account by name, number (1-based), or default to the first.
function resolveImapAccount(account) {
  const accounts = getImapAccounts();
  if (!accounts.length) return null;
  if (!account) return accounts[0];
  const lower = String(account).toLowerCase();
  return accounts.find(a => a.name.toLowerCase() === lower)
    || accounts[Number(account) - 1]
    || accounts[0];
}

function resolveSmtpAccount(account) {
  const accounts = getSmtpAccounts();
  if (!accounts.length) return null;
  if (!account) return accounts[0];
  const lower = String(account).toLowerCase();
  return accounts.find(a => a.name.toLowerCase() === lower)
    || accounts[Number(account) - 1]
    || accounts[0];
}

// ── IMAP helpers ──────────────────────────────────────────────────────────────

function isGmailAccount(acc) {
  return (acc?.host || '').toLowerCase().includes('gmail');
}

function resolveFolder(name, acc) {
  if (!name || name.toUpperCase() === 'INBOX') return 'INBOX';
  if (!isGmailAccount(acc)) return name;
  const map = {
    'sent':      '[Gmail]/Sent Mail',
    'sent mail': '[Gmail]/Sent Mail',
    'trash':     '[Gmail]/Trash',
    'bin':       '[Gmail]/Trash',
    'spam':      '[Gmail]/Spam',
    'junk':      '[Gmail]/Spam',
    'all':       '[Gmail]/All Mail',
    'all mail':  '[Gmail]/All Mail',
    'archive':   '[Gmail]/All Mail',
    'drafts':    '[Gmail]/Drafts',
    'draft':     '[Gmail]/Drafts',
    'starred':   '[Gmail]/Starred',
    'important': '[Gmail]/Important',
  };
  return map[name.toLowerCase()] || name;
}

async function withImap(fn, accountSelector) {
  const IMap = getImapFlow();
  if (!IMap) return { error: 'imapflow not installed — run: npm install imapflow' };

  const acc = resolveImapAccount(accountSelector);
  if (!acc) return { error: 'IMAP not configured — set IMAP_HOST, IMAP_USER, IMAP_PASS in .env' };
  if (!acc.user || !acc.pass) return { error: `IMAP account "${acc.name}" is missing IMAP_USER or IMAP_PASS` };

  const client = new IMap({
    host:     acc.host,
    port:     acc.port,
    secure:   acc.tls,
    auth:     { user: acc.user, pass: acc.pass },
    logger:   false,
    emitLogs: false,
  });

  try {
    await client.connect();
    const result = await fn(client, acc);
    try { await client.logout(); } catch {}
    return result;
  } catch (err) {
    try { client.close(); } catch {}
    return { error: err.message };
  }
}

function fmtAddr(addr) {
  if (!addr) return '';
  if (addr.name) return `${addr.name} <${addr.address || ''}>`;
  return addr.address || '';
}

function msgSummary(msg) {
  const from = msg.envelope?.from?.[0];
  return {
    uid:      msg.uid,
    subject:  msg.envelope?.subject || '(no subject)',
    from:     fmtAddr(from),
    fromAddr: from?.address || '',
    date:     (msg.envelope?.date || msg.internalDate)?.toISOString().slice(0, 16) || '',
    read:     msg.flags?.has('\\Seen')     || false,
    flagged:  msg.flags?.has('\\Flagged')  || false,
    answered: msg.flags?.has('\\Answered') || false,
  };
}

// ── Account discovery ─────────────────────────────────────────────────────────

function listEmailAccounts() {
  const imap = getImapAccounts().map(a => ({
    name: a.name, host: a.host, user: a.user, protocol: 'imap',
  }));
  const smtp = getSmtpAccounts().map(a => ({
    name: a.name, host: a.host, user: a.user, protocol: 'smtp',
  }));
  return { imap, smtp };
}

// ── SMTP operations ──────────────────────────────────────────────────────────

async function sendEmail({ to, subject, text, html, cc, bcc, replyTo, inReplyTo, references, account } = {}) {
  const nm = getNodemailer();
  if (!nm) return { error: 'nodemailer not installed — run: npm install nodemailer' };

  const acc = resolveSmtpAccount(account);
  if (!acc) return { error: 'SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS in .env' };
  if (!acc.user || !acc.pass) return { error: `SMTP account "${acc.name}" is missing user or password` };
  if (!to)            return { error: '"to" is required' };
  if (!subject)       return { error: '"subject" is required' };
  if (!text && !html) return { error: '"text" or "html" body required' };

  try {
    const transport = nm.createTransport({
      host:   acc.host,
      port:   acc.port,
      secure: acc.port === 465,
      auth:   { user: acc.user, pass: acc.pass },
    });
    const info = await transport.sendMail({
      from: acc.from,
      to, subject,
      ...(text       && { text }),
      ...(html       && { html }),
      ...(cc         && { cc }),
      ...(bcc        && { bcc }),
      ...(replyTo    && { replyTo }),
      ...(inReplyTo  && { inReplyTo }),
      ...(references && { references }),
    });
    return { success: true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected, sentFrom: acc.user };
  } catch (err) {
    return { error: err.message };
  }
}

async function verifySmtp(account) {
  const nm = getNodemailer();
  if (!nm) return { error: 'nodemailer not installed — run: npm install nodemailer' };
  const acc = resolveSmtpAccount(account);
  if (!acc) return { error: 'SMTP not configured' };
  try {
    const transport = nm.createTransport({
      host:   acc.host,
      port:   acc.port,
      secure: acc.port === 465,
      auth:   { user: acc.user, pass: acc.pass },
    });
    await transport.verify();
    return { success: true, account: acc.name, host: acc.host, user: acc.user };
  } catch (err) {
    return { error: err.message };
  }
}

// ── IMAP read operations ──────────────────────────────────────────────────────

async function listFolders(account) {
  return withImap(async (client) => {
    const list = await client.list();
    return list
      .filter(m => !m.flags?.has('\\Noselect'))
      .map(m => ({ path: m.path, name: m.name, specialUse: m.specialUse || null }));
  }, account);
}

async function listEmails({ folder = 'INBOX', limit = 20, unreadOnly = false, account } = {}) {
  return withImap(async (client, acc) => {
    const resolved = resolveFolder(folder, acc);
    const lock     = await client.getMailboxLock(resolved);
    try {
      const total = client.mailbox.exists;
      if (total === 0) return [];

      if (unreadOnly) {
        const uids = await client.search({ unseen: true }, { uid: true });
        if (!uids.length) return [];
        const slice   = uids.slice(-Math.min(limit, uids.length));
        const results = [];
        for await (const msg of client.fetch(slice, { uid: true, flags: true, envelope: true, internalDate: true }, { uid: true })) {
          results.push(msgSummary(msg));
        }
        return results.reverse();
      }

      const from    = Math.max(1, total - limit + 1);
      const results = [];
      for await (const msg of client.fetch(`${from}:*`, { uid: true, flags: true, envelope: true, internalDate: true })) {
        results.push(msgSummary(msg));
      }
      return results.reverse();
    } finally {
      lock.release();
    }
  }, account);
}

async function getEmail(uid, folder = 'INBOX', account) {
  const parse = getSimpleParser();
  if (!parse) return { error: 'mailparser not installed — run: npm install mailparser' };

  return withImap(async (client, acc) => {
    const resolved = resolveFolder(folder, acc);
    const lock     = await client.getMailboxLock(resolved);
    try {
      const msg = await client.fetchOne(String(uid), { uid: true, flags: true, envelope: true, source: true }, { uid: true });
      if (!msg) return { error: `Message UID ${uid} not found in ${resolved}` };

      const parsed = await parse(msg.source);

      const SECURITY_HEADERS = [
        'authentication-results', 'received-spf', 'dkim-signature',
        'arc-authentication-results', 'x-spam-status', 'x-spam-score',
        'x-google-dkim-signature', 'x-forwarded-to',
      ];
      const secHeaders = {};
      for (const h of SECURITY_HEADERS) {
        const val = parsed.headers?.get(h);
        if (val) secHeaders[h] = String(val).slice(0, 500);
      }

      return {
        uid,
        messageId:       parsed.messageId     || null,
        subject:         parsed.subject        || '(no subject)',
        from:            parsed.from?.text     || '',
        fromAddress:     parsed.from?.value?.[0]?.address || '',
        replyTo:         parsed.replyTo?.text  || null,
        to:              parsed.to?.text       || '',
        cc:              parsed.cc?.text       || null,
        date:            parsed.date?.toISOString() || '',
        read:            msg.flags?.has('\\Seen')    || false,
        flagged:         msg.flags?.has('\\Flagged') || false,
        text:            (parsed.text || '').slice(0, 8000) || null,
        hasHtml:         !!parsed.html,
        attachments:     (parsed.attachments || []).map(a => ({
          filename:    a.filename || 'unnamed',
          contentType: a.contentType,
          size:        a.size || 0,
        })),
        securityHeaders: secHeaders,
      };
    } finally {
      lock.release();
    }
  }, account);
}

async function searchEmails({ query, from: fromAddr, subject, unread, flagged, folder = 'INBOX', limit = 20, account } = {}) {
  return withImap(async (client, acc) => {
    const resolved = resolveFolder(folder, acc);
    const lock     = await client.getMailboxLock(resolved);
    try {
      const criteria = {};
      if (fromAddr) criteria.from    = fromAddr;
      if (subject)  criteria.subject = subject;
      if (unread)   criteria.unseen  = true;
      if (flagged)  criteria.flagged = true;
      if (query && !fromAddr && !subject) criteria.text = query;
      if (!Object.keys(criteria).length)  criteria.all  = true;

      const uids = await client.search(criteria, { uid: true });
      if (!uids.length) return [];

      const slice   = uids.slice(-Math.min(limit, uids.length));
      const results = [];
      for await (const msg of client.fetch(slice, { uid: true, flags: true, envelope: true, internalDate: true }, { uid: true })) {
        results.push(msgSummary(msg));
      }
      return results.reverse();
    } finally {
      lock.release();
    }
  }, account);
}

// ── IMAP management operations ────────────────────────────────────────────────

async function deleteEmail(uid, folder = 'INBOX', account) {
  return withImap(async (client, acc) => {
    const resolved = resolveFolder(folder, acc);
    const trash    = resolveFolder('trash', acc);
    const lock     = await client.getMailboxLock(resolved);
    try {
      if (resolved === trash) {
        await client.messageDelete(String(uid), { uid: true });
        return { success: true, uid, action: 'permanently deleted (was already in trash)' };
      }
      await client.messageMove(String(uid), trash, { uid: true });
      return { success: true, uid, action: 'moved to trash', trash };
    } finally {
      lock.release();
    }
  }, account);
}

async function expungeEmail(uid, folder = 'INBOX', account) {
  return withImap(async (client, acc) => {
    const resolved = resolveFolder(folder, acc);
    const lock     = await client.getMailboxLock(resolved);
    try {
      await client.messageDelete(String(uid), { uid: true });
      return { success: true, uid, action: 'permanently deleted' };
    } finally {
      lock.release();
    }
  }, account);
}

async function moveEmail(uid, fromFolder, toFolder, account) {
  return withImap(async (client, acc) => {
    const from = resolveFolder(fromFolder, acc);
    const to   = resolveFolder(toFolder, acc);
    const lock = await client.getMailboxLock(from);
    try {
      await client.messageMove(String(uid), to, { uid: true });
      return { success: true, uid, from, to };
    } finally {
      lock.release();
    }
  }, account);
}

async function markEmail(uid, folder = 'INBOX', { read, flagged, spam } = {}, account) {
  return withImap(async (client, acc) => {
    const resolved = resolveFolder(folder, acc);

    if (spam === true) {
      const lock = await client.getMailboxLock(resolved);
      try {
        await client.messageMove(String(uid), resolveFolder('spam', acc), { uid: true });
        return { success: true, uid, action: 'moved to spam' };
      } finally {
        lock.release();
      }
    }

    const lock = await client.getMailboxLock(resolved);
    try {
      if (read === true)     await client.messageFlagsAdd(String(uid),    ['\\Seen'],    { uid: true });
      if (read === false)    await client.messageFlagsRemove(String(uid), ['\\Seen'],    { uid: true });
      if (flagged === true)  await client.messageFlagsAdd(String(uid),    ['\\Flagged'], { uid: true });
      if (flagged === false) await client.messageFlagsRemove(String(uid), ['\\Flagged'], { uid: true });
      return { success: true, uid, read, flagged };
    } finally {
      lock.release();
    }
  }, account);
}

async function replyEmail(uid, folder = 'INBOX', replyText, account) {
  const original = await withImap(async (client, acc) => {
    const resolved = resolveFolder(folder, acc);
    const lock     = await client.getMailboxLock(resolved);
    try {
      return await client.fetchOne(String(uid), { uid: true, envelope: true }, { uid: true });
    } finally {
      lock.release();
    }
  }, account);

  if (original?.error) return original;
  if (!original)        return { error: `Message UID ${uid} not found` };

  const env       = original.envelope;
  const replyAddr = env.replyTo?.[0] || env.from?.[0];
  const subject   = (env.subject || '').startsWith('Re:') ? env.subject : `Re: ${env.subject || ''}`;

  return sendEmail({
    to:         fmtAddr(replyAddr),
    subject,
    text:       replyText,
    inReplyTo:  env.messageId,
    references: env.messageId,
    account,
  });
}

module.exports = {
  // Account info
  listEmailAccounts,
  // SMTP
  sendEmail, verifySmtp,
  // IMAP read
  listFolders, listEmails, getEmail, searchEmails,
  // IMAP manage
  deleteEmail, expungeEmail, moveEmail, markEmail, replyEmail,
};
