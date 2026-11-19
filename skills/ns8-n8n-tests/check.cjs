const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, selectors } = require('playwright');
const { workflowFixture } = require('./fixtures.cjs');

selectors.setTestIdAttribute('data-test-id');
const { NODE_ADDR: node, MODULE_ID: mid, APP_HOST: host, FIXTURE_STATE: file,
  ADMIN_USER: admin, ADMIN_PASSWORD: password } = process.env;
const phase = process.argv[2];
const app = 'https://' + host;
let state;
let step = 'validate test inputs';

function save() {
  const temp = file + '.tmp-' + crypto.randomUUID();
  fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
}

function loadState() {
  assert(['seed', 'verify'].includes(phase), 'Choose seed or verify');
  assert(!(process.env.QA_REQUEST_CERT === '1' && process.env.QA_IGNORE_TLS === '1'),
    'A requested public certificate must pass browser TLS verification');
  assert(/^[\w.-]+$/.test(node || '') && /^n8n\d+$/.test(mid || '') &&
    /^[a-z0-9.-]+$/.test(host || '') && file && admin && password, 'Missing or invalid test inputs');
  if (phase === 'seed' && !fs.existsSync(file)) {
    const id = crypto.randomUUID();
    state = { node, mid, host, path: 'ns8-qa-' + id, email: 'qa-' + id + '@example.org',
      password: 'Aa9' + crypto.randomBytes(20).toString('hex'), key: crypto.randomBytes(24).toString('hex') };
    fs.writeFileSync(file, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
  }
  const info = fs.lstatSync(file);
  assert(info.isFile() && (info.mode & 0o077) === 0, 'Use a private fixture state file');
  state = JSON.parse(fs.readFileSync(file));
  assert(state.node === node && state.mid === mid && state.host === host, 'Fixture target mismatch');
  if (phase === 'verify') assert(state.complete, 'Baseline fixtures are incomplete');
}

async function openModule(context) {
  const page = await context.newPage();
  const base = 'https://' + node + '/cluster-admin/';
  step = 'sign in to Cluster Admin';
  await page.goto(base);
  await page.locator('input[name="username"]').fill(admin);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('#main-content').waitFor();
  const settings = base + '#/apps/' + mid + '?page=settings';
  step = 'read and apply NS8 Settings';
  await page.goto(settings);
  const frame = page.frameLocator('iframe');
  const fqdn = frame.getByPlaceholder('n8n.example.org');
  const zone = frame.locator('input[role=combobox], [role=combobox] input, input[placeholder="Choose timezone"]').first();
  await fqdn.waitFor();
  const redirect = frame.locator('input[value="httpToHttps"]');
  const certificate = frame.locator('input[value="letsEncrypt"]');
  async function enable(toggle) {
    if (!await toggle.isChecked()) {
      const id = await toggle.getAttribute('id');
      await frame.locator('label[for="' + id + '"]').click();
    }
  }
  await frame.locator('input[placeholder="n8n.example.org"]:enabled').waitFor();
  assert(!await frame.getByText('Get configuration', { exact: true }).isVisible(),
    'NS8 could not read the existing configuration');
  const wantsCertificate = process.env.QA_REQUEST_CERT === '1';
  const matches = await fqdn.inputValue() === host && await zone.inputValue() === 'UTC' &&
    await redirect.isChecked() && (!wantsCertificate || await certificate.isChecked());
  if (phase === 'seed' && !matches) {
    assert(['', host].includes(await fqdn.inputValue()), 'This instance already serves another hostname');
    await fqdn.fill(host);
    if (await zone.inputValue() !== 'UTC') {
      await zone.fill('UTC');
      await frame.getByText('UTC', { exact: true }).last().click();
    }
    await enable(redirect);
    if (process.env.QA_REQUEST_CERT === '1') await enable(certificate);
    const submit = frame.getByRole('button', { name: 'Save' });
    await Promise.all([
      frame.locator('input[placeholder="n8n.example.org"]:disabled').waitFor(),
      submit.click(),
    ]);
    await frame.locator('input[placeholder="n8n.example.org"]:enabled').waitFor({ timeout: 180000 });
  }
  // Reload through the server-backed Settings page after the configure action.
  step = 'reopen NS8 Settings';
  await page.reload();
  await frame.locator('input[placeholder="n8n.example.org"]:enabled').waitFor();
  await page.waitForFunction(({ host }) => {
    const doc = document.querySelector('iframe')?.contentDocument;
    return doc?.querySelector('input[placeholder="n8n.example.org"]')?.value === host;
  }, { host }, { timeout: 120000 });
  assert.equal(await zone.inputValue(), 'UTC');
  assert(await redirect.isChecked(), 'HTTPS redirect setting was lost');
  if (process.env.QA_REQUEST_CERT === '1') {
    assert(await certificate.isChecked(), 'Requested HTTPS certificate setting was lost');
  }
  step = 'open n8n from NS8 Status';
  await page.goto(base + '#/apps/' + mid);
  await frame.getByRole('heading', { name: 'Status' }).waitFor();
  const launch = frame.getByRole('button', { name: 'Open N8N' });
  await launch.waitFor();
  if (process.env.QA_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.QA_SCREENSHOT_DIR, { recursive: true });
    await frame.locator('body').screenshot({ path: path.join(process.env.QA_SCREENSHOT_DIR, '1._Status.png') });
  }
  const popup = page.waitForEvent('popup');
  await launch.click();
  const editor = await popup;
  await editor.waitForURL(url => url.origin === app);
  console.log('PASS NS8 Settings, Status, and Open N8N');
  return editor;
}

