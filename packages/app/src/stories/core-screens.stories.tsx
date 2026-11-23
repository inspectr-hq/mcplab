import type { Meta, StoryObj } from '@storybook/react-vite';
import { CoreScreenStory } from './fixtures';

const meta = {
  title: 'Screens/Core workflows',
  parameters: { layout: 'fullscreen' }
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const screen = (path: string, populated: boolean): Story => ({
  render: () => <CoreScreenStory path={path} populated={populated} />,
  name: `${
    path === '/'
      ? 'Home'
      : path
          .split('?')[0]
          .split('/')
          .filter(Boolean)
          .join(' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
  } ${populated ? 'Populated' : 'Empty'}`
});

export const HomePopulated = screen('/', true);
export const HomeEmpty = screen('/', false);
export const ConfigurationsPopulated = screen('/mcp-evaluations', true);
export const ConfigurationsEmpty = screen('/mcp-evaluations', false);
export const ConfigEditorPopulated = screen('/mcp-evaluations/config-demo', true);
export const ConfigEditorEmpty = screen('/mcp-evaluations/config-demo', false);
export const RunEvaluationPopulated = screen('/run', true);
export const RunEvaluationEmpty = screen('/run', false);
export const ResultsPopulated = screen('/results', true);
export const ResultsEmpty = screen('/results', false);
export const ResultDetailPopulated = screen('/results/run-demo', true);
export const ResultDetailEmpty = screen('/results/run-demo', false);
export const ComparePopulated = screen('/compare', true);
export const CompareEmpty = screen('/compare', false);
export const CompareResultDetailsPopulated = screen(
  '/compare/results?left=run-demo&right=run-demo',
  true
);
export const CompareResultDetailsEmpty = screen(
  '/compare/results?left=run-demo&right=run-demo',
  false
);
