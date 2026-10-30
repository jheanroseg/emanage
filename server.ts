import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Public shared URL calculation
const rawAppUrl = process.env.APP_URL || '';
const sharedAppUrl = rawAppUrl.replace('ais-dev-', 'ais-pre-');

// Persisted events database directory
const DATA_DIR = path.resolve(__dirname, 'data');
const DB_FILE = path.resolve(DATA_DIR, 'db.json');
const SIGNIN_LOGS_FILE = path.resolve(DATA_DIR, 'signin_logs.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export interface SignInLog {
  id: string;
  userId?: string | number | null;
  userName?: string;
  email: string;
  ip: string;
  userAgent: string;
  status: 'SUCCESS' | 'FAILED';
  reason?: string;
  method: string;
  timestamp: string;
  formattedDate: string;
}

interface DbData {
  events: any[];
  rsvpResponses: any[];
  users: any[];
  signInLogs: SignInLog[];
}

let dbData: DbData = {
  events: [],
  rsvpResponses: [],
  users: [],
  signInLogs: []
};

// Check if db.json exists, or if emanage_organized_data.json exists to bootstrap
if (fs.existsSync(DB_FILE)) {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    dbData = {
      events: Array.isArray(raw.events) ? raw.events : [],
      rsvpResponses: Array.isArray(raw.rsvpResponses) ? raw.rsvpResponses : [],
      users: Array.isArray(raw.users) ? raw.users : [],
      signInLogs: Array.isArray(raw.signInLogs) ? raw.signInLogs : []
    };
  } catch (e) {
    console.error('Error reading db.json', e);
  }
}

// Also check separate signin_logs.json if present
if (fs.existsSync(SIGNIN_LOGS_FILE)) {
  try {
    const logs = JSON.parse(fs.readFileSync(SIGNIN_LOGS_FILE, 'utf-8'));
    if (Array.isArray(logs) && logs.length > 0) {
      const existingIds = new Set(dbData.signInLogs.map((l: any) => l.id));
      for (const log of logs) {
        if (!existingIds.has(log.id)) {
          dbData.signInLogs.push(log);
          existingIds.add(log.id);
        }
      }
    }
  } catch (err) {
    console.error('Error reading signin_logs.json', err);
  }
}

// Helper to record sign in log securely
function recordSignInLog(logEntry: Omit<SignInLog, 'id' | 'timestamp' | 'formattedDate'>) {
  const now = new Date();
  const entry: SignInLog = {
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    ...logEntry,
    timestamp: now.toISOString(),
    formattedDate: now.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    })
  };

  if (!Array.isArray(dbData.signInLogs)) {
    dbData.signInLogs = [];
  }
  dbData.signInLogs.unshift(entry);
  if (dbData.signInLogs.length > 1000) {
    dbData.signInLogs = dbData.signInLogs.slice(0, 1000);
  }

  saveDb();
  try {
    fs.writeFileSync(SIGNIN_LOGS_FILE, JSON.stringify(dbData.signInLogs, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving signin_logs.json', e);
  }
  return entry;
}

// NOTE: events are no longer auto-seeded from emanage_organized_data.json.
// Every account starts with an empty event list.

const saveDb = () => {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error writing db.json', e);
  }
};

// API: Public configuration
app.get('/api/config', (_req, res) => {
  res.json({
    appUrl: rawAppUrl,
    sharedAppUrl: sharedAppUrl || rawAppUrl,
  });
});

// --------------------------------------------------------------------------------------
// USER AUTHENTICATION & PERSISTENCE ENDPOINTS
// --------------------------------------------------------------------------------------

// API: Get all registered users
app.get('/api/users', (_req, res) => {
  const users = (dbData.users || []).map((u: any) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role || 'Event Host & Admin',
    phone: u.phone || '',
    organization: u.organization || 'Personal Workspace',
    createdAt: u.createdAt || ''
  }));
  res.json(users);
});

