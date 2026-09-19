import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode, type Ref } from 'react';
import { WeatherIcon } from '../ui/WeatherIcon';
import { getCountyBoundaries } from '../../services/weather';
import { formatDayName, formatTemp } from '../../utils/format';
import type {
  GraphicAlertArea,
  GraphicDay,
  GraphicHour,
  GraphicOutlook,
  GraphicPlace,
  GraphicSnapshot,
} from '../../api/types';

/**
 * ON-AIR GRAPHIC TEMPLATES
 *
 * The Storm 12 Weather graphics package: the 1920x1080 templates shared by
 * the Graphics Studio monitors, the gallery and rundown thumbnails, and the
 * /output playout page. Every template draws from a GraphicSnapshot - values
 * frozen at the moment of a take - so what is on program never shifts under
 * the operator.
 *
 * Drawn as SVG: one markup scales from a 132px thumbnail to a full-frame
 * browser source, and the studio exports the same markup straight to PNG.
 *
 * Layout grid shared by every full-screen template: lockup and time stamp in
 * the top band, a tag at y=236, a title at y=356, content between y=400 and
 * y=940, and the brand band from y=984. Nothing that must read leaves the
 * title-safe margin.
 */

export const W = 1920;
export const H = 1080;
const SAFE_X = 90;

const FONT = "Inter, 'Segoe UI', Arial, sans-serif";
const BRAND_FONT = "'Russo One', 'Arial Black', sans-serif";
const TILE_BLUE = '#1d4f9c';
const ACCENT = '#2f7bff';
const ALERT_RED = '#d0142c';
const PANEL = '#06183a';
const PANEL_LINE = '#3a6cc4';
const DIM = '#a9c1e2';
const SOFT = '#dbe7f5';
const RAIN = '#7fc4ff';

/* ------------------------------------------------------------- registry */

export interface TemplateField {
  key: string;
  label: string;
  type?: 'text' | 'area';
  /** Filled from the live observation unless the operator types over it. */
  live?: boolean;
  wide?: boolean;
  help?: string;
  placeholder?: string;
}

export interface TemplateDef {
  id: string;
  name: string;
  group: 'Full screen' | 'Overlays';
  /** Overlays carry no ground: they export and play out with alpha. */
  overlay?: boolean;
  hint?: string;
  fields: TemplateField[];
}

const KICKER: TemplateField = {
  key: 'kicker',
  label: 'Kicker',
  wide: true,
  help: 'The tag above the headline. Leave blank for the default.',
};
const HEADLINE: TemplateField = { key: 'headline', label: 'Headline', wide: true };
const DETAIL: TemplateField = { key: 'detail', label: 'Detail', type: 'area', wide: true };
const live = (key: string, label: string): TemplateField => ({ key, label, live: true });

export const GRAPHIC_TEMPLATES: TemplateDef[] = [
  {
    id: 'conditions',
    name: 'Current Conditions',
    group: 'Full screen',
    hint: 'Filled from the live observation. Type to override a value.',
    fields: [
      KICKER,
      live('temperature', 'Temperature'),
      live('condition', 'Condition'),
      live('feelsLike', 'Feels like'),
      live('wind', 'Wind'),
      live('humidity', 'Humidity'),
      live('location', 'Location'),
    ],
  },
  {
    id: 'hourly',
    name: 'Next 12 Hours',
    group: 'Full screen',
    hint: 'Temperatures, sky and rain chances from the live hourly forecast.',
    fields: [KICKER],
  },
  {
    id: 'planner',
    name: 'Day Planner',
    group: 'Full screen',
    hint: 'Morning, afternoon and evening from the live hourly forecast.',
    fields: [KICKER],
  },
  {
    id: 'sevenday',
    name: 'Seven Day',
    group: 'Full screen',
    hint: 'Days, icons and temperatures from the live 7-day forecast.',
    fields: [KICKER],
  },
  {
    id: 'areatemps',
    name: 'Area Temperatures',
    group: 'Full screen',
    hint: 'Current temperatures for the ticker markets on the county map. Edit the list under Ticker & Markets.',
    fields: [KICKER],
  },
  {
    id: 'severe',
    name: 'Severe Outlook',
    group: 'Full screen',
    hint: 'Day 1-3 risk levels from the Storm Prediction Center.',
    fields: [KICKER, { key: 'detail', label: 'Threats line', wide: true, placeholder: 'Main threats: damaging wind and hail' }],
  },
  {
    id: 'weatherday',
    name: 'Weather Alert Day',
    group: 'Full screen',
    hint: 'The day-ahead heads-up: name the hazard and when it arrives.',
    fields: [
      { key: 'kicker', label: 'Banner', wide: true, placeholder: 'Weather Alert Day' },
      { key: 'when', label: 'When', wide: true, placeholder: 'Today through Saturday' },
      { key: 'what', label: 'What', type: 'area', wide: true, placeholder: 'Extreme heat and high humidity' },
    ],
  },
  {
    id: 'heatindex',
    name: 'Heat Index Map',
    group: 'Full screen',
    hint: 'Heat index for the ticker markets, shading the county map.',
    fields: [
      { key: 'kicker', label: 'Title', wide: true, placeholder: "Today's Heat Index" },
      { key: 'detail', label: 'Subtitle', wide: true, placeholder: '3:00 PM' },
    ],
  },
  {
    id: 'compare',
    name: 'Highs vs Feels Like',
    group: 'Full screen',
    hint: 'The next four days, forecast high against apparent temperature.',
    fields: [
      { key: 'kicker', label: 'Title', wide: true, placeholder: 'Highs vs Feels Like' },
      { key: 'detail', label: 'Subtitle', wide: true },
    ],
  },
  {
    id: 'alertmap',
    name: 'Alert Map',
    group: 'Full screen',
    hint: 'Counties shaded by the alerts in force across the coverage area.',
    fields: [
      { key: 'kicker', label: 'Title', wide: true, placeholder: 'Weather Alerts' },
      { key: 'detail', label: 'Subtitle', wide: true, placeholder: 'In effect now' },
    ],
  },
  {
    id: 'headlines',
    name: 'Weather Headlines',
    group: 'Full screen',
    fields: [
      KICKER,
      HEADLINE,
      { key: 'line1', label: 'Point 1', wide: true },
      { key: 'line2', label: 'Point 2', wide: true },
      { key: 'line3', label: 'Point 3', wide: true },
    ],
  },
  { id: 'quote', name: 'Forecast Statement', group: 'Full screen', fields: [KICKER, HEADLINE, DETAIL] },
  { id: 'alert', name: 'Alert Lower Third', group: 'Overlays', overlay: true, fields: [KICKER, HEADLINE, DETAIL] },
  {
    id: 'ltconditions',
    name: 'Conditions Lower Third',
    group: 'Overlays',
    overlay: true,
    hint: 'Filled from the live observation. Type to override a value.',
    fields: [
      KICKER,
      live('location', 'Location'),
      live('temperature', 'Temperature'),
      live('condition', 'Condition'),
      live('wind', 'Wind'),
      live('feelsLike', 'Feels like'),
    ],
  },
  {
    id: 'bug',
    name: 'Temperature Bug',
    group: 'Overlays',
    overlay: true,
    hint: 'A corner bug for live shots, filled from the live observation.',
    fields: [live('temperature', 'Temperature'), live('condition', 'Condition'), live('location', 'Location')],
  },
];

export const templateDef = (id: string) => GRAPHIC_TEMPLATES.find((t) => t.id === id) ?? GRAPHIC_TEMPLATES[0];
export const templateName = (id: string) => GRAPHIC_TEMPLATES.find((t) => t.id === id)?.name ?? id;
export const isOverlay = (id: string) => Boolean(GRAPHIC_TEMPLATES.find((t) => t.id === id)?.overlay);

export type Fields = Record<string, string>;

/* ------------------------------------------------------------------ ids */