async function editorLogin(page) {
  step = 'sign in to n8n';
  await page.goto(app + '/signin');
  await page.waitForURL(url => ['/setup', '/signin'].includes(url.pathname));
  // A blank instance redirects /signin to /setup after its startup settings load.
  const setup = page.locator('input[autocomplete="given-name"]');
  const login = page.getByRole('button', { name: 'Sign in', exact: true });
  await setup.or(login).first().waitFor();
  if (await setup.isVisible()) {
    assert.equal(phase, 'seed', 'Owner account was lost');
    await page.locator('input[type=email]').fill(state.email);
    await setup.fill('QA');
    await page.locator('input[autocomplete="family-name"]').fill('Owner');
    await page.locator('input[type=password]').fill(state.password);
    await page.getByTestId('setup-form').getByRole('button', { name: /Next|Set up|Continue|Create account/i }).click();
  } else {
    await page.getByRole('textbox', { name: 'Email' }).fill(state.email);
    await page.locator('input[type=password]').fill(state.password);
    await login.click();
  }
  await page.waitForURL(url => !['/setup', '/signin'].includes(url.pathname));
  console.log('PASS n8n owner session');
}

let browserId;
async function request(page, endpoint, method = 'GET', body) {
  const response = await page.evaluate(async ({ endpoint, method, body, browserId }) => {
    const headers = { 'Content-Type': 'application/json' };
    if (browserId) headers['browser-id'] = browserId;
    const res = await fetch('/rest/' + endpoint, {
      headers, method, body: JSON.stringify(body), redirect: 'error',
    });
    return res.ok ? { data: (await res.json()).data } : { error: res.status };
  }, { endpoint, method, body, browserId });
  assert(!response.error, method + ' ' + endpoint.split('?')[0] + ' returned ' + response.error);
  return response.data;
}

