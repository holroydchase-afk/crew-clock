// Geofence fairness eval: the model. Pure functions, no I/O.
// Everything here is simulated from a seeded random generator. No real location data.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// The shipped rule itself (a UMD file), not a copy.
const Geo = require('../../js/geo.js') as typeof import('../../js/geo.js');

export const DEFAULT_SEED = 20261118;
export const DEFAULT_TRIALS = 20000;
export const RADII_FT = [150, 300, 600];

// A phone's stated accuracy is a 95% confidence radius (W3C Geolocation).
export const CONFIDENCE = 0.95;
// For a 2-D Gaussian error the distance is Rayleigh, so r95 = sigma * sqrt(-2 ln(1 - 0.95)).
export const R95_OVER_SIGMA = Math.sqrt(-2 * Math.log(1 - CONFIDENCE));

export const MILE_M = 1609;

export type Env = { label: string, accuracyMinM: number, accuracyMaxM: number, honesty: number };
// Assumptions, not field data. honesty = true 95% error / stated accuracy.
export const ENVIRONMENTS: Record<string, Env> = {
  open_sky: { label: 'Open sky, good GPS lock', accuracyMinM: 4, accuracyMaxM: 12, honesty: 1 },
  tree_cover: { label: 'Under tree cover', accuracyMinM: 15, accuracyMaxM: 45, honesty: 1 },
  hollow: { label: 'Steep hollow, few satellites in view', accuracyMinM: 40, accuracyMaxM: 120, honesty: 1 },
  overconfident: { label: 'Cheap phone that claims a better fix than it has (multipath)', accuracyMinM: 8, accuracyMaxM: 20, honesty: 3 },
  cell_only: { label: 'No GPS lock, cell towers only', accuracyMinM: 300, accuracyMaxM: 1500, honesty: 1 },
};
export const ENV_NAMES = Object.keys(ENVIRONMENTS);

export type Offsite = { key: string, label: string, distanceM: (radiusM: number) => number };
// Where a worker who is truly off site stands, measured from the pin.
export const OFFSITE: Offsite[] = [
  { key: '15', label: '1.5 x the radius', distanceM: (radiusM) => 1.5 * radiusM },
  { key: '3', label: '3 x the radius', distanceM: (radiusM) => 3 * radiusM },
  { key: 'Mile', label: '1 mile', distanceM: () => MILE_M },
];

export type Status = ReturnType<typeof Geo.fenceStatus>;
export type Policy = (reportedDistM: number, statedAccuracyM: number, radiusM: number) => Status;
export const POLICIES: Record<string, Policy> = {
  // What most time clocks do: inside the circle or not.
  strict: (reportedDistM, statedAccuracyM, radiusM) => (reportedDistM <= radiusM ? 'onsite' : 'offsite'),
  // The shipped rule.
  fair: (reportedDistM, statedAccuracyM, radiusM) => Geo.fenceStatus(reportedDistM, statedAccuracyM, radiusM),
  // A candidate: the shipped rule, with the benefit of the doubt capped at the radius.
  capped: (reportedDistM, statedAccuracyM, radiusM) => {
    const shipped = Geo.fenceStatus(reportedDistM, statedAccuracyM, radiusM);
    if (shipped === 'nogps' || shipped === 'weak') return shipped;
    return Geo.fenceStatus(reportedDistM, Math.min(Number(statedAccuracyM), radiusM), radiusM);
  },
};
export const POLICY_NAMES = Object.keys(POLICIES);

export const POLICY_LABELS: Record<string, string> = {
  strict: 'What most time clocks do: on site only if the reported spot is inside the circle.',
  fair: 'The shipped rule (`Geo.fenceStatus` in `js/geo.ts`): the stated accuracy is subtracted from the distance first.',
  capped: 'A candidate, not shipped: like `fair`, but the amount subtracted is never more than the radius.',
};

export const METRICS = ['onsiteWronglyFlagged', 'onsitePhotoAsked', 'onsiteClean',
  'offsitePassed15', 'offsitePassed3', 'offsitePassedMile',
  'offsitePhoto15', 'offsitePhoto3', 'offsitePhotoMile'];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sigma of each axis so that 95% of error distances are within statedAccuracyM * honesty.
export function sigmaFor(statedAccuracyM: number, honesty: number): number {
  return (statedAccuracyM * honesty) / R95_OVER_SIGMA;
}

