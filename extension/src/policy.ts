/** 纯策略函数：不碰文件、不碰游戏，方便单元测试。 */

export interface CardLike {
  type_id: number;
  price: number;
  locked: boolean;
  name: string;
}

export interface AnimalLike {
  type_id: number;
  rare: number;
  is_adult: boolean;
  name?: string;
  code_name?: string;
  hunger: number;
}

/** 买动物：每种不超过上限；资金 > 最贵候选 1.5 倍时买最贵，否则买最便宜。 */
export function chooseAnimalCard(
  cards: readonly CardLike[],
  counts: Record<string, number>,
  coin: number,
  maxPerSpecies: number,
  typeId?: number,
): CardLike | null {
  const candidates = cards.filter(
    (c) => !c.locked && (counts[String(c.type_id)] ?? 0) < maxPerSpecies,
  );
  if (candidates.length === 0) return null;
  if (typeId !== undefined) {
    return candidates.find((c) => c.type_id === typeId) ?? null;
  }
  const topPrice = Math.max(...candidates.map((c) => c.price));
  const rich = coin > topPrice * 1.5;
  return [...candidates].sort((a, b) =>
    rich ? b.price - a.price : a.price - b.price,
  )[0]!;
}

/** 槽位：不到 2 倍不买，2–4 倍询问，4 倍以上自动。 */
export function slotAction(coin: number, cost: number): 'none' | 'ask' | 'auto' {
  if (!Number.isFinite(cost) || cost <= 0) return 'none';
  if (coin >= cost * 4) return 'auto';
  if (coin >= cost * 2) return 'ask';
  return 'none';
}

/** 同种正好 2 只、都低于 4 星且都已成年时，返回这一对（可全卖重刷）。 */
export function findLowStarPair(
  animals: readonly AnimalLike[],
  reroll: boolean,
): AnimalLike[] | null {
  if (!reroll) return null;
  const groups = new Map<number, AnimalLike[]>();
  for (const a of animals) {
    const list = groups.get(a.type_id) ?? [];
    list.push(a);
    groups.set(a.type_id, list);
  }
  for (const list of groups.values()) {
    if (list.length === 2 && list.every((a) => a.rare < 4 && a.is_adult)) {
      return list;
    }
  }
  return null;
}

/** 自动巡视喂食：按饥饿从低到高取前 N 只。 */
export function pickFeedTargets<T extends { hunger: number }>(
  animals: readonly T[],
  count: number,
): T[] {
  return [...animals].sort((a, b) => a.hunger - b.hunger).slice(0, Math.max(0, count));
}
