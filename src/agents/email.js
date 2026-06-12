'use strict';

require('dotenv').config();

const { createSubagentAdapter } = require('../lib/subagent');
const email = require('../tools/email');

const adapter = createSubagentAdapter();

const ACCOUNT_PROP = { type: 'string', description: 'Which email account to use — name (e.g. "personal", "work") or number (1, 2). Defaults to the primary account.' };

const EMAIL_TOOLS = [
  {
    name: 'list_email_accounts',
    description: 'List all configured email accounts (IMAP and SMTP). Call this first when the user mentions a specific account by name or when you are unsure which account to use.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_emails',
    description: 'List recent emails from a mailbox folder.',
    input_schema: {
      type: 'object',
      properties: {
        folder:     { type: 'string',  description: "Folder name. Examples: INBOX, Sent, Trash, Spam, Drafts. Default: INBOX" },
        limit:      { type: 'integer', description: 'Max emails to return (default: 20)' },
        unreadOnly: { type: 'boolean', description: 'If true, return only unread messages' },
        account:    ACCOUNT_PROP,
      },
    },
  },
  {
    name: 'get_email',
    description: 'Fetch the full content and security headers of a specific email by UID. Use for reading body text, analyzing for spam/phishing, and checking SPF/DKIM/DMARC headers.',
    input_schema: {
      type: 'object',
      properties: {
        uid:     { type: 'integer', description: 'Message UID from list_emails or search_emails' },
        folder:  { type: 'string',  description: 'Folder the message is in (default: INBOX)' },
        account: ACCOUNT_PROP,
      },
      required: ['uid'],
    },
  },
  {
    name: 'search_emails',
    description: 'Search emails by sender, subject, keyword, or flags.',
    input_schema: {
      type: 'object',
      properties: {
        folder:  { type: 'string',  description: 'Folder to search in (default: INBOX)' },
        from:    { type: 'string',  description: 'Filter by sender email or name fragment' },
        subject: { type: 'string',  description: 'Filter by subject keyword' },
        query:   { type: 'string',  description: 'Full-text keyword search (slower; used only when no other filters are set)' },
        unread:  { type: 'boolean', description: 'Only return unread messages' },
        flagged: { type: 'boolean', description: 'Only return flagged/starred messages' },
        limit:   { type: 'integer', description: 'Max results (default: 20)' },
        account: ACCOUNT_PROP,
      },
    },
  },
  {
    name: 'list_folders',
    description: 'List all mailbox folders available in an IMAP account.',
    input_schema: {
      type: 'object',
      properties: { account: ACCOUNT_PROP },
    },
  },
  {
    name: 'send_email',
    description: 'Send an email via SMTP.',
    input_schema: {
      type: 'object',
      properties: {
        to:      { type: 'string', description: 'Recipient — "Name <email>" or just "email@example.com"' },
        subject: { type: 'string', description: 'Subject line' },
        text:    { type: 'string', description: 'Plain-text body' },
        html:    { type: 'string', description: 'Optional HTML body' },
        cc:      { type: 'string', description: 'Optional CC addresses' },
        bcc:     { type: 'string', description: 'Optional BCC addresses' },
        account: ACCOUNT_PROP,
      },
      required: ['to', 'subject', 'text'],
    },
  },
  {
    name: 'reply_email',
    description: 'Reply to an existing email — threading headers are set automatically.',
    input_schema: {
      type: 'object',
      properties: {
        uid:       { type: 'integer', description: 'UID of the email to reply to' },
        folder:    { type: 'string',  description: 'Folder the original email is in (default: INBOX)' },
        replyText: { type: 'string',  description: 'Plain-text reply body' },
        account:   ACCOUNT_PROP,
      },
      required: ['uid', 'replyText'],
    },
  },
  {
    name: 'move_email',
    description: 'Move an email from one folder to another.',
    input_schema: {
      type: 'object',
      properties: {
        uid:        { type: 'integer', description: 'Message UID' },
        fromFolder: { type: 'string',  description: 'Source folder' },
        toFolder:   { type: 'string',  description: 'Destination folder' },
        account:    ACCOUNT_PROP,
      },
      required: ['uid', 'fromFolder', 'toFolder'],
    },
  },
  {
    name: 'mark_email',
    description: 'Mark an email as read/unread, flagged/unflagged, or move it to spam.',
    input_schema: {
      type: 'object',
      properties: {
        uid:     { type: 'integer', description: 'Message UID' },
        folder:  { type: 'string',  description: 'Folder the message is in (default: INBOX)' },
        read:    { type: 'boolean', description: 'true=mark read, false=mark unread' },
        flagged: { type: 'boolean', description: 'true=flag/star, false=unflag' },
        spam:    { type: 'boolean', description: 'true=move to spam folder' },
        account: ACCOUNT_PROP,
      },
      required: ['uid'],
    },
  },
  {
    name: 'delete_email',
    description: 'Move an email to Trash. If it is already in Trash, permanently deletes it. Safe — recoverable from Trash.',
    input_schema: {
      type: 'object',
      properties: {
        uid:     { type: 'integer', description: 'Message UID' },
        folder:  { type: 'string',  description: 'Folder the message is in (default: INBOX)' },
        account: ACCOUNT_PROP,
      },
      required: ['uid'],
    },
  },
  {
    name: 'permanent_delete_email',
    description: 'PERMANENTLY delete an email with no recovery. Use only after explicit confirmation from Phonic. Prefer delete_email (trash) unless permanent deletion was specifically requested.',
    input_schema: {
      type: 'object',
      properties: {
        uid:     { type: 'integer', description: 'Message UID' },
        folder:  { type: 'string',  description: 'Folder the message is in (default: INBOX)' },
        account: ACCOUNT_PROP,
      },
      required: ['uid'],
    },
  },
];

