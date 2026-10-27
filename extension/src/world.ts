// @ts-nocheck
/**
 * 牧场 World：读 Tiny Pasture 的状态，并把「喂 / 摸 / 买」翻译成
 * TinyPastureBridge 的命令。所有花钱动作都受每日预算与开关约束。
 */
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Bridge } from './bridge.ts';
import { PASTURE_CONFIG_GROUP } from './config.ts';
import { chooseAnimalCard, findLowStarPair, foodLeft as foodBudget, pickFeedTargets, slotAction } from './policy.ts';

const SHOP_BUTTON = '/root/Main/MainUI/BG/BT_Shop';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class PastureWorld {
  constructor({ cfg, dataDir, bridge = null }: { cfg?: any; dataDir?: any; bridge?: any }) {
    this.cfg = {
      bridgeDir: '',
      pollSeconds: 30,
      dailyBudget: 500,
      reserveCoins: 200,
      confirmOver: 300,
      allowBuy: false,
      hungerThreshold: 30,
      ...cfg,
    };
    this.bridge = bridge ?? new Bridge(this.cfg.bridgeDir || undefined);
    this.host = null;
    this.timer = null;
    this.last = null;
    this.lastSeen = null;
    this.statePath = join(dataDir, 'pasture-state.json');
    this.logPath = join(dataDir, 'pasture-log.jsonl');
    this.digestEnabled = this.cfg.digestEnabled !== false;
    this.digestInterval = Math.max(60, this.cfg.digestIntervalSeconds ?? 3600);
    this.digestMaxChars = Math.min(500, Math.max(100, this.cfg.digestMaxChars ?? 500));
    this.lastDigestAt = Date.now();
    this.digestBaseline = null;
    this.stats = { fed: 0, petted: 0, bought: 0, sold: 0, picked: 0, cleaned: 0 };
    this.autoCare = this.cfg.autoCare !== false;
    this.careInterval = Math.max(10, this.cfg.careIntervalSeconds ?? 360);
    this.autoFeedMax = Math.max(0, this.cfg.autoFeedMax ?? 3);
    this.autoBuy = this.cfg.autoBuy === true;
    this.autoBuyTypeId = Number.isInteger(this.cfg.autoBuyTypeId)
      ? this.cfg.autoBuyTypeId
      : null;
    this.dailyBudgetPercent = Number.isFinite(this.cfg.dailyBudgetPercent)
      ? this.cfg.dailyBudgetPercent
      : 70;
    this.maxPerSpecies = Math.max(1, this.cfg.maxPerSpecies ?? 2);
    this.autoTrim = this.cfg.autoTrim !== false;
    this.rerollLowStar = this.cfg.rerollLowStar !== false;
    this.cursorRestore = this.cfg.cursorRestore === true;
    this.slotAsked = false;
    this.lastCareAt = 0;
    this.caring = false;
  }

  get id() {
    return 'pasture';
  }

  envPromptVars() {
    return {
      pasture_budget: String(this.cfg.dailyBudget),
      pasture_allow_buy: this.cfg.allowBuy ? '允许' : '不允许',
      pasture_hunger_threshold: String(this.cfg.hungerThreshold),
    };
  }

  tools() {
    return [
      {
        name: 'pasture_status',
        description:
          '查看《动物栏：桌面牧场》的实时状态：金币、牧场名、动物数量，以及每只动物的饥饿/健康/稀有度。' +
          '用户问牧场、动物、金币时先用它。',
        tags: ['read'],
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        handler: async () => this.statusText(),
      },
      {
        name: 'pasture_pet',
        description:
          '在牧场里抚摸一只动物（默认摸最饿的那只）。这是无花费的互动，会让动物冒出爱心。',
        tags: ['write'],
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            index: { type: 'integer', description: '第几只（0 开始，按饥饿从低到高）；不填摸最饿的。' },
          },
        },
        handler: async (args) => this.pet(Number.isInteger(args?.index) ? args.index : -1),
      },
      {
        name: 'pasture_feed',
        description:
          '一次投喂多份食物（默认 3 份），按动物种类选食物，最多喂最饿的几只。' +
          '食物会落在避开左右边缘的安全位置；喂食按实时金币，不占每日预算。',
        tags: ['write'],
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            count: { type: 'integer', description: '投喂几份，默认 3，最大 5。' },
          },
        },
        handler: async (args) => this.feed(args?.count ?? 3),
      },
      {
        name: 'pasture_shop',
        description:
          '打开《动物栏：桌面牧场》商店的指定页面（animals 动物 / items 物资 / facility 设施 / decoration 装饰），' +
          '返回货架上的名称、价格、是否解锁，让 Coopanion 自己分析该买什么。分析完会自动关闭界面。',
        tags: ['read', 'write'],
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            page: {
              type: 'string',
              enum: ['animals', 'items', 'facility', 'decoration'],
              default: 'animals',
              description: '要打开并分析的商店页面。',
            },
          },
        },
        handler: async (args) => this.shop(args?.page ?? 'animals'),
      },
      {
        name: 'pasture_buy_food',
        description:
          '打开商店的「物资」页，选中一种食物买下并喂给最饿的动物（默认买最便宜的）。' +
          '喂食按实时金币，不占每日预算；操作完会自动关闭界面。',
        tags: ['write'],
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', description: '食物名，例如「胡萝卜」；不填选最便宜的。' },
            confirm: {
              type: 'boolean',
              description: '金额超过 confirmOver 时，先问用户，得到同意后带 confirm:true 再调用。',
            },
          },
        },
        handler: async (args) => this.buyFood(args?.name, args?.confirm === true),
      },
      {
        name: 'pasture_buy_animal',
        description:
          '用金币在牧场商店买一只动物（打开商店 → 选物种 → 买一只 → 接受）。' +
          '受每日预算与 allowBuy 开关限制；不指定 type_id 时按每种上限与资金策略选，买完自动喂。',
        tags: ['write'],
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type_id: { type: 'integer', description: '物种 type_id；不填选最便宜的。' },
            max_price: { type: 'integer', description: '这一笔最多花多少金币。' },
            confirm: {
              type: 'boolean',
              description: '金额超过 confirmOver 时，先问用户，得到同意后带 confirm:true 再调用。',
            },
          },
        },
        handler: async (args) => this.buyAnimal(args ?? {}),
      },
      {
        name: 'pasture_spend',
        description:
          '查看金币、今日已花、每日预算、预留；喂食按实时金币，每日预算只约束买动物/装饰。',
        tags: ['read'],
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        handler: async () => this.spendReport(),
      },
      {
        name: 'pasture_auto',
        description:
          '开启/关闭自动巡视，并可改间隔与每轮最多喂几只。开启后每轮读取状态，' +
          '自动喂最饿的动物、摸一只，并通过事件告诉用户自己干了什么。',
        tags: ['write'],
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            enabled: { type: 'boolean', description: '是否开启自动巡视。' },
            interval_seconds: { type: 'integer', description: '每轮间隔秒数，最小 10。' },
            max_feed: { type: 'integer', description: '每轮最多喂几只，0 表示不自动喂。' },
            buy_type_id: {
              type: 'integer',
              description: '自动买动物时指定物种 type_id；不填按策略选（资金充裕时优先最贵）。',
            },
          },
        },
        handler: async (args) => this.autoStatus(args ?? {}),
      },
      {
        name: 'pasture_sell',
        description:
          '出售一只 4 星以下的成年动物（4 星及以上保留）。不带 confirm 只列候选；' +
          '用户确认后带 confirm:true 再调用，可以用 name 指定。',
        tags: ['write'],
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', description: '动物名或代号；不填选稀有度最低的。' },
            confirm: { type: 'boolean', description: '确认出售；不带时只列候选，不卖。' },
          },
        },
        handler: async (args) => this.sellAnimal(args?.name, args?.confirm === true),
      },
      {
        name: 'pasture_new',
        description:
          '购买新牧场/动物栏位：金币达到价格 2 倍才考虑；不带 confirm 只报价，' +
          '带 confirm:true 才真正购买。',
        tags: ['write'],
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            confirm: { type: 'boolean', description: '确认购买；不带时只报价。' },
          },
        },
        handler: async (args) => this.newPasture(args?.confirm === true),
      },
      {
        name: 'pasture_trim',
        description:
          '把超过每种 2 只上限的 4 星以下成年动物自动卖掉；' +
          '同种只剩 2 只且都低星时可以全卖重刷，单只不卖。',
        tags: ['write'],
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        handler: async () => {
          const sold = await this.trimExcess();
          return sold.length === 0
            ? '没有需要清理的超量动物。'
            : `清理了 ${sold.length} 只超量动物。`;
        },
      },
      {
        name: 'pasture_log',
        description: '读取最近的牧场小时报（默认 3 份，每份不超过 500 字）。',
        tags: ['read'],
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', description: '读取最近几份，默认 3，最多 20。' },
          },
        },
        handler: async (args) => this.log(args?.limit ?? 3),
      },
      {
        name: 'pasture_start',
        description:
          '如果 Tiny Pasture 停在开始菜单，点一下「开始游戏」。mod 启动时也会自动点一次。',
        tags: ['write'],
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        handler: async () => this.startGame(),
      },
    ];
  }

  webUi(language = 'zh') {
    const online = this.lastSeen !== null;
    const coin = this.last?.coin;
    return {
      label: language === 'en' ? 'Pasture' : '牧场',
      lamps: [
        {
          label: language === 'en' ? 'Tiny Pasture' : '动物栏',
          state: online ? 'online' : 'offline',
          hint: online
            ? language === 'en'
              ? `last seen ${this.lastSeen.toLocaleTimeString()}`
              : `上次读取 ${this.lastSeen.toLocaleTimeString()}`
            : language === 'en'
              ? 'game not running'
              : '游戏没开',
        },
      ],
      badges: [
        {
          label: language === 'en' ? 'coins' : '金币',
          value: coin === undefined ? '—' : String(coin),
          tone: 'plain',
        },
        {
          label: language === 'en' ? 'animals' : '动物',
          value: this.last ? String(this.last.animals.length) : '—',
          tone: 'plain',
        },
      ],
      panels: [
        {
          id: 'dashboard',
          title: language === 'en' ? 'Pasture console' : '牧场控制台',
          description:
            language === 'en'
              ? 'Read state and trigger feed/pet/trim/buy/auto-care.'
              : '查看状态，并直接喂食、抚摸、清理、购买、开关自动巡视。',
        },
      ],
      invoke: (panel, method, args) => this.#invokePanel(panel, method, args, language),
      config: [PASTURE_CONFIG_GROUP],
    };
  }

  async #invokePanel(panel, method, args, language) {
    if (panel !== 'dashboard') throw new Error(`unknown panel: ${panel}`);
    if (method === 'state') return this.#panelState();
    if (method === 'log') return { ok: true, text: await this.log(Number(args?.[0] ?? 3)) };
    if (method !== 'action') throw new Error(`unknown method: ${method}`);

    const action = String(args?.[0] ?? '');
    const params = args?.[1] ?? {};
    try {
      switch (action) {
        case 'refresh':
          await this.poll();
          return { ok: true, message: language === 'en' ? 'refreshed' : '已刷新' };
        case 'status':
          return { ok: true, message: await this.statusText() };
        case 'spend':
          return { ok: true, message: await this.spendReport() };
        case 'feed':
          return { ok: true, message: await this.feed(Number(params.count ?? 3)) };
        case 'pet':
          return { ok: true, message: await this.pet(-1) };
        case 'shop':
          return { ok: true, message: await this.shop(params.page ?? 'animals') };
        case 'buyFood':
          return { ok: true, message: await this.buyFood(params.name, params.confirm === true) };
        case 'buyAnimal':
          return { ok: true, message: await this.buyAnimal(params) };
        case 'sell':
          return { ok: true, message: await this.sellAnimal(params.name, true) };
        case 'trim': {
          const sold = await this.trimExcess();
          return {
            ok: true,
            message:
              sold.length === 0
                ? '没有需要清理的动物。'
                : `清理了 ${sold.length} 只超量/低星动物。`,
          };
        }
        case 'new':
          return { ok: true, message: await this.newPasture(params.confirm === true) };
        case 'start':
          return { ok: true, message: await this.startGame() };
        case 'auto': {
          const next = params.enabled === undefined ? !this.autoCare : params.enabled === true;
          this.autoCare = next;
          this.cfg.autoCare = next;
          return {
            ok: true,
            message: next ? '自动巡视已开启' : '自动巡视已关闭',
          };
        }
        default:
          return { ok: false, message: `未知操作：${action}` };
      }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  #panelState() {
    const s = this.last;
    return {
      ok: true,
      online: this.lastSeen !== null,
      coin: s?.coin ?? null,
      farm: s?.farm_name ?? '',
      budget: s ? this.#dailyCap(s) : null,
      foodLeft: s ? foodBudget(s.coin, this.cfg.reserveCoins) : null,
      autoCare: this.autoCare,
      autoBuy: this.autoBuy,
      allowBuy: this.cfg.allowBuy === true,
      maxPerSpecies: this.maxPerSpecies,
      animals: (s?.animals ?? []).map((a) => ({
        name: a.name || a.code_name,
        code_name: a.code_name,
        type_id: a.type_id,
        rare: a.rare,
        hunger: Math.round(a.hunger),
        health: Math.round(a.health),
        adult: a.is_adult,
        sick: a.is_sick,
      })),
    };
  }

  async start(host) {
    this.host = host;
    this.timer = setInterval(() => {
      void this.poll();
    }, Math.max(5, this.cfg.pollSeconds) * 1000);
    this.timer.unref?.();
    await this.poll();
    this.#resetDigest(this.last);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.host = null;
  }

  async poll() {
    try {
      if (!(await this.bridge.isGameRunning())) {
        this.lastSeen = null;
        return;
      }
      const summary = await this.bridge.send('summary', {}, 5000);
      this.lastSeen = new Date();
      const previous = this.last;
      this.last = summary;
      this.#emitChanges(previous, summary);
      if (
        this.autoCare &&
        !this.caring &&
        Date.now() - this.lastCareAt >= this.careInterval * 1000
      ) {
        this.lastCareAt = Date.now();
        await this.#autoCare(summary);
      }
      if (
        this.digestEnabled &&
        this.last &&
        Date.now() - this.lastDigestAt >= this.digestInterval * 1000
      ) {
        await this.#digest();
      }
    } catch (err) {
      this.host?.log?.warn?.(`pasture: poll failed: ${err.message}`);
    }
  }

  #emitChanges(previous, summary) {
    if (!previous) return;
    const ts = new Date().toISOString();
    const sick = summary.animals.filter((a) => a.is_sick);
    const hungry = summary.animals.filter((a) => a.hunger < this.cfg.hungerThreshold);
    if (sick.length > (previous.animals.filter((a) => a.is_sick).length ?? 0)) {
      void this.host?.pushEvent?.({
        type: 'pasture.sick',
        ts,
        source: this.id,
        text: `牧场里有动物生病了：${sick.map((a) => a.name || a.code_name).join('、')}`,
        tags: ['speak'],
        meta: { sick: sick.length },
      });
    }
    if (summary.animals.length > (previous.animals.length ?? 0)) {
      const added = summary.animals.length - previous.animals.length;
      void this.host?.pushEvent?.({
        type: 'pasture.newAnimal',
        ts,
        source: this.id,
        text: `牧场里多了 ${added} 只动物，现在一共 ${summary.animals.length} 只。`,
        tags: ['speak'],
        meta: { added, total: summary.animals.length },
      });
    }
    if (hungry.length > 0 && previous.animals.every((a) => a.hunger >= this.cfg.hungerThreshold)) {
      void this.host?.pushEvent?.({
        type: 'pasture.hungry',
        ts,
        source: this.id,
        text: `牧场里 ${hungry.length} 只动物饿了（低于 ${this.cfg.hungerThreshold}）：${hungry
          .map((a) => `${a.name || a.code_name} ${Math.round(a.hunger)}`)
          .join('、')}`,
        tags: ['speak'],
        meta: { hungry: hungry.length },
      });
    }
  }

  async statusText() {
    const summary = await this.#summaryOrThrow();
    const lines = [
      `牧场「${summary.farm_name || '未命名'}」：金币 ${summary.coin}，${summary.animals.length} 只动物。`,
    ];
    for (const a of summary.animals) {
      const hunger = Math.round(a.hunger);
      lines.push(
        `- ${a.name || a.code_name}（${a.code_name}，${a.is_adult ? '成年' : '幼年'}）：` +
          `饥饿 ${hunger}/100，健康 ${Math.round(a.health)}` +
          (a.is_sick ? '，生病' : '') +
          `，稀有度 ${a.rare}`,
      );
    }
    return lines.join('\n');
  }

  async pet(index) {
    const summary = await this.#summaryOrThrow();
    if (summary.animals.length === 0) return '牧场里现在没有动物。';
    const target = summary.animals[0];
    const res = await this.bridge.send('pet', { index });
    this.stats.petted += 1;
    return `摸了摸 ${res.name || target.name || target.code_name}，它冒出了爱心。`;
  }

  async feed(count = 3) {
    let wanted = Math.max(1, Math.min(5, Number(count) || 1));
    let guard = null;
    while (wanted >= 1) {
      guard = await this.#foodAfford(5 * wanted, true);
      if (guard.ok) break;
      wanted -= 1;
    }
    if (!guard || !guard.ok) return guard?.message ?? '现在不适合喂食。';
    const before = guard.summary;
    if (before.animals.length === 0) return '牧场里现在没有动物，先别喂了。';
    const targets = pickFeedTargets(before.animals, wanted);
    const fed = [];
    for (const target of targets) {
      try {
        const live = await this.bridge.send('summary', {}, 5000);
        if (foodBudget(live.coin, this.cfg.reserveCoins) < 5) break;
        await this.#feedOne(target);
        fed.push(target);
      } catch {
        break;
      }
    }
    const after = await this.bridge.send('summary', {}, 5000);
    const spent = before.coin - after.coin;
    this.stats.fed += fed.length;
    return (
      `一次投喂 ${fed.length} 份：` +
      fed.map((a) => `${a.name || a.code_name}（${this.#foodIdFor(a)} 号食物）`).join('、') +
      `，花费 ${spent} 金币。`
    );
  }

  async buyAnimal({ type_id: typeId, max_price: maxPrice, confirm = false } = {}) {
    if (!this.cfg.allowBuy) return '买动物的开关没开（allowBuy），这次先不买。';
    const before = await this.#summaryOrThrow();
    const slot = before.animal_slot ?? 8;
    if (before.animals.length >= slot) {
      return `牧场满员（${before.animals.length}/${slot}），先卖一只再买。`;
    }
    const counts = {};
    for (const a of before.animals) counts[a.type_id] = (counts[a.type_id] ?? 0) + 1;
    await this.bridge.send('unfold');
    await this.bridge.send('press', { path: SHOP_BUTTON });
    await delay(700);
    let cards = (await this.bridge.send('cards')).cards ?? [];
    if (cards.length === 0) {
      await this.bridge.send('press', { path: SHOP_BUTTON });
      await delay(700);
      cards = (await this.bridge.send('cards')).cards ?? [];
    }
    const open = cards.filter((c) => !c.locked);
    if (open.length === 0) {
      await this.#closeShop();
      return '商店里没有可买的动物（可能都没解锁）。';
    }
    const card = chooseAnimalCard(
      open,
      counts,
      before.coin,
      this.maxPerSpecies,
      typeId,
    );
    if (!card) {
      await this.#closeShop();
      return typeId !== undefined
        ? `type_id ${typeId} 不可买，或这个物种已经有 ${this.maxPerSpecies} 只了。`
        : `每种动物最多 ${this.maxPerSpecies} 只，当前可买的物种都到上限了。`;
    }
    if (maxPrice !== undefined && card.price > maxPrice) {
      await this.bridge.send('shop_close');
      return `买 ${card.name} 要 ${card.price} 金币，超过这次单笔上限 ${maxPrice}，先不买。`;
    }
    const guard = await this.#afford(card.price, confirm === true);
    if (!guard.ok) {
      await this.bridge.send('shop_close');
      return guard.message;
    }
    await this.bridge.send('press', { path: card.path });
    await delay(400);
    await this.bridge.send('buy_one');
    await delay(700);
    await this.bridge.send('accept');
    await delay(900);
    await this.bridge.send('shop_close');
    const after = await this.bridge.send('summary', {}, 5000);
    await this.#recordSpend(card.price);
    this.stats.bought += 1;
    const beforeNodes = new Set(before.animals.map((a) => a.node));
    const newcomer = after.animals.find((a) => !beforeNodes.has(a.node));
    let fedText = '';
    if (newcomer && after.coin - 5 > this.cfg.reserveCoins) {
      try {
        await this.#feedOne(newcomer);
        this.stats.fed += 1;
        fedText = '，并喂了它一份';
      } catch {
        /* 喂食失败不影响购买结果 */
      }
    }
    const gained = after.animals.length - before.animals.length;
    return (
      `花 ${card.price} 金币买了 ${card.name}，牧场现在 ${after.animals.length} 只动物` +
      (gained > 0 ? '，新动物已经落地' : '') +
      fedText +
      `。余额 ${after.coin}。`
    );
  }

  async buyFood(name, confirm = false) {
    await this.bridge.send('shop_open', { page: 'items' });
    await delay(700);
    const catalog = await this.bridge.send('shop_catalog', { page: 'items' });
    const foods = (catalog.items ?? []).filter((i) => i.kind === 'food' && !i.locked);
    if (foods.length === 0) {
      await this.#closeShop();
      return '物资页现在没有可买的食物。';
    }
    const picked = name
      ? foods.find((f) => f.name === name || f.name.includes(name))
      : [...foods].sort((a, b) => a.price - b.price)[0];
    if (!picked) {
      await this.#closeShop();
      return `物资页没找到「${name}」。`;
    }
    const guard = await this.#foodAfford(picked.price, confirm === true);
    if (!guard.ok) {
      await this.bridge.send('shop_close');
      return guard.message;
    }
    const before = guard.summary;
    const target = [...before.animals].sort((a, b) => a.hunger - b.hunger)[0];
    if (!target) return '牧场里没有动物，先不买了。';
    await this.bridge.send('select_item', { path: picked.path });
    await delay(300);
    await this.bridge.send('click', { path: target.node });
    await delay(250);
    const [x, y, w, h] = target.rect;
    await this.bridge.send('feed_drop', { x: x + w / 2, y: y + h / 2 });
    await delay(1200);
    const after = await this.bridge.send('summary', {}, 5000);
    await this.#recordSpend(picked.price);
    await this.bridge.send('shop_close');
    this.stats.fed += 1;
    return (
      `在物资页买了 ${picked.name} 喂给 ${target.name || target.code_name}，` +
      `花费 ${picked.price} 金币（实际金币变化 ${before.coin - after.coin}）。界面已关。`
    );
  }

  async shop(page = 'animals') {
    const labels = { animals: '动物', items: '物资', facility: '设施', decoration: '装饰' };
    await this.bridge.send('shop_open', { page });
    await delay(700);
    const catalog = await this.bridge.send('shop_catalog', { page });
    if (!catalog.ok) {
      await this.#closeShop();
      return `商店「${labels[page] ?? page}」现在打不开：${catalog.error ?? '未知原因'}`;
    }
    const items = catalog.items ?? [];
    if (items.length === 0) {
      await this.#closeShop();
      return `商店「${labels[page] ?? page}」现在没有可买的东西。`;
    }
    const lines = [`商店「${labels[page] ?? page}」：`];
    for (const item of items) {
      lines.push(
        `- ${item.name || '未命名'}：${item.price} 金币${item.locked ? '（未解锁）' : ''}`,
      );
    }
    await this.#closeShop();
    lines.push('界面已自动关闭；想买哪个告诉我。');
    return lines.join('\n');
  }

  async spendReport() {
    const summary = await this.#summaryOrThrow();
    const spent = await this.#spentToday();
    const budget = this.#dailyCap(summary);
    const budgetLeft = budget - spent;
    const foodAvailable = foodBudget(summary.coin, this.cfg.reserveCoins);
    const spendable = Math.max(0, Math.min(budgetLeft, foodAvailable));
    return (
      `金币 ${summary.coin}；今日已花 ${spent}/${budget}` +
      `（每日预算只约束买动物/装饰）；` +
      `喂食按实时金币，扣掉保留 ${this.cfg.reserveCoins} 后可用 ${foodAvailable}；` +
      `买动物/装饰还能花 ${spendable}。`
    );
  }

  async autoStatus(args = {}) {
    if (typeof args.enabled === 'boolean') this.autoCare = args.enabled;
    if (Number.isInteger(args.interval_seconds)) {
      this.careInterval = Math.max(10, args.interval_seconds);
    }
    if (Number.isInteger(args.max_feed)) {
      this.autoFeedMax = Math.max(0, args.max_feed);
    }
    if (Number.isInteger(args.buy_type_id)) {
      this.autoBuyTypeId = args.buy_type_id;
    }
    this.lastCareAt = 0;
    return (
      `自动巡视已${this.autoCare ? '开启' : '关闭'}：` +
      `每 ${this.careInterval} 秒看一次，最多喂 ${this.autoFeedMax} 只，` +
      `饥饿阈值 ${this.cfg.autoFeedThreshold ?? this.cfg.hungerThreshold}；` +
      `自动买动物${this.autoBuyTypeId === null ? '选最便宜的' : `指定 species ${this.autoBuyTypeId}`}。`
    );
  }

  async sellAnimal(name, confirm = false, allowLast = false) {
    const summary = await this.#summaryOrThrow();
    const counts = {};
    for (const a of summary.animals) counts[a.type_id] = (counts[a.type_id] ?? 0) + 1;
    const candidates = summary.animals.filter(
      (a) =>
        a.rare < 4 &&
        a.is_adult &&
        (allowLast || (counts[a.type_id] ?? 0) >= 2),
    );
    if (candidates.length === 0) {
      return '没有可卖的动物（只卖 4 星以下、成年；单只不卖，2 只低星可全卖重刷）。';
    }
    if (!confirm) {
      const list = candidates
        .map((a) => `${a.name || a.code_name}（${a.rare} 星）`)
        .join('、');
      return `可以卖：${list}。要卖哪只？确认后带 confirm:true 再调用，可以用 name 指定。`;
    }
    const target = name
      ? candidates.find((a) => (a.name || '').includes(name) || a.code_name.includes(name))
      : [...candidates].sort((a, b) => a.rare - b.rare)[0];
    await this.bridge.send('open_animal', { path: summary.animals[0].node });
    await delay(500);
    const cards = (await this.bridge.send('farm_cards')).cards ?? [];
    for (const card of cards) {
      await this.bridge.send('press', { path: card.path });
      await delay(300);
      const detail = await this.bridge.send('farm_detail');
      if (
        detail.ok &&
        detail.sell_visible &&
        detail.stars < 4 &&
        (!name || (detail.name || '').includes(name))
      ) {
        await this.bridge.send('farm_sell');
        await delay(300);
        await this.bridge.send('farm_confirm');
        await delay(900);
        await this.bridge.send('farm_close');
        await delay(400);
        const after = await this.bridge.send('summary', {}, 5000);
        this.stats.sold += 1;
        return (
          `卖掉了 ${detail.name || target?.name || target?.code_name}（${detail.stars} 星），` +
          `金币 ${summary.coin} → ${after.coin}，动物 ${after.animals.length} 只。`
        );
      }
    }
    await this.bridge.send('farm_close');
    return '没找到符合条件的动物卡片，先不卖。';
  }

  async trimExcess() {
    const sold = [];
    for (let i = 0; i < 14; i += 1) {
      const summary = await this.#summaryOrThrow();
      const groups = {};
      for (const a of summary.animals) {
        const key = String(a.type_id);
        (groups[key] ??= []).push(a);
      }
      let target = null;
      for (const list of Object.values(groups)) {
        if (list.length > this.maxPerSpecies) {
          target = list
            .filter((a) => a.rare < 4 && a.is_adult)
            .sort((a, b) => a.rare - b.rare)[0];
          if (target) break;
        }
      }
      const pair = target ? null : findLowStarPair(summary.animals, this.rerollLowStar);
      if (pair) {
        for (const animal of pair) {
          const result = await this.sellAnimal(
            animal.name || animal.code_name,
            true,
            true,
          );
          if (!result.startsWith('卖掉了')) break;
          sold.push(result);
          await delay(600);
        }
        continue;
      }
      if (!target) break;
      const result = await this.sellAnimal(target.name || target.code_name, true);
      if (!result.startsWith('卖掉了')) break;
      sold.push(result);
    }
    return sold;
  }

  async newPasture(confirm = false) {
    const info = await this.bridge.send('depot_info');
    const costs = info.depot_cost ?? {};
    const key = String(info.unlocked_depot ?? 0);
    const cost = Number(costs[key] ?? 0);
    if (!cost) return '读不到新牧场/栏位的价格，先不买。';
    const action = slotAction(info.coin, cost);
    const threshold = cost * 2;
    if (action === 'none') {
      return (
        `新牧场（含动物栏位）要 ${cost} 金币；按 2 倍安全线需要 ${threshold}，` +
        `现在只有 ${info.coin}，先不买。`
      );
    }
    if (action === 'ask' && !confirm) {
      return (
        `金币已达到 2 倍安全线（${info.coin} ≥ ${threshold}，价格 ${cost}）。` +
        '要现在解锁新牧场/栏位吗？确认后带 confirm:true 再买；' +
        `金币到 ${cost * 4} 时会自动买。`
      );
    }
    const summary = await this.#summaryOrThrow();
    if (summary.animals.length > 0) {
      await this.bridge.send('open_animal', { path: summary.animals[0].node });
      await delay(500);
    }
    await this.bridge.send('farm_new');
    await delay(500);
    await this.bridge.send('farm_new_confirm');
    await delay(900);
    await this.bridge.send('farm_close');
    const after = await this.bridge.send('summary', {}, 5000);
    return (
      `花 ${cost} 金币买了新牧场/栏位，现在牧场 ${after.animals.length} 只，` +
      `栏位上限 ${after.animal_slot ?? '?'}，余额 ${after.coin}。`
    );
  }

  async #closeShop() {
    try {
      await this.bridge.send('shop_close');
    } catch {
      /* 已经关了 */
    }
  }

  async #closeFarm() {
    try {
      await this.bridge.send('farm_close');
    } catch {
      /* 已经关了 */
    }
  }

  #foodIdFor(animal) {
    const map = this.cfg.foodBySpecies ?? {
      rabbit: 0,
      cat: 2,
      dogk: 3,
      fish: 8,
    };
    const code = String(animal?.code_name ?? '').toLowerCase();
    for (const [key, id] of Object.entries(map)) {
      if (code.includes(String(key).toLowerCase())) return Number(id);
    }
    return 1;
  }

  async #feedOne(animal) {
    await this.bridge.send('feed_pick', {
      food_id: this.#foodIdFor(animal),
      restore_cursor: this.cursorRestore,
    });
    await delay(250);
    await this.bridge.send('click', { path: animal.node });
    await delay(250);
    const [x, y, w, h] = animal.rect;
    await this.bridge.send('feed_drop', { x: x + w / 2, y: y + h / 2 });
    await delay(900);
  }

  async #autoCare(before) {
    this.caring = true;
    try {
      let spendable = foodBudget(before.coin, this.cfg.reserveCoins);
      const threshold = this.cfg.autoFeedThreshold ?? this.cfg.hungerThreshold;
      const hungry = [...before.animals]
        .filter((a) => a.hunger < threshold)
        .sort((a, b) => a.hunger - b.hunger)
        .slice(0, this.autoFeedMax);
      const fed = [];
      for (const animal of hungry) {
        if (spendable < 5) break;
        try {
          const live = await this.bridge.send('summary', {}, 5000);
          spendable = foodBudget(live.coin, this.cfg.reserveCoins);
          if (spendable < 5) break;
          await this.#feedOne(animal);
          fed.push(animal);
          spendable -= 5;
        } catch (err) {
          this.host?.log?.warn?.(`pasture: auto feed failed: ${err.message}`);
          break;
        }
      }
      let petted = null;
      if (fed.length === 0 && this.cfg.autoPet !== false && before.animals.length > 0) {
        try {
          await this.bridge.send('pet', { index: 0 });
          petted = [...before.animals].sort((a, b) => a.hunger - b.hunger)[0];
        } catch (err) {
          this.host?.log?.warn?.(`pasture: auto pet failed: ${err.message}`);
        }
      }
      if (fed.length > 0) {
        await this.#recordSpend(fed.length * 5);
        this.stats.fed += fed.length;
      }
      if (petted) this.stats.petted += 1;
      let picked = 0;
      let cleaned = 0;
      try {
        picked = (await this.bridge.send('collect_coin')).coins ?? 0;
      } catch {
        /* 没有可捡的 */
      }
      try {
        cleaned = (await this.bridge.send('clean_poop')).poops ?? 0;
      } catch {
        /* 没有可打扫的 */
      }
      this.stats.picked += picked;
      this.stats.cleaned += cleaned;
      let trimmed = [];
      if (this.autoTrim) {
        try {
          trimmed = await this.trimExcess();
        } catch {
          /* 清理失败就跳过 */
        }
      }
      let bought = null;
      if (this.autoBuy) {
        const preBuy = trimmed.length
          ? await this.bridge.send('summary', {}, 5000)
          : before;
        const slot = preBuy.animal_slot ?? 8;
        if (preBuy.animals.length < slot) {
          const text = await this.buyAnimal({
            confirm: true,
            ...(this.autoBuyTypeId !== null ? { type_id: this.autoBuyTypeId } : {}),
          });
          if (text.startsWith('花 ')) bought = text;
        }
      }
      let newSlot = null;
      if (this.cfg.autoNewPasture === true) {
        try {
          const info = await this.bridge.send('depot_info');
          const costs = info.depot_cost ?? {};
          const cost = Number(costs[String(info.unlocked_depot ?? 0)] ?? 0);
          if (cost > 0) {
            if (info.coin >= cost * 4) {
              const text = await this.newPasture(true);
              if (text.startsWith('花 ')) newSlot = text;
            } else if (info.coin >= cost * 2 && !this.slotAsked) {
              this.slotAsked = true;
              void this.host?.pushEvent?.({
                type: 'pasture.slotOffer',
                ts: new Date().toISOString(),
                source: this.id,
                text:
                  `金币 ${info.coin} 已达到新牧场/栏位价格 ${cost} 的 2 倍，` +
                  `现在可以解锁；到 ${cost * 4} 我会自动买。要现在买吗？`,
                tags: ['speak'],
                meta: { cost, coin: info.coin },
              });
            } else if (info.coin < cost * 2) {
              this.slotAsked = false;
            }
          }
        } catch {
          /* 价格读不到就跳过 */
        }
      }
      const after = await this.bridge.send('summary', {}, 5000);
      this.last = after;
      const parts = [`金币 ${after.coin}，${after.animals.length} 只动物`];
      if (fed.length > 0) {
        parts.push(`喂了 ${fed.map((a) => a.name || a.code_name).join('、')}`);
      }
      if (petted) parts.push(`摸了摸 ${petted.name || petted.code_name}`);
      if (picked > 0) parts.push(`捡了 ${picked} 处金币`);
      if (cleaned > 0) parts.push(`打扫了 ${cleaned} 处便便`);
      if (trimmed.length > 0) parts.push(`清理了 ${trimmed.length} 只超量动物`);
      if (bought) parts.push(bought);
      if (newSlot) parts.push(newSlot);
      const sick = after.animals.filter((a) => a.is_sick);
      if (sick.length > 0) parts.push(`${sick.length} 只生病`);
      const acted =
        fed.length > 0 ||
        petted !== null ||
        bought !== null ||
        newSlot !== null ||
        trimmed.length > 0 ||
        picked > 0 ||
        cleaned > 0;
      // 什么都不用做、也没有生病的，就不打扰用户。
      if (!acted && sick.length === 0) return;
      const text = acted
        ? `我巡视了牧场：${parts.join('；')}。`
        : `我看了看牧场：${parts.join('；')}，需要留意。`;
      void this.host?.pushEvent?.({
        type: 'pasture.care',
        ts: new Date().toISOString(),
        source: this.id,
        text,
        tags: ['speak'],
        meta: { fed: fed.length, petted: petted !== null, coin: after.coin },
      });
    } finally {
      this.caring = false;
    }
  }

  async startGame() {
    const res = await this.bridge.send('start_game', {}, 5000);
    return res.pressed ? '已经点了「开始游戏」。' : '现在不在开始菜单，不用点。';
  }

  async #summaryOrThrow() {
    if (!(await this.bridge.isGameRunning())) {
      throw new Error('Tiny Pasture 没在运行（找不到心跳）');
    }
    const summary = await this.bridge.send('summary', {}, 5000);
    this.last = summary;
    this.lastSeen = new Date();
    return summary;
  }

  #resetDigest(summary) {
    if (!summary) {
      this.digestBaseline = null;
      return;
    }
    this.digestBaseline = {
      coin: summary.coin,
      history_coin: summary.history_coin,
      animals: summary.animals.length,
    };
    this.stats = { fed: 0, petted: 0, bought: 0, sold: 0, picked: 0, cleaned: 0 };
    this.lastDigestAt = Date.now();
  }

  async #digest() {
    const now = this.last;
    const base = this.digestBaseline;
    if (!now || !base) {
      this.#resetDigest(now);
      return;
    }
    const d = this.stats;
    const historyGain = Math.max(0, (now.history_coin ?? 0) - (base.history_coin ?? 0));
    const coinDelta = now.coin - base.coin;
    const rare3 = now.animals.filter((a) => a.rare >= 3).length;
    const rare2 = now.animals.filter((a) => a.rare === 2).length;
    const low = now.animals.length - rare3 - rare2;
    const adults = now.animals.filter((a) => a.is_adult).length;
    const babies = now.animals.length - adults;
    const sick = now.animals.filter((a) => a.is_sick).length;
    const hungriest = [...now.animals].sort((a, b) => a.hunger - b.hunger)[0];
    const time = new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const lines = [
      `【牧场小时报 ${time}】`,
      `「${now.farm_name || '牧场'}」${now.animals.length} 只（成年 ${adults} / 幼年 ${babies}），金币 ${now.coin}。`,
      `这一小时：累计收获 +${historyGain} 金币（净 ${coinDelta >= 0 ? '+' : ''}${coinDelta}），` +
        `喂 ${d.fed} 次，摸 ${d.petted} 次，买 ${d.bought} 只，卖 ${d.sold} 只，` +
        `捡金币 ${d.picked} 次，打扫 ${d.cleaned} 次。`,
      `驯养：3 星以上 ${rare3} 只，2 星 ${rare2} 只，0-1 星 ${low} 只；生病 ${sick} 只` +
        (hungriest
          ? `；最饿 ${hungriest.name || hungriest.code_name} ${Math.round(hungriest.hunger)}/100。`
          : '。'),
    ];
    let text = lines.join('\n');
    if (text.length > this.digestMaxChars) {
      text = text.slice(0, this.digestMaxChars - 1) + '…';
    }
    try {
      await appendFile(
        this.logPath,
        JSON.stringify({ ts: new Date().toISOString(), text }) + '\n',
        'utf8',
      );
    } catch {
      /* 日志写不了也不影响推送 */
    }
    void this.host?.pushEvent?.({
      type: 'pasture.digest',
      ts: new Date().toISOString(),
      source: this.id,
      text,
      tags: ['speak'],
      meta: { historyGain, coin: now.coin },
    });
    this.#resetDigest(now);
  }

  async log(limit = 3) {
    try {
      const raw = await readFile(this.logPath, 'utf8');
      const lines = raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-Math.max(1, Math.min(20, limit)));
      if (lines.length === 0) return '还没有牧场小时报。';
      return lines
        .map((line) => {
          try {
            return JSON.parse(line).text;
          } catch {
            return line;
          }
        })
        .join('\n\n');
    } catch {
      return '还没有牧场小时报。';
    }
  }

  #dailyCap(summary) {
    if (Number.isFinite(this.dailyBudgetPercent)) {
      return Math.floor((summary.coin * this.dailyBudgetPercent) / 100);
    }
    return this.cfg.dailyBudget;
  }

  async #afford(price, confirm) {
    const summary = await this.#summaryOrThrow();
    const spent = await this.#spentToday();
    const budgetLeft = this.#dailyCap(summary) - spent;
    const coinLeft = foodBudget(summary.coin, this.cfg.reserveCoins);
    const cap = Math.min(budgetLeft, coinLeft);
    if (price > cap) {
      return {
        ok: false,
        message:
          `这笔要 ${price} 金币，但现在最多只能花 ${Math.max(0, cap)}` +
          `（今日预算剩 ${Math.max(0, budgetLeft)}，需保留 ${this.cfg.reserveCoins}，` +
          `当前金币 ${summary.coin}）。先不买。`,
      };
    }
    if (price > this.cfg.confirmOver && !confirm) {
      return {
        ok: false,
        message:
          `这笔要 ${price} 金币，超过单笔确认线 ${this.cfg.confirmOver}。` +
          '先问用户；同意后带 confirm:true 再调用。',
      };
    }
    return { ok: true, summary };
  }

  async #foodAfford(price, confirm) {
    const summary = await this.#summaryOrThrow();
    const coinLeft = foodBudget(summary.coin, this.cfg.reserveCoins);
    if (price > coinLeft) {
      return {
        ok: false,
        message:
          `食物要 ${price} 金币，扣掉保留 ${this.cfg.reserveCoins} 后只剩 ` +
          `${Math.max(0, coinLeft)}（当前金币 ${summary.coin}）。先不买。`,
      };
    }
    if (price > this.cfg.confirmOver && !confirm) {
      return {
        ok: false,
        message:
          `这笔要 ${price} 金币，超过单笔确认线 ${this.cfg.confirmOver}。` +
          '先问用户；同意后带 confirm:true 再调用。',
      };
    }
    return { ok: true, summary };
  }

  async #readState() {
    try {
      return JSON.parse(await readFile(this.statePath, 'utf8'));
    } catch {
      return { date: '', spent: 0 };
    }
  }

  async #spentToday() {
    const state = await this.#readState();
    const today = new Date().toISOString().slice(0, 10);
    return state.date === today ? state.spent : 0;
  }

  async #recordSpend(coins) {
    const today = new Date().toISOString().slice(0, 10);
    const state = await this.#readState();
    const spent = (state.date === today ? state.spent : 0) + coins;
    await mkdir(join(this.statePath, '..'), { recursive: true });
    await writeFile(this.statePath, JSON.stringify({ date: today, spent }), 'utf8');
  }
}
