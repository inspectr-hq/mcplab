import { useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHeightToViewportBottom } from './use-height-to-viewport-bottom';

function Panel({ active = true }: { active?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const height = useHeightToViewportBottom(ref, { active });
  return (
    <div ref={ref} data-testid="panel">
      {height ?? 'auto'}
    </div>
  );
}

function placeAt(top: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top,
    bottom: top,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: top,
    toJSON: () => ({})
  });
}

function screenIsWide(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  } as unknown as MediaQueryList);
}

describe('useHeightToViewportBottom', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reaches from where the element starts to the bottom of the viewport', () => {
    screenIsWide(true);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
    placeAt(180);
    render(<Panel />);
    expect(screen.getByTestId('panel')).toHaveTextContent('796');
  });

  it('follows the window size and keeps a usable minimum below tall content', () => {
    screenIsWide(true);
    const innerHeight = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
    placeAt(700);
    render(<Panel />);
    expect(screen.getByTestId('panel')).toHaveTextContent('448');
    placeAt(100);
    innerHeight.mockReturnValue(900);
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(screen.getByTestId('panel')).toHaveTextContent('776');
  });

  it('leaves the height to CSS when inactive or on narrow screens', () => {
    render(<Panel active={false} />);
    expect(screen.getByTestId('panel')).toHaveTextContent('auto');
    screenIsWide(false);
    render(<Panel />);
    expect(screen.getAllByTestId('panel')[1]).toHaveTextContent('auto');
  });
});
