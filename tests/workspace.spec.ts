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
  await expect(page.locator('.live-pill')).toHaveText('Paused');
  await stream(page, [{ type: 'error', message: 'Retry failed' }]);
  await page.getByTitle('Start run', { exact: true }).click();
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
  await expect(page.locator('.live-pill')).toHaveText('Paused');
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
