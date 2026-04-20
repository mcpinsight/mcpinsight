import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HEALTH_THRESHOLDS, HealthBadge } from '@/components/shared/HealthBadge';
import { TooltipProvider } from '@/components/ui/tooltip';

function renderBadge(props: Parameters<typeof HealthBadge>[0]) {
  return render(
    <TooltipProvider>
      <HealthBadge {...props} />
    </TooltipProvider>,
  );
}

describe('HealthBadge', () => {
  it('shows the numeric score when given one', () => {
    renderBadge({ score: 82 });
    expect(screen.getByTestId('health-badge').textContent).toBe('82');
  });

  it('classifies score >= 70 as healthy', () => {
    renderBadge({ score: HEALTH_THRESHOLDS.healthy });
    expect(screen.getByTestId('health-badge').getAttribute('data-variant')).toBe('healthy');
  });

  it('classifies score in [40, 70) as warning', () => {
    renderBadge({ score: HEALTH_THRESHOLDS.warning });
    expect(screen.getByTestId('health-badge').getAttribute('data-variant')).toBe('warning');
  });

  it('classifies score < 40 as critical', () => {
    renderBadge({ score: HEALTH_THRESHOLDS.warning - 1 });
    expect(screen.getByTestId('health-badge').getAttribute('data-variant')).toBe('critical');
  });

  it('renders "—" with unknown variant when score is null', () => {
    renderBadge({ score: null });
    const badge = screen.getByTestId('health-badge');
    expect(badge.textContent).toBe('—');
    expect(badge.getAttribute('data-variant')).toBe('unknown');
  });

  it('includes the score in the aria-label for sighted tooltip parity', () => {
    renderBadge({ score: 72 });
    const badge = screen.getByTestId('health-badge');
    expect(badge.getAttribute('aria-label')).toContain('72');
  });

  it('flags essential servers in the accessible label', () => {
    renderBadge({ score: 55, isEssential: true });
    const badge = screen.getByTestId('health-badge');
    expect(badge.getAttribute('aria-label')).toContain('essential');
  });

  it('uses insufficient-data copy when score is null', () => {
    renderBadge({ score: null });
    const badge = screen.getByTestId('health-badge');
    expect(badge.getAttribute('aria-label')?.toLowerCase()).toContain('enough data');
  });
});
