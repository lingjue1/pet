// @ts-nocheck
/**
 * 与 TinyPastureBridge（游戏内 mod）的本地文件桥。
 *
 * 扩展写 bridge/cmd.json，mod 处理后写 bridge/result.json 并删除 cmd。
 * 只在本机、只走 user://bridge，不经过网络。
 */
import { readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

export function defaultBridgeDir() {
  const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  return join(appData, 'TinyPasture', 'bridge');
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Bridge {
  constructor(dir = defaultBridgeDir()) {
    this.dir = dir;
  }

  async heartbeatAgeMs() {
    try {
      const info = await stat(join(this.dir, 'heartbeat.json'));
      return Date.now() - info.mtimeMs;
    } catch {
      return Infinity;
    }
  }

  async isGameRunning(maxAgeMs = 15000) {
    return (await this.heartbeatAgeMs()) <= maxAgeMs;
  }

  async send(cmd, args = {}, timeoutMs = 8000) {
    const id = randomUUID();
    const payload = { cmd, id, ...args };
    const cmdPath = join(this.dir, 'cmd.json');
    const tmpPath = join(this.dir, `cmd.${id}.tmp`);
    await writeFile(tmpPath, JSON.stringify(payload), 'utf8');
    await rename(tmpPath, cmdPath);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await delay(120);
      try {
        const data = JSON.parse(await readFile(join(this.dir, 'result.json'), 'utf8'));
        if (data.id === id) return data;
      } catch {
        // result.json 还没写好，继续等
      }
    }
    await this.#discard(cmdPath, id);
    throw new Error(`Tiny Pasture 没有响应（${cmd}）`);
  }

  async #discard(cmdPath, id) {
    try {
      const pending = JSON.parse(await readFile(cmdPath, 'utf8'));
      if (pending.id === id) await rm(cmdPath, { force: true });
    } catch {
      // 已经被 mod 消费掉了
    }
  }
}
