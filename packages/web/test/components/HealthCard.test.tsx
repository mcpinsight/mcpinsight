import type { ServerHealth } from '@mcpinsight/core/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HealthCard } from '@/components/shared/HealthCard';

const baseComponents: NonNullable<ServerHealth['components']> = {
  activation: 1,
  successRate: 0.95,
  toolUtil: 0.8,
  clarity: 1,
  tokenEff: 0.85,
};

describe('HealthCard', () => {
  it('shows skeletons when health is undefined (loading)', () => {
    render(<HealthCard health={undefined} daysOfHistory={null} totalCalls={0} />);
    expect(screen.getByTestId('health-card')).toBeInTheDocument();
    expect(screen.queryByTestId('insufficient-data')).toBeNull();
    expect(screen.queryByTestId('health-factors')).toBeNull();
  });

  it('renders the numeric score and five factor bars when data is sufficient', () => {
    const health: ServerHealth = {
      server_name: 'filesystem',
      score: 82,
      components: baseComponents,
      is_essential: true,
    };
    render(<HealthCard health={health} daysOfHistory={30} totalCalls={120} />);
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByTestId('health-factors')).toBeInTheDocument();
    expect(screen.getByTestId('essential-badge')).toBeInTheDocument();
    // All five factor bars rendered
    expect(screen.getByTestId('factor-bar-activation')).toBeInTheDocument();
    expect(screen.getByTestId('factor-bar-success-rate')).toBeInTheDocument();
    expect(screen.getByTestId('factor-bar-tool-use')).toBeInTheDocument();
    expect(screen.getByTestId('factor-bar-clarity')).toBeInTheDocument();
    expect(screen.getByTestId('factor-bar-token-efficiency')).toBeInTheDocument();
  });

  it('renders insufficient-data body with pluralized counts', () => {
    const health: ServerHealth = {
      server_name: 'filesystem',
      score: null,
      components: null,
      is_essential: false,
      insufficient_data_reason: 'too_recent',
    };
    render(<HealthCard health={health} daysOfHistory={2} totalCalls={3} />);
    expect(screen.getByTestId('insufficient-data')).toBeInTheDocument();
    // Contains actual counts the user has, pluralized
    expect(screen.getByText(/2 days/)).toBeInTheDocument();
    expect(screen.getByText(/3 calls/)).toBeInTheDocument();
    // Reason-specific hint
    expect(screen.getByText(/Too early/i)).toBeInTheDocument();
    // Essential pill not shown when is_essential=false
    expect(screen.queryByTestId('essential-badge')).toBeNull();
  });

  it('uses singular day/call labels when counts are 1', () => {
    const health: ServerHealth = {
      server_name: 'filesystem',
      score: null,
      components: null,
      is_essential: false,
      insufficient_data_reason: 'too_few_calls',
    };
    render(<HealthCard health={health} daysOfHistory={1} totalCalls={1} />);
    expect(screen.getByText(/1 day and 1 call/)).toBeInTheDocument();
    // too_few_calls reason hint differs from too_recent
    expect(screen.getByText(/Run more sessions/i)).toBeInTheDocument();
  });

  it('essential pill is shown even when the score is null', () => {
    const health: ServerHealth = {
      server_name: 'filesystem',
      score: null,
      components: null,
      is_essential: true,
      insufficient_data_reason: 'too_recent',
    };
    render(<HealthCard health={health} daysOfHistory={2} totalCalls={5} />);
    expect(screen.getByTestId('essential-badge')).toBeInTheDocument();
  });
});