// Several graphics share a page (two monitors, the gallery, the rundown), so
// gradient and filter ids are namespaced per SVG rather than colliding.
const GidContext = createContext('gfx');

function useGid() {
  const prefix = useContext(GidContext);
  return (name: string) => `${prefix}-${name}`;
}

/* ------------------------------------------------------------- helpers */

/** Readable ink for text sitting on a coloured fill. */
function inkFor(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return '#ffffff';
  const n = Number.parseInt(match[1], 16);
  const luma = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return luma > 150 ? '#0b1a33' : '#ffffff';
}

/** The station's temperature ramp, used for every temperature fill. */
function tempFill(t: number | null): string {
  if (t === null) return '#3a4656';
  if (t < 32) return '#7aa7ff';
  if (t < 50) return '#5cc8ff';
  if (t < 65) return '#5fd38d';
  if (t < 80) return '#f5d04a';
  if (t < 90) return '#f5963b';
  return '#e8513a';
}

/** Catmull-Rom through the points, as cubic Beziers: a curve, not a zigzag. */
function smoothPath(points: Array<[number, number]>): string {
  if (points.length < 2) return '';
  let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function wrap(text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (`${line} ${word}`.trim().length > width && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) return lines;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

/* --------------------------------------------------------------- pieces */

function SharedDefs() {
  const id = useGid();
  return (
    <defs>
      <radialGradient id={id('sky')} cx="0.72" cy="0.12" r="1.15">
        <stop offset="0%" stopColor="#1f4f9c" />
        <stop offset="42%" stopColor="#0b2552" />
        <stop offset="100%" stopColor="#030c1f" />
      </radialGradient>
      <linearGradient id={id('chrome')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="46%" stopColor="#e6ebf1" />
        <stop offset="54%" stopColor="#a9b5c3" />
        <stop offset="100%" stopColor="#dfe5ec" />
      </linearGradient>
      <linearGradient id={id('tile')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#cfd8e2" />
      </linearGradient>
      <linearGradient id={id('band-line')} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor={ACCENT} />
        <stop offset="60%" stopColor="#9cc7ff" />
        <stop offset="100%" stopColor="#9cc7ff" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={id('panel')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#0a2250" stopOpacity="0.82" />
        <stop offset="100%" stopColor={PANEL} stopOpacity="0.82" />
      </linearGradient>
      <filter id={id('shadow')} x="-10%" y="-10%" width="120%" height="130%">
        <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="#000814" floodOpacity="0.55" />
      </filter>
    </defs>
  );
}

/** Storm-blue sky with the radar rings from the station artwork. */
function Ground() {
  const id = useGid();
  return (
    <>
      <rect width={W} height={H} fill={`url(#${id('sky')})`} />
      <g fill="none" stroke="#6fa4ff" strokeOpacity="0.1" strokeWidth="3">
        {[260, 440, 620, 800].map((r) => (
          <circle key={r} cx="160" cy={H} r={r} />
        ))}
      </g>
    </>
  );
}

/** The Storm 12 Weather lockup, same geometry as the site logo. */
function Lockup({ x, y, height }: { x: number; y: number; height: number }) {
  const id = useGid();
  return (
    <g transform={`translate(${x} ${y}) scale(${height / 92})`} filter={`url(#${id('shadow')})`}>
      <text x="0" y="54" fontFamily={BRAND_FONT} fontSize="56" fill={`url(#${id('chrome')})`} textLength="198" lengthAdjust="spacingAndGlyphs">
        STORM
      </text>
      <rect x="208" y="3" width="90" height="64" rx="9" fill={`url(#${id('tile')})`} />
      <text x="253" y="55" textAnchor="middle" fontFamily={BRAND_FONT} fontSize="52" fill={TILE_BLUE} textLength="70" lengthAdjust="spacingAndGlyphs">
        12
      </text>
      <text x="14" y="89" fontFamily={BRAND_FONT} fontSize="25" fill="#ffffff" textLength="172" lengthAdjust="spacingAndGlyphs">
        WEATHER
      </text>
    </g>
  );
}

/** The silver "12" tile on its own, for overlays. */
function Tile({ x, y, w, h, fontSize }: { x: number; y: number; w: number; h: number; fontSize: number }) {
  const id = useGid();
  return (
    <>
      <rect x={x} y={y} width={w} height={h} fill={`url(#${id('tile')})`} />
      <text
        x={x + w / 2}
        y={y + h / 2 + fontSize * 0.36}
        textAnchor="middle"
        fontFamily={BRAND_FONT}
        fontSize={fontSize}
        fill={TILE_BLUE}
        textLength={w * 0.75}
        lengthAdjust="spacingAndGlyphs"
      >
        12
      </text>
    </>
  );
}

function Header({ stamp }: { stamp: string }) {
  return (
    <>
      <Lockup x={SAFE_X} y={64} height={118} />
      <text x={W - SAFE_X} y="118" textAnchor="end" fontFamily={FONT} fontSize="32" fontWeight="600" fill="#b9cde8">
        {stamp}
      </text>
    </>
  );
}

function Tag({ x, y, text, color = ACCENT }: { x: number; y: number; text: string; color?: string }) {
  const label = text.toUpperCase();
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={label.length * 19 + 56} height="52" rx="6" fill={color} />
      <text x="28" y="36" fontFamily={FONT} fontSize="26" fontWeight="800" letterSpacing="3" fill="#ffffff">
        {label}
      </text>
    </g>
  );
}

function Title({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <text x={SAFE_X} y="356" fontFamily={FONT} fontSize="60" fontWeight="700" fill={muted ? '#5f7ea8' : '#ffffff'}>
      {children}
    </text>
  );
}

function Card({ x, y, w, h, accent, highlight }: { x: number; y: number; w: number; h: number; accent?: string; highlight?: boolean }) {
  const id = useGid();
  return (
    <>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="22"
        fill={highlight ? '#123f86' : `url(#${id('panel')})`}
        fillOpacity={highlight ? 0.85 : 1}
        stroke={PANEL_LINE}
        strokeOpacity={highlight ? 0.85 : 0.45}
        strokeWidth="2"
      />
      {accent && <path d={`M${x + 22} ${y} H${x + w - 22} A22 22 0 0 1 ${x + w} ${y + 22} V${y + 10} H${x} V${y + 22} A22 22 0 0 1 ${x + 22} ${y} Z`} fill={accent} />}
    </>
  );
}

/** Bottom brand band shared by every full-screen template. */
function Band({ station, market }: { station: string; market: string }) {
  const id = useGid();
  const y = H - 96;
  const name = station.toUpperCase();
  const nameWidth = name.length * 20.6;
  return (
    <g>
      <rect y={y} width={W} height="96" fill="#041026" fillOpacity="0.94" />
      <rect y={y} width={W} height="5" fill={`url(#${id('band-line')})`} />
      <text x={SAFE_X} y={y + 60} fontFamily={BRAND_FONT} fontSize="34" fill="#ffffff" textLength={nameWidth} lengthAdjust="spacingAndGlyphs">
        {name}
      </text>
      <text x={SAFE_X + nameWidth + 30} y={y + 59} fontFamily={FONT} fontSize="28" fontWeight="600" letterSpacing="2" fill="#9fb8da">
        FIRST ALERT FORECAST
      </text>
      <text x={W - SAFE_X} y={y + 59} textAnchor="end" fontFamily={FONT} fontSize="30" fontWeight="700" fill={SOFT}>
        {market}
      </text>
    </g>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <text x={W / 2} y="660" textAnchor="middle" fontFamily={FONT} fontSize="40" fontWeight="600" fill="#9fb8da">
      {children}
    </text>
  );
}

/* ------------------------------------------------- full-screen templates */

interface TemplateProps {
  f: Fields;
  station: string;
  market: string;
  stamp: string;
}

function ConditionsGraphic({ f, station, market, stamp, icon }: TemplateProps & { icon: string }) {
  const id = useGid();
  const rows: Array<[string, string | undefined]> = [
    ['Feels like', f.feelsLike],
    ['Wind', f.wind],
    ['Humidity', f.humidity],
  ];
  return (
    <>
      <Ground />
      <Header stamp={stamp} />
      <Tag x={SAFE_X} y={236} text={f.kicker || 'Current Conditions'} />
      <Title>{f.location || market}</Title>

      <g transform="translate(70 420)">
        <WeatherIcon name={icon} size={230} animated={false} />
      </g>
      <text x="320" y="660" fontFamily={FONT} fontSize="300" fontWeight="800" letterSpacing="-12" fill="#ffffff" filter={`url(#${id('shadow')})`}>
        {f.temperature || '--'}
      </text>
      <text x={SAFE_X + 6} y="780" fontFamily={FONT} fontSize="68" fontWeight="700" fill={SOFT}>
        {f.condition}
      </text>

      <Card x={1150} y={236} w={680} h={600} />
      {rows.map(([label, value], i) => {
        const top = 236 + i * 200;
        return (
          <g key={label}>
            <text x="1200" y={top + 82} fontFamily={FONT} fontSize="34" fontWeight="500" fill={DIM}>
              {label}
            </text>
            <text x="1200" y={top + 160} fontFamily={FONT} fontSize="72" fontWeight="800" fill="#ffffff">
              {value || '--'}
            </text>
            {i < rows.length - 1 && (
              <line x1="1200" x2="1780" y1={top + 200} y2={top + 200} stroke={PANEL_LINE} strokeOpacity="0.35" strokeWidth="2" />
            )}
          </g>
        );
      })}

      <Band station={station} market={market} />
    </>
  );
}

/** Next 12 hours: a temperature curve over the hours, rain chances beneath. */
function HourlyGraphic({ f, station, market, stamp, hours }: TemplateProps & { hours: GraphicHour[] }) {
  const id = useGid();
  const list = hours.slice(0, 12);
  const panel = { x: SAFE_X, y: 400, w: W - SAFE_X * 2, h: 540 };
  const colW = panel.w / 12;
  const cx = (i: number) => panel.x + colW * (i + 0.5);

  const temps = list.map((h) => h.temp).filter((t): t is number => t !== null);
  const hi = temps.length ? Math.max(...temps) : 0;
  const lo = temps.length ? Math.min(...temps) : 0;
  // A flat evening still gets a readable curve: never less than 6 degrees tall.
  const span = Math.max(hi - lo, 6);
  const mid = (hi + lo) / 2;
  const top = 648;
  const bottom = 772;
  const yFor = (t: number) => (top + bottom) / 2 - ((t - mid) / span) * (bottom - top);

  const points = list
    .map((h, i) => (h.temp === null ? null : ([cx(i), yFor(h.temp)] as [number, number])))
    .filter((p): p is [number, number] => p !== null);
  const line = smoothPath(points);
  const floor = 812;
  const area = points.length > 1 ? `${line} L${points[points.length - 1][0]} ${floor} L${points[0][0]} ${floor} Z` : '';

  return (
    <>
      <Ground />
      <Header stamp={stamp} />
      <Tag x={SAFE_X} y={236} text={f.kicker || 'Next 12 Hours'} />
      <Title>{market}</Title>

      <defs>
        <linearGradient id={id('curve-fill')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffc93d" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#ffc93d" stopOpacity="0" />
        </linearGradient>
      </defs>
      <Card x={panel.x} y={panel.y} w={panel.w} h={panel.h} />

      {list.length === 0 ? (
        <Empty>Loading the hourly forecast</Empty>
      ) : (
        <>
          <rect x={panel.x + 2} y={panel.y + 2} width={colW - 2} height={panel.h - 4} rx="20" fill="#ffffff" fillOpacity="0.05" />
          {area && <path d={area} fill={`url(#${id('curve-fill')})`} />}
          {line && <path d={line} fill="none" stroke="#ffc93d" strokeWidth="6" strokeLinecap="round" />}

          {list.map((h, i) => {
            const y = h.temp === null ? null : yFor(h.temp);
            const precip = Math.max(0, Math.min(100, h.precip ?? 0));
            const barH = (precip / 100) * 56;
            return (
              <g key={h.time || i}>
                {i > 0 && (
                  <line x1={panel.x + colW * i} x2={panel.x + colW * i} y1={panel.y + 30} y2={panel.y + 150} stroke={PANEL_LINE} strokeOpacity="0.25" strokeWidth="2" />
                )}
                <text x={cx(i)} y="458" textAnchor="middle" fontFamily={FONT} fontSize="30" fontWeight="700" fill={i === 0 ? '#ffffff' : SOFT}>
                  {i === 0 ? 'Now' : h.label}
                </text>
                <g transform={`translate(${cx(i) - 44} 472)`}>
                  <WeatherIcon name={h.icon} size={88} animated={false} />
                </g>
                {y !== null && (
                  <>
                    <text x={cx(i)} y={y - 26} textAnchor="middle" fontFamily={FONT} fontSize="42" fontWeight="800" fill="#ffffff">
                      {formatTemp(h.temp)}
                    </text>
                    <circle cx={cx(i)} cy={y} r="9" fill="#ffffff" stroke="#ffc93d" strokeWidth="4" />
                  </>
                )}
                <rect x={cx(i) - 30} y={886 - 56} width="60" height="56" rx="6" fill="#1a3358" />
                {barH > 0 && <rect x={cx(i) - 30} y={886 - barH} width="60" height={barH} rx="6" fill="#3f8cff" />}
                <text x={cx(i)} y="922" textAnchor="middle" fontFamily={FONT} fontSize="26" fontWeight="600" fill={RAIN}>
                  {precip}%
                </text>
              </g>
            );
          })}
        </>
      )}

      <Band station={station} market={market} />
    </>
  );
}

const PERIODS = [
  { name: 'Morning', hour: 8, color: '#ffb347' },
  { name: 'Afternoon', hour: 14, color: '#ffd24d' },
  { name: 'Evening', hour: 20, color: '#8fa8ff' },
];

/** Day planner: the next morning, afternoon and evening, side by side. */
function PlannerGraphic({ f, station, market, stamp, hours }: TemplateProps & { hours: GraphicHour[] }) {
  const gap = 24;
  const cardW = (W - SAFE_X * 2 - gap * 2) / 3;
  return (
    <>
      <Ground />
      <Header stamp={stamp} />
      <Tag x={SAFE_X} y={236} text={f.kicker || 'Day Planner'} />
      <Title>{market}</Title>

      {hours.length === 0 ? (
        <Empty>Loading the hourly forecast</Empty>
      ) : (
        PERIODS.map((period, i) => {
          const hour = hours.find((h) => h.hour === period.hour);
          const x = SAFE_X + i * (cardW + gap);
          return (
            <g key={period.name}>
              <Card x={x} y={400} w={cardW} h={540} accent={period.color} />
              <text x={x + 40} y="486" fontFamily={FONT} fontSize="48" fontWeight="800" fill="#ffffff">
                {period.name}
              </text>
              <text x={x + cardW - 40} y="484" textAnchor="end" fontFamily={FONT} fontSize="30" fontWeight="600" fill={DIM}>
                {hour ? `${hour.dayLabel} · ${hour.label}` : ''}
              </text>
              <g transform={`translate(${x + cardW / 2 - 90} 516)`}>
                <WeatherIcon name={hour?.icon ?? 'cloudy'} size={180} animated={false} />
              </g>
              <text x={x + cardW / 2} y="810" textAnchor="middle" fontFamily={FONT} fontSize="140" fontWeight="800" letterSpacing="-6" fill="#ffffff">
                {hour ? formatTemp(hour.temp) : '--'}
              </text>
              <text x={x + cardW / 2} y="866" textAnchor="middle" fontFamily={FONT} fontSize="34" fontWeight="600" fill={SOFT}>
                {(hour?.condition ?? '').slice(0, 26)}
              </text>
              <text x={x + cardW / 2} y="912" textAnchor="middle" fontFamily={FONT} fontSize="30" fontWeight="600" fill={RAIN}>
                {hour ? `${hour.precip ?? 0}% rain` : ''}
              </text>
            </g>
          );
        })
      )}

      <Band station={station} market={market} />
    </>
  );
}

function SevenDayGraphic({ f, station, market, stamp, days }: TemplateProps & { days: GraphicDay[] }) {
  const list = days.slice(0, 7);
  const gap = 20;
  const colW = (W - SAFE_X * 2 - gap * 6) / 7;
  return (
    <>
      <Ground />
      <Header stamp={stamp} />
      <Tag x={SAFE_X} y={236} text={f.kicker || '7-Day Forecast'} />
      <Title>{market}</Title>

      {list.length === 0 && <Empty>Loading the forecast</Empty>}
      {list.map((day, i) => {
        const x = SAFE_X + i * (colW + gap);
        return (
          <g key={day.date || i}>
            <Card x={x} y={410} w={colW} h={520} highlight={i === 0} />
            <text x={x + colW / 2} y="482" textAnchor="middle" fontFamily={FONT} fontSize="40" fontWeight="800" fill="#ffffff">
              {i === 0 ? 'Today' : formatDayName(day.date, 'short')}
            </text>
            <g transform={`translate(${x + colW / 2 - 66} 514)`}>
              <WeatherIcon name={day.icon} size={132} animated={false} />
            </g>
            <text x={x + colW / 2} y="746" textAnchor="middle" fontFamily={FONT} fontSize="100" fontWeight="800" letterSpacing="-3" fill="#ffffff">
              {formatTemp(day.high)}
            </text>
            <text x={x + colW / 2} y="816" textAnchor="middle" fontFamily={FONT} fontSize="56" fontWeight="600" fill="#9fb8da">
              {formatTemp(day.low)}
            </text>
            <text x={x + colW / 2} y="882" textAnchor="middle" fontFamily={FONT} fontSize="30" fontWeight="600" fill={RAIN}>
              {day.precipProbability ?? 0}% rain
            </text>
          </g>
        );
      })}

      <Band station={station} market={market} />
    </>
  );
}

/* ---------------------------------------------------- area temperature map */

const MAP = { x: SAFE_X, y: 214, w: W - SAFE_X * 2, h: 740 };

let countyCache: GeoJSON.FeatureCollection | null = null;
let countyRequest: Promise<void> | null = null;

/** County outlines, fetched once per page and shared by every map graphic. */
function useCountyShapes(enabled: boolean) {
  const [shapes, setShapes] = useState(countyCache);
  useEffect(() => {
    if (!enabled || countyCache) return undefined;
    let alive = true;
    if (!countyRequest) {
      countyRequest = getCountyBoundaries()
        .then((collection) => {
          countyCache = collection;
        })
        .catch(() => {
          countyRequest = null;
        });
    }
    countyRequest.then(() => {
      if (alive) setShapes(countyCache);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return enabled ? shapes : null;
}

/** Fit the towns into the map frame: equirectangular, corrected for latitude. */
function fitProjection(places: GraphicPlace[]) {
  const lats = places.map((p) => p.lat);
  const lons = places.map((p) => p.lon);
  const cLat = (Math.max(...lats) + Math.min(...lats)) / 2;
  const cLon = (Math.max(...lons) + Math.min(...lons)) / 2;
  const kx = Math.cos((cLat * Math.PI) / 180);
  // Padding leaves room for the callout cards around the outermost towns.
  const spanLon = (Math.max(...lons) - Math.min(...lons) + 1.2) * kx;
  const spanLat = Math.max(...lats) - Math.min(...lats) + 0.8;
  const k = Math.min(MAP.w / spanLon, MAP.h / spanLat);
  const halfLon = MAP.w / 2 / (k * kx);
  const halfLat = MAP.h / 2 / k;
  return {
    project: (lon: number, lat: number): [number, number] => [
      MAP.x + MAP.w / 2 + (lon - cLon) * kx * k,
      MAP.y + MAP.h / 2 - (lat - cLat) * k,
    ],
    bounds: { west: cLon - halfLon, east: cLon + halfLon, south: cLat - halfLat, north: cLat + halfLat },
  };
}

interface CountyShape {
  id: string;
  name: string;
  d: string;
  cx: number;
  cy: number;
}

/**
 * Every county that touches the frame, projected once and kept separately.
 * Separately, because the alert map fills counties individually and the heat
 * map shades each one by the nearest town; the plain temperature map merges
 * them back into a single path.
 */
function countyShapes(collection: GeoJSON.FeatureCollection, fit: ReturnType<typeof fitProjection>): CountyShape[] {
  const { bounds: b, project } = fit;
  const margin = 0.3;
  const shapes: CountyShape[] = [];

  for (const feature of collection.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const polygons =
      geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];

    let d = '';
    let sumX = 0;
    let sumY = 0;
    let points = 0;

    for (const polygon of polygons) {
      for (const ring of polygon) {
        const touches = ring.some(
          (pt) => pt[0] >= b.west - margin && pt[0] <= b.east + margin && pt[1] >= b.south - margin && pt[1] <= b.north + margin,
        );
        if (!touches) continue;
        ring.forEach((pt, i) => {
          const [x, y] = project(pt[0], pt[1]);
          d += `${i ? 'L' : 'M'}${x.toFixed(0)} ${y.toFixed(0)}`;
          sumX += x;
          sumY += y;
          points += 1;
        });
        d += 'Z';
      }
    }

    if (!d) continue;
    shapes.push({
      id: String(feature.properties?.id ?? ''),
      name: String(feature.properties?.name ?? ''),
      d,
      cx: sumX / points,
      cy: sumY / points,
    });
  }
  return shapes;
}

/** All of them as one path: one node, when nothing needs shading per county. */
const mergedPath = (shapes: CountyShape[]) => shapes.map((shape) => shape.d).join('');

const CARD_W = 170;
const CARD_H = 96;

/** Where a callout card may sit relative to its town, nearest slot first. */
const OFFSETS: Array<[number, number]> = [
  [0, -90],
  [0, 90],
  [-130, 0],
  [130, 0],
  [-125, -78],
  [125, -78],
  [-125, 78],
  [125, 78],
  [0, -180],
  [0, 180],
  [-250, 0],
  [250, 0],
  [-210, -150],
  [210, -150],
  [-210, 150],
  [210, 150],
];

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Callout {
  place: GraphicPlace;
  px: number;
  py: number;
  cx: number;
  cy: number;
}

/** Shared area of two boxes, in square pixels. */
const shared = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/**
 * Callout cards on leader lines. Each town takes the nearest slot that is
 * clear of every other card, town dot and the tag and stays inside the frame -
 * towns twenty miles apart would otherwise stack their temperatures on top of
 * each other around the metro.
 *
 * When no slot is perfectly clear, the one with the least overlap wins, and
 * leaving the frame costs double: a card nudging a neighbour still reads, a
 * card hanging off the map into the header does not.
 */
function layoutCallouts(
  places: GraphicPlace[],
  project: (lon: number, lat: number) => [number, number],
  tag: string,
): Callout[] {
  const points = places.map((place) => ({ place, xy: project(place.lon, place.lat) }));
  const dots: Box[] = points.map(({ xy }) => ({ x0: xy[0] - 12, y0: xy[1] - 12, x1: xy[0] + 12, y1: xy[1] + 12 }));
  const placed: Box[] = [{ x0: MAP.x + 30, y0: MAP.y + 30, x1: MAP.x + 30 + tag.length * 19 + 56, y1: MAP.y + 82 }];
  const frame: Box = { x0: MAP.x + 8, y0: MAP.y + 8, x1: MAP.x + MAP.w - 8, y1: MAP.y + MAP.h - 8 };
  const cardBox = (cx: number, cy: number): Box => ({
    x0: cx - CARD_W / 2 - 6,
    y0: cy - CARD_H / 2 - 6,
    x1: cx + CARD_W / 2 + 6,
    y1: cy + CARD_H / 2 + 6,
  });

  return points.map(({ place, xy }, index) => {
    const [px, py] = xy;
    const others = dots.filter((_, j) => j !== index);
    let offset = OFFSETS[0];
    let best = Number.POSITIVE_INFINITY;
    for (const candidate of OFFSETS) {
      const box = cardBox(px + candidate[0], py + candidate[1]);
      const size = (box.x1 - box.x0) * (box.y1 - box.y0);
      const score =
        placed.reduce((sum, b) => sum + shared(box, b), 0) +
        others.reduce((sum, b) => sum + shared(box, b), 0) +
        (size - shared(box, frame)) * 2;
      if (score < best) {
        best = score;
        offset = candidate;
        if (score === 0) break;
      }
    }
    placed.push(cardBox(px + offset[0], py + offset[1]));
    return { place, px, py, cx: px + offset[0], cy: py + offset[1] };
  });
}

function AreaTempsGraphic({ f, station, market, stamp, places, lite }: TemplateProps & { places: GraphicPlace[]; lite?: boolean }) {
  const id = useGid();
  const shapes = useCountyShapes(!lite && places.length > 1);
  const key = places.map((p) => `${p.name}:${p.lat}:${p.lon}`).join('|');
  const fit = useMemo(() => (places.length > 1 ? fitProjection(places) : null), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const counties = useMemo(() => (shapes && fit ? mergedPath(countyShapes(shapes, fit)) : ''), [shapes, fit]);
  const tag = f.kicker || 'Temperatures Now';
  const callouts = fit ? layoutCallouts(places, fit.project, tag) : [];

  return (
    <>
      <Ground />
      <Header stamp={stamp} />

      <defs>
        <clipPath id={id('map')}>
          <rect x={MAP.x} y={MAP.y} width={MAP.w} height={MAP.h} rx="24" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id('map')})`}>
        <rect x={MAP.x} y={MAP.y} width={MAP.w} height={MAP.h} fill="#041330" />
        {counties && (
          <path d={counties} fill="#0c2a5c" fillOpacity="0.75" stroke="#3f6fb8" strokeOpacity="0.55" strokeWidth="1.6" strokeLinejoin="round" />
        )}
      </g>
      <rect x={MAP.x} y={MAP.y} width={MAP.w} height={MAP.h} rx="24" fill="none" stroke={PANEL_LINE} strokeOpacity="0.55" strokeWidth="2" />

      {places.length < 2 && <Empty>Loading area temperatures</Empty>}
      {/* Leaders first, then the town dots, then the cards over both. */}
      {callouts.map(({ place, px, py, cx, cy }) => (
        <line key={`lead-${place.name}`} x1={px} y1={py} x2={cx} y2={cy} stroke="#ffffff" strokeOpacity="0.75" strokeWidth="3" />
      ))}
      {callouts.map(({ place, px, py }) => (
        <circle key={`dot-${place.name}`} cx={px} cy={py} r="9" fill="#ffffff" stroke="#020915" strokeWidth="3" />
      ))}
      {callouts.map(({ place, cx, cy }) => {
        const fill = tempFill(place.temp);
        const ink = inkFor(fill);
        return (
          <g key={place.name}>
            <rect
              x={cx - CARD_W / 2}
              y={cy - CARD_H / 2}
              width={CARD_W}
              height={CARD_H}
              rx="14"
              fill={fill}
              filter={`url(#${id('shadow')})`}
            />
            <text x={cx} y={cy + 6} textAnchor="middle" fontFamily={FONT} fontSize="50" fontWeight="800" letterSpacing="-2" fill={ink}>
              {formatTemp(place.temp)}
            </text>
            <text
              x={cx}
              y={cy + 36}
              textAnchor="middle"
              fontFamily={FONT}
              fontSize={place.name.length > 10 ? 19 : 22}
              fontWeight="700"
              fill={ink}
              fillOpacity="0.85"
            >
              {place.name}
            </text>
          </g>
        );
      })}

      <Tag x={SAFE_X + 30} y={MAP.y + 30} text={tag} />
      <Band station={station} market={market} />
    </>
  );
}

/* -------------------------------------------------------- severe outlook */

const SPC_SCALE = ['#66a366', '#ffe066', '#ffa366', '#e06666', '#ee99ee'];

function SevereGraphic({ f, station, market, stamp, outlooks }: TemplateProps & { outlooks: GraphicOutlook[] }) {
  const gap = 24;
  const cardW = (W - SAFE_X * 2 - gap * 2) / 3;
  const dayName = (i: number) =>
    i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : formatDayName(new Date(Date.now() + 2 * 86400000).toISOString(), 'long');

  return (
    <>
      <Ground />
      <Header stamp={stamp} />
      <Tag x={SAFE_X} y={236} text={f.kicker || 'Severe Weather Outlook'} color={ALERT_RED} />
      <Title>{market}</Title>
      {f.detail && (
        <text x={W - SAFE_X} y="354" textAnchor="end" fontFamily={FONT} fontSize="34" fontWeight="600" fill={SOFT}>
          {f.detail.slice(0, 60)}
        </text>
      )}

      {[0, 1, 2].map((i) => {
        const outlook = outlooks[i] ?? { day: `day${i + 1}`, label: 'Outlook unavailable', level: -1, color: '#3a4656' };
        const level = outlook.level;
        const color = level >= 0 ? outlook.color : '#3a4656';
        const x = SAFE_X + i * (cardW + gap);
        const cx = x + cardW / 2;
        const segW = (cardW - 80 - 4 * 10) / 5;
        const label = level < 0 && outlook.label === 'Outlook unavailable' ? outlook.label : level < 0 ? 'No Severe Risk' : outlook.label;
        return (
          <g key={outlook.day}>
            <Card x={x} y={400} w={cardW} h={540} accent={color} />
            <text x={x + 40} y="486" fontFamily={FONT} fontSize="48" fontWeight="800" fill="#ffffff">
              {dayName(i)}
            </text>
            <text x={x + cardW - 40} y="484" textAnchor="end" fontFamily={FONT} fontSize="30" fontWeight="600" fill={DIM}>
              Day {i + 1}
            </text>
            <circle cx={cx} cy="640" r="104" fill={level >= 1 ? color : '#12294f'} stroke={color} strokeWidth="8" />
            <text x={cx} y="684" textAnchor="middle" fontFamily={FONT} fontSize="124" fontWeight="800" fill={level >= 1 ? inkFor(color) : '#9fb8da'}>
              {level >= 1 ? level : '0'}
            </text>
            <text x={cx} y="810" textAnchor="middle" fontFamily={FONT} fontSize={label.length > 18 ? 36 : 46} fontWeight="800" fill="#ffffff">
              {label.slice(0, 28)}
            </text>
            {SPC_SCALE.map((segment, s) => (
              <rect key={segment} x={x + 40 + s * (segW + 10)} y="842" width={segW} height="16" rx="8" fill={s < level ? segment : '#1a3358'} />
            ))}
            <text x={cx} y="906" textAnchor="middle" fontFamily={FONT} fontSize="28" fontWeight="600" fill="#9fb8da">
              {level >= 1 ? `Level ${level} of 5` : level === 0 ? 'Thunderstorms possible' : 'Quiet for severe weather'}
            </text>
          </g>
        );
      })}

      <Band station={station} market={market} />
    </>
  );
}

/* ------------------------------------------------------------ headlines */

function HeadlinesGraphic({ f, station, market, stamp }: TemplateProps) {
  const lines = [f.line1, f.line2, f.line3].map((line) => (line ?? '').trim());
  return (
    <>
      <Ground />
      <Header stamp={stamp} />
      <Tag x={SAFE_X} y={236} text={f.kicker || 'Weather Headlines'} />
      <Title muted={!f.headline}>{(f.headline || 'Your headline here').slice(0, 48)}</Title>

      {lines.map((line, i) => {
        const y = 410 + i * 172;
        return (
          <g key={i}>
            <Card x={SAFE_X} y={y} w={W - SAFE_X * 2} h={148} />
            <circle cx={SAFE_X + 78} cy={y + 74} r="46" fill={ACCENT} />
            <text x={SAFE_X + 78} y={y + 92} textAnchor="middle" fontFamily={FONT} fontSize="50" fontWeight="800" fill="#ffffff">
              {i + 1}
            </text>
            <text x={SAFE_X + 156} y={y + 92} fontFamily={FONT} fontSize="50" fontWeight="700" fill={line ? '#ffffff' : '#5f7ea8'}>
              {(line || `Point ${i + 1}`).slice(0, 62)}
            </text>
          </g>
        );
      })}

      <Band station={station} market={market} />
    </>
  );
}

function QuoteGraphic({ f, station, market, stamp }: TemplateProps) {
  const lines = wrap(f.detail || '', 60, 6);
  const bottom = 500 + Math.max(lines.length - 1, 0) * 66 + 16;
  return (
    <>
      <Ground />
      <Header stamp={stamp} />
      <Tag x={SAFE_X} y={236} text={f.kicker || 'Forecast'} />
      <rect x={SAFE_X} y="336" width="10" height={bottom - 336} rx="5" fill={ACCENT} />
      <text x={SAFE_X + 40} y="410" fontFamily={FONT} fontSize="88" fontWeight="800" letterSpacing="-1" fill={f.headline ? '#ffffff' : '#5f7ea8'}>
        {(f.headline || 'Your headline here').slice(0, 38)}
      </text>
      {lines.map((text, i) => (
        <text key={i} x={SAFE_X + 40} y={500 + i * 66} fontFamily={FONT} fontSize="46" fontWeight="500" fill={SOFT}>
          {text}
        </text>
      ))}
      <Band station={station} market={market} />
    </>
  );
}

/* ------------------------------------------------------------- overlays */

/** Shared lower-third geometry: tile, tag bar, white headline bar, detail bar. */
function LowerThird({
  tag,
  tagColor,
  right,
  headline,
  muted,
  trailing,
  detail,
}: {
  tag: string;
  tagColor: string;
  right: string;
  headline: string;
  muted?: boolean;
  trailing?: string;
  detail: string;
}) {
  const id = useGid();
  const top = 760;
  const edge = W - 96;
  const label = tag.toUpperCase();
  const tagW = label.length * 23 + 64;
  return (
    <g filter={`url(#${id('shadow')})`}>
      <Tile x={96} y={top} w={200} h={200} fontSize={120} />

      <rect x="296" y={top} width={tagW} height="64" fill={tagColor} />
      <text x="326" y={top + 44} fontFamily={FONT} fontSize="32" fontWeight="800" letterSpacing="3" fill="#ffffff">
        {label}
      </text>
      <rect x={296 + tagW} y={top} width={edge - 296 - tagW} height="64" fill="#041026" fillOpacity="0.92" />
      <text x={edge - 30} y={top + 43} textAnchor="end" fontFamily={FONT} fontSize="28" fontWeight="600" fill="#cfe0f5">
        {right}
      </text>

      <rect x="296" y={top + 64} width={edge - 296} height="86" fill="#ffffff" />
      <text x="326" y={top + 124} fontFamily={FONT} fontSize="54" fontWeight="800" fill={muted ? '#8a9bb3' : '#0b1f3f'}>
        {headline}
      </text>
      {trailing && (
        <text x={edge - 30} y={top + 128} textAnchor="end" fontFamily={FONT} fontSize="66" fontWeight="800" letterSpacing="-2" fill={TILE_BLUE}>
          {trailing}
        </text>
      )}

      <rect x="296" y={top + 150} width={edge - 296} height="50" fill="#0b2552" />
      <text x="326" y={top + 184} fontFamily={FONT} fontSize="28" fontWeight="500" fill="#e2ecf8">
        {detail}
      </text>
    </g>
  );
}

function AlertGraphic({ f, station, market }: TemplateProps) {
  return (
    <LowerThird
      tag={f.kicker || 'Weather Alert'}
      tagColor={ALERT_RED}
      right={`${station.toUpperCase()} · ${market}`}
      headline={(f.headline || 'Your headline here').slice(0, 52)}
      muted={!f.headline}
      detail={(f.detail || '').slice(0, 100)}
    />
  );
}

function ConditionsLowerThird({ f, station, market }: TemplateProps) {
  const detail = [f.condition, f.wind && `Wind ${f.wind}`, f.feelsLike && `Feels like ${f.feelsLike}`].filter(Boolean).join('   ·   ');
  return (
    <LowerThird
      tag={f.kicker || 'Current Conditions'}
      tagColor={ACCENT}
      right={station.toUpperCase()}
      headline={(f.location || market).slice(0, 36)}
      trailing={f.temperature || '--'}
      detail={detail.slice(0, 100)}
    />
  );
}

/** A top-right corner bug for live shots: icon, temperature, tile, sky. */
function BugGraphic({ f, icon }: TemplateProps & { icon: string }) {
  const id = useGid();
  const x = 1450;
  const y = 60;
  const town = (f.location || '').split(',')[0].toUpperCase().slice(0, 14);
  return (
    <g filter={`url(#${id('shadow')})`}>
      <rect x={x} y={y} width="270" height="150" fill="#041026" fillOpacity="0.94" />
      <g transform={`translate(${x + 12} ${y + 26})`}>
        <WeatherIcon name={icon} size={96} animated={false} />
      </g>
      <text x={x + 256} y={y + 112} textAnchor="end" fontFamily={FONT} fontSize="96" fontWeight="800" letterSpacing="-4" fill="#ffffff">
        {f.temperature || '--'}
      </text>
      <Tile x={x + 270} y={y} w={110} h={150} fontSize={72} />
      <rect x={x} y={y + 150} width="380" height="46" fill={ACCENT} />
      <text x={x + 18} y={y + 182} fontFamily={FONT} fontSize="26" fontWeight="700" fill="#ffffff">
        {(f.condition || '').slice(0, 18)}
      </text>
      <text x={x + 362} y={y + 182} textAnchor="end" fontFamily={FONT} fontSize="22" fontWeight="700" fill="#dbe7f5">
        {town}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------ title bar */

/**
 * The bar the map and chart graphics wear: station mark and title on white,
 * over a coloured strip carrying the qualifier - the hour a map is valid for,
 * or the days an alert covers.
 */
function TitleBar({
  title,
  subtitle,
  stamp,
  color = ACCENT,
}: {
  title: string;
  subtitle?: string;
  stamp?: string;
  color?: string;
}) {
  const id = useGid();
  return (
    <g filter={`url(#${id('shadow')})`}>
      <rect x={SAFE_X} y="48" width={W - SAFE_X * 2} height="96" fill="#ffffff" />
      <rect x={SAFE_X} y="48" width="300" height="96" fill="#0b2552" />
      <Tile x={SAFE_X + 18} y={62} w={94} h={68} fontSize={50} />
      <text x={SAFE_X + 128} y="94" fontFamily={FONT} fontSize="28" fontWeight="800" fill="#ffffff">
        STORM 12
      </text>
      <text x={SAFE_X + 128} y="124" fontFamily={FONT} fontSize="20" fontWeight="600" letterSpacing="4" fill="#9fb8da">
        WEATHER
      </text>
      <text x={SAFE_X + 330} y="114" fontFamily={FONT} fontSize="54" fontWeight="800" fill="#0b1f3f">
        {title.toUpperCase()}
      </text>
      {stamp && (
        <text x={W - SAFE_X - 28} y="112" textAnchor="end" fontFamily={FONT} fontSize="30" fontWeight="600" fill="#5f7ea8">
          {stamp}
        </text>
      )}
      {subtitle && (
        <>
          <rect x={SAFE_X} y="144" width={Math.min(subtitle.length * 21 + 60, 900)} height="52" fill={color} />
          <text x={SAFE_X + 28} y="181" fontFamily={FONT} fontSize="28" fontWeight="800" letterSpacing="2" fill="#ffffff">
            {subtitle.toUpperCase()}
          </text>
        </>
      )}
    </g>
  );
}

/** Map lettering: white, knocked out with a dark rim so it reads over any fill. */
const OUTLINE = {
  fill: '#ffffff',
  stroke: '#04101f',
  strokeWidth: 8,
  strokeLinejoin: 'round' as const,
  paintOrder: 'stroke' as const,
};

/* ------------------------------------------------------- weather alert day */

/**
 * The day-ahead heads-up: what is coming, and when. Deliberately plain - a
 * viewer should read the two lines in the time it takes to look up.
 */
function WeatherDayGraphic({ f, station, market, stamp }: TemplateProps) {
  const id = useGid();
  const what = wrap(f.what || 'Describe the hazard here', 34, 2);
  return (
    <>
      <Ground />
      <rect x="60" y="110" width="980" height="740" rx="28" fill="#041026" fillOpacity="0.62" />

      <g filter={`url(#${id('shadow')})`}>
        <rect x="110" y="150" width="880" height="180" fill="#ffffff" />
        <text x="146" y="206" fontFamily={FONT} fontSize="26" fontWeight="700" letterSpacing="4" fill="#0b1f3f">
          {station.toUpperCase()}
        </text>
        <text
          x="146"
          y="288"
          fontFamily={FONT}
          fontSize={(f.kicker || 'Weather Alert Day').length > 18 ? 48 : 58}
          fontWeight="800"
          letterSpacing="-1"
          fill={ALERT_RED}
        >
          {(f.kicker || 'Weather Alert Day').toUpperCase().slice(0, 24)}
        </text>
        <Tile x={846} y={166} w={120} h={148} fontSize={88} />
      </g>

      <text x="150" y="450" fontFamily={FONT} fontSize="44" fontWeight="800" letterSpacing="2" fill="#7fc4ff">
        WHEN
      </text>
      <text x="150" y="524" fontFamily={FONT} fontSize="52" fontWeight="700" fill="#ffffff">
        {(f.when || 'Today through Saturday').slice(0, 30)}
      </text>

      <text x="150" y="640" fontFamily={FONT} fontSize="44" fontWeight="800" letterSpacing="2" fill="#7fc4ff">
        WHAT
      </text>
      {what.map((line, i) => (
        <text key={i} x="150" y={714 + i * 66} fontFamily={FONT} fontSize="52" fontWeight="700" fill={f.what ? '#ffffff' : '#5f7ea8'}>
          {line}
        </text>
      ))}

      <text x={W - SAFE_X} y="118" textAnchor="end" fontFamily={FONT} fontSize="32" fontWeight="600" fill="#b9cde8">
        {stamp}
      </text>
      <Band station={station} market={market} />
    </>
  );
}

/* --------------------------------------------------------- heat index map */

/** Nearest town wins the shading: a coarse field, but an honest one. */
function shadeByNearest(shapes: CountyShape[], places: GraphicPlace[], project: (lon: number, lat: number) => [number, number]) {
  const points = places.map((place) => ({ place, xy: project(place.lon, place.lat) }));
  return shapes.map((shape) => {
    let nearest = points[0];
    let best = Number.POSITIVE_INFINITY;
    for (const point of points) {
      const dx = point.xy[0] - shape.cx;
      const dy = point.xy[1] - shape.cy;
      const distance = dx * dx + dy * dy;
      if (distance < best) {
        best = distance;
        nearest = point;
      }
    }
    const value = nearest?.place.feels ?? nearest?.place.temp ?? null;
    return { ...shape, fill: tempFill(value) };
  });
}

function HeatIndexGraphic({ f, station, market, stamp, places, lite }: TemplateProps & { places: GraphicPlace[]; lite?: boolean }) {
  const id = useGid();
  const usable = places.filter((place) => place.feels !== null || place.temp !== null);
  const shapes = useCountyShapes(!lite && usable.length > 1);
  const key = usable.map((p) => `${p.name}:${p.lat}:${p.lon}`).join('|');
  const fit = useMemo(() => (usable.length > 1 ? fitProjection(usable) : null), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const shaded = useMemo(
    () => (shapes && fit ? shadeByNearest(countyShapes(shapes, fit), usable, fit.project) : []),
    [shapes, fit], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const callouts = fit ? layoutCallouts(usable, fit.project, '') : [];

  return (
    <>
      <Ground />
      <TitleBar title={f.kicker || "Today's Heat Index"} subtitle={f.detail || stamp} color={ALERT_RED} />

      <defs>
        <clipPath id={id('map')}>
          <rect x={MAP.x} y={MAP.y} width={MAP.w} height={MAP.h} rx="24" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id('map')})`}>
        <rect x={MAP.x} y={MAP.y} width={MAP.w} height={MAP.h} fill="#0a1f3f" />
        {shaded.map((shape) => (
          <path key={shape.id} d={shape.d} fill={shape.fill} fillOpacity="0.82" stroke="#04101f" strokeOpacity="0.55" strokeWidth="2" />
        ))}
      </g>
      <rect x={MAP.x} y={MAP.y} width={MAP.w} height={MAP.h} rx="24" fill="none" stroke={PANEL_LINE} strokeOpacity="0.55" strokeWidth="2" />

      {usable.length < 2 && <Empty>Loading the heat index</Empty>}
      {callouts.map(({ place, px, py, cx, cy }) => {
        const displaced = Math.hypot(cx - px, cy - py) > 120;
        const reading = place.feels ?? place.temp;
        return (
          <g key={place.name}>
            {displaced && <line x1={px} y1={py} x2={cx} y2={cy + 20} stroke="#ffffff" strokeOpacity="0.6" strokeWidth="3" />}
            <text x={cx} y={cy + 8} textAnchor="middle" fontFamily={FONT} fontSize="78" fontWeight="800" letterSpacing="-3" {...OUTLINE}>
              {reading === null ? '--' : Math.round(reading)}
            </text>
            <text x={cx} y={cy + 52} textAnchor="middle" fontFamily={FONT} fontSize="32" fontWeight="700" {...OUTLINE} strokeWidth="6">
              {place.name}
            </text>
          </g>
        );
      })}

      <Band station={station} market={market} />
    </>
  );
}

/* ------------------------------------------------------------- comparison */

/** Forecast highs against what it will feel like: the pair is the story. */
function CompareGraphic({ f, station, market, stamp, days }: TemplateProps & { days: GraphicDay[] }) {
  const list = days.slice(0, 4).filter((day) => day.high !== null);
  const peak = Math.max(...list.flatMap((day) => [day.high ?? 0, day.feelsHigh ?? day.high ?? 0]), 1);
  const base = 880;
  const top = 420;
  const colW = list.length ? (W - SAFE_X * 2) / list.length : 0;
  const barW = 118;
  const height = (value: number | null) => ((value ?? 0) / peak) * (base - top);

  return (
    <>
      <Ground />
      <TitleBar title={f.kicker || 'Highs vs Feels Like'} subtitle={f.detail || market} stamp={stamp} />

      <Card x={SAFE_X} y={248} w={W - SAFE_X * 2} h={700} />
      <g transform={`translate(${W - SAFE_X - 420} 316)`}>
        <rect width="26" height="26" rx="5" fill="#d99a34" />
        <text x="40" y="22" fontFamily={FONT} fontSize="28" fontWeight="600" fill={SOFT}>
          Forecast high
        </text>
        <rect x="230" width="26" height="26" rx="5" fill={ALERT_RED} />
        <text x="270" y="22" fontFamily={FONT} fontSize="28" fontWeight="600" fill={SOFT}>
          Feels like
        </text>
      </g>

      {list.length === 0 && <Empty>Loading the forecast</Empty>}
      {list.map((day, i) => {
        const centre = SAFE_X + colW * (i + 0.5);
        const feels = day.feelsHigh ?? day.high;
        const highH = height(day.high);
        const feelsH = height(feels);
        return (
          <g key={day.date || i}>
            <rect x={centre - barW - 12} y={base - highH} width={barW} height={highH} rx="8" fill="#d99a34" />
            <text x={centre - barW / 2 - 12} y={base - highH - 26} textAnchor="middle" fontFamily={FONT} fontSize="54" fontWeight="800" fill="#ffffff">
              {formatTemp(day.high)}
            </text>
            <rect x={centre + 12} y={base - feelsH} width={barW} height={feelsH} rx="8" fill={ALERT_RED} />
            <text x={centre + barW / 2 + 12} y={base - feelsH - 26} textAnchor="middle" fontFamily={FONT} fontSize="54" fontWeight="800" fill="#ffffff">
              {formatTemp(feels)}
            </text>
            <text x={centre} y={base + 62} textAnchor="middle" fontFamily={FONT} fontSize="44" fontWeight="800" fill={SOFT}>
              {i === 0 ? 'Today' : formatDayName(day.date, 'short')}
            </text>
          </g>
        );
      })}
      <line x1={SAFE_X + 40} x2={W - SAFE_X - 40} y1={base} y2={base} stroke={PANEL_LINE} strokeOpacity="0.6" strokeWidth="3" />

      <Band station={station} market={market} />
    </>
  );
}

/* --------------------------------------------------------------- alert map */

function AlertMapGraphic({
  f,
  station,
  market,
  stamp,
  places,
  areas,
  lite,
}: TemplateProps & { places: GraphicPlace[]; areas: GraphicAlertArea[]; lite?: boolean }) {
  const id = useGid();
  const shapes = useCountyShapes(!lite && places.length > 1);
  const key = places.map((p) => `${p.name}:${p.lat}:${p.lon}`).join('|');
  const fit = useMemo(() => (places.length > 1 ? fitProjection(places) : null), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const counties = useMemo(() => (shapes && fit ? countyShapes(shapes, fit) : []), [shapes, fit]);
  const labels = fit ? layoutCallouts(places, fit.project, f.kicker || 'Weather Alerts') : [];

  const byCounty = new Map(areas.map((area) => [area.id, area]));
  // Legend order follows severity, so the worst alert reads first.
  const legend = [...new Map(areas.map((area) => [area.label, area])).values()]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 4);

  return (
    <>
      <Ground />
      <TitleBar title={f.kicker || 'Weather Alerts'} subtitle={f.detail || 'In effect now'} stamp={stamp} color={ALERT_RED} />

      <defs>
        <clipPath id={id('map')}>
          <rect x={MAP.x} y={MAP.y} width={MAP.w} height={MAP.h} rx="24" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id('map')})`}>
        <rect x={MAP.x} y={MAP.y} width={MAP.w} height={MAP.h} fill="#07172f" />
        {counties.map((shape) => {
          const area = byCounty.get(shape.id);
          return (
            <path
              key={shape.id}
              d={shape.d}
              fill={area ? area.color : '#123a6b'}
              fillOpacity={area ? 0.82 : 0.5}
              stroke="#04101f"
              strokeOpacity="0.6"
              strokeWidth="2"
            />
          );
        })}
      </g>
      <rect x={MAP.x} y={MAP.y} width={MAP.w} height={MAP.h} rx="24" fill="none" stroke={PANEL_LINE} strokeOpacity="0.55" strokeWidth="2" />

      {places.length < 2 && <Empty>Loading the coverage area</Empty>}
      {/* Town names take the same collision pass as the map callouts: the
          metro towns sit close enough to print over each other otherwise. */}
      {labels.map(({ place, px, py, cx, cy }) => {
        const displaced = Math.hypot(cx - px, cy - py) > 120;
        return (
          <g key={place.name}>
            {displaced && <line x1={px} y1={py} x2={cx} y2={cy - 12} stroke="#ffffff" strokeOpacity="0.6" strokeWidth="3" />}
            <circle cx={px} cy={py} r="7" fill="#ffffff" stroke="#04101f" strokeWidth="3" />
            <text x={cx} y={cy} textAnchor="middle" fontFamily={FONT} fontSize="34" fontWeight="700" {...OUTLINE} strokeWidth="7">
              {place.name}
            </text>
          </g>
        );
      })}

      {legend.length > 0 && (
        <g transform={`translate(${MAP.x + 30} ${MAP.y + MAP.h - 40 - legend.length * 54})`}>
          {legend.map((area, i) => (
            <g key={area.label} transform={`translate(0 ${i * 54})`}>
              <rect width="44" height="44" rx="6" fill={area.color} stroke="#04101f" strokeWidth="2" />
              <text x="60" y="34" fontFamily={FONT} fontSize="32" fontWeight="700" {...OUTLINE} strokeWidth="7">
                {area.label}
              </text>
            </g>
          ))}
        </g>
      )}
      {legend.length === 0 && places.length > 1 && (
        <text x={MAP.x + 30} y={MAP.y + MAP.h - 40} fontFamily={FONT} fontSize="32" fontWeight="700" {...OUTLINE} strokeWidth="7">
          No active alerts
        </text>
      )}

      <Band station={station} market={market} />
    </>
  );
}

/* ---------------------------------------------------------------- frame */

interface GraphicSvgProps {
  data: GraphicSnapshot;
  svgRef?: Ref<SVGSVGElement>;
  className?: string;
  label?: string;
  /** Thumbnails: skip the expensive map geometry. */
  lite?: boolean;
  /** Thumbnails inside a labelled button: hide from assistive tech. */
  decorative?: boolean;
}

/** One full 1920x1080 graphic, sized by its container. */
export function GraphicSvg({ data, svgRef, className, label, lite, decorative }: GraphicSvgProps) {
  const prefix = `gfx${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const props: TemplateProps = { f: data.fields, station: data.station, market: data.market, stamp: data.stamp };

  let body;
  switch (data.template) {
    case 'hourly':
      body = <HourlyGraphic {...props} hours={data.hours ?? []} />;
      break;
    case 'planner':
      body = <PlannerGraphic {...props} hours={data.hours ?? []} />;
      break;
    case 'sevenday':
      body = <SevenDayGraphic {...props} days={data.days} />;
      break;
    case 'areatemps':
      body = <AreaTempsGraphic {...props} places={data.places ?? []} lite={lite} />;
      break;
    case 'severe':
      body = <SevereGraphic {...props} outlooks={data.outlooks ?? []} />;
      break;
    case 'weatherday':
      body = <WeatherDayGraphic {...props} />;
      break;
    case 'heatindex':
      body = <HeatIndexGraphic {...props} places={data.places ?? []} lite={lite} />;
      break;
    case 'compare':
      body = <CompareGraphic {...props} days={data.days} />;
      break;
    case 'alertmap':
      body = <AlertMapGraphic {...props} places={data.places ?? []} areas={data.areas ?? []} lite={lite} />;
      break;
    case 'headlines':
      body = <HeadlinesGraphic {...props} />;
      break;
    case 'quote':
      body = <QuoteGraphic {...props} />;
      break;
    case 'alert':
      body = <AlertGraphic {...props} />;
      break;
    case 'ltconditions':
      body = <ConditionsLowerThird {...props} />;
      break;
    case 'bug':
      body = <BugGraphic {...props} icon={data.icon} />;
      break;
    default:
      body = <ConditionsGraphic {...props} icon={data.icon} />;
  }

  return (
    <GidContext.Provider value={prefix}>
      <svg
        ref={svgRef}
        className={className}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role={decorative ? undefined : 'img'}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : label ?? `${templateName(data.template)} graphic`}
      >
        <SharedDefs />
        {body}
      </svg>
    </GidContext.Provider>
  );
}
