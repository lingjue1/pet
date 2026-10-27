import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PastureWorld } from '../src/world.ts';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const summary = {
  coin: 1234,
  farm_name: '白云',
  animal_slot: 8,
  history_coin: 5000,
  animals: [
    {
      node: '/root/Main/Managers/AnimalM/DogK',
      name: '柯基',
      code_name: 'dogk',
      type_id: 1,
      rare: 2,
      is_adult: true,
      hunger: 12,
      health: 90,
      is_sick: false,
      rect: [10, 20, 30, 40],
    },
  ],
};

class FakeBridge {
  async isGameRunning(): Promise<boolean> {
    return true;
  }

  async send(cmd: string): Promise<any> {
    if (cmd === 'summary') return summary;
    if (cmd === 'pet') return { ok: true, name: '柯基' };
    throw new Error(`unexpected ${cmd}`);
  }
}

async function world(): Promise<PastureWorld> {
  const dataDir = await mkdtemp(join(tmpdir(), 'pasture-world-'));
  dirs.push(dataDir);
  return new PastureWorld({
    cfg: {
      reserveCoins: 100,
      dailyBudget: 500,
      dailyBudgetPercent: 70,
      autoCare: false,
      digestEnabled: false,
    },
    dataDir,
    bridge: new FakeBridge(),
  });
}

describe('PastureWorld', () => {
  it('statusText 报告金币与动物状态', async () => {
    const text = await (await world()).statusText();
    expect(text).toContain('白云');
    expect(text).toContain('金币 1234');
    expect(text).toContain('柯基');
    expect(text).toContain('饥饿 12/100');
    expect(text).toContain('稀有度 2');
  });

  it('pet 走 bridge 并返回名字', async () => {
    expect(await (await world()).pet(-1)).toContain('柯基');
  });

  it('tools() 暴露 13 个工具', async () => {
    const tools = await (await world()).tools();
    expect(tools).toHaveLength(13);
    expect(tools.map((t: any) => t.name)).toContain('pasture_trim');
  });

  it('envPromptVars 报预算与开关', async () => {
    const vars = await (await world()).envPromptVars();
    expect(vars.pasture_budget).toBe('500');
    expect(vars.pasture_allow_buy).toBe('不允许');
  });

  it('webUi 声明控制台面板并响应状态/开关', async () => {
    const w = await world();
    await w.poll();
    const ui = w.webUi('zh');
    expect(ui.panels?.map((p: any) => p.id)).toContain('dashboard');
    const state = await ui.invoke!('dashboard', 'state', []);
    expect((state as any).coin).toBe(1234);
    const toggled = await ui.invoke!('dashboard', 'action', ['auto', { enabled: false }]);
    expect((toggled as any).ok).toBe(true);
    expect((await ui.invoke!('dashboard', 'state', []) as any).autoCare).toBe(false);
  });
});
