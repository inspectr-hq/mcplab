import type { Meta, StoryObj } from '@storybook/react-vite';
import { screenStory } from '../../screen-story';

const meta = { title: 'Screens/Libraries/Test Cases' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = screenStory('/libraries/test-cases', true);
export const Empty: Story = screenStory('/libraries/test-cases', false);
