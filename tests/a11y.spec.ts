import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/providers', (route) => route.fulfill({ json: {
    providers: [{ configured: true }],
    capabilities: { liveModels: true, codingHarnesses: true, sandbox: true },
    setup: { gateway: 'configured', sandbox: 'configured', message: 'Credentials configured; access checked on run.' },
  } }));
  await page.goto('/');
});

for (const workspace of ['Coding', 'Design', 'Research']) {
  test(`${workspace} workspace has no serious accessibility violations`, async ({ page }) => {
    await page.locator('.work-type-tabs button', { hasText: workspace }).click();
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations
      .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
      .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
    expect(serious).toEqual([]);
  });
}

test('canvas elements can be moved with the keyboard', async ({ page }) => {
  await page.locator('.work-type-tabs button', { hasText: 'Design' }).click();
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  const note = page.locator('.canvas-sticky');
  const before = (await note.boundingBox())!;
  await note.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await note.boundingBox())!.x).toBeGreaterThan(before.x + 10);
});

test('the latest activity is announced to screen readers', async ({ page }) => {
  await page.unroute('**/api/runs');
  await page.route('**/api/runs', (route) => route.fulfill({
    contentType: 'text/event-stream',
    body: `data: ${JSON.stringify({ id: '1', at: new Date().toISOString(), type: 'complete', message: 'Finished', progress: 100 })}\n\n`,
  }));
  await page.getByRole('textbox').fill('Task');
  await page.getByRole('button', { name: 'Start team run', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Collaboragent: Finished' })).toBeAttached();
  await expect(page.getByRole('progressbar', { name: 'Run progress' })).toHaveAttribute('aria-valuenow', '100');
});
