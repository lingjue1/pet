import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dryMountWorld } from 'cortico/extensions/dry-mount.ts';
import { pastureDefinition } from '../src/definition.ts';
import { PASTURE_DEFAULTS } from '../src/config.ts';

describe('pasture definition', () => {
  it('id 与契约字段', () => {
    expect(pastureDefinition.id).toBe('pasture');
    expect(pastureDefinition.label).toBe('牧场');
  });

  it('默认配置保守：花钱、卖动物、PowerShell 都默认关闭', () => {
    const cfg = pastureDefinition.defaults!();
    expect(cfg.enabled).toBe(false);
    expect(cfg.allowBuy).toBe(false);
    expect(cfg.autoBuy).toBe(false);
    expect(cfg.autoTrim).toBe(false);
    expect(cfg.rerollLowStar).toBe(false);
    expect(cfg.autoNewPasture).toBe(false);
    expect(cfg.cursorRestore).toBe(false);
    expect(cfg).toEqual(PASTURE_DEFAULTS);
  });

  it('自描述包含全部 13 个工具', () => {
    const names = pastureDefinition.describe!.tools.map((t) => t.name);
    expect(names).toHaveLength(13);
    expect(new Set(names).size).toBe(13);
    expect(names).toContain('pasture_status');
    expect(names).toContain('pasture_trim');
    expect(names).toContain('pasture_log');
  });

  it('自描述包含全部事件', () => {
    const types = pastureDefinition.describe!.events.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'pasture.hungry',
        'pasture.sick',
        'pasture.care',
        'pasture.newAnimal',
        'pasture.digest',
        'pasture.slotOffer',
      ]),
    );
  });

  it('通过 Cortico dry mount（默认配置、工具名、面板、WebUI 产物声明）', async () => {
    const scratchDir = await mkdtemp(join(tmpdir(), 'pasture-dry-mount-'));
    try {
      const report = await dryMountWorld(pastureDefinition as any, {
        scratchDir,
        packageDir: process.cwd(),
        hasWebUiClient: true,
      });
      expect(report.failures).toEqual([]);
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  });
});