// API: User Signup
app.post('/api/users/signup', (req, res) => {
  const { name, email, password, role, phone, organization, createdAt } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Missing required signup fields' });
  }
  if (!Array.isArray(dbData.users)) {
    dbData.users = [];
  }
  const cleanEmail = email.trim().toLowerCase();
  const existingIdx = dbData.users.findIndex(
    (u: any) => u.email.toLowerCase() === cleanEmail
  );
  const userObj = {
    id: req.body.id || 'u_' + Date.now(),
    name: name.trim(),
    email: cleanEmail,
    password: String(password),
    role: role || 'Event Host & Admin',
    phone: phone || '',
    organization: organization || 'Personal Workspace',
    createdAt: createdAt || new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  };
  if (existingIdx >= 0) {
    dbData.users[existingIdx] = userObj;
  } else {
    dbData.users.push(userObj);
  }
  saveDb();

  // Record sign-in log for the new account
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'Unknown Browser';
  recordSignInLog({
    userId: userObj.id,
    userName: userObj.name,
    email: userObj.email,
    ip,
    userAgent,
    status: 'SUCCESS',
    method: 'signup_auto_login'
  });

  res.json({ success: true, user: userObj });
});

// API: User Login
app.post('/api/users/login', (req, res) => {
  const { email, password } = req.body;
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'Unknown Browser';

  if (!email || !password) {
    recordSignInLog({
      userId: null,
      userName: '',
      email: String(email || '').trim().toLowerCase(),
      ip,
      userAgent,
      status: 'FAILED',
      reason: 'Missing email or password',
      method: 'password'
    });
    return res.status(400).json({ error: 'Please enter your email and password' });
  }
  if (!Array.isArray(dbData.users)) {
    dbData.users = [];
  }
  const cleanInput = String(email).trim().toLowerCase();
  const user = dbData.users.find(
    (u: any) =>
      (u.email.toLowerCase() === cleanInput || u.name.toLowerCase() === cleanInput) &&
      String(u.password) === String(password)
  );

  if (user) {
    recordSignInLog({
      userId: user.id,
      userName: user.name,
      email: user.email,
      ip,
      userAgent,
      status: 'SUCCESS',
      method: 'password'
    });
    return res.json({ success: true, user });
  }

  recordSignInLog({
    userId: null,
    userName: '',
    email: cleanInput,
    ip,
    userAgent,
    status: 'FAILED',
    reason: 'Invalid credentials',
    method: 'password'
  });

  return res.status(401).json({
    error: 'Invalid credentials. No registered account found with this email/password. Please create an account via Sign Up.'
  });
});

// --------------------------------------------------------------------------------------
// SIGN IN LOGS ENDPOINTS (Secure Audit Database)
// --------------------------------------------------------------------------------------

// API: Get sign-in logs
app.get('/api/logs/signin', (req, res) => {
  const emailFilter = (req.query.email as string)?.trim().toLowerCase();
  let logs = dbData.signInLogs || [];
  if (emailFilter) {
    logs = logs.filter(l => l.email.toLowerCase() === emailFilter);
  }
  res.json(logs);
});

// API: Record a sign in log entry
app.post('/api/logs/signin', (req, res) => {
  const { userId, userName, email, status, reason, method } = req.body;
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'Unknown Browser';

  const entry = recordSignInLog({
    userId: userId || null,
    userName: userName || '',
    email: String(email || '').trim().toLowerCase(),
    ip,
    userAgent,
    status: status === 'FAILED' ? 'FAILED' : 'SUCCESS',
    reason: reason || undefined,
    method: method || 'client_session'
  });

  res.json({ success: true, log: entry });
});

// API: Clear sign-in logs
app.delete('/api/logs/signin', (_req, res) => {
  dbData.signInLogs = [];
  saveDb();
  try {
    fs.writeFileSync(SIGNIN_LOGS_FILE, JSON.stringify([], null, 2), 'utf-8');
  } catch (e) {
    console.error('Error clearing signin_logs.json', e);
  }
  res.json({ success: true, message: 'Sign-in logs cleared successfully' });
});

// --------------------------------------------------------------------------------------
// GOOGLE SHEETS IMPORT PROXY ENDPOINT
// --------------------------------------------------------------------------------------

