import { describe, expect, it } from 'vitest';
import {
  chooseAnimalCard,
  findLowStarPair,
  pickFeedTargets,
  slotAction,
  type AnimalLike,
  type CardLike,
} from '../src/policy.ts';

const cards: CardLike[] = [
  { type_id: 1, price: 120, locked: false, name: '兔' },
  { type_id: 2, price: 720, locked: false, name: '猫' },
  { type_id: 3, price: 2000, locked: false, name: '狐' },
  { type_id: 4, price: 9999, locked: true, name: '未解锁' },
];

const animal = (type_id: number, rare: number, is_adult = true): AnimalLike => ({
  type_id,
  rare,
  is_adult,
  hunger: 50,
  name: `a${type_id}`,
  code_name: `t${type_id}`,
});

describe('chooseAnimalCard', () => {
  it('钱不够 1.5 倍时买最便宜', () => {
    expect(chooseAnimalCard(cards, {}, 1000, 2)?.type_id).toBe(1);
  });

  it('钱超过最贵候选 1.5 倍时买最贵', () => {
    expect(chooseAnimalCard(cards, {}, 2001 * 1.5 + 1, 2)?.type_id).toBe(3);
  });

  it('跳过已锁与已满 2 只的物种', () => {
    const counts = { '1': 2, '3': 2 };
    expect(chooseAnimalCard(cards, counts, 99999, 2)?.type_id).toBe(2);
  });

  it('指定物种满 2 只时返回 null', () => {
    expect(chooseAnimalCard(cards, { '2': 2 }, 99999, 2, 2)).toBeNull();
  });

  it('没有候选时返回 null', () => {
    expect(chooseAnimalCard([cards[3]!], {}, 99999, 2)).toBeNull();
  });
});

describe('slotAction', () => {
  it('低于 2 倍不买', () => {
    expect(slotAction(5999, 3000)).toBe('none');
  });
  it('2 到 4 倍询问', () => {
    expect(slotAction(6000, 3000)).toBe('ask');
    expect(slotAction(11999, 3000)).toBe('ask');
  });
  it('4 倍以上自动', () => {
    expect(slotAction(12000, 3000)).toBe('auto');
  });
  it('价格非法时不动作', () => {
    expect(slotAction(99999, 0)).toBe('none');
  });
});

describe('findLowStarPair', () => {
  it('同种 2 只都低于 4 星且成年，返回这一对', () => {
    const pair = findLowStarPair([animal(1, 0), animal(1, 3)], true);
    expect(pair).toHaveLength(2);
  });
  it('其中一只 4 星则不返回', () => {
    expect(findLowStarPair([animal(1, 0), animal(1, 4)], true)).toBeNull();
  });
  it('其中一只未成年则不返回', () => {
    expect(findLowStarPair([animal(1, 0), animal(1, 2, false)], true)).toBeNull();
  });
  it('关闭重刷时不返回', () => {
    expect(findLowStarPair([animal(1, 0), animal(1, 1)], false)).toBeNull();
  });
});

describe('pickFeedTargets', () => {
  it('按饥饿从低到高取 N 只', () => {
    const list = [
      { hunger: 80, id: 'a' },
      { hunger: 10, id: 'b' },
      { hunger: 40, id: 'c' },
    ];
    expect(pickFeedTargets(list, 2).map((x) => x.id)).toEqual(['b', 'c']);
  });
  it('count 为 0 时返回空', () => {
    expect(pickFeedTargets([{ hunger: 1 }], 0)).toEqual([]);
  });
});
