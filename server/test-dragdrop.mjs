// Πραγματική δοκιμή drag-and-drop: headless Chrome, δημιουργούμε ένα synthetic File +
// DataTransfer μέσα στη σελίδα και εκπέμπουμε ένα πραγματικό DOM "drop" event πάνω στο
// DropZone στοιχείο. Αυτό διαπερνά το πραγματικό onDrop handler του React component.
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9333;

function log(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}

const BASE = 'http://localhost:3001/api';
let cookie = '';
async function call(method, path, body) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const suffix = Date.now();
const email = `__dnd_test_${suffix}@example.com`;
let r = await call('POST', '/auth/register', { email, username: `DndTest${suffix}`, password: 'password123' });
log('εγγραφή δοκιμαστικού χρήστη', r.status === 201, JSON.stringify(r.body));
const sessionCookieValue = cookie.split('=')[1];

r = await call('POST', '/projects', { name: '__test_dragdrop__', sourceLanguage: 'en', targetLanguages: ['el'] });
log('δημιουργία test project', r.status === 201, JSON.stringify(r.body));
const projectId = r.body.id;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  '--no-sandbox',
  '--disable-gpu',
  '--window-size=1200,900',
], { stdio: 'ignore' });

await new Promise((res) => setTimeout(res, 1500));

const targetsRes = await fetch(`http://localhost:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
const target = await targetsRes.json();
const ws = new WebSocket(target.webSocketDebuggerUrl);

let msgId = 0;
const pending = new Map();
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
await new Promise((res) => ws.once('open', res));

await send('Network.enable');
await send('Network.setCookie', {
  name: 'metafrasis_session', value: sessionCookieValue, domain: 'localhost', path: '/',
});
await send('Page.enable');
await send('Page.navigate', { url: `http://localhost:3001/projects/${projectId}?tab=sources` });

for (let i = 0; i < 20; i++) {
  await new Promise((res) => setTimeout(res, 300));
  const check = await send('Runtime.evaluate', {
    expression: '!document.body.innerText.includes("Φόρτωση…")',
  });
  if (check.result?.result?.value === true) break;
}

// Το DropZone component έχει πλέον data-testid="dropzone" στο root div του — μοναδικό
// και χωρίς αμφισημία, αντί για ευριστικές CSS-selector προσπάθειες στη δομή του DOM.
const ZONE = `document.querySelector('[data-testid="dropzone"]')`;

const zoneCheck = await send('Runtime.evaluate', { expression: `!!${ZONE}`, returnByValue: true });
log('βρέθηκε το drop-zone στοιχείο', zoneCheck.result?.result?.value === true, JSON.stringify(zoneCheck.result?.result));

async function dispatchOn(zoneExpr, type, fileName, mimeType, content) {
  const res = await send('Runtime.evaluate', {
    expression: `
      (async () => {
        const zone = ${zoneExpr};
        if (!zone) return { error: 'no-zone' };
        const dt = new DataTransfer();
        dt.items.add(new File([${JSON.stringify(content)}], ${JSON.stringify(fileName)}, { type: ${JSON.stringify(mimeType)} }));
        const event = new DragEvent(${JSON.stringify(type)}, { bubbles: true, cancelable: true, dataTransfer: dt });
        zone.dispatchEvent(event);
        await new Promise(r => setTimeout(r, 100));
        return { outline: zone.style.outline };
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });
  return res.result?.result?.value;
}

// 1. dragover πρέπει να ενεργοποιήσει το dashed accent outline.
const overResult = await dispatchOn(ZONE, 'dragover', 'test.json', 'application/json', '{}');
log('το dragover ενεργοποιεί το highlight', /dashed/.test(overResult?.outline ?? ''), JSON.stringify(overResult));

// 2. dragleave πρέπει να το καθαρίσει ξανά.
const leaveResult = await send('Runtime.evaluate', {
  expression: `
    (async () => {
      const zone = ${ZONE};
      if (!zone) return { error: 'no-zone' };
      const event = new DragEvent('dragleave', { bubbles: true, cancelable: true, relatedTarget: document.body });
      zone.dispatchEvent(event);
      await new Promise(r => setTimeout(r, 100));
      return { outline: zone.style.outline };
    })()
  `,
  awaitPromise: true,
  returnByValue: true,
});
log('το dragleave καθαρίζει το highlight', leaveResult.result?.result?.value?.outline === 'none', JSON.stringify(leaveResult.result));

// 3. Πραγματικό drop ενός έγκυρου .json.
await new Promise((res) => setTimeout(res, 1500));
r = await call('GET', `/projects/${projectId}/files`);
const beforeCount = r.body.files?.length ?? 0;

await dispatchOn(ZONE, 'drop', 'dropped.json', 'application/json', JSON.stringify({ hello: 'world' }));
await new Promise((res) => setTimeout(res, 1500));

r = await call('GET', `/projects/${projectId}/files`);
const uploaded = r.body.files?.some((f) => f.name === 'dropped.json');
log('το drop ανεβάζει πραγματικά το αρχείο (επιβεβαίωση στη βάση)', uploaded === true, JSON.stringify(r.body.files));
log('το πλήθος αρχείων αυξήθηκε κατά 1', (r.body.files?.length ?? 0) === beforeCount + 1);

// 4. Αρχείο λάθος τύπου δεν πρέπει να ανέβει.
await dispatchOn(ZONE, 'drop', 'notes.txt', 'text/plain', 'not json');
await new Promise((res) => setTimeout(res, 1000));
r = await call('GET', `/projects/${projectId}/files`);
const notesUploaded = r.body.files?.some((f) => f.name === 'notes.txt');
log('αρχείο λάθος τύπου (.txt) ΔΕΝ ανεβαίνει', notesUploaded === false, JSON.stringify(r.body.files.map((f) => f.name)));

await send('Browser.close');
chrome.kill();

r = await call('DELETE', `/projects/${projectId}`);
log('καθαρισμός: διαγραφή test project', r.status === 204, `status=${r.status}`);

console.log(process.exitCode ? '\nΥΠΑΡΧΟΥΝ ΑΠΟΤΥΧΙΕΣ' : '\nΟΛΑ ΠΕΡΑΣΑΝ');
