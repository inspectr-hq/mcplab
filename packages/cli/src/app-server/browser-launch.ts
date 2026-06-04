import { spawn } from 'node:child_process';

interface BrowserLaunchDeps {
  platform?: NodeJS.Platform;
  spawn?: typeof spawn;
}

export function startBrowser(url: string, deps: BrowserLaunchDeps = {}): void {
  const platform = deps.platform ?? process.platform;
  const launch = deps.spawn ?? spawn;
  if (platform === 'darwin') {
    launch('open', [url], { stdio: 'ignore', detached: true }).unref();
    return;
  }
  if (platform === 'win32') {
    launch('cmd', ['/c', 'start', url], { stdio: 'ignore', detached: true }).unref();
    return;
  }
  launch('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
}
