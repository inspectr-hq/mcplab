import type { Meta, StoryObj } from '@storybook/react-vite';
import { screenStory } from '../../screen-story';

const meta = { title: 'Screens/Execution/Compare Evaluations/Result Details' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const path =
  '/compare/results?left=20261123-085348-013&right=20261123-085348-013';
export const Populated: Story = screenStory(path, true);
export const Empty: Story = screenStory(path, false);
