#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('mcpinsight')
  .description('Analytics for MCP servers in Claude Code, Codex, and Cursor.')
  .version('0.0.0');

program
  .command('hello', { isDefault: true })
  .description('Smoke test — prints a greeting.')
  .action(() => {
    process.stdout.write('hello from mcpinsight\n');
  });

program.parse();
