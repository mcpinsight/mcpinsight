import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TimeseriesPoint } from '@/api/client';
import { CallsTimeseriesChart } from '@/components/shared/CallsTimeseriesChart';

describe('CallsTimeseriesChart', () => {
  it('renders an empty-state placeholder when no points are supplied', () => {
    render(<CallsTimeseriesChart points={[]} />);
    expect(screen.queryByTestId('timeseries-chart')).toBeNull();
    expect(screen.getByRole('img')).toHaveAccessibleName(/no calls/i);
  });

  it('renders a chart with dots for each day when points are supplied', () => {
    const points: TimeseriesPoint[] = [
      { day: '2026-04-20', calls: 12, errors: 0, input_tokens: 100, output_tokens: 200 },
      { day: '2026-04-21', calls: 30, errors: 1, input_tokens: 250, output_tokens: 500 },
      { day: '2026-04-22', calls: 8, errors: 0, input_tokens: 50, output_tokens: 100 },
    ];
    render(<CallsTimeseriesChart points={points} />);
    const chart = screen.getByTestId('timeseries-chart');
    expect(chart).toBeInTheDocument();
    const circles = chart.querySelectorAll('circle');
    expect(circles).toHaveLength(3);
    // Aria-label includes the date range for screen readers
    expect(chart).toHaveAccessibleName(/2026-04-20.*2026-04-22/);
  });

  it('handles a single point without dividing by zero', () => {
    const points: TimeseriesPoint[] = [
      { day: '2026-04-20', calls: 5, errors: 0, input_tokens: 100, output_tokens: 200 },
    ];
    const { container } = render(<CallsTimeseriesChart points={points} />);
    expect(container.querySelectorAll('circle')).toHaveLength(1);
  });
});
