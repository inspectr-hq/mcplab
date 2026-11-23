import type { Meta, StoryObj } from '@storybook/react-vite';
import { screenStory } from '../../screen-story';

const meta = { title: 'Screens/Execution/Evaluation Results/Result Detail' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = screenStory('/results/20261123-085348-013', true);
export const Empty: Story = screenStory('/results/20261123-085348-013', false);
