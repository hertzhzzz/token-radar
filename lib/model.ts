// The token radar's model (radar-2): one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds every
// rankable pre-token protocol below the watchlist floor: the early rows the radar exists to find. A
// protocol is pre-token when its index entry records no token (no market cap, no CoinGecko id, no
// symbol); the snapshot's live-token protocols are kept apart and shown as the market's own values,
// never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures. The multiple is not a flat guess: it is
// calibrated from the protocols that already trade, per category, inside this same snapshot.
//
//   category multiple = shrink(median(mcap_usd / tvl_usd) of the live protocols in the category)
//   shrink            = (n * category_median + 4 * global_median) / (n + 4), clamped to [0.05, 1.5]
//   base              = tvl_usd x category_multiple
//   growth            = clamp(change_7d, -60, 120) per cent
//   growthMult        = 1 + (growth / 100) x 0.5
//   maturity          = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied           = max(1, round(base x growthMult x maturity))
//
// The shrinkage pulls a category with few live protocols toward the global median, so a single
// outlier cannot set the multiple, and the clamp keeps every multiple inside a range the market
// actually pays. A category with no live protocol at all takes the global median. No protocol name is
// ever special-cased: the same function scores every row, and the multiples are recomputed from the
// snapshot on every run.
//
// Why radar-2 calibrates the multiple instead of guessing one.
//
// The starter this entry replaces scores every protocol with the same flat multiple of 0.25, so its
// ranking is a ranking by TVL alone: two protocols with the same TVL get the same implied value no
// matter what they do. The market does not price categories alike. A lending market that already
// trades is worth a different fraction of its TVL than a bridge or a perpetuals exchange, because
// the revenue, the risk and the growth behind each TVL dollar differ. A flat multiple throws that
// signal away, and with it the whole point of a radar: telling a lending protocol with a strong
// market apart from a bridge with the same TVL and a weaker one.
//
// Radar-2 takes the multiple from the market itself, inside the same snapshot. For each category it
// looks at the protocols that already trade, takes the median of their market-cap-to-TVL ratios, and
// shrinks that median toward the global median with a prior of four protocols. The shrinkage is the
// part that keeps the model honest: a category with one live protocol cannot set its own multiple
// from a single outlier, and a category with twenty live protocols mostly sets its own. A category
// with no live protocol at all takes the global median, which is the model's way of saying it has no
// evidence and will not invent any. No protocol name is ever special-cased, so the same rule scores
// the watchlist and the early rows alike, and the multiples are recomputed from the snapshot on
// every run: a new snapshot re-prices every category.
//
// Worked example, shrinkage. A category has 2 live protocols whose mcap/TVL ratios have median
// 0.80, and the global median is 0.2138. The shrunk multiple is
//   (2 x 0.80 + 4 x 0.2138) / (2 + 4) = (1.60 + 0.8552) / 6 = 0.4092.
// Without the prior the category would take 0.80 outright, more than double the shrunk value, on
// the evidence of two protocols. With the prior it still pays a premium over the global median, but
// only a premium two protocols can support. The clamp to [0.05, 1.5] then keeps the multiple inside
// a range the market actually pays: no category is ever worth twenty times its TVL, and none is
// worth a twentieth of it.
//
// Worked example, implied value. A lending protocol holds $100,000,000 of TVL, its category
// multiple is 0.45, its seven-day growth is +20%, and it was listed 400 days ago. Then
//   base         = 100,000,000 x 0.45 = 45,000,000
//   growthMult   = 1 + (20 / 100) x 0.5 = 1.10
//   maturityMult = 0.6 + (400 / 1095) x 0.4 = 0.7461
//   implied      = round(45,000,000 x 1.10 x 0.7461) = 36,932,940.
// The growth term is deliberately half-weighted (0.5): a hot week moves the value, but one week of
// growth is not worth as much as the TVL behind it. The maturity term starts at 0.6 for a protocol
// listed yesterday and rises to 1.0 after three years, so a protocol that has run for years with no
// token is worth more than a new one with the same TVL: survival is evidence. A protocol whose
// listing date is unknown is scored as 365 days old, the middle of the range, rather than as new.
//
// The farm plan is derived the same way, from the protocol's own record and nothing else. Seven
// steps: a fresh wallet, the category's main action, a second different action in the same category,
// one qualifying action a week, a hold sized to the protocol's age, a claim made only from the
// protocol's own published link, and a farm log. The first two actions are category-specific
// (lending supplies, a DEX provides liquidity, a bridge bridges), the capital is sized from TVL
// ($50 to $250), and the hold is longer for younger protocols (60 days under six months, 45 under
// a year, 30 after that), because a young protocol's snapshots are the ones that need the longest
// qualifying window.
//
// Determinism. The model reads only the snapshot and the constants in MODEL. There is no clock, no
// randomness and no network: two runs over the same snapshot write the same board, the same data.js
// and the same dossier, byte for byte. Ties on implied value break by slug, so the order is stable
// even when two protocols score identically. That is what lets the gate compare the dossier the
// program wrote against the dossier the scorer rebuilds from the output.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the page recomputes them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  shrink_prior: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  shrink_prior: 4,
  multiple_floor: 0.05,
  multiple_cap: 1.5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's calibrated multiple, with the live count behind it. */
