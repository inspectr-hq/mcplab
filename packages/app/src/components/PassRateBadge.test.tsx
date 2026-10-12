import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PassRateBadge } from './PassRateBadge';

it('distinguishes nothing evaluated from a zero pass rate', () => {
  render(
    <>
      <PassRateBadge rate={null} />
      <PassRateBadge rate={0} />
    </>
  );
  expect(screen.getByText('–')).not.toHaveClass('bg-destructive/15');
  expect(screen.getByText('0%')).toHaveClass('bg-destructive/15');
});
