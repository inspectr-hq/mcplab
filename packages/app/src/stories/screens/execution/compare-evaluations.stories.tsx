import type { Meta, StoryObj } from '@storybook/react-vite';
import { screenStory } from '../../screen-story';

const meta = { title: 'Screens/Execution/Compare Evaluations' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = screenStory('/compare', true);
export const Empty: Story = screenStory('/compare', false);
