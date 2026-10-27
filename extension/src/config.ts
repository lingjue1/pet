/** `config.json` 的 `worlds.pasture` 段。默认值偏保守：花钱和卖动物默认关闭。 */
import type { ConfigGroup } from 'cortico/core/types.ts';

export interface PastureConfig {
  enabled: boolean;
  /** 留空时用 `%APPDATA%\TinyPasture\bridge`。 */
  bridgeDir: string;
  pollSeconds: number;
  dailyBudget: number;
  dailyBudgetPercent: number;
  reserveCoins: number;
  confirmOver: number;
  allowBuy: boolean;
  autoCare: boolean;
  careIntervalSeconds: number;
  autoFeedMax: number;
  autoFeedThreshold: number;
  autoPet: boolean;
  autoBuy: boolean;
  autoBuyTypeId: number | null;
  maxPerSpecies: number;
  autoTrim: boolean;
  rerollLowStar: boolean;
  autoNewPasture: boolean;
  digestEnabled: boolean;
  digestIntervalSeconds: number;
  digestMaxChars: number;
  hungerThreshold: number;
  /** 喂食后是否用 PowerShell 还原鼠标；默认关闭，不启动外部进程。 */
  cursorRestore: boolean;
}

export const PASTURE_DEFAULTS: PastureConfig = {
  enabled: false,
  bridgeDir: '',
  pollSeconds: 30,
  dailyBudget: 500,
  dailyBudgetPercent: 70,
  reserveCoins: 200,
  confirmOver: 300,
  allowBuy: false,
  autoCare: true,
  careIntervalSeconds: 360,
  autoFeedMax: 3,
  autoFeedThreshold: 30,
  autoPet: true,
  autoBuy: false,
  autoBuyTypeId: null,
  maxPerSpecies: 2,
  autoTrim: false,
  rerollLowStar: false,
  autoNewPasture: false,
  digestEnabled: true,
  digestIntervalSeconds: 3600,
  digestMaxChars: 500,
  hungerThreshold: 30,
  cursorRestore: false,
};

export const PASTURE_CONFIG_GROUP: ConfigGroup = {
  id: 'world:pasture',
  owner: 'world:pasture',
  schema: {
    type: 'object',
    title: '牧场',
    properties: {
      'worlds.pasture.pollSeconds': {
        type: 'number',
        title: '状态刷新间隔（秒）',
        minimum: 5,
        'x-hot': true,
      },
      'worlds.pasture.dailyBudgetPercent': {
        type: 'number',
        title: '每日预算（当前金币的百分比）',
        minimum: 0,
        maximum: 100,
        'x-hot': true,
      },
      'worlds.pasture.reserveCoins': {
        type: 'number',
        title: '保留金币',
        minimum: 0,
        'x-hot': true,
      },
      'worlds.pasture.allowBuy': {
        type: 'boolean',
        title: '允许花金币买东西',
        'x-hot': true,
      },
      'worlds.pasture.autoCare': {
        type: 'boolean',
        title: '自动巡视',
        'x-hot': true,
      },
      'worlds.pasture.careIntervalSeconds': {
        type: 'number',
        title: '自动巡视间隔（秒）',
        minimum: 10,
        'x-hot': true,
      },
      'worlds.pasture.autoFeedMax': {
        type: 'number',
        title: '每轮最多喂几只',
        minimum: 0,
        maximum: 5,
        'x-hot': true,
      },
      'worlds.pasture.autoBuy': {
        type: 'boolean',
        title: '自动买动物',
        'x-hot': true,
      },
      'worlds.pasture.autoBuyTypeId': {
        type: 'number',
        title: '自动买指定物种 type_id（留空则按策略选）',
        'x-hot': true,
      },
      'worlds.pasture.maxPerSpecies': {
        type: 'number',
        title: '每种动物最多保留几只',
        minimum: 1,
        'x-hot': true,
      },
      'worlds.pasture.autoTrim': {
        type: 'boolean',
        title: '自动卖掉超量/低星动物',
        'x-hot': true,
      },
      'worlds.pasture.rerollLowStar': {
        type: 'boolean',
        title: '同种 2 只低星时全卖重刷',
        'x-hot': true,
      },
      'worlds.pasture.autoNewPasture': {
        type: 'boolean',
        title: '自动解锁新牧场/栏位（2 倍询问，4 倍自动）',
        'x-hot': true,
      },
      'worlds.pasture.cursorRestore': {
        type: 'boolean',
        title: '喂食后还原鼠标（会启动 PowerShell）',
        'x-hot': true,
      },
    },
  },
};
