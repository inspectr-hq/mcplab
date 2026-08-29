import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PasswordInput } from './password-input';

describe('PasswordInput', () => {
  it('toggles between hidden and visible value', () => {
    render(<PasswordInput aria-label="Client secret" defaultValue="secret-value" />);

    const input = screen.getByLabelText('Client secret');
    const toggle = screen.getByRole('button', { name: 'Show value' });
    expect(input).toHaveAttribute('type', 'password');

    fireEvent.click(toggle);

    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide value' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide value' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('disables the toggle when the input is disabled', () => {
    render(<PasswordInput aria-label="Secret" value="secret-value" disabled readOnly />);

    expect(screen.getByRole('button', { name: 'Show value' })).toBeDisabled();
  });
});
