import type { Meta, StoryObj } from '@storybook/react-vite';
import { screenStory } from './screen-story';

const meta = { title: 'MCPLab App' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = screenStory('/', true);
