import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const cliVersion = (JSON.parse(
  readFileSync(new URL('../../../cli/package.json', import.meta.url), 'utf8')
) as { version: string }).version;

const screens = [
  'screens-home-dashboard--populated',
  'screens-lab-mcp-evaluations--populated',
  'screens-lab-config-editor--populated',
  'screens-libraries-test-cases--populated',
  'screens-execution-run-evaluation--populated',
  'screens-execution-run-evaluation--running-queue',
  'screens-execution-evaluation-results--populated',
  'screens-execution-evaluation-results-result-detail--populated',
  'screens-execution-compare-evaluations--populated',
  'screens-execution-compare-evaluations-result-details--populated'
];
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 }
];
const themes = ['light', 'dark'] as const;

async function waitForStableCharts(page: Page) {
  const marks = page.locator('.recharts-curve, .recharts-sector, .recharts-dot');
  if (!(await marks.count())) return;

  let previous = '';
  await expect
    .poll(
      async () => {
        const current = (await marks.evaluateAll((items) =>
          items
            .map((item) =>
              ['d', 'cx', 'cy', 'r'].map((attribute) => item.getAttribute(attribute)).join(',')
            )
            .join('|')
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
        await page.clock.setFixedTime(new Date('2026-11-23T10:30:00Z'));
        await page.goto(`/iframe.html?id=${screen}&viewMode=story&globals=theme:${theme}`);
        await expect(page.locator('#storybook-root').getByRole('heading').first()).toBeVisible();
        await expect(page.getByText('connected', { exact: true })).toBeVisible();
        if (viewport.name === 'desktop') {
          await expect(page.getByText(`v${cliVersion}`, { exact: true })).toBeVisible();
        }
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
          screen.includes('dashboard') ||
          screen.includes('evaluation-results') ||
          screen.includes('compare-evaluations--populated')
        ) {
          await expect(page.getByText('Weather MCP Evaluation').first()).toBeVisible();
        }
        if (screen === 'screens-home-dashboard--populated') {
          const recentRunsTable = page
            .getByRole('heading', { name: 'Recent Runs' })
            .locator('xpath=following::table[1]');
          await expect(recentRunsTable.locator('tbody tr')).toHaveCount(10);
          await expect(
            recentRunsTable.getByRole('row').filter({ hasText: 'Weather MCP Evaluation' })
          ).toHaveCount(10);
        }
        if (screen === 'screens-lab-config-editor--populated') {
          await page.getByRole('tab', { name: 'Agents' }).click();
          await expect(page.getByText('Claude Haiku 5.5', { exact: true })).toBeVisible();
          await page.getByRole('tab', { name: 'Scenarios' }).click();
        }
        if (screen.includes('test-cases')) {
          await expect(page.getByText('Check Weather').first()).toBeVisible();
          await expect(page.getByText('Get current weather for London').first()).toBeVisible();
          await expect(page.getByText('Weather MCP').first()).toBeVisible();
        }
        if (screen.includes('result-detail') || screen.includes('result-details')) {
          await expect(page.getByText('20261123-085348-013').first()).toBeVisible();
        }
        if (screen === 'screens-execution-evaluation-results--populated') {
          await expect(page.getByText('100.0%', { exact: true }).first()).toBeVisible();
          await expect(page.getByText('Showing 1-5 of 5')).toBeVisible();
          const resultsTable = page.getByRole('table').first();
          await expect(
            resultsTable.getByRole('row').filter({ hasText: 'Weather MCP Evaluation' })
          ).toHaveCount(5);
          const suiteRow = page.getByRole('row').filter({ hasText: 'weather-suite-run-001' });
          await expect(suiteRow).toContainText('3 scenarios · 1 agent · 1 MCP');
        }
        if (screen === 'screens-execution-run-evaluation--running-queue') {
          await expect(page.getByText('1/3 scenario-agent runs complete')).toBeVisible();
        }
        if (screen === 'screens-execution-evaluation-results-result-detail--populated') {
          await expect(page.getByText('100%', { exact: true }).first()).toBeVisible();
        }
        if (
          screen === 'screens-execution-evaluation-results--populated' ||
          screen === 'screens-execution-evaluation-results-result-detail--populated'
        ) {
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