async function createWorkflow(page, failed) {
  const fixture = workflowFixture(state, failed);
  step = 'import and save workflow in the editor';
  await page.goto(app + '/workflow/new');
  const menu = page.getByTestId('workflow-menu');
  await menu.waitFor();
  const dialog = page.getByRole('dialog');
  const survey = dialog.getByRole('button', { name: 'Get started', exact: true });
  const skip = dialog.getByRole('button', { name: 'Skip', exact: true });
  if (await survey.isVisible()) {
    await survey.click();
    await skip.waitFor();
  }
  if (await skip.isVisible()) {
    await skip.click();
    await dialog.waitFor({ state: 'hidden' });
    await page.goto(app + '/workflow/new');
  }
  await menu.click();
  await page.getByTestId('workflow-menu-item-import').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('workflow-menu-item-import-from-file').click();
  await (await chooser).setFiles({
    name: 'qualification.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)),
  });
  const imported = page.locator('[data-test-id="canvas-node"][data-node-name="' +
    (failed ? 'Expected failure' : 'Python') + '"]');
  const importPrompt = page.getByRole('dialog').filter({ hasText: 'Importing this from an AI tool?' })
    .getByRole('button', { name: 'Skip', exact: true });
  await imported.or(importPrompt).first().waitFor();
  if (await importPrompt.isVisible()) await importPrompt.click();
  await imported.waitFor();
  await page.getByTestId('inline-edit-preview').click();
  await page.getByTestId('inline-edit-input').fill(fixture.name);
  const saved = page.waitForResponse(r =>
    /\/rest\/workflows(?:\/[\w-]+)?(?:\?|$)/.test(r.url()) && ['PATCH', 'POST'].includes(r.request().method()) && r.ok());
  await page.getByTestId('inline-edit-input').press('Enter');
  await saved;
  await page.waitForURL(url => /^\/workflow\/(?!new$)[\w-]+$/.test(url.pathname));
  return new URL(page.url()).pathname.split('/').pop();
}

async function readExecution(page, id, workflowId, expected) {
  const deadline = Date.now() + 90000;
  do {
    const exec = await request(page, 'executions/' + encodeURIComponent(id));
    assert.equal(String(exec.workflowId), workflowId);
    if (exec.status === expected) return;
    assert(!['error', 'success', 'crashed', 'canceled'].includes(exec.status),
      'Execution ' + id + ' ended with ' + exec.status + ', expected ' + expected);
    await new Promise(resolve => setTimeout(resolve, 750));
  } while (Date.now() < deadline);
  throw Error('Timed out waiting for execution ' + id);
}

async function manual(page, id, status) {
  step = 'execute saved workflow in the editor';
  await page.goto(app + '/workflow/' + id);
  await page.getByTestId('canvas-node').first().waitFor();
  await page.locator('[data-test-id="canvas-node"][data-node-name="Manual"]').hover();
  const button = page.getByTestId('execute-workflow-button-Manual');
  const [response] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === '/rest/workflows/' + id + '/run'),
    button.click(),
  ]);
  assert(response.ok(), 'Manual run request failed');
  const { data } = await response.json();
  assert(data.executionId, 'Manual run did not return an execution ID');
  await readExecution(page, data.executionId, id, status);
  if (status === 'error') {
    await page.getByText(/Qualification intentional failure|Problem in node .Expected failure./i).first().waitFor();
  }
  return String(data.executionId);
}

async function webhook(page) {
  const hit = value => page.evaluate(async ({ url, value }) => {
    const response = await fetch(url, { headers: { 'X-NS8-QA': value }, redirect: 'error', credentials: 'omit' });
    return { status: response.status, body: response.ok ? await response.json() : null };
  }, { url: '/webhook/' + state.path, value });
  step = 'exercise production webhook';
  const before = await request(page, 'executions?limit=50');
  const seen = new Set(before.results.map(e => String(e.id)));
  assert([401, 403].includes((await hit('invalid')).status), 'Webhook accepted invalid credential');
  const good = await hit(state.key);
  assert.equal(good.status, 200);
  assert.deepEqual(good.body, { javascript: 21, python: 42 });
  const after = await request(page, 'executions?limit=50');
  const execution = after.results.find(e => !seen.has(String(e.id)) && e.mode === 'webhook' && String(e.workflowId) === state.workflow);
  assert(execution, 'Missing new production webhook execution');
  await readExecution(page, execution.id, state.workflow, 'success');
  return String(execution.id);
}