// API: Fetch Google Sheet as CSV to bypass browser CORS
app.post('/api/import/google-sheet', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Please provide a valid Google Sheet URL' });
  }

  try {
    let sheetId = '';
    let gid = '0';

    // Patterns for Google Sheets:
    // https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit...
    // https://docs.google.com/spreadsheets/d/e/{PUBLIC_ID}/pubhtml...
    const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (idMatch && idMatch[1]) {
      sheetId = idMatch[1];
    }

    const gidMatch = url.match(/[#&?]gid=([0-9]+)/);
    if (gidMatch && gidMatch[1]) {
      gid = gidMatch[1];
    }

    let exportUrl = url;
    if (sheetId) {
      exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
    } else if (url.includes('/pubhtml') || url.includes('/pub?')) {
      exportUrl = url.replace(/\/pubhtml.*/, '/pub?output=csv').replace(/\/pub\?.*/, '/pub?output=csv');
    }

    const response = await fetch(exportUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      return res.status(400).json({
        error: `Failed to fetch Google Sheet (${response.status} ${response.statusText}). Please verify the sheet is shared ("Anyone with the link can view").`
      });
    }

    const csvText = await response.text();
    if (!csvText || csvText.includes('<!DOCTYPE html>') && csvText.includes('accounts.google.com')) {
      return res.status(400).json({
        error: 'The Google Sheet is private or requires Google Sign-in. Please change sharing to "Anyone with the link can view" or download as Excel/CSV to upload.'
      });
    }

    res.json({ success: true, csvData: csvText, exportUrl });
  } catch (err: any) {
    console.error('Error fetching Google Sheet:', err);
    res.status(500).json({ error: `Could not fetch Google Sheet: ${err.message}` });
  }
});

// API: Direct APK Download
app.get(['/api/download/apk', '/emanage.apk', '/download/apk'], (_req, res) => {
  const apkPath = path.resolve(__dirname, 'public', 'EManage-release.apk');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="EManage-release.apk"');
  if (fs.existsSync(apkPath)) {
    return res.sendFile(apkPath);
  }
  res.redirect('/EManage-release.apk');
});


// --------------------------------------------------------------------------------------
// PYTHON DATA PROCESSOR ENDPOINTS
// --------------------------------------------------------------------------------------

// API: Run Python Processor
app.get('/api/python/run', (req, res) => {
  const pythonScript = path.resolve(__dirname, 'emanage_processor.py');
  const addSample = req.query.add_sample === 'true' ? ['--add-sample'] : [];
  const args = [pythonScript, '--json', ...addSample];

  const py = spawn('python3', args, { cwd: __dirname });

  let stdoutData = '';
  let stderrData = '';

  py.stdout.on('data', (chunk) => {
    stdoutData += chunk.toString();
  });

  py.stderr.on('data', (chunk) => {
    stderrData += chunk.toString();
  });

  py.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).json({
        success: false,
        error: `Python process exited with code ${code}`,
        stderr: stderrData,
      });
    }

    try {
      const parsed = JSON.parse(stdoutData.trim());

      // If events were generated, sync them into dbData
      if (parsed.events_by_month) {
        const eventsList: any[] = [];
        Object.values(parsed.events_by_month).forEach((list: any) => {
          if (Array.isArray(list)) eventsList.push(...list);
        });
        if (eventsList.length > 0) {
          dbData.events = eventsList;
          saveDb();
        }
      }

      res.json({
        success: true,
        data: parsed,
        logs: stderrData,
      });
    } catch (parseErr: any) {
      res.json({
        success: true,
        rawOutput: stdoutData,
        logs: stderrData,
      });
    }
  });

  py.on('error', (err) => {
    res.status(500).json({
      success: false,
      error: `Failed to spawn Python: ${err.message}`,
    });
  });
});

// API: Get Python Source Code
app.get('/api/python/code', (_req, res) => {
  const pythonScript = path.resolve(__dirname, 'emanage_processor.py');
  try {
    if (fs.existsSync(pythonScript)) {
      const code = fs.readFileSync(pythonScript, 'utf-8');
      res.type('text/plain').send(code);
    } else {
      res.status(404).send('# emanage_processor.py not found');
    }
  } catch (err: any) {
    res.status(500).send(`# Error reading file: ${err.message}`);
  }
});

// API: Download Python file
app.get('/api/python/download', (_req, res) => {
  const pythonScript = path.resolve(__dirname, 'emanage_processor.py');
  if (fs.existsSync(pythonScript)) {
    res.download(pythonScript, 'emanage_processor.py');
  } else {
    res.status(404).json({ error: 'emanage_processor.py not found' });
  }
});

// API: Get Generated Markdown Report
app.get('/api/python/report', (_req, res) => {
  const reportPath = path.resolve(__dirname, 'emanage_summary_report.md');
  if (fs.existsSync(reportPath)) {
    res.type('text/markdown').send(fs.readFileSync(reportPath, 'utf-8'));
  } else {
    res.status(404).send('# Report has not been generated yet. Run Python Processor first.');
  }
});

