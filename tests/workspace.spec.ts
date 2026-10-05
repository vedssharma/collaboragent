import { test, expect, type Page } from '@playwright/test';
import type { RunEvent } from '../lib/types';
import { getExecutionCapabilities, getConnectionSetup, getSandboxOptions } from '../lib/provider-config';

const complete = { type: 'complete', progress: 100, message: 'Finished' } as const;
const file = { type: 'file', file: 'hello.txt', content: 'Hello', progress: 50, message: 'File created' } as const;
async function stream(page: Page, events: Partial<RunEvent>[]) {
  await page.unroute('**/api/runs');
  await page.route('**/api/runs', (route) => route.fulfill({
    contentType: 'text/event-stream',
    body: events.map((event, i) => `data: ${JSON.stringify({ id: `qa-${i}`, at: new Date().toISOString(), ...event })}\n\n`).join(''),
  }));
}
async function start(page: Page, prompt = 'Create a hello file') {
  await page.getByRole('textbox').fill(prompt);
  await page.getByRole('button', { name: 'Start team run', exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.route('**/api/providers', (route) => route.fulfill({ json: {
    providers: [{ configured: true }],
    capabilities: { liveModels: true, codingHarnesses: true, sandbox: true },
    setup: { gateway: 'configured', sandbox: 'configured', message: 'Credentials configured; access checked on run.' },
  } }));
  // No test can accidentally start a billable provider run.
  await stream(page, [complete]);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Toggle real agent execution' })).toBeEnabled();
});

test('mobile composer fits and can submit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('textbox').fill('Mobile task');
  const send = page.getByRole('button', { name: 'Start team run', exact: true });
  const bounds = await send.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await send.click();
  await expect(page.locator('.mission-status')).toHaveText('Complete');
});

test('retry keeps partial files even when retry fails', async ({ page }) => {
  await stream(page, [file, { type: 'error', message: 'Interrupted' }]);
  await start(page);
  await expect(page.locator('.code-scroll')).toContainText('Hello');
  await expect(page.locator('.live-pill')).toHaveText('Interrupted');
  await stream(page, [{ type: 'error', message: 'Retry failed' }]);
  await page.getByRole('button', { name: 'Retry run', exact: true }).click();
  await expect(page.locator('.activity-feed')).toContainText('Retry failed');
  await expect(page.locator('.code-scroll')).toContainText('Hello');
});

test('new mission replaces old artifacts only after new output', async ({ page }) => {
  await stream(page, [file, complete]); await start(page);
  await expect(page.locator('.live-pill')).toHaveText('Run complete');
  await stream(page, [{ type: 'error', message: 'New run failed' }]); await start(page, 'Different mission');
  await expect(page.locator('.activity-feed')).toContainText('New run failed');
  await expect(page.locator('.code-scroll')).toContainText('Hello');
  await stream(page, [{ ...file, file: 'new.txt', content: 'New content' }, complete]); await start(page, 'Different mission');
  await expect(page.locator('.code-scroll')).toContainText('New content');
  await expect(page.locator('.file-tree')).not.toContainText('hello.txt');
});

test('early EOF unlocks workspace and explains failure', async ({ page }) => {
  await stream(page, [{ type: 'run', message: 'Started', progress: 5 }]); await start(page);
  await expect(page.locator('.live-pill')).toHaveText('Interrupted');
  await expect(page.locator('.activity-feed')).toContainText('stream ended before');
  await expect(page.getByRole('button', { name: 'Design', exact: true })).toBeEnabled();
});

test('Enter submits and Shift+Enter inserts a newline', async ({ page }) => {
  const input = page.getByRole('textbox');
  await input.fill('Hello'); await input.press('Shift+Enter'); await input.press('x');
  await expect(input).toHaveValue('Hello\nx');
  await input.press('Enter');
  await expect(page.locator('.live-pill')).toHaveText('Run complete');
});

test('review count uses reported checks', async ({ page }) => {
  await stream(page, [file, complete]); await start(page);
  await expect(page.locator('.live-pill')).toHaveText('Run complete');
  await expect(page.locator('.summary-strip')).toContainText('—');
  await stream(page, [{ type: 'activity', message: 'Review', checks: { passed: 3, total: 5 } }, complete]); await start(page);
  await expect(page.locator('.summary-strip')).toContainText('3/5');
});

test('file can be updated to empty content', async ({ page }) => {
  await stream(page, [file, { ...file, content: '' }, complete]); await start(page);
  await expect(page.locator('.live-pill')).toHaveText('Run complete');
  await expect(page.locator('.code-line code')).toHaveText('');
});

