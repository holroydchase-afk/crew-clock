// Rules that flag punches worth a second look. Plain math, so they run on the
// cheapest phone and on the server alike. They flag; they never block.
type RiskFlag = { code: string, level: 'high' | 'low' };

(function (root) {
  const Geo = root.Geo || (typeof require !== 'undefined' ? require('./geo.js') : null);
  const MIN = 60000;

  const RULES: Record<string, { level: 'high' | 'low', words: string }> = {
    impossible_travel: { level: 'high', words: 'Moved faster than a truck can drive since the last punch' },
    shared_phone: { level: 'high', words: "Clocked in on someone else's phone" },
    frozen_gps: { level: 'high', words: 'Exact same GPS spot as an earlier day (possible fake location app)' },
    bad_signature: { level: 'high', words: 'Punch was changed after it left the phone' },
    future_time: { level: 'high', words: "Phone's clock is set ahead" },
    crew_inactive: { level: 'high', words: 'Sent after the boss turned this person off' },
    bad_location: { level: 'low', words: 'Phone sent an impossible GPS reading, so it was left off' },
    teammate_no_photo: { level: 'high', words: 'A foreman clocked this person in or out with no picture' },
    too_perfect: { level: 'low', words: 'GPS reported perfect accuracy, which real phones rarely do' },
    chain_gap: { level: 'low', words: 'A punch from this phone never arrived' },
    unsigned: { level: 'low', words: 'Old phone, punch not signed' },
    late_sync: { level: 'low', words: 'Sent more than 12 hours after the tap (no signal)' },
    odd_hours: { level: 'low', words: 'Punch between 10 PM and 4 AM' },
  };

  function hourIn(ms: number, timeZone: string) {
    try {
      return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date(ms)));
    } catch (e) {
      return new Date(ms).getHours();
    }
  }

  // p: the new punch. ctx: { crewHistory: earlier punches by this person,
  // deviceHistory: earlier punches from this phone, receivedAt, chain, timeZone }
  function assess(p: PunchFields, ctx?: { crewHistory?: PunchFields[], deviceHistory?: PunchFields[], receivedAt?: number, chain?: string, timeZone?: string }): RiskFlag[] {
    const c = ctx || {};
    const flags: RiskFlag[] = [];
    const add = (code: string) => flags.push({ code, level: RULES[code].level });
    if (p.type === 'void') return flags;

    const prior = (c.crewHistory || []).filter((x) => x.id !== p.id && x.lat != null && x.at < p.at)
      .sort((a, b) => b.at - a.at);
    if (p.lat != null && prior[0]) {
      const prev = prior[0];
      const meters = Geo.distanceM(Number(prev.lat), Number(prev.lng), p.lat, Number(p.lng));
      const secs = Math.max(1, (p.at - prev.at) / 1000);
      if (meters > 1000 && meters / secs > 40) add('impossible_travel');
    }
    if (p.lat != null && prior.some((x) => x.lat === p.lat && x.lng === p.lng && Math.abs(p.at - x.at) > 60 * MIN)) {
      add('frozen_gps');
    }
    if (p.accuracy != null && p.accuracy < 1.5) add('too_perfect');

    const isLeadPunch = p.byCrewId && p.byCrewId !== p.crewId;
    if (!isLeadPunch && p.deviceId) {
      const other = (c.deviceHistory || []).some((x) => x.deviceId === p.deviceId && x.crewId !== p.crewId &&
        x.byCrewId === x.crewId && Math.abs(x.at - p.at) < 15 * MIN);
      if (other) add('shared_phone');
    }
    // The server never gets `photo`, only `photoKey` once it uploaded, so a missing key means no
    // picture (PS-6). `photo` covers the phone before upload; `hasPhoto` the boss's team view.
    if (isLeadPunch && !p.photoKey && !p.photo && !p.hasPhoto) add('teammate_no_photo');

    if (c.receivedAt) {
      if (p.at - c.receivedAt > 5 * MIN) add('future_time');
      if (c.receivedAt - p.at > 12 * 60 * MIN) add('late_sync');
    }
    if (c.chain === 'unsigned') add('unsigned');
    if (c.chain === 'bad_signature') add('bad_signature');
    if (c.chain === 'gap') add('chain_gap');

    const h = hourIn(p.at, c.timeZone || 'America/New_York');
    if (h >= 22 || h < 4) add('odd_hours');
    return flags;
  }

  function topLevel(flags: { level: string }[] | null | undefined) {
    if (!flags || !flags.length) return null;
    return flags.some((f) => f.level === 'high') ? 'high' : 'low';
  }

  function describe(flag: { code: string }) { return (RULES[flag.code] || {}).words || flag.code; }

  const api = { RULES, assess, topLevel, describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Risk = api;
})(typeof self !== 'undefined' ? self : globalThis);

// What require('./risk.js') returns (the tests, Node) and what globals.d.ts gives self.Risk.
// Type-only: the build erases `export declare`, so js/risk.js stays a classic script.
export declare const RULES: Record<string, { level: "high" | "low", words: string }>;
export declare function assess(p: PunchFields, ctx?: { crewHistory?: PunchFields[], deviceHistory?: PunchFields[], receivedAt?: number, chain?: string, timeZone?: string }): RiskFlag[];
export declare function topLevel(flags: { level: string }[] | null | undefined): "high" | "low" | null;
export declare function describe(flag: { code: string }): string;