// --------------------------------------------------------------------------------------
// EVENT & RSVP ENDPOINTS
// --------------------------------------------------------------------------------------

// API: Get all events
app.get('/api/events', (req, res) => {
  // Events are private per account: only return events owned by the requesting organizer
  const owner = String(req.query.owner || '').trim().toLowerCase();
  if (!owner) return res.json([]);
  res.json((dbData.events || []).filter((e: any) => String(e.ownerEmail || '').toLowerCase() === owner));
});

// API: Delete all events of one organizer (Clear All Events)
app.delete('/api/events', (req, res) => {
  const owner = String(req.query.owner || '').trim().toLowerCase();
  if (!owner) return res.status(400).json({ error: 'owner required' });
  dbData.events = (dbData.events || []).filter((e: any) => String(e.ownerEmail || '').toLowerCase() !== owner);
  saveDb();
  res.json({ success: true });
});

// API: Delete a single event (only by its owner)
app.delete('/api/events/:id', (req, res) => {
  const owner = lc(req.query.owner);
  const event = (dbData.events || []).find((e: any) => e.id === req.params.id);
  if (!event) return res.json({ success: true });
  if (!owner || lc(event.ownerEmail) !== owner) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  dbData.events = dbData.events.filter((e: any) => e.id !== req.params.id);
  saveDb();
  res.json({ success: true });
});

// API: Get single event by id (public RSVP page) - private response data is not exposed
app.get('/api/events/:id', (req, res) => {
  const event = dbData.events.find((e: any) => e.id === req.params.id);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  const { rsvpLog, formKeys, formKeysFor, ...publicEvent } = event;
  res.json(publicEvent);
});

// API: Sync events from organizer dashboard
// The server keeps its own rsvpLog; the organizer's roster is stored as sent.
app.post('/api/events/sync', (req, res) => {
  const { events } = req.body;
  if (Array.isArray(events)) {
    for (const incoming of events) {
      if (!incoming || !incoming.id) continue;
      const { rsvpLog, formKeys, formKeysFor, ...ev } = incoming;
      const idx = dbData.events.findIndex((e: any) => e.id === ev.id);
      let target: any;
      if (idx >= 0) {
        const existing = dbData.events[idx];
        // never let one account overwrite another account's event
        if (existing.ownerEmail && ev.ownerEmail && lc(existing.ownerEmail) !== lc(ev.ownerEmail)) continue;
        target = dbData.events[idx] = { ...existing, ...ev, rsvpLog: existing.rsvpLog || [] };
      } else {
        target = { ...ev, rsvpLog: [] };
        dbData.events.push(target);
      }
      attachPendingTo(target);
    }
    saveDb();
  }
  res.json({ success: true });
});

function normalizeRsvpStatus(raw: string | undefined): 'Confirmed' | 'Declined' | 'Pending' {
  if (!raw) return 'Pending';
  const clean = raw.trim().toLowerCase();
  if (/declin|cannot|can't|can not|unable|regret|not attend|won't|sorry|hindi|absent|\bno\b|\bn\b/.test(clean)) {
    return 'Declined';
  }
  if (/confirm|attend|\byes\b|going|pupunta|\boo\b|\by\b|join|count me/.test(clean)) {
    return 'Confirmed';
  }
  return 'Pending';
}

const lc = (v: any) => String(v || '').trim().toLowerCase();

// ---- Form response handling -------------------------------------------------------------
// Every response (Google Form webhook or the in-app RSVP page) is appended to event.rsvpLog.
// The organizer's app applies each log entry once on top of its own guest list, so a response can
// never be lost when the organizer edits the roster at the same time.

function applyResponseToServerGuests(event: any, entry: any) {
  if (!Array.isArray(event.guests)) event.guests = [];
  const name = String(entry.name || '').trim();
  const email = String(entry.email || '').trim();
  const idx = event.guests.findIndex(
    (g: any) =>
      (email && g.email && lc(g.email) === lc(email)) ||
      (name && lc(g.name) === lc(name))
  );
  const rsvp = entry.rsvp;
  const guestObj = {
    id: idx >= 0 ? event.guests[idx].id : 'g_' + Math.random().toString(36).substring(2, 9),
    name: name || email,
    email: email || `${name.toLowerCase().replace(/\s+/g, '.')}@guest.local`,
    invited: true,
    rsvp,
    attendance: rsvp === 'Confirmed' ? 'Attended' : 'Absent',
    notes: entry.notes || (idx >= 0 ? event.guests[idx].notes : '') || ''
  };
  if (idx >= 0) event.guests[idx] = guestObj;
  else event.guests.unshift(guestObj);
  event.rsvp_count = event.guests.filter((g: any) => g.rsvp === 'Confirmed').length;
  return guestObj;
}