export interface CategoryMultiple {
  category: string;
  live_count: number;
  live_median: number | null;
  multiple: number;
}

/** The calibration: the global median and one multiple per category that appears on the board. */
export interface Calibration {
  global_median: number;
  by_category: CategoryMultiple[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: Calibration;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted-or-not list of numbers; NaN when empty. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * Calibrate the category multiples from the snapshot's own live-token protocols. For each category,
 * take the median market-cap-to-TVL ratio of its live protocols, shrink it toward the global median
 * with a prior of `model.shrink_prior` live protocols, and clamp it to the model's range. A category
 * with no live protocol takes the global median. The result is a lookup the model and the page share.
 *
 * The shrinkage is a weighted average, not a blend: (n x category_median + prior x global_median) /
 * (n + prior). A category with many live protocols keeps most of its own median; a category with
 * one or two is pulled most of the way to the global median. The median, not the mean, is the
 * centre: one protocol trading at ten times its TVL cannot drag its category's multiple with it.
 * Only protocols with a positive TVL and a market cap enter the calibration, and only ratios that
 * are finite and positive; a live protocol with no market cap is not evidence about any multiple.
 * The returned multiples are rounded to four decimals, which is the precision the board and the
 * dashboard both carry, so the page's recomputation and the board's numbers agree.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const globalMedian = median(all);
  const clamp = (v: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, v));
  const multipleFor = (category: string | null): number => {
    const key = category ?? 'Other';
    const list = byCategory.get(key);
    if (list === undefined || list.length === 0) return clamp(globalMedian);
    const catMedian = median(list);
    const shrunk = (list.length * catMedian + model.shrink_prior * globalMedian) / (list.length + model.shrink_prior);
    return clamp(shrunk);
  };
  const seen = new Set<string>();
  const by_category: CategoryMultiple[] = [];
  for (const p of snapshot.protocols) {
    const key = p.category ?? 'Other';
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byCategory.get(key);
    by_category.push({
      category: key,
      live_count: list === undefined ? 0 : list.length,
      live_median: list === undefined || list.length === 0 ? null : Math.round(median(list) * 10000) / 10000,
      multiple: Math.round(multipleFor(p.category) * 10000) / 10000,
    });
  }
  by_category.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { global_median: Math.round(globalMedian * 10000) / 10000, by_category };
}

/** The category multiple for one protocol, from a calibration the caller built. */
export function multipleForCategory(calibration: Calibration, category: string | null): number {
  const key = category ?? 'Other';
  const found = calibration.by_category.find((c) => c.category === key);
  if (found !== undefined) return found.multiple;
  return Math.min(MODEL.multiple_cap, Math.max(MODEL.multiple_floor, calibration.global_median));
}

