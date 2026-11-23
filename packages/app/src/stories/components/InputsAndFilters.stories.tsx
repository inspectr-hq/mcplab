import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SearchInput } from '@/components/SearchInput';
import { PasswordInput } from '@/components/ui/password-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StorySection } from '../fixtures';

const meta = {
  title: 'Components/Inputs and filters',
  parameters: { layout: 'padded' }
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function SearchFilterStory() {
  const [value, setValue] = useState('support');
  return (
    <StorySection>
      <Label htmlFor="story-search">Filter results</Label>
      <SearchInput value={value} onValueChange={setValue} placeholder="Search results" />
    </StorySection>
  );
}

export const SearchFilter: Story = { render: () => <SearchFilterStory /> };

export const TextAndPassword: Story = {
  render: () => (
    <StorySection>
      <div className="grid max-w-sm gap-4">
        <div className="grid gap-2">
          <Label htmlFor="story-input">Workspace name</Label>
          <Input id="story-input" defaultValue="Support evaluation" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="story-password">API key</Label>
          <PasswordInput id="story-password" defaultValue="sk-story-fixture" />
        </div>
      </div>
    </StorySection>
  )
};
