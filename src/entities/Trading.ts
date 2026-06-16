export interface Trade {
  wantId: string;
  wantCount: number;
  giveId: string;
  giveCount: number;
}

/**
 * Villager trade pool — emerald-centric like vanilla, but built from
 * materials that already exist (no wheat/farming yet, so apples stand in
 * for the classic "farmer sells food" trade).
 */
const TRADE_POOL: Trade[] = [
  { wantId: 'apple', wantCount: 4, giveId: 'emerald', giveCount: 1 },
  { wantId: 'coal', wantCount: 8, giveId: 'emerald', giveCount: 1 },
  { wantId: 'wool', wantCount: 6, giveId: 'emerald', giveCount: 1 },
  { wantId: 'lapis', wantCount: 4, giveId: 'emerald', giveCount: 1 },
  { wantId: 'emerald', wantCount: 1, giveId: 'iron_ingot', giveCount: 4 },
  { wantId: 'emerald', wantCount: 1, giveId: 'cooked_porkchop', giveCount: 3 },
  { wantId: 'emerald', wantCount: 3, giveId: 'diamond', giveCount: 1 },
  { wantId: 'emerald', wantCount: 1, giveId: 'glass_bottle', giveCount: 6 },
];

/** Pick `count` distinct random trades for a freshly spawned villager. */
export function rollTrades(count = 2): Trade[] {
  const pool = [...TRADE_POOL];
  const picked: Trade[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}