function recordResponse(event: any, resp: { name: string; email: string; rsvp: string; notes?: string }) {
  const entry = {
    id: 'r_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
    name: resp.name,
    email: resp.email,
    rsvp: resp.rsvp,
    notes: resp.notes || '',
    at: new Date().toISOString()
  };
  if (!Array.isArray(event.rsvpLog)) event.rsvpLog = [];
  event.rsvpLog.push(entry);
  if (event.rsvpLog.length > 2000) event.rsvpLog = event.rsvpLog.slice(-2000);
  const guest = applyResponseToServerGuests(event, entry);
  return { entry, guest };
}

// Responses that arrive before the event exists on the server (e.g. after a Render restart wiped the
// data) are kept here and attached automatically as soon as the organizer's app syncs the event.
function queuePendingResponse(p: any) {
  if (!Array.isArray(dbData.rsvpResponses)) dbData.rsvpResponses = [];
  dbData.rsvpResponses.push({ ...p, pending: true, at: new Date().toISOString() });
  if (dbData.rsvpResponses.length > 5000) dbData.rsvpResponses = dbData.rsvpResponses.slice(-5000);
}

function extractFormKeys(url: string): string[] {
  const keys: string[] = [];
  const pub = /\/forms\/d\/e\/([A-Za-z0-9_-]+)/.exec(url || '');
  if (pub) keys.push(pub[1]);
  const id = /\/forms\/d\/(?!e\/)([A-Za-z0-9_-]+)/.exec(url || '');
  if (id) keys.push(id[1]);
  return keys;
}

function attachPendingTo(event: any) {
  if (!Array.isArray(dbData.rsvpResponses) || dbData.rsvpResponses.length === 0) return;
  const owner = lc(event.ownerEmail);
  const title = lc(event.title);
  const myKeys = [...extractFormKeys(String(event.rsvp_link || '')), ...(Array.isArray(event.formKeys) ? event.formKeys : [])];
  const keep: any[] = [];
  for (const p of dbData.rsvpResponses) {
    if (!p || !p.pending) {
      keep.push(p);
      continue;
    }
    const byId = p.eventId && p.eventId === event.id;
    const sameOwner = !p.eventId && lc(p.owner) === owner;
    const byKey = sameOwner && Array.isArray(p.formKeys) && p.formKeys.some((k: string) => myKeys.includes(k));
    const byTitle = sameOwner && p.title && (lc(p.title) === title || title.includes(lc(p.title)) || lc(p.title).includes(title));
    if (byId || byKey || byTitle) {
      recordResponse(event, { name: p.name, email: p.email, rsvp: p.rsvp, notes: p.notes });
    } else {
      keep.push(p);
    }
  }
  dbData.rsvpResponses = keep;
}

