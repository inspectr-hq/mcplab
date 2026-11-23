import type { Meta, StoryObj } from '@storybook/react-vite';
import { screenStory } from '../../screen-story';

const meta = { title: 'Screens/Execution/Run Evaluation' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = screenStory('/run', true);
export const Empty: Story = screenStory('/run', false);
export const RunningQueue: Story = screenStory('/run', true, true);
