import { describe, expect, it, vi } from 'vitest';
import { startBrowser } from './browser-launch.js';

describe('startBrowser', () => {
  it('uses open on darwin', () => {
    const unref = vi.fn();
    const spawnResult = { unref };
    const spawn = vi.fn(() => spawnResult);

    startBrowser('http://localhost:8787', {
      platform: 'darwin',
      spawn
    });

    expect(spawn).toHaveBeenCalledWith('open', ['http://localhost:8787'], {
      stdio: 'ignore',
      detached: true
    });
    expect(unref).toHaveBeenCalled();
  });

  it('uses cmd /c start on win32', () => {
    const unref = vi.fn();
    const spawnResult = { unref };
    const spawn = vi.fn(() => spawnResult);

    startBrowser('http://localhost:8787', {
      platform: 'win32',
      spawn
    });

    expect(spawn).toHaveBeenCalledWith('cmd', ['/c', 'start', 'http://localhost:8787'], {
      stdio: 'ignore',
      detached: true
    });
    expect(unref).toHaveBeenCalled();
  });

  it('uses xdg-open on other platforms', () => {
    const unref = vi.fn();
    const spawnResult = { unref };
    const spawn = vi.fn(() => spawnResult);

    startBrowser('http://localhost:8787', {
      platform: 'linux',
      spawn
    });

    expect(spawn).toHaveBeenCalledWith('xdg-open', ['http://localhost:8787'], {
      stdio: 'ignore',
      detached: true
    });
    expect(unref).toHaveBeenCalled();
  });
});
