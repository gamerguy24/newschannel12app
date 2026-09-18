/**
 * Broadcast ordering + colour treatment for NWS event types.
 *
 * `rank` drives which alert wins the BREAKING WEATHER banner (lower = louder).
 * Colours follow the long-standing NWS product colour conventions so the map
 * legend reads the way a viewer expects, while the palette itself is ours.
 */
const CATALOG = [
  { match: /tornado warning/i, rank: 1, kind: 'warning', tier: 'catastrophic', color: '#FF1B1B', group: 'tornado' },
  { match: /extreme wind warning/i, rank: 2, kind: 'warning', tier: 'catastrophic', color: '#FF3D3D', group: 'wind' },
  { match: /(hurricane|typhoon) warning/i, rank: 3, kind: 'warning', tier: 'catastrophic', color: '#D2042D', group: 'tropical' },
  { match: /storm surge warning/i, rank: 4, kind: 'warning', tier: 'severe', color: '#B21E7B', group: 'tropical' },
  { match: /flash flood warning/i, rank: 5, kind: 'warning', tier: 'severe', color: '#22B14C', group: 'flood' },
  { match: /severe thunderstorm warning/i, rank: 6, kind: 'warning', tier: 'severe', color: '#FFA200', group: 'thunderstorm' },
  { match: /(tropical storm) warning/i, rank: 7, kind: 'warning', tier: 'severe', color: '#F08080', group: 'tropical' },
  { match: /snow squall warning/i, rank: 8, kind: 'warning', tier: 'severe', color: '#04E9E7', group: 'winter' },
  { match: /(blizzard|ice storm) warning/i, rank: 9, kind: 'warning', tier: 'severe', color: '#7B68EE', group: 'winter' },
  { match: /winter storm warning/i, rank: 10, kind: 'warning', tier: 'severe', color: '#FF69B4', group: 'winter' },
  { match: /flood warning/i, rank: 11, kind: 'warning', tier: 'moderate', color: '#2E8B57', group: 'flood' },
  { match: /(high wind|wind chill|extreme cold) warning/i, rank: 12, kind: 'warning', tier: 'moderate', color: '#DAA520', group: 'wind' },
  { match: /(excessive heat|extreme heat) warning/i, rank: 12, kind: 'warning', tier: 'moderate', color: '#C71585', group: 'heat' },
  { match: /warning$/i, rank: 15, kind: 'warning', tier: 'moderate', color: '#E0533D', group: 'other' },

  { match: /tornado watch/i, rank: 20, kind: 'watch', tier: 'severe', color: '#FFFF00', group: 'tornado' },
  { match: /severe thunderstorm watch/i, rank: 21, kind: 'watch', tier: 'severe', color: '#DB7093', group: 'thunderstorm' },
  { match: /(hurricane|tropical storm|storm surge) watch/i, rank: 22, kind: 'watch', tier: 'moderate', color: '#FF00FF', group: 'tropical' },
  { match: /flash flood watch/i, rank: 23, kind: 'watch', tier: 'moderate', color: '#2E8B57', group: 'flood' },
  { match: /(winter storm|blizzard|ice storm) watch/i, rank: 24, kind: 'watch', tier: 'moderate', color: '#4682B4', group: 'winter' },
  { match: /flood watch/i, rank: 25, kind: 'watch', tier: 'moderate', color: '#3CB371', group: 'flood' },
  { match: /watch$/i, rank: 28, kind: 'watch', tier: 'moderate', color: '#D2B48C', group: 'other' },

  { match: /special weather statement/i, rank: 40, kind: 'statement', tier: 'minor', color: '#FFE4B5', group: 'thunderstorm' },
  { match: /(winter weather|freezing rain|frost|freeze|wind chill) advisory/i, rank: 42, kind: 'advisory', tier: 'minor', color: '#7B68EE', group: 'winter' },
  { match: /(flood|coastal flood) advisory/i, rank: 43, kind: 'advisory', tier: 'minor', color: '#00FF7F', group: 'flood' },
  { match: /heat advisory/i, rank: 44, kind: 'advisory', tier: 'minor', color: '#FF7F50', group: 'heat' },
  { match: /advisory$/i, rank: 45, kind: 'advisory', tier: 'minor', color: '#BDB76B', group: 'other' },
  { match: /(emergency)/i, rank: 0, kind: 'warning', tier: 'catastrophic', color: '#FF0033', group: 'other' },
];

const FALLBACK = { rank: 60, kind: 'statement', tier: 'minor', color: '#8FA3BF', group: 'other' };

export function classifyEvent(event = '') {
  const found = CATALOG.find((entry) => entry.match.test(event));
  const base = found ? { rank: found.rank, kind: found.kind, tier: found.tier, color: found.color, group: found.group } : { ...FALLBACK };
  // "Tornado Emergency" / "Flash Flood Emergency" arrive inside the headline,
  // not the event name; callers can bump the tier when they detect one.
  return base;
}

/** Alert types offered in the Severe Weather Center filter chips. */
export const ALERT_GROUPS = [
  { id: 'tornado', label: 'Tornado' },
  { id: 'thunderstorm', label: 'Thunderstorm' },
  { id: 'flood', label: 'Flood' },
  { id: 'winter', label: 'Winter' },
  { id: 'tropical', label: 'Tropical' },
  { id: 'wind', label: 'Wind' },
  { id: 'heat', label: 'Heat' },
  { id: 'other', label: 'Other' },
];

export const ALERT_KINDS = [
  { id: 'warning', label: 'Warnings' },
  { id: 'watch', label: 'Watches' },
  { id: 'advisory', label: 'Advisories' },
  { id: 'statement', label: 'Statements' },
];

export const SEVERITY_TIERS = [
  { id: 'catastrophic', label: 'Catastrophic' },
  { id: 'severe', label: 'Severe' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'minor', label: 'Minor' },
];
