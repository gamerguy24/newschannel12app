/** Display formatting shared by every screen and by Broadcast Mode. */

const DASH = '--';

export const formatTemp = (value: number | null | undefined, unit = '°'): string =>
  value === null || value === undefined || !Number.isFinite(value) ? DASH : `${Math.round(value)}${unit}`;

export const formatNumber = (value: number | null | undefined, digits = 0, suffix = ''): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? DASH
    : `${value.toFixed(digits)}${suffix}`;

export const formatPercent = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? DASH : `${Math.round(value)}%`;

export function formatWind(
  speed: number | null | undefined,
  direction?: string | number | null,
  gust?: number | null,
): string {
  if (speed === null || speed === undefined || !Number.isFinite(speed)) return DASH;
  if (speed < 1) return 'Calm';
  const dir = typeof direction === 'number' ? degreesToCompass(direction) : direction;
  const base = `${dir ? `${dir} ` : ''}${Math.round(speed)} mph`;
  return gust && gust > speed + 3 ? `${base} G${Math.round(gust)}` : base;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function degreesToCompass(degrees: number | null | undefined): string | null {
  if (degrees === null || degrees === undefined || !Number.isFinite(degrees)) return null;
  return COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

export function compassToDegrees(compass: string | null | undefined): number | null {
  if (!compass) return null;
  const index = COMPASS.indexOf(compass.toUpperCase());
  return index === -1 ? null : index * 22.5;
}

export function formatPressure(inHg: number | null | undefined, trend?: { direction: string } | null): string {
  if (inHg === null || inHg === undefined || !Number.isFinite(inHg)) return DASH;
  const arrow = trend?.direction === 'rising' ? ' ↑' : trend?.direction === 'falling' ? ' ↓' : '';
  return `${inHg.toFixed(2)} in${arrow}`;
}

export function formatVisibility(miles: number | null | undefined): string {
  if (miles === null || miles === undefined || !Number.isFinite(miles)) return DASH;
  if (miles >= 10) return '10+ mi';
  if (miles < 1) return `${(Math.round(miles * 4) / 4).toFixed(2).replace(/\.?0+$/, '')} mi`;
  return `${miles.toFixed(1)} mi`;
}

/* -------------------------------------------------------------------- time */

export function formatTime(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DASH;
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timeZone ?? undefined,
  });
}

export function formatHour(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DASH;
  return date
    .toLocaleTimeString('en-US', { hour: 'numeric', timeZone: timeZone ?? undefined })
    .replace(' ', '');
}

export function formatDayName(iso: string | null | undefined, style: 'short' | 'long' = 'short'): string {
  if (!iso) return DASH;
  const date = parseLocalDate(iso);
  if (!date) return DASH;
  return date.toLocaleDateString('en-US', { weekday: style });
}

export function formatDate(iso: string | null | undefined, style: 'short' | 'medium' = 'short'): string {
  if (!iso) return DASH;
  const date = parseLocalDate(iso);
  if (!date) return DASH;
  return style === 'short'
    ? date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * A bare "2026-09-04" parses as UTC midnight, which can render as the previous
 * day west of Greenwich. Parse date-only strings in local time instead.
 */
export function parseLocalDate(value: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isToday(iso: string): boolean {
  const date = parseLocalDate(iso);
  if (!date) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/** "in 18 min", "2 hr ago", "just now". */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return DASH;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return DASH;
  const deltaSec = Math.round((time - now) / 1000);
  const abs = Math.abs(deltaSec);
  const suffix = deltaSec < 0 ? ' ago' : '';
  const prefix = deltaSec > 0 ? 'in ' : '';

  if (abs < 45) return 'just now';
  if (abs < 3600) return `${prefix}${Math.round(abs / 60)} min${suffix}`;
  if (abs < 86400) {
    const hours = Math.round(abs / 3600);
    return `${prefix}${hours} hr${hours === 1 ? '' : 's'}${suffix}`;
  }
  const days = Math.round(abs / 86400);
  return `${prefix}${days} day${days === 1 ? '' : 's'}${suffix}`;
}

/** "until 9:00 PM" style expiry, with a day marker when it crosses midnight. */
export function formatExpiry(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return 'further notice';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'further notice';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = formatTime(iso, timeZone);
  if (sameDay) return time;
  const tomorrow = new Date(now.getTime() + 86400000);
  if (date.toDateString() === tomorrow.toDateString()) return `${time} tomorrow`;
  return `${time} ${date.toLocaleDateString('en-US', { weekday: 'short', timeZone: timeZone ?? undefined })}`;
}

/** Minutes remaining, floored at zero. */
export function minutesUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.round((time - now) / 60000));
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return DASH;
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export function formatDistance(miles: number | null | undefined): string {
  if (miles === null || miles === undefined || !Number.isFinite(miles)) return DASH;
  if (miles < 1) return 'less than a mile';
  return `${Math.round(miles)} mi`;
}

/* ------------------------------------------------------------------- text */

export const titleCase = (text: string): string =>
  text
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bNws\b/g, 'NWS');

/** NWS products are wrapped at 69 columns; rewrap them into real paragraphs. */
export function unwrapProductText(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split('\n')
        .map((line) => line.trimEnd())
        .join(
          // Preserve deliberate structure (headers, bullets, tables); join
          // ordinary prose lines back into a paragraph.
          ' ',
        )
        .replace(/\s{2,}/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
