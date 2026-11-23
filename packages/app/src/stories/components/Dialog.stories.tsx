import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';

const meta = { title: 'Components/Dialogs', parameters: { layout: 'centered' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ConfirmDelete: Story = {
  render: () => (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete evaluation?</DialogTitle>
          <DialogDescription>
            This removes the selected evaluation from the workspace.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button variant="destructive">Delete evaluation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
};