test('paper abstract and conclusion links scroll', async ({ page }) => {
  await page.getByRole('button', { name: 'Research', exact: true }).click();
  await stream(page, [{ type: 'paper', paper: {
    title: 'Navigation', subtitle: 'Test', abstract: 'Abstract', conclusion: 'Conclusion',
    sections: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, heading: `Section ${i}`, paragraphs: Array(5).fill('Long paragraph. '.repeat(60)), sourceIds: [] })),
  } }, complete]); await start(page, 'Research');
  const paper = page.locator('.paper-scroll'); await expect(paper).toBeVisible();
  await page.addStyleTag({ content: '.paper-scroll { scroll-behavior: auto !important; }' });
  await paper.evaluate((e) => { e.scrollTop = 1000; });
  await page.getByRole('button', { name: 'Abstract', exact: true }).click();
  await expect.poll(() => paper.evaluate((e) => e.scrollTop)).toBeLessThan(1000);
  await page.getByRole('button', { name: 'Conclusion', exact: true }).click();
  await expect.poll(() => paper.evaluate((e) => e.scrollTop)).toBeGreaterThan(1000);
});

test('hand tool pans zoomed board', async ({ page }) => {
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Hand tool', exact: true }).click();
  const board = page.locator('.design-board-scroll'); const box = (await board.boundingBox())!;
  await page.mouse.move(box.x + box.width * .8, box.y + box.height * .6); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .3, box.y + box.height * .6, { steps: 10 }); await page.mouse.up();
  expect(await board.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
});

test('export downloads standalone SVG', async ({ page }) => {
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  const exportButton = page.getByRole('button', { name: 'Export board', exact: true });
  await expect(exportButton).toBeDisabled();
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  const downloaded = page.waitForEvent('download'); await exportButton.click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('design-board.svg');
  const readable = await download.createReadStream();
  const chunks = []; for await (const chunk of readable) chunks.push(chunk);
  const svg = Buffer.concat(chunks).toString();
  expect(svg).toContain('New note'); expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
});

test('invalid request bodies return 400 without invoking providers', async ({ request }) => {
  for (const data of ['null', '[]', '"text"', '{', '{}', JSON.stringify({ mode: 'live', prompt: 'x', workType: 'invalid' }), JSON.stringify({ mode: 'live', prompt: 'x'.repeat(4001) })]) {
    const response = await request.post('/api/runs', { data, headers: { 'Content-Type': 'application/json' } });
    expect(response.status()).toBe(400);
  }
});

test('provider dialog opens, refreshes and closes without collecting subscription credentials', async ({ page }) => {
  await page.getByRole('button', { name: 'Configure providers' }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('not ChatGPT subscription login');
  await expect(dialog).toContainText('Anthropic requires approval');
  await expect(dialog.locator('input')).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh connection status' }).click();
  await expect(dialog).toContainText('Credentials configured');
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
});

test('expired OIDC cannot enable harnesses; explicit sandbox credentials can', () => {
  const expired = `header.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.signature`;
  const env = { AI_GATEWAY_API_KEY: 'test-key', VERCEL_OIDC_TOKEN: expired };
  expect(getExecutionCapabilities(env)).toEqual({ liveModels: true, codingHarnesses: false, sandbox: false });
  expect(getConnectionSetup(env).sandbox).toBe('expired-or-invalid');
  const explicit = { ...env, VERCEL_TOKEN: 'test-token', VERCEL_TEAM_ID: 'team', VERCEL_PROJECT_ID: 'project' };
  expect(getExecutionCapabilities(explicit).codingHarnesses).toBe(true);
  expect(getSandboxOptions(explicit)).toEqual({ token: 'test-token', teamId: 'team', projectId: 'project' });
  expect(JSON.stringify(getConnectionSetup(explicit))).not.toContain('test-token');
});

test('a revision event replaces draft artifacts instead of merging', async ({ page }) => {
  await stream(page, [
    { ...file, workType: 'coding' },
    { type: 'activity', workType: 'coding', message: 'Replacing the draft', resetArtifacts: true },
    { ...file, workType: 'coding', file: 'revised.txt', content: 'Revised' },
    complete,
  ]);
  await start(page);
  await expect(page.locator('.code-scroll')).toContainText('Revised');
  await expect(page.locator('.file-tree')).not.toContainText('hello.txt');
});

test('stopping a run says it stopped and offers a retry', async ({ page }) => {
  await page.unroute('**/api/runs');
  await page.route('**/api/runs', () => { /* never answers: the run stays in flight */ });
  await start(page);
  await page.getByRole('button', { name: 'Stop run', exact: true }).click();
  await expect(page.locator('.live-pill')).toHaveText('Stopped');
  await expect(page.getByRole('button', { name: 'Retry run', exact: true })).toBeEnabled();
});

test('generated files and the mission survive a page reload', async ({ page }) => {
  await stream(page, [file, complete]);
  await start(page, 'Persist me');
  await expect(page.locator('.code-scroll')).toContainText('Hello');
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('.code-scroll')).toContainText('Hello');
  await expect(page.locator('.mission-card h1')).toHaveText('Persist me');
});