const SYSTEM_PROMPT = `You are Widow's email specialist. You were delegated an email task by the main harness.

CAPABILITIES
- Read, search, and list emails (IMAP)
- Send and reply to emails (SMTP)
- Organize: move, flag, mark read/unread, move to spam
- Delete: trash (recoverable) or permanent (irreversible)
- Detect spam and phishing attempts

SPAM & PHISHING ANALYSIS
When asked to analyse an email or when something looks suspicious, fetch the full email with get_email and examine:

1. Authentication headers
   - authentication-results: look for spf=pass/fail, dkim=pass/fail, dmarc=pass/fail
   - received-spf: "Pass" is good; "Fail" or "SoftFail" means the sending server is not authorised for that domain
   - dkim-signature: presence is a positive signal; absent on a "from" a major service is suspicious
   - x-spam-status: "Yes" or a high score is a red flag

2. Sender analysis
   - Compare the display name to the actual email address — "PayPal Support <noreply@paypal-accounts-secure.ru>" is a classic spoof
   - Look for domain typosquatting: paypa1.com, amaz0n.com, micro-soft.com, etc.
   - Check if replyTo differs from the from address — phishers often set a different reply-to

3. Content signals
   - Urgency language: "Your account will be suspended", "Act now", "24 hours"
   - Fear / threat: "Unusual sign-in detected", "Your payment failed", "Legal action"
   - Requests for credentials, financial info, or personal data
   - Unexpected attachments (especially .exe, .zip, .docm, .js, .lnk)
   - Mismatched or obfuscated links (hover text differs from href)

VERDICT FORMAT
After analysis, always give one of:
  SAFE       — passes authentication, domain looks legitimate, no red flags
  SUSPICIOUS — one or two yellow flags; advise caution but not certain phishing
  PHISHING   — clear indicators of fraud; strongly advise do not click, do not reply

Follow the verdict with a concise bullet list of the evidence.

SAFETY RULES
- Never use permanent_delete_email unless Phonic explicitly says "permanently delete" or "no need to keep it"
- Always move to trash first with delete_email; mention that it can be recovered from Trash
- Before sending an email on Phonic's behalf, confirm the recipient and subject if there's any ambiguity
- If an email is flagged PHISHING, warn strongly before any reply action

RESPONSE STYLE
- Concise, voice-friendly (this will be read aloud)
- Summarise email content rather than quoting it verbatim
- Use natural language counts: "3 unread from Amazon" not a raw JSON list
- For lists of emails, give sender, subject, and date — skip UIDs unless specifically asked`;

const TOOL_MAP = {
  list_email_accounts:    ()  => email.listEmailAccounts(),
  list_emails:            (i) => email.listEmails({ folder: i.folder, limit: i.limit, unreadOnly: i.unreadOnly, account: i.account }),
  get_email:              (i) => email.getEmail(i.uid, i.folder, i.account),
  search_emails:          (i) => email.searchEmails(i),
  list_folders:           (i) => email.listFolders(i.account),
  send_email:             (i) => email.sendEmail(i),
  reply_email:            (i) => email.replyEmail(i.uid, i.folder, i.replyText, i.account),
  move_email:             (i) => email.moveEmail(i.uid, i.fromFolder, i.toFolder, i.account),
  mark_email:             (i) => email.markEmail(i.uid, i.folder, { read: i.read, flagged: i.flagged, spam: i.spam }, i.account),
  delete_email:           (i) => email.deleteEmail(i.uid, i.folder, i.account),
  permanent_delete_email: (i) => email.expungeEmail(i.uid, i.folder, i.account),
};

async function run(task, context, onProgress) {
  const messages = [];
  let userContent = `Email task: ${task}`;
  if (context) userContent += `\n\nContext: ${context}`;
  messages.push({ role: 'user', content: userContent });

  let finalResponse = '';
  const MAX_ITERATIONS = 30;
  let iterations = 0;

  try {
    while (iterations++ < MAX_ITERATIONS) {
      const response = await adapter.complete(messages, SYSTEM_PROMPT, EMAIL_TOOLS);

      if (response.stop_reason === 'tool_use') {
        const narration = response.content
          .filter(b => b.type === 'text').map(b => b.text).join('').trim();
        if (narration) onProgress?.(`» ${narration}`);

        messages.push({ role: 'assistant', content: response.content });

        const toolResults = [];
        for (const block of response.content.filter(b => b.type === 'tool_use')) {
          const fn = TOOL_MAP[block.name];
          onProgress?.(`▸ email: ${block.name.replace(/_/g, ' ')}`);
          const result = fn
            ? await fn(block.input)
            : { error: `Unknown tool: ${block.name}` };
          toolResults.push(adapter.toolResult(block.id, block.name, result));
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      finalResponse = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim();

      if (!finalResponse) {
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: [{ type: 'text', text: 'Please provide your response now.' }] });
        continue;
      }

      break;
    }

    if (!finalResponse) finalResponse = 'Email task completed.';
    return { success: true, result: finalResponse };

  } catch (err) {
    console.error('[Email agent] Error:', err);
    return { success: false, error: err.message };
  }
}

module.exports = { run };
