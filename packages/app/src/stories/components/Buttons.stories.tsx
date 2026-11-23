import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@/components/ui/button';
import { StorySection } from '../fixtures';

const meta = {
  title: 'Components/Buttons',
  component: Button,
  parameters: { layout: 'padded' }
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  render: () => (
    <StorySection>
      <div className="flex flex-wrap gap-3">
        <Button>Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button disabled>Disabled</Button>
      </div>
    </StorySection>
  )
};
