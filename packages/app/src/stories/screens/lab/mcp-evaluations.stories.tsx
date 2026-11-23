import type { Meta, StoryObj } from '@storybook/react-vite';
import { screenStory } from '../../screen-story';

const meta = { title: 'Screens/Lab/MCP Evaluations' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = screenStory('/mcp-evaluations', true);
export const Empty: Story = screenStory('/mcp-evaluations', false);
