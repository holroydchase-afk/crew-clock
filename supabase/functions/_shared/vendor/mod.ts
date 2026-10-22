// Loads the shared plain-JS modules (they attach themselves to globalThis).
import './geo.js';
import './report.js';
import './chain.js';
import './risk.js';

// deno-lint-ignore no-explicit-any
const g = globalThis as any;
export const Geo = g.Geo;
export const Report = g.Report;
export const Chain = g.Chain;
export const Risk = g.Risk;
