/** 牧场控制台面板：状态卡 + 常用动作按钮，全部经 ctx.invoke 打到 World。 */
import type {
  WebUiClientBundle,
  WebUiPanelContext,
} from 'cortico/web/shared/client-panel.ts';

interface PanelState {
  ok: boolean;
  online: boolean;
  coin: number | null;
  farm: string;
  budget: number | null;
  foodLeft: number | null;
  autoCare: boolean;
  autoBuy: boolean;
  allowBuy: boolean;
  maxPerSpecies: number;
  animals: Array<{
    name: string;
    code_name: string;
    type_id: number;
    rare: number;
    hunger: number;
    health: number;
    adult: boolean;
    sick: boolean;
  }>;
}

const CSS = `
.pasture-panel{display:flex;flex-direction:column;gap:12px;padding:4px 0;color:var(--fg,#222)}
.pasture-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pasture-title{font-weight:600}
.pasture-dot{width:8px;height:8px;border-radius:50%;background:#bbb;display:inline-block}
.pasture-dot.on{background:#2fb344}.pasture-dot.off{background:#d9534f}
.pasture-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
.pasture-card{border:1px solid var(--border,#ddd);border-radius:8px;padding:8px 10px;background:var(--bg2,#fafafa)}
.pasture-card b{display:block;font-size:18px}.pasture-card span{font-size:12px;opacity:.7}
.pasture-actions{display:flex;gap:8px;flex-wrap:wrap}
.pasture-actions button{border:1px solid var(--border,#ccc);background:var(--bg1,#fff);color:inherit;border-radius:6px;padding:6px 10px;cursor:pointer}
.pasture-actions button:hover{border-color:#2fb344}
.pasture-actions button.primary{background:#2fb344;border-color:#2fb344;color:#fff}
.pasture-log{white-space:pre-wrap;font:12px/1.5 ui-monospace,Consolas,monospace;background:var(--bg2,#f6f6f6);border-radius:6px;padding:8px;min-height:42px;margin:0}
.pasture-list{display:flex;flex-direction:column;gap:4px;font-size:13px}
.pasture-row{display:flex;gap:8px;align-items:center;border-bottom:1px dashed var(--border,#eee);padding:3px 0}
.pasture-row .name{min-width:64px;font-weight:500}.pasture-row .meta{opacity:.7}
.pasture-row .sick{color:#d9534f}
`;

function mount(ctx: WebUiPanelContext): void {
  const root = ctx.root;
  root.classList.add('pasture-panel');
  const style = document.createElement('style');
  style.textContent = CSS;
  root.append(style);

  const head = ctx.ui.h('div', 'pasture-head');
  const dot = ctx.ui.h('span', 'pasture-dot');
  const title = ctx.ui.h('span', 'pasture-title', '牧场控制台');
  const sub = ctx.ui.h('span', 'pasture-sub', '');
  head.append(dot, title, sub);

  const cards = ctx.ui.h('div', 'pasture-cards');
  const card = (label: string) => {
    const box = ctx.ui.h('div', 'pasture-card');
    const value = ctx.ui.h('b', null, '—');
    const name = ctx.ui.h('span', null, label);
    box.append(value, name);
    cards.append(box);
    return value;
  };
  const coinEl = card('金币');
  const animalEl = card('动物');
  const budgetEl = card('喂食可用');
  const autoEl = card('自动巡视');

  const actions = ctx.ui.h('div', 'pasture-actions');
  const logBox = ctx.ui.h('pre', 'pasture-log', '点「刷新」读取牧场状态。');
  const list = ctx.ui.h('div', 'pasture-list');

  const button = (label: string, fn: () => void, primary = false) => {
    const b = ctx.ui.h('button', primary ? 'primary' : null, label);
    b.type = 'button';
    b.addEventListener('click', fn);
    actions.append(b);
    return b;
  };

  const call = async (action: string, params?: Record<string, unknown>) => {
    logBox.textContent = '执行中…';
    const r = (await ctx.invoke('action', [action, params ?? {}])) as {
      ok: boolean;
      message: string;
    };
    logBox.textContent = r.message;
    await refresh();
  };

  const refresh = async () => {
    const s = (await ctx.invoke('state')) as PanelState;
    dot.className = `pasture-dot ${s.online ? 'on' : 'off'}`;
    sub.textContent = s.online
      ? `${s.farm || '牧场'} · 每种≤${s.maxPerSpecies}`
      : '游戏没开或 bridge 没心跳';
    coinEl.textContent = s.coin === null ? '—' : String(s.coin);
    animalEl.textContent = String(s.animals.length);
    budgetEl.textContent = s.foodLeft === null ? '—' : String(s.foodLeft);
    autoEl.textContent = s.autoCare ? '开' : '关';
    list.replaceChildren();
    for (const a of s.animals) {
      const row = ctx.ui.h('div', 'pasture-row');
      row.append(
        ctx.ui.h('span', 'name', a.name),
        ctx.ui.h('span', null, `${a.rare}★`),
        ctx.ui.h('span', 'meta', `${a.adult ? '成年' : '幼年'} · 饥饿 ${a.hunger}/100 · 健康 ${a.health}`),
      );
      if (a.sick) row.append(ctx.ui.h('span', 'sick', '生病'));
      list.append(row);
    }
    if (s.animals.length === 0) {
      list.append(ctx.ui.h('div', 'pasture-row', '没有动物或还没读到状态。'));
    }
  };

  button('刷新', () => void call('refresh'), true);
  button('喂 3 份', () => void call('feed', { count: 3 }));
  button('买食物', () => void call('buyFood', { confirm: true }));
  button('摸一只', () => void call('pet'));
  button('清理超量/低星', () => void call('trim'));
  button('卖一只低星', () => void call('sell', {}));
  button('买动物', () => void call('buyAnimal', { confirm: true }));
  button('解锁栏位', () => void call('new', { confirm: true }));
  button('今日花费', () => void call('spend'));
  button('动物目录', () => void call('shop', { page: 'animals' }));
  button('物资目录', () => void call('shop', { page: 'items' }));
  button('装饰目录', () => void call('shop', { page: 'decoration' }));
  button('开始游戏', () => void call('start'));
  button('自动巡视开/关', () => void call('auto'));
  button('看小时报', () => {
    void (async () => {
      const r = (await ctx.invoke('log', [3])) as { text: string };
      logBox.textContent = r.text;
    })();
  });

  root.append(head, cards, actions, logBox, list);
  void refresh();
}

const bundle: WebUiClientBundle = { panels: { dashboard: { mount } } };
export default bundle;