// Short Google Form links (forms.gle/...) are followed once to find the real form id.
async function resolveEventFormKeys(event: any): Promise<string[]> {
  const link = String(event.rsvp_link || '').trim();
  if (!link) return [];
  const direct = extractFormKeys(link);
  if (direct.length) return direct;
  if (event.formKeysFor === link && Array.isArray(event.formKeys)) return event.formKeys;
  let keys: string[] = [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    const r = await fetch(link.startsWith('http') ? link : `https://${link}`, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    clearTimeout(timer);
    keys = extractFormKeys(r.url || '');
  } catch (_) {}
  event.formKeys = keys;
  event.formKeysFor = link;
  return keys;
}

// API: Submit RSVP from guest phone or laptop
app.post('/api/rsvp', (req, res) => {
  const { eventId, guestName, guestEmail, rsvp, notes } = req.body;
  if (!eventId || !guestName || !guestEmail) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const normalizedRsvp = normalizeRsvpStatus(rsvp);
  const event = dbData.events.find((e: any) => e.id === eventId);

  if (event) {
    const { guest } = recordResponse(event, {
      name: String(guestName).trim(),
      email: String(guestEmail).trim(),
      rsvp: normalizedRsvp,
      notes
    });
    saveDb();
    return res.json({ success: true, guest });
  }

  queuePendingResponse({
    eventId,
    name: String(guestName).trim(),
    email: String(guestEmail).trim(),
    rsvp: normalizedRsvp,
    notes: notes || ''
  });
  saveDb();
  res.json({ success: true, queued: true });
});

// API: Google Form Webhook / Apps Script endpoint
// Works for ANY event: the event is found by (1) eventId, (2) the Google Form's own id/link saved in the
// event's RSVP link, or (3) the form title matching the event title - always limited to the organizer's events.
app.all('/api/gform-webhook', async (req, res) => {
  const query: any = req.query || {};
  const body: any = req.body || {};
  const pick = (...vals: any[]) => String(vals.find(v => v !== undefined && v !== null && String(v).trim() !== '') ?? '').trim();

  const eventId = pick(query.eventId, body.eventId, query.id, body.id);
  const owner = lc(pick(query.owner, body.owner));
  const formTitle = pick(query.title, body.title, body.eventTitle, query.eventTitle);
  const guestName = pick(body.name, body.guestName, body['Full Name'], body['Name'], body['Pangalan'], query.name, query.guestName);
  const guestEmail = pick(body.email, body.guestEmail, body['Email Address'], body['Email'], query.email, query.guestEmail);
  const rawRsvp = pick(
    body.rsvp, body.status, body['Will you attend?'], body['RSVP'], body['Confirmation'], body['Attendance'], body['Response'],
    query.rsvp, query.status
  );
  const notes = pick(body.notes, body.message, body['Notes'], body['Message'], query.notes);

  const formKeys = [
    ...extractFormKeys(pick(body.publishedUrl, query.publishedUrl, body.formUrl, query.formUrl)),
    ...[pick(body.formId, query.formId)].filter(Boolean)
  ];

  if (!guestName) {
    return res.status(400).json({ error: 'Missing guest name in form submission' });
  }

  const normalizedRsvp = normalizeRsvpStatus(rawRsvp);

  let event: any = null;
  if (eventId) {
    event = dbData.events.find((e: any) => e.id === eventId) || null;
  }
  if (!event && owner) {
    const owned = dbData.events.filter((e: any) => lc(e.ownerEmail) === owner);
    if (formKeys.length) {
      for (const ev of owned) {
        const keys = await resolveEventFormKeys(ev);
        if (keys.some(k => formKeys.includes(k))) {
          event = ev;
          break;
        }
      }
    }
    if (!event && formTitle) {
      const ft = formTitle.toLowerCase();
      event =
        owned.find((e: any) => lc(e.title) === ft) ||
        owned.find((e: any) => lc(e.title).includes(ft) || ft.includes(lc(e.title))) ||
        null;
    }
  }

  if (!event) {
    // Keep the response safe until the event reaches the server, then attach it automatically.
    queuePendingResponse({
      eventId: eventId || undefined,
      owner,
      title: formTitle,
      formKeys,
      name: guestName,
      email: guestEmail,
      rsvp: normalizedRsvp,
      notes
    });
    saveDb();
    return res.json({
      success: true,
      queued: true,
      message: 'Event not found on the server yet. Response saved and will appear after you open the app and log in.'
    });
  }

  const { guest } = recordResponse(event, { name: guestName, email: guestEmail, rsvp: normalizedRsvp, notes });
  saveDb();

  res.json({
    success: true,
    message: `Recorded ${guestName} (${normalizedRsvp}) for "${event.title}"`,
    guest,
    stats: {
      total: event.guests.length,
      confirmed: event.guests.filter((g: any) => g.rsvp === 'Confirmed').length,
      declined: event.guests.filter((g: any) => g.rsvp === 'Declined').length,
      pending: event.guests.filter((g: any) => g.rsvp === 'Pending').length
    }
  });
});

// API: Update Event RSVP Link
app.post('/api/events/:id/rsvp-link', (req, res) => {
  const { rsvp_link } = req.body;
  const event = dbData.events.find((e: any) => e.id === req.params.id);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  event.rsvp_link = rsvp_link || 'https://forms.gle/aFGNLexpupZkvvpr8';
  saveDb();
  res.json({ success: true, event });
});

// Start Server with Vite Middleware
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`EManage Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
