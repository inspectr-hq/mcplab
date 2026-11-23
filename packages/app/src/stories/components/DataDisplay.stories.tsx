import type { Meta, StoryObj } from '@storybook/react-vite';
import { Activity } from 'lucide-react';
import { PassRateBadge } from '@/components/PassRateBadge';
import { ProviderBadge } from '@/components/ProviderBadge';
import { StatCard } from '@/components/StatCard';
import { StorySection } from '../fixtures';

const meta = { title: 'Components/Data display', parameters: { layout: 'padded' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const EvaluationSummary: Story = {
  render: () => (
    <StorySection>
      <div className="grid max-w-xl gap-4 sm:grid-cols-2">
        <StatCard
          title="Evaluations"
          value={12}
          subtitle="2 this week"
          icon={Activity}
          trend="up"
        />
        <div className="flex items-center gap-3">
          <PassRateBadge rate={1} />
          <PassRateBadge rate={0.62} />
          <PassRateBadge rate={null} />
          <ProviderBadge provider="openai" />
        </div>
      </div>
    </StorySection>
  )
};