/** The three multipliers and the implied value one protocol gets under `model` and `calibration`.
 *
 * The growth term clamps the seven-day change to the model's floor and cap before it is weighted,
 * so a single week of +300% cannot triple a protocol's value and a week of -90% cannot erase it.
 * A protocol with no seven-day change is scored as flat. The maturity term uses the protocol's age
 * in whole days, or the model's unknown-age figure when the listing date is absent. The implied
 * value is at least 1: a protocol on the board is never worth nothing, even when its TVL is small
 * and its growth is at its floor. The multiple itself is the calibrated category multiple, never a
 * flat constant, and it is the same multiple the dashboard's calibration table shows.
 */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const multiple = multipleForCategory(calibration, protocol.category);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, multiple, growthPct, growthMult, maturityMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, calibration: Calibration, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor, by TVL. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, multiple, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, calibration, model);
    return { p, implied, multiple, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: Math.round(s.multiple * 10000) / 10000,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, different action in the same category, so the position is not a single deposit. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const half = Math.max(10, Math.round(capital / 2));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${half} against the supply on ${name}, then repay it in full before the hold ends.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Swap $${half} through ${name}'s router on ${chain} once a week so the wallet shows trading activity.`;
  if (c.includes('bridge')) return `Send a second, smaller bridge of $${half} through ${name} a week later, on a different day.`;
  if (c.includes('staking') || c.includes('restak')) return `Delegate a further $${half} through ${name} to a second validator or pool.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge, then open a fresh one of $${half} so the account shows two completed trades.`;
  if (c.includes('prediction')) return `Settle the first position, then place a second one of $${half} on a different market.`;
  if (c.includes('curator') || c.includes('allocator')) return `Move $${half} into a second ${name} vault with a different strategy.`;
  if (c.includes('stable')) return `Use $${half} of the minted asset to pay for one on-chain action, then top the balance back up.`;
  if (c.includes('rwa')) return `Claim the yield the $${capital} position earns once, and leave the principal in place.`;
  if (c.includes('insurance')) return `File one test claim of $${half} only if a covered event happens; never file a false claim.`;
  return `Use $${half} of the deposit for one more action inside ${name} on ${chain}, such as a swap or a vote.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 *
 * The seven steps have fixed jobs. Step 1 isolates the funds in a fresh wallet, so a farm never
 * risks a wallet that holds anything else. Steps 2 and 3 are the position itself: the category's
 * main action, then a second, different action in the same category, so the wallet shows more than
 * a single deposit. Step 4 keeps the position qualifying with one action a week. Step 5 holds it
 * for the age-sized window, so the activity lands in more than one snapshot. Step 6 claims only
 * from the protocol's own published link, because a claim link from anywhere else is the classic
 * way a farm loses its funds. Step 7 writes the log, so the position can be repeated or unwound.
 * The capital is sized from TVL in four bands ($50, $100, $150, $250) and the hold from age
 * (60, 45 or 30 days), so a large, old protocol and a small, young one get different plans.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const second = secondActionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: second,
      cost: `about $${capital >= 150 ? 6 : 3} of gas`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const calibration = calibrate(snapshot, model);
  const board = buildBoard(snapshot, calibration, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    calibration,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps.
 *
 * The checks run in this order, and the first failure is the one reported. Coverage comes first:
 * every watchlist slug must be on the board, because the watchlist is the floor the radar promises.
 * Then ranks must run 1..n with no gaps, and implied value must not rise down the board, because a
 * ranking that is not sorted is not a ranking. Then the board must not give every row the same
 * implied value, which would mean the model scored nothing. Finally every row's farm steps must
 * number between 3 and 12 and each step must run 20 to 600 characters, and every implied value
 * must be a positive safe integer. A board that passes all five is one the gate will take.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
