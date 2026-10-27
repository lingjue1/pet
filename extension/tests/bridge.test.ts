import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Bridge } from '../src/bridge.ts';

const dirs: string[] = [];

async function tempBridge(): Promise<{ dir: string; bridge: Bridge }> {
  const dir = await mkdtemp(join(tmpdir(), 'pasture-bridge-'));
  dirs.push(dir);
  return { dir, bridge: new Bridge(dir) };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('Bridge', () => {
  it('没有 heartbeat 时判定游戏没运行', async () => {
    const { bridge } = await tempBridge();
    expect(await bridge.isGameRunning()).toBe(false);
  });

  it('heartbeat 新鲜时判定游戏在运行', async () => {
    const { dir, bridge } = await tempBridge();
    const hb = join(dir, 'heartbeat.json');
    await writeFile(hb, '{}', 'utf8');
    expect(await bridge.isGameRunning(15_000)).toBe(true);
    const old = new Date(Date.now() - 60_000);
    await utimes(hb, old, old);
    expect(await bridge.isGameRunning(15_000)).toBe(false);
  });

  it('写到 cmd.json 并等待匹配 id 的 result.json', async () => {
    const { dir, bridge } = await tempBridge();
    const timer = setInterval(async () => {
      try {
        const cmd = JSON.parse(await readFile(join(dir, 'cmd.json'), 'utf8'));
        if (cmd.cmd === 'ping') {
          await writeFile(
            join(dir, 'result.json'),
            JSON.stringify({ id: cmd.id, ok: true, pong: 1 }),
            'utf8',
          );
        }
      } catch {
        // cmd.json 还没写好
      }
    }, 20);
    try {
      const result = await bridge.send('ping', { x: 1 }, 2000);
      expect(result.ok).toBe(true);
      expect(result.pong).toBe(1);
    } finally {
      clearInterval(timer);
    }
  });

  it('超时后拒绝并清掉自己的 cmd.json', async () => {
    const { dir, bridge } = await tempBridge();
    await expect(bridge.send('slow', {}, 300)).rejects.toThrow(/没有响应/);
    await expect(readFile(join(dir, 'cmd.json'), 'utf8')).rejects.toThrow();
  });
});
