import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouteTree } from './App';
import { NavLink } from '@/components/NavLink';

vi.mock('@/components/AppLayout', () => ({
  AppLayout: () => <Outlet />
}));

function MockManageTestCases() {
  const { testCaseId } = useParams<{ testCaseId?: string }>();
  const location = useLocation();
  return (
    <div>
      <output data-testid="route-path">{location.pathname}</output>
      <output data-testid="test-case-id">{testCaseId ?? ''}</output>
    </div>
  );
}

vi.mock('./pages/ManageTestCases', () => ({ default: MockManageTestCases }));

function MockResults() {
  const [searchParams] = useSearchParams();
  return <output data-testid="scenario-query">{searchParams.get('scenario') ?? ''}</output>;
}

vi.mock('./pages/Results', () => ({ default: MockResults }));

describe('App route tree compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects the legacy scenarios index to the test-case index', () => {
    render(
      <MemoryRouter initialEntries={['/libraries/scenarios']}>
        <AppRouteTree />
      </MemoryRouter>
    );

    expect(screen.getByTestId('route-path')).toHaveTextContent('/libraries/test-cases');
    expect(screen.getByTestId('test-case-id')).toHaveTextContent('');
  });

  it('redirects a legacy scenario URL and exposes the decoded test-case param', () => {
    render(
      <MemoryRouter initialEntries={['/libraries/scenarios/legacy%2Fscenario']}>
        <AppRouteTree />
      </MemoryRouter>
    );

    expect(screen.getByTestId('route-path')).toHaveTextContent(
      '/libraries/test-cases/legacy%2Fscenario'
    );
    expect(screen.getByTestId('test-case-id')).toHaveTextContent('legacy/scenario');
  });

  it('reads query parameters through the routed page', () => {
    render(
      <MemoryRouter initialEntries={['/results?scenario=scenario-42&agent=claude']}>
        <AppRouteTree />
      </MemoryRouter>
    );

    expect(screen.getByTestId('scenario-query')).toHaveTextContent('scenario-42');
  });

  it('preserves encoded backslashes and navigates to an internal route', () => {
    const decodedId = '\\evil.example\\path';
    const encodedId = '%5Cevil.example%5Cpath';
    expect(encodeURIComponent(decodedId)).toBe(encodedId);

    render(
      <MemoryRouter initialEntries={['/libraries/test-cases']}>
        <NavLink to={`/libraries/test-cases/${encodedId}`}>Open encoded test case</NavLink>
        <AppRouteTree />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: 'Open encoded test case' });
    const expectedPath = `/libraries/test-cases/${encodedId}`;
    expect(link).toHaveAttribute('href', expectedPath);

    const resolvedLink = new URL((link as HTMLAnchorElement).href);
    expect(resolvedLink.origin).toBe(window.location.origin);
    expect(resolvedLink.pathname).toBe(expectedPath);

    fireEvent.click(link);

    expect(screen.getByTestId('route-path')).toHaveTextContent(expectedPath);
    expect(screen.getByTestId('test-case-id')).toHaveTextContent(decodedId);
  });
});