test('agent room can be hidden and a workspace cleared', async ({ page }) => {
  await page.getByRole('button', { name: 'Hide agent room' }).click();
  await expect(page.locator('.agent-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Show agent room' }).click();
  await expect(page.locator('.agent-panel')).toBeVisible();
  await stream(page, [file, complete]); await start(page);
  await expect(page.locator('.code-scroll')).toContainText('Hello');
  await page.getByRole('button', { name: 'Clear workspace' }).click();
  await expect(page.locator('.file-tree')).not.toContainText('hello.txt');
  await expect(page.locator('.live-pill')).toHaveText('Idle');
});

test('generated code downloads as a zip archive', async ({ page }) => {
  await stream(page, [file, { ...file, file: 'src/app.ts', content: 'export {}' }, complete]);
  await start(page, 'Zip project');
  await expect(page.locator('.file-tree')).toContainText('app.ts');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download code' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('zip-project.zip');
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  const archive = Buffer.concat(chunks);
  expect(archive.subarray(0, 4).toString('hex')).toBe('504b0304');
  expect(archive.toString('latin1')).toContain('zip-project/src/app.ts');
});

test('a follow-up sends the current result so the team can revise it', async ({ page }) => {
  await stream(page, [file, complete]); await start(page, 'First version');
  await expect(page.locator('.code-scroll')).toContainText('Hello');
  let body: { refine?: { previousMission: string; files?: { path: string; content: string }[] } } = {};
  await page.unroute('**/api/runs');
  await page.route('**/api/runs', (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ id: 'r', at: new Date().toISOString(), ...complete })}\n\n` });
  });
  const buildOn = page.getByRole('button', { name: 'Build on result' });
  await expect(buildOn).toHaveAttribute('aria-pressed', 'false');
  await buildOn.click();
  await expect(buildOn).toHaveAttribute('aria-pressed', 'true');
  await start(page, 'Make it blue');
  await expect(page.locator('.live-pill')).toHaveText('Run complete');
  expect(body.refine?.previousMission).toBe('First version');
  expect(body.refine?.files).toEqual([{ path: 'hello.txt', content: 'Hello' }]);
});

test('follow-up context is validated', async ({ request }) => {
  const response = await request.post('/api/runs', { data: { prompt: 'x', mode: 'live', workType: 'coding', refine: { previousMission: 'y', files: [{ path: '', content: 'z' }] } } });
  expect(response.status()).toBe(400);
});

test('code is highlighted and a changed file can be compared with its previous version', async ({ page }) => {
  await stream(page, [
    { ...file, file: 'app.ts', content: 'const greeting = "hi";\nexport { greeting };' },
    { ...file, file: 'app.ts', content: 'const greeting = "hello";\nexport { greeting };' },
    complete,
  ]);
  await start(page);
  await expect(page.locator('.code-scroll .hljs-keyword').first()).toHaveText('const');
  await page.getByRole('button', { name: 'Show changes' }).click();
  await expect(page.locator('.diff-removed')).toContainText('"hi"');
  await expect(page.locator('.diff-added')).toContainText('"hello"');
});

test('token usage from the run is shown when it completes', async ({ page }) => {
  await stream(page, [{ ...complete, usage: { inputTokens: 12_400, outputTokens: 3_100, calls: 4 } }]);
  await start(page);
  await expect(page.locator('.activity-footer')).toHaveText('12.4k in · 3.1k out · 4 model calls');
});

test('canvas elements can be edited, resized, deleted and restored with undo', async ({ page }) => {
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  const note = page.locator('.canvas-sticky');
  await note.dblclick();
  await page.getByRole('textbox', { name: 'Element text' }).fill('Edited note');
  await page.keyboard.press('Enter');
  await expect(note).toContainText('Edited note');

  const before = (await note.boundingBox())!;
  const handle = (await page.locator('.canvas-resize-handle').boundingBox())!;
  await page.mouse.move(handle.x + 4, handle.y + 4); await page.mouse.down();
  await page.mouse.move(handle.x + 80, handle.y + 60, { steps: 6 }); await page.mouse.up();
  expect((await note.boundingBox())!.width).toBeGreaterThan(before.width + 40);

  await note.focus();
  await page.keyboard.press('Delete');
  await expect(note).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.canvas-sticky')).toContainText('Edited note');

  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG' }).click();
  expect((await downloaded).suggestedFilename()).toBe('design-board.png');
});
