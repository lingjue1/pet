/** World 定义：id、默认配置、工厂与自描述。 */
import type { WorldDefinition } from 'cortico/world.ts';
import type { World } from 'cortico/core/types.ts';
import { PASTURE_DEFAULTS, type PastureConfig } from './config.ts';
import { PastureWorld } from './world.ts';

const SUMMARIES: Record<string, { zh: string; en: string }> = {
  pasture_status: { zh: '查看牧场金币、动物数量与每只动物的饥饿/健康/稀有度。', en: 'Show pasture coins, animals and their hunger/health/rarity.' },
  pasture_pet: { zh: '抚摸一只动物（默认最饿的）。', en: 'Pet an animal (the hungriest by default).' },
  pasture_feed: { zh: '一次投喂多份食物（默认 3 份），按物种选食物并避开左右边缘。', en: 'Feed several foods at once, chosen per species and away from edges.' },
  pasture_shop: { zh: '打开商店页并返回货架目录，分析完自动关闭。', en: 'Open a shop page, list the catalog, then close it.' },
  pasture_buy_food: { zh: '买一种食物喂给最饿的动物，操作完自动关闭。', en: 'Buy a food and feed the hungriest animal, then close the shop.' },
  pasture_buy_animal: { zh: '买一只动物；每种不超过上限，资金充裕时优先最贵，买完自动喂。', en: 'Buy an animal within the per-species cap, preferring the most expensive when rich, then feed it.' },
  pasture_spend: { zh: '查看今日花费、预算、预留金币和还能花多少。', en: 'Show today spend, budget, reserve and remaining coins.' },
  pasture_auto: { zh: '开关自动巡视，调整间隔与每轮最多喂几只。', en: 'Toggle auto care and adjust interval/max feeds.' },
  pasture_sell: { zh: '卖一只 4 星以下成年动物；单只不卖，同种 2 只低星可全卖重刷。', en: 'Sell an adult below 4 stars; never a single one, but a low-star pair may be cleared for a reroll.' },
  pasture_new: { zh: '价格 2 倍时询问、4 倍时自动解锁新牧场/栏位。', en: 'Ask at 2x the slot price and auto-buy at 4x.' },
  pasture_trim: { zh: '清理超量/低星动物，规则与自动巡视一致。', en: 'Trim excess/low-star animals with the same rules as auto care.' },
  pasture_log: { zh: '读取最近的牧场小时报。', en: 'Read recent hourly pasture reports.' },
  pasture_start: { zh: '在开始菜单点「开始游戏」。', en: 'Press Start on the title menu.' },
};

const EVENTS = [
  ['pasture.hungry', '有动物饿了。', 'An animal is hungry.'],
  ['pasture.sick', '有动物生病了。', 'An animal is sick.'],
  ['pasture.care', '自动巡视完成一轮。', 'One auto-care round finished.'],
  ['pasture.newAnimal', '牧场里多了新动物。', 'A new animal joined.'],
  ['pasture.digest', '每小时收获与驯养小结（≤500 字）。', 'Hourly harvest/taming digest (max 500 chars).'],
  ['pasture.slotOffer', '金币达到槽位价格 2 倍时的解锁询问。', 'Ask whether to unlock a slot at 2x its price.'],
] as const;

const TOOL_DECLS = new PastureWorld({ cfg: PASTURE_DEFAULTS, dataDir: '' })
  .tools()
  .map((tool: any) => {
    const { handler: _handler, ...decl } = tool;
    return decl;
  });

export const pastureDefinition: WorldDefinition<PastureConfig> = {
  id: 'pasture',
  label: '牧场',
  defaults: () => ({ ...PASTURE_DEFAULTS }),
  create: (ctx) =>
    new PastureWorld({ cfg: ctx.cfg, dataDir: ctx.dataDir }) as unknown as World,
  describe: {
    tools: TOOL_DECLS.map((tool: any) => ({
      ...tool,
      summary: SUMMARIES[tool.name] ?? { zh: tool.description, en: tool.description },
    })),
    events: EVENTS.map(([type, zh, en]) => ({ type, description: { zh, en } })),
  },
};
