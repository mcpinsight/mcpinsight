#!/usr/bin/env node
import { Command } from 'commander';

import { registerScanCommand } from './commands/scan.js';

const program = new Command();

program
  .name('mcpinsight')
  .description('Analytics for MCP servers in Claude Code, Codex, and Cursor.')
  .version('0.0.0');

program
  .command('hello')
  .description('Smoke test — prints a greeting.')
  .action(() => {
    process.stdout.write('hello from mcpinsight\n');
  });

registerScanCommand(program);

program.parseAsync().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
