import { spawn } from 'node:child_process';
import process from 'node:process';

// VibeX 2.0 owns the app root and loads app/main.js directly. The plugin CLI
// now handles build, link, and generation reloads, so no sidecar Vite server
// is needed for plugin development.
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(command, ['vibex-plugin', 'dev'], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

const stop = (signal) => {
  if (!child.killed) child.kill(signal);
};

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
