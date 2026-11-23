import { expect, test, type Page } from '@playwright/test';

const screens = [
  'screens-core-workflows--home-populated',
  'screens-core-workflows--configurations-populated',
  'screens-core-workflows--config-editor-populated',
  'screens-core-workflows--run-evaluation-populated',
  'screens-core-workflows--results-populated',
  'screens-core-workflows--result-detail-populated',
  'screens-core-workflows--compare-populated',
  'screens-core-workflows--compare-result-details-populated'
];
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 }
];
const themes = ['light', 'dark'] as const;

async function waitForStableCharts(page: Page) {
  const sectors = page.locator('.recharts-sector');
  if (!(await sectors.count())) return;

  let previous = '';
  await expect
    .poll(
      async () => {
        const current = (await sectors.evaluateAll((items) =>
          items.map((item) => item.getAttribute('d')).join('|')
        )) as string;
        const stable = current !== '' && current === previous;
        previous = current;
        return stable;
      },
      { intervals: [100], timeout: 5000 }
    )
    .toBe(true);
}

for (const screen of screens) {
  for (const viewport of viewports) {
    for (const theme of themes) {
      test(`${screen} ${viewport.name} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.clock.setFixedTime(new Date('2026-06-15T10:30:00Z'));
        await page.goto(`/iframe.html?id=${screen}&viewMode=story&globals=theme:${theme}`);
        await expect(page.locator('#storybook-root').getByRole('heading').first()).toBeVisible();
        if (theme === 'dark') {
          const themeRoot = page.locator('html');
          await expect(themeRoot).toHaveClass(/dark/);
          await expect
            .poll(() =>
              themeRoot.evaluate((element) =>
                getComputedStyle(element).getPropertyValue('--background')
              )
            )
            .toContain('222 47% 11%');
        }
        if (
          screen.includes('--home-') ||
          screen.includes('--results-') ||
          screen.includes('--compare-populated')
        ) {
          await expect(page.getByText('Support Assistant Evaluation').first()).toBeVisible();
        }
        if (screen.includes('--result-detail-') || screen.includes('--compare-result-details-')) {
          await expect(page.getByText('run-demo').first()).toBeVisible();
        }
        if (screen.includes('--results-')) {
          await expect(page.getByText('100.0%', { exact: true }).first()).toBeVisible();
        }
        if (screen.includes('--result-detail-')) {
          await expect(page.getByText('100%', { exact: true }).first()).toBeVisible();
        }
        if (screen.includes('--results-') || screen.includes('--result-detail-')) {
          await expect(page.locator('.recharts-sector').first()).toHaveAttribute(
            'fill',
            'hsl(152, 69%, 40%)'
          );
        }
        await page.evaluate(() => document.fonts.ready);
        await waitForStableCharts(page);
        await expect(page).toHaveScreenshot(`${screen}-${viewport.name}-${theme}.png`, {
          fullPage: true,
          animations: 'disabled'
        });
      });
    }
  }
}