async function main() {
  loadState();
  const browser = await chromium.launch({ channel: process.env.QA_CHROME_CHANNEL || undefined,
    args: ['--host-resolver-rules=MAP ' + host + ' ' + (process.env.QA_NODE_IP || node)] });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: process.env.QA_IGNORE_TLS === '1', locale: 'en-US' });
    context.setDefaultTimeout(45000);
    context.on('request', req => {
      if (new URL(req.url()).origin === app && req.headers()['browser-id']) browserId = req.headers()['browser-id'];
    });
    const page = await openModule(context);
    step = 'verify routed HTTPS health check';
    const redirectPage = await context.newPage();
    const deadline = Date.now() + 180000;
    for (;;) {
      let https;
      try {
        https = await redirectPage.goto('http://' + host + '/healthz/readiness', { timeout: 10000 });
      } catch (err) {
        if (Date.now() >= deadline) throw err;
      }
      if (https && https.ok()) {
        assert.equal(new URL(https.url()).origin, app, 'Readiness probe reached another origin');
        const redirect = https.request().redirectedFrom();
        assert(redirect && new URL(redirect.url()).origin === 'http://' + host,
          'Missing redirect from the configured HTTP origin');
        const redirectResponse = await redirect.response();
        assert(redirectResponse && [301, 302, 307, 308].includes(redirectResponse.status()), 'Missing HTTP redirect');
        break;
      }
      assert(Date.now() < deadline, 'Timed out waiting for the n8n HTTPS readiness probe');
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
    await redirectPage.close();
    await editorLogin(page);
    const closeChecklist = page.getByTestId('suggested-actions-close');
    await page.addLocatorHandler(closeChecklist, () => closeChecklist.click());
    if (phase === 'seed') {
      if (!state.credential) {
        step = 'create disposable n8n credential';
        const created = await request(page, 'credentials', 'POST', {
          name: state.path, type: 'httpHeaderAuth', data: { name: 'X-NS8-QA', value: state.key },
        });
        state.credential = { name: created.name, id: created.id };
        save();
      }
      if (!state.workflow) { state.workflow = await createWorkflow(page, false); save(); }
      if (!state.failure) { state.failure = await createWorkflow(page, true); save(); }
      step = 'publish seeded workflow';
      const workflow = await request(page, 'workflows/' + state.workflow);
      if (!workflow.activeVersionId && !workflow.active) {
        await request(page, 'workflows/' + state.workflow + '/activate', 'POST', { versionId: workflow.versionId });
      }
    } else {
      step = 'read original executions';
      await readExecution(page, state.manual, state.workflow, 'success');
      await readExecution(page, state.error, state.failure, 'error');
      await readExecution(page, state.webhook, state.workflow, 'success');
      console.log('PASS original successful, failed, and production execution IDs');
    }
    const manualId = await manual(page, state.workflow, 'success');
    const failureId = await manual(page, state.failure, 'error');
    const webhookId = await webhook(page);
    if (phase === 'seed' && !state.complete) {
      Object.assign(state, { manual: manualId, error: failureId, webhook: webhookId, complete: true });
      save();
    }
    console.log('PASS manual, failure, webhook authentication, JavaScript and Python output');
    console.log(JSON.stringify({ phase, workflow: state.workflow, failure: state.failure, manualId, failureId, webhookId }));
  } finally { await browser.close(); }
}

main().catch(err => {
  let message = err.message;
  for (const secret of [password, state?.password, state?.key].filter(Boolean)) {
    message = message.split(secret).join('[redacted]');
  }
  console.error(step + ' failed: ' + message);
  process.exitCode = 1;
});
