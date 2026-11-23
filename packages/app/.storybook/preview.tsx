import type { Preview } from '@storybook/react-vite';
import { ThemeWrapper } from './ThemeWrapper';
import '../src/index.css';

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Color theme',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: ['light', 'dark'],
        dynamicTitle: true
      }
    }
  },
  initialGlobals: { theme: 'light' },
  decorators: [
    (Story, context) => (
      <ThemeWrapper theme={context.globals.theme}>
        <Story />
      </ThemeWrapper>
    )
  ],
  parameters: { layout: 'fullscreen' }
};

export default preview;
