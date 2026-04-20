#!/usr/bin/env node
import { Command } from 'commander';

import { registerClientsCommand } from './commands/clients.js';
import { registerScanCommand } from './commands/scan.js';
import { registerServersCommand } from './commands/servers.js';
import { registerTopCommand } from './commands/top.js';

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
registerTopCommand(program);
registerServersCommand(program);
registerClientsCommand(program);

program.parseAsync().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
