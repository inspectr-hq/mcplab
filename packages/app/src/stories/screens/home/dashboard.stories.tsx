import type { Meta, StoryObj } from '@storybook/react-vite';
import { screenStory } from '../../screen-story';

const meta = { title: 'Screens/Home/Dashboard' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = screenStory('/', true);
export const Empty: Story = screenStory('/', false);
