import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CLIENT_IDS } from '@mcpinsight/core/types';

import { ClientFilter } from '@/components/shared/ClientFilter';

describe('ClientFilter', () => {
  it('renders a trigger showing the current value', () => {
    render(<ClientFilter value="all" onChange={() => {}} />);
    expect(screen.getByLabelText('Client filter')).toHaveTextContent('All clients');
  });

  it('exposes every CLIENT_IDS entry plus "all" when opened', async () => {
    const user = userEvent.setup();
    render(<ClientFilter value="all" onChange={() => {}} />);
    await user.click(screen.getByLabelText('Client filter'));
    expect(screen.getByRole('option', { name: 'All clients' })).toBeInTheDocument();
    for (const id of CLIENT_IDS) {
      expect(screen.getByRole('option', { name: id })).toBeInTheDocument();
    }
  });

  it('calls onChange with the selected client id', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ClientFilter value="all" onChange={onChange} />);
    await user.click(screen.getByLabelText('Client filter'));
    await user.click(screen.getByRole('option', { name: 'codex' }));
    expect(onChange).toHaveBeenCalledWith('codex');
  });
});
