// Microsoft Graph (Outlook / Microsoft 365) – delegated OAuth + mail read/send.
const store = require('./store');

const TENANT = process.env.MS_TENANT_ID || 'common';
const CLIENT_ID = process.env.MS_CLIENT_ID;
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET;
const SCOPES = 'offline_access User.Read Mail.ReadWrite Mail.Send';
const AUTH_BASE = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0`;
const GRAPH = 'https://graph.microsoft.com/v1.0';

const configured = () => Boolean(CLIENT_ID && CLIENT_SECRET);
const redirectUri = () => `${process.env.PUBLIC_BASE_URL || 'http://localhost:3000'}/auth/callback`;

function authUrl(state) {
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: SCOPES,
    state,
    prompt: 'select_account',
  });
  return `${AUTH_BASE}/authorize?${q}`;
}

async function tokenRequest(params) {
  const res = await fetch(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: SCOPES,
      redirect_uri: redirectUri(),
      ...params,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Microsoft token error: ${json.error_description || json.error}`);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in - 120) * 1000,
  };
}

async function exchangeCode(code) {
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code });
  const db = store.load();
  db.auth = tokens;
  const me = await graph('GET', '/me?$select=displayName,mail,userPrincipalName');
  db.auth.account = { name: me.displayName, email: me.mail || me.userPrincipalName };
  store.save();
  return db.auth.account;
}

async function accessToken() {
  const db = store.load();
  if (!db.auth) throw new Error('Outlook is not connected');
  if (Date.now() < db.auth.expiresAt) return db.auth.accessToken;
  const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: db.auth.refreshToken });
  db.auth = { ...db.auth, ...fresh, refreshToken: fresh.refreshToken || db.auth.refreshToken };
  store.save();
  return db.auth.accessToken;
}

async function graph(method, url, body, extraHeaders = {}) {
  const res = await fetch(url.startsWith('http') ? url : GRAPH + url, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 202 || res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Graph ${method} ${url}: ${res.status} ${json.error?.message || ''}`);
  return json;
}

// Inbox messages received since `sinceIso`, oldest first, plain-text bodies.
async function fetchNewMessages(sinceIso) {
  const q = new URLSearchParams({
    $filter: `receivedDateTime ge ${sinceIso}`,
    $orderby: 'receivedDateTime asc',
    $top: '50',
    $select: 'id,subject,from,receivedDateTime,body,conversationId,internetMessageId',
  });
  let url = `/me/mailFolders/inbox/messages?${q}`;
  const out = [];
  while (url && out.length < 200) {
    const page = await graph('GET', url, null, { Prefer: 'outlook.body-content-type="text"' });
    for (const m of page.value) {
      out.push({
        id: m.id,
        subject: m.subject || '',
        fromName: m.from?.emailAddress?.name || '',
        fromEmail: (m.from?.emailAddress?.address || '').toLowerCase(),
        receivedAt: m.receivedDateTime,
        body: m.body?.content || '',
      });
    }
    url = page['@odata.nextLink'];
  }
  return out;
}

async function sendMail({ to, toName, subject, body, attachments = [] }) {
  await graph('POST', '/me/sendMail', {
    message: {
      subject,
      body: { contentType: 'Text', content: body },
      toRecipients: [{ emailAddress: { address: to, name: toName || to } }],
      attachments: attachments.map((a) => ({
        '@odata.type': '#microsoft.graph.fileAttachment', name: a.name, contentType: a.contentType, contentBytes: a.base64,
      })),
    },
    saveToSentItems: true,
  });
}

function account() {
  return store.load().auth?.account || null;
}

function disconnect() {
  store.load().auth = null;
  store.save();
}

module.exports = { configured, authUrl, exchangeCode, fetchNewMessages, sendMail, account, disconnect };