// One 2-D Gaussian error vector in meters (Box-Muller).
export function sampleError(rng: () => number, sigma: number): { x: number, y: number } {
  const mag = sigma * Math.sqrt(-2 * Math.log(1 - rng()));
  const angle = 2 * Math.PI * rng();
  return { x: mag * Math.cos(angle), y: mag * Math.sin(angle) };
}

// clean | flagged | photo: what a status means for a clock-in. Nothing is ever blocked.
export type Outcome = 'clean' | 'flagged' | 'photo';
export function outcome(status: string): Outcome {
  if (status === 'onsite') return 'clean';
  if (status === 'weak' || status === 'nogps') return 'photo';
  return 'flagged';
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

// Every policy sees the same simulated fixes for a given (seed, environment, radius).
function cellSeed(seed: number, envName: string, radiusFt: number): number {
  return (seed + 1000003 * (ENV_NAMES.indexOf(envName) + 1) + 7919 * radiusFt) >>> 0;
}

export type MetricKey = `onsite${string}` | `offsite${string}`;
export type Cell = {
  env: string, radiusFt: number, policy: string,
  onsiteWronglyFlagged: number, onsitePhotoAsked: number, onsiteClean: number,
  [metric: MetricKey]: number,
};
type Tally = Record<Outcome, number>;

function simulate(envName: string, radiusFt: number, policyNames: string[], trials: number, seed: number): Cell[] {
  const env = ENVIRONMENTS[envName];
  if (!env) throw new Error('unknown environment: ' + envName);
  for (const p of policyNames) if (!POLICIES[p]) throw new Error('unknown policy: ' + p);
  const radiusM = Geo.toMeters(radiusFt);
  const rng = mulberry32(cellSeed(seed, envName, radiusFt));
  const counts = policyNames.map((): { onsite: Tally, offsite: Tally[] } => ({
    onsite: { clean: 0, flagged: 0, photo: 0 },
    offsite: OFFSITE.map(() => ({ clean: 0, flagged: 0, photo: 0 })),
  }));
  const reported = (trueDistM: number, sigma: number) => {
    const bearing = 2 * Math.PI * rng();
    const e = sampleError(rng, sigma);
    return Math.hypot(trueDistM * Math.cos(bearing) + e.x, trueDistM * Math.sin(bearing) + e.y);
  };
  for (let i = 0; i < trials; i++) {
    const accuracyM = env.accuracyMinM + (env.accuracyMaxM - env.accuracyMinM) * rng();
    const sigma = sigmaFor(accuracyM, env.honesty);
    // Truly on site: uniform by area inside the fence circle.
    const onDist = reported(radiusM * Math.sqrt(rng()), sigma);
    const offDists = OFFSITE.map((o) => reported(o.distanceM(radiusM), sigma));
    policyNames.forEach((p, k) => {
      counts[k].onsite[outcome(POLICIES[p](onDist, accuracyM, radiusM))]++;
      offDists.forEach((d, j) => { counts[k].offsite[j][outcome(POLICIES[p](d, accuracyM, radiusM))]++; });
    });
  }
  return policyNames.map((policy, k) => {
    const c = counts[k];
    const cell: Cell = {
      env: envName,
      radiusFt,
      policy,
      onsiteWronglyFlagged: round4(c.onsite.flagged / trials),
      onsitePhotoAsked: round4(c.onsite.photo / trials),
      onsiteClean: round4(c.onsite.clean / trials),
    };
    OFFSITE.forEach((o, j) => { cell[`offsitePassed${o.key}`] = round4(c.offsite[j].clean / trials); });
    OFFSITE.forEach((o, j) => { cell[`offsitePhoto${o.key}`] = round4(c.offsite[j].photo / trials); });
    return cell;
  });
}

export function runCell({ env, radiusFt, policy, trials = DEFAULT_TRIALS, seed = DEFAULT_SEED }: { env: string, radiusFt: number, policy: string, trials?: number, seed?: number }): Cell {
  return simulate(env, radiusFt, [policy], trials, seed)[0];
}

export type Result = { seed: number, trials: number, cells: Cell[] };
export function runAll({ trials = DEFAULT_TRIALS, seed = DEFAULT_SEED }: { trials?: number, seed?: number } = {}): Result {
  const cells: Cell[] = [];
  for (const env of ENV_NAMES) for (const radiusFt of RADII_FT) {
    cells.push(...simulate(env, radiusFt, POLICY_NAMES, trials, seed));
  }
  return { seed, trials, cells };
}
