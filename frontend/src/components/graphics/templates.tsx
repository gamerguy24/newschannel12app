import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode, type Ref } from 'react';
import { WeatherIcon } from '../ui/WeatherIcon';
import { getCountyBoundaries } from '../../services/weather';
import { formatDayName, formatTemp } from '../../utils/format';
import type {
  GraphicAlertArea,
  GraphicOutlookShape,
  GraphicDay,
  GraphicHour,
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
const SOFT = '#dbe7f5';

/* ------------------------------------------------------------- registry */

export interface TemplateField {
  key: string;
  label: string;
  type?: 'text' | 'area' | 'select';
  /** Choices for a 'select' field. */
  options?: Array<{ value: string; label: string }>;
  /** Filled from the live observation unless the operator types over it. */
  live?: boolean;
  wide?: boolean;
  help?: string;
  placeholder?: string;
}

export interface TemplateDef {
  id: string;
  name: string;
  group: 'Full screen' | 'Maps' | 'Overlays';
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

/** Every full-screen graphic can dress for the event it covers. */
const SCENE: TemplateField = {
  key: 'scene',
  label: 'Backdrop',
  type: 'select',
  options: [
    { value: 'storm', label: 'Storm - heavy cloud' },
    { value: 'sunset', label: 'Heat - low sun' },
    { value: 'winter', label: 'Winter - snow' },
  ],
};

const TITLE = (placeholder: string): TemplateField => ({ key: 'kicker', label: 'Title', wide: true, placeholder });


export const GRAPHIC_TEMPLATES: TemplateDef[] = [
  {
    id: 'twopanel',
    name: 'Two Day Outlook',
    group: 'Full screen',
    hint: 'Two days side by side - the weekend, or tonight and tomorrow. Leave a label blank to use the day name.',
    fields: [
      SCENE,
      TITLE('Your Forecast'),
      {
        key: 'span',
        label: 'Days',
        type: 'select',
        options: [
          { value: 'next', label: 'Next two days' },
          { value: 'weekend', label: 'Saturday and Sunday' },
        ],
      },
      { key: 'labelA', label: 'Left panel' },
      { key: 'labelB', label: 'Right panel' },
      { key: 'noteA', label: 'Left note', wide: true, placeholder: 'Rain ends, clearing skies' },
      { key: 'noteB', label: 'Right note', wide: true, placeholder: 'Partly cloudy' },
    ],
  },
  {
    id: 'hourstrip',
    name: 'Hour by Hour',
    group: 'Full screen',
    hint: 'The next seven hours from the live forecast.',
    fields: [SCENE, TITLE('Hour by Hour Forecast')],
  },
  {
    id: 'raintiming',
    name: 'Rain Chance Timing',
    group: 'Full screen',
    hint: 'Rain chance every second hour, so five columns cover ten hours.',
    fields: [SCENE, TITLE('Rain Chance Timing')],
  },
  {
    id: 'threeperiod',
    name: 'Forecast Periods',
    group: 'Full screen',
    hint: 'This afternoon, tonight and tomorrow from the live forecast.',
    fields: [
      SCENE,
      TITLE('Forecast'),
      { key: 'labelA', label: 'First' },
      { key: 'labelB', label: 'Second' },
      { key: 'labelC', label: 'Third' },
    ],
  },
  {
    id: 'records',
    name: 'Records and Normals',
    group: 'Full screen',
    hint: 'The high fills from the forecast. Normals and records are in no free feed, so type them in - a field left blank drops its row.',
    fields: [
      SCENE,
      TITLE('Todays Records'),
      { key: 'date', label: 'Date' },
      { key: 'high', label: 'High' },
      { key: 'normal', label: 'Normal high' },
      { key: 'record', label: 'Record high' },
      { key: 'year', label: 'Year set' },
    ],
  },
  {
    id: 'activity',
    name: 'Activity Forecast',
    group: 'Full screen',
    hint: 'Three days for one question - mowing, washing the car, the game tonight.',
    fields: [SCENE, TITLE('Lawn Mowing Forecast')],
  },
  {
    id: 'kids',
    name: 'Weather Kids',
    group: 'Full screen',
    hint: 'Todays forecast beside a viewers name and town.',
    fields: [
      SCENE,
      TITLE('Weather Kids'),
      { key: 'labelA', label: 'Forecast heading' },
      { key: 'labelB', label: 'Panel heading' },
      { key: 'name', label: 'Name' },
      { key: 'town', label: 'Town' },
      { key: 'message', label: 'Message', wide: true, placeholder: 'Thanks for sending us your weather picture!' },
    ],
  },
  {
    id: 'watching',
    name: "What We're Watching",
    group: 'Full screen',
    hint: 'Three things worth knowing, in your own words. A row with no text is left out.',
    fields: [
      SCENE,
      TITLE("What We're Watching"),
      { key: 'labelA', label: 'First label', placeholder: 'This Morning' },
      { key: 'textA', label: 'First line', wide: true, placeholder: 'Frosty start' },
      { key: 'labelB', label: 'Second label', placeholder: 'This Afternoon' },
      { key: 'textB', label: 'Second line', wide: true, placeholder: 'Cool, below average' },
      { key: 'labelC', label: 'Third label', placeholder: 'Tomorrow' },
      { key: 'textC', label: 'Third line', wide: true, placeholder: 'Highs near 70 degrees' },
    ],
  },
  {
    id: 'busstop',
    name: 'Bus Stop Forecast',
    group: 'Full screen',
    hint: 'The school day in three readings. Temperatures fill from the hourly forecast unless you type one.',
    fields: [
      TITLE('Bus Stop Forecast'),
      { key: 'labelA', label: 'First label', placeholder: 'Bus Stop' },
      { key: 'tempA', label: 'First temp', placeholder: 'from 7am' },
      { key: 'labelB', label: 'Second label', placeholder: 'Lunch / Recess' },
      { key: 'tempB', label: 'Second temp', placeholder: 'from noon' },
      { key: 'labelC', label: 'Third label', placeholder: 'Ride Home' },
      { key: 'tempC', label: 'Third temp', placeholder: 'from 3pm' },
    ],
  },
  {
    id: 'superseven',
    name: 'Super 7 Day',
    group: 'Full screen',
    hint: 'Seven days from the live forecast. Weekends run red; mark the days that need an alert banner.',
    fields: [
      SCENE,
      TITLE('Super 7 Day Forecast'),
      { key: 'alertDays', label: 'Alert days', placeholder: '3,4', help: 'Column numbers, 1 to 7.' },
      { key: 'noteDay', label: 'Note on day', placeholder: '4' },
      { key: 'noteText', label: 'Note', placeholder: 'Temp drop' },
    ],
  },
  {
    id: 'areatemps',
    name: 'Area Temperatures',
    group: 'Maps',
    hint: 'Current temperatures for the ticker markets. Edit the list under Ticker & Markets.',
    fields: [KICKER],
  },
  {
    id: 'heatindex',
    name: 'Heat Index Map',
    group: 'Maps',
    hint: 'Heat index for the ticker markets, shading the county map.',
    fields: [
      { key: 'kicker', label: 'Title', wide: true, placeholder: 'Todays Heat Index' },
      { key: 'detail', label: 'Subtitle', wide: true, placeholder: '3:00 PM' },
    ],
  },
  {
    id: 'alertmap',
    name: 'Alert Map',
    group: 'Maps',
    hint: 'Counties shaded by the alerts in force across the coverage area.',
    fields: [
      { key: 'kicker', label: 'Title', wide: true, placeholder: 'Weather Alerts' },
      { key: 'detail', label: 'Subtitle', wide: true, placeholder: 'In effect now' },
    ],
  },
  {
    id: 'spcmap',
    name: 'SPC Outlook',
    group: 'Maps',
    hint: 'Use Plot outlook below to draw the latest Storm Prediction Center risk areas over the coverage area.',
    fields: [
      { key: 'kicker', label: 'Title', wide: true, placeholder: 'Severe Weather Outlook' },
      { key: 'detail', label: 'Subtitle', wide: true, placeholder: 'Storm Prediction Center' },
    ],
  },
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
function fitProjection(places: GraphicPlace[], frame: { x: number; y: number; w: number; h: number } = MAP) {
  const lats = places.map((p) => p.lat);
  const lons = places.map((p) => p.lon);
  const cLat = (Math.max(...lats) + Math.min(...lats)) / 2;
  const cLon = (Math.max(...lons) + Math.min(...lons)) / 2;
  const kx = Math.cos((cLat * Math.PI) / 180);
  // Padding leaves room for the callout cards around the outermost towns.
  const spanLon = (Math.max(...lons) - Math.min(...lons) + 1.2) * kx;
  const spanLat = Math.max(...lats) - Math.min(...lats) + 0.8;
  const k = Math.min(frame.w / spanLon, frame.h / spanLat);
  const halfLon = frame.w / 2 / (k * kx);
  const halfLat = frame.h / 2 / k;
  return {
    project: (lon: number, lat: number): [number, number] => [
      frame.x + frame.w / 2 + (lon - cLon) * kx * k,
      frame.y + frame.h / 2 - (lat - cLat) * k,
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

/**
 * Where map lettering may sit: on the town, then rings of increasing reach.
 *
 * The old table stopped about a county's width out, which is fine for a town
 * on its own and useless around Nashville, where eight of these sit within
 * one label of each other. With nowhere further to go they piled up. The
 * rings stretch wider than they are tall because the coverage area is a wide
 * map with empty space east and west, and that is where the room is.
 */
const MAP_SLOTS: Array<[number, number]> = (() => {
  // Just above the town, not on it: a label centred on its own dot hides the
  // dot behind the lettering, and then nothing points at the town at all.
  const slots: Array<[number, number]> = [[0, -58]];
  for (const radius of [104, 168, 244, 330, 430]) {
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
      slots.push([Math.round(Math.cos(angle) * radius * 1.3), Math.round(Math.sin(angle) * radius * 0.72)]);
    }
  }
  return slots;
})();

/**
 * Roughly how wide a run of bold type will be.
 *
 * The layout used to reserve a fixed width for every label, which is how
 * "Murfreesboro" came to overlap its neighbours: at 36px it is about 230
 * wide, the box said 176, and the solver happily called that clear. An
 * estimate that tracks the actual string is worth far more here than an
 * exact measurement, because it only has to be right enough to keep two
 * labels apart.
 */
const textWidth = (text: string, size: number) => text.length * size * 0.56;

/**
 * Where a leader line from the town should stop: the edge of its own label,
 * not the middle of it, so the line meets the box instead of running under
 * the lettering.
 */
function leaderEnd(px: number, py: number, cx: number, cy: number, w: number, h: number): [number, number] {
  const dx = cx - px;
  const dy = cy - py;
  if (!dx && !dy) return [cx, cy];
  const halfW = w / 2 + 8;
  const halfH = h / 2 + 8;
  const scale = Math.min(
    Math.abs(dx) > 0.01 ? halfW / Math.abs(dx) : Number.POSITIVE_INFINITY,
    Math.abs(dy) > 0.01 ? halfH / Math.abs(dy) : Number.POSITIVE_INFINITY,
  );
  // A label sitting on its own town needs no line at all.
  if (scale >= 1) return [cx, cy];
  return [cx - dx * scale, cy - dy * scale];
}

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
  /** What the solver reserved, so a leader can stop at the label's edge. */
  w: number;
  h: number;
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
  area: { x: number; y: number; w: number; h: number } = MAP,
  measure: (place: GraphicPlace) => { w: number; h: number } = () => ({ w: CARD_W, h: CARD_H }),
  slots: Array<[number, number]> = MAP_SLOTS,
  /** Corners already spoken for - a legend, a key, a line of hint text. */
  reserve: Box[] = [],
): Callout[] {
  const points = places.map((place) => ({
    place,
    xy: project(place.lon, place.lat),
    size: measure(place),
  }));
  const dots: Box[] = points.map(({ xy }) => ({ x0: xy[0] - 14, y0: xy[1] - 14, x1: xy[0] + 14, y1: xy[1] + 14 }));
  const placed: Box[] = tag
    ? [{ x0: area.x + 30, y0: area.y + 30, x1: area.x + 30 + tag.length * 19 + 56, y1: area.y + 82 }]
    : [];
  placed.push(...reserve);
  const bounds: Box = { x0: area.x + 8, y0: area.y + 8, x1: area.x + area.w - 8, y1: area.y + area.h - 8 };

  const cardBox = (cx: number, cy: number, size: { w: number; h: number }): Box => ({
    x0: cx - size.w / 2 - 7,
    y0: cy - size.h / 2 - 7,
    x1: cx + size.w / 2 + 7,
    y1: cy + size.h / 2 + 7,
  });

  // The most hemmed-in towns choose first. Left until last, a town in the
  // middle of the metro finds every good slot taken and lands on top of a
  // neighbour; going first, it takes the one workable spot and the ones with
  // open country around them bend around it.
  const crowding = (index: number) => {
    const [px, py] = points[index].xy;
    return points.reduce(
      (n, other, j) => (j === index || Math.hypot(other.xy[0] - px, other.xy[1] - py) > 230 ? n : n + 1),
      0,
    );
  };
  const order = points.map((_, i) => i).sort((a, b) => crowding(b) - crowding(a));

  const out: Callout[] = new Array(points.length);
  for (const index of order) {
    const { place, xy, size } = points[index];
    const [px, py] = xy;

    let offset = slots[0];
    let best = Number.POSITIVE_INFINITY;
    for (const candidate of slots) {
      const box = cardBox(px + candidate[0], py + candidate[1], size);
      const onLabels = placed.reduce((sum, b) => sum + shared(box, b), 0);
      const onDots = dots.reduce((sum, b, j) => (j === index ? sum : sum + shared(box, b)), 0);
      const outside = (size.w + 14) * (size.h + 14) - shared(box, bounds);
      const reach = Math.hypot(candidate[0], candidate[1]);

      // Covering a neighbour is the worst outcome, leaving the frame worse
      // still; distance is only a tiebreak, so a label travels as far as it
      // must and no further.
      const score = onLabels * 3 + onDots * 2 + outside * 4 + reach * 12 + (reach * reach) / 40;
      if (score < best) {
        best = score;
        offset = candidate;
        if (score === 0) break;
      }
    }

    placed.push(cardBox(px + offset[0], py + offset[1], size));
    out[index] = { place, px, py, cx: px + offset[0], cy: py + offset[1], w: size.w, h: size.h };
  }

  return out;
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
      {/* Leaders first, then the town dots, then the cards over both. Each
          line stops at the edge of its own card rather than running under it. */}
      {callouts.map(({ place, px, py, cx, cy, w, h }) => {
        const [lx, ly] = leaderEnd(px, py, cx, cy, w, h);
        if (lx === cx && ly === cy) return null;
        return (
          <line key={`lead-${place.name}`} x1={px} y1={py} x2={lx} y2={ly} stroke="#ffffff" strokeOpacity="0.8" strokeWidth="3" />
        );
      })}
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

/* ----------------------------------------------------------- station bar */

/**
 * The bar every map and chart wears: a full-width white plate, the station
 * block at the left, the title set large in black, and a red strip beneath
 * carrying the qualifier. The proportions are what make it read on air - the
 * title is the loudest thing in the top third of frame, not a polite caption.
 */
function StationBar({ title, subtitle, stamp }: { title: string; subtitle?: string; stamp?: string }) {
  const id = useGid();
  const label = (subtitle ?? '').toUpperCase();
  return (
    <g filter={`url(#${id('shadow')})`}>
      <rect x="110" y="56" width="1700" height="104" fill="#ffffff" />
      <rect x="110" y="56" width="340" height="104" fill="#0b2552" />
      <Tile x={132} y={70} w={104} h={76} fontSize={56} />
      <text x="256" y="106" fontFamily={FONT} fontSize="30" fontWeight="800" fill="#ffffff">
        STORM 12
      </text>
      <text x="256" y="136" fontFamily={FONT} fontSize="20" fontWeight="600" letterSpacing="5" fill="#9fb8da">
        WEATHER
      </text>
      <text x="486" y="132" fontFamily={FONT} fontSize="66" fontWeight="800" letterSpacing="-1" fill="#0b1420">
        {title.toUpperCase().slice(0, 26)}
      </text>
      {stamp && (
        <text x="1786" y="126" textAnchor="end" fontFamily={FONT} fontSize="28" fontWeight="600" fill="#6b7f96">
          {stamp}
        </text>
      )}
      {label && (
        <>
          <rect x="110" y="160" width={label.length * 26 + 84} height="56" fill={ALERT_RED} />
          <text x="142" y="201" fontFamily={FONT} fontSize="34" fontWeight="800" letterSpacing="1" fill="#ffffff">
            {label}
          </text>
        </>
      )}
    </g>
  );
}

/** The map frame that sits under a station bar. */
const BAR_MAP = { x: 110, y: 240, w: 1700, h: 716 };

/** Map lettering: white, rimmed hard in black so it survives any fill under it. */
const OUTLINE = {
  fill: '#ffffff',
  stroke: '#06121f',
  strokeWidth: 10,
  strokeLinejoin: 'round' as const,
  paintOrder: 'stroke' as const,
};

/* ---------------------------------------------------------------- scenes */

/**
 * A sky, rather than a flat wash. Heat graphics live on a low sun: a warm
 * gradient, a glow, haze bands and a treeline - all drawn, so there is no
 * photograph to license and it stays sharp at any size.
 */
function SunsetScene() {
  const id = useGid();
  // Deterministic ridge: the same silhouette on every render and every export.
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  let ridge = `M0 ${H} L0 884`;
  for (let x = 0; x <= W; x += 40) ridge += ` L${x} ${856 + Math.round(next() * 44)}`;
  ridge += ` L${W} ${H} Z`;

  return (
    <>
      <defs>
        <linearGradient id={id('sunset-sky')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f9c67a" />
          <stop offset="28%" stopColor="#ef8f33" />
          <stop offset="58%" stopColor="#c9451c" />
          <stop offset="100%" stopColor="#5d1710" />
        </linearGradient>
        <radialGradient id={id('sunset-sun')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#fff6d8" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#ffd98a" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#ffb057" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('sunset-vignette')} cx="0.5" cy="0.45" r="0.78">
          <stop offset="58%" stopColor="#1a0600" stopOpacity="0" />
          <stop offset="100%" stopColor="#1a0600" stopOpacity="0.6" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${id('sunset-sky')})`} />
      <circle cx="1470" cy="300" r="560" fill={`url(#${id('sunset-sun')})`} />
      <circle cx="1470" cy="300" r="84" fill="#fffdf2" fillOpacity="0.92" />
      {[648, 706, 764, 820].map((y, i) => (
        <rect key={y} y={y} width={W} height={14 - i * 2} fill="#ffe0b0" fillOpacity={0.12 - i * 0.02} />
      ))}
      <path d={ridge} fill="#2b0a06" fillOpacity="0.92" />
      <rect width={W} height={H} fill={`url(#${id('sunset-vignette')})`} />
    </>
  );
}

/** A winter sky: flat light, cold haze, and snow in the air. */
function WinterScene() {
  const id = useGid();
  let seed = 19;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const flakes = Array.from({ length: 140 }, () => ({
    x: Math.round(next() * W),
    y: Math.round(next() * H),
    r: 1.5 + next() * 3.5,
    o: 0.25 + next() * 0.5,
  }));

  return (
    <>
      <defs>
        <linearGradient id={id('winter-sky')} x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stopColor="#c9d9e8" />
          <stop offset="42%" stopColor="#8aa4bd" />
          <stop offset="100%" stopColor="#2d4159" />
        </linearGradient>
        <radialGradient id={id('winter-vignette')} cx="0.5" cy="0.42" r="0.78">
          <stop offset="58%" stopColor="#0b1a26" stopOpacity="0" />
          <stop offset="100%" stopColor="#0b1a26" stopOpacity="0.6" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${id('winter-sky')})`} />
      {flakes.map((flake, i) => (
        <circle key={i} cx={flake.x} cy={flake.y} r={flake.r} fill="#ffffff" fillOpacity={flake.o} />
      ))}
      <path d={`M0 ${H} L0 890 L${W} 858 L${W} ${H} Z`} fill="#16202c" fillOpacity="0.9" />
      <rect width={W} height={H} fill={`url(#${id('winter-vignette')})`} />
    </>
  );
}

/** A storm sky: heavy cloud, a break of light, rain in the distance. */
function StormScene() {
  const id = useGid();
  let seed = 41;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const rain = Array.from({ length: 90 }, () => {
    const x = Math.round(next() * W);
    const y = Math.round(next() * 760);
    return `M${x} ${y} L${x - 26} ${y + 96}`;
  });

  return (
    <>
      <defs>
        <linearGradient id={id('storm-sky')} x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0%" stopColor="#2b3b52" />
          <stop offset="38%" stopColor="#16243a" />
          <stop offset="100%" stopColor="#060d18" />
        </linearGradient>
        <radialGradient id={id('storm-break')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#cfe0f5" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#cfe0f5" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${id('storm-sky')})`} />
      <ellipse cx="1420" cy="330" rx="620" ry="300" fill={`url(#${id('storm-break')})`} />
      <g stroke="#9fc4e8" strokeOpacity="0.16" strokeWidth="3" strokeLinecap="round">
        {rain.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <path d={`M0 ${H} L0 896 L${W} 864 L${W} ${H} Z`} fill="#050b14" fillOpacity="0.92" />
    </>
  );
}

/** The backdrop a graphic wears, chosen per event. */
function Scene({ kind }: { kind?: string }) {
  if (kind === 'winter') return <WinterScene />;
  if (kind === 'storm') return <StormScene />;
  return <SunsetScene />;
}

/** Ground for the alert map: land and haze, dark enough for colour to sit on. */
function TerrainScene() {
  const id = useGid();
  return (
    <>
      <defs>
        <linearGradient id={id('land')} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#12324a" />
          <stop offset="55%" stopColor="#0a2033" />
          <stop offset="100%" stopColor="#04101c" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${id('land')})`} />
    </>
  );
}

/* ------------------------------------------------------------ heat field */

/** Continuous temperature ramp, so a six-degree spread still shows as colour. */
const RAMP: Array<[number, [number, number, number]]> = [
  [10, [58, 92, 190]],
  [32, [74, 143, 224]],
  [48, [63, 176, 232]],
  [60, [56, 192, 122]],
  [72, [214, 198, 66]],
  [84, [239, 138, 46]],
  [95, [224, 67, 31]],
  [108, [150, 20, 42]],
];

function rampColor(value: number | null): string {
  if (value === null) return '#3a4656';
  const stops = RAMP;
  if (value <= stops[0][0]) return `rgb(${stops[0][1].join(',')})`;
  for (let i = 1; i < stops.length; i += 1) {
    if (value <= stops[i][0]) {
      const [v0, c0] = stops[i - 1];
      const [v1, c1] = stops[i];
      const t = (value - v0) / (v1 - v0);
      const mix = c0.map((c, k) => Math.round(c + (c1[k] - c) * t));
      return `rgb(${mix.join(',')})`;
    }
  }
  return `rgb(${stops[stops.length - 1][1].join(',')})`;
}

/**
 * The heat field. Readings are inverse-distance weighted onto a coarse grid
 * and then blurred, which is how a station's heat raster reads - a smooth
 * field of colour, not one flat tint per county.
 */
function HeatField({
  places,
  project,
  frame,
}: {
  places: GraphicPlace[];
  project: (lon: number, lat: number) => [number, number];
  frame: { x: number; y: number; w: number; h: number };
}) {
  const id = useGid();
  const cols = 56;
  const rows = 26;
  const cw = frame.w / cols;
  const ch = frame.h / rows;

  const points = places
    .map((place) => ({ value: place.feels ?? place.temp, xy: project(place.lon, place.lat) }))
    .filter((point): point is { value: number; xy: [number, number] } => point.value !== null);
  if (points.length < 2) return null;

  const cells = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = frame.x + c * cw + cw / 2;
      const y = frame.y + r * ch + ch / 2;
      let weighted = 0;
      let total = 0;
      for (const point of points) {
        const d2 = Math.max((point.xy[0] - x) ** 2 + (point.xy[1] - y) ** 2, 400);
        // Inverse fourth power: each town keeps its own neighbourhood rather
        // than everything averaging to one flat middle value.
        const weight = 1 / (d2 * d2);
        weighted += point.value * weight;
        total += weight;
      }
      cells.push({ x: frame.x + c * cw, y: frame.y + r * ch, fill: rampColor(weighted / total) });
    }
  }

  return (
    <>
      <defs>
        <filter id={id('soften')} x="-6%" y="-6%" width="112%" height="112%">
          <feGaussianBlur stdDeviation="24" />
        </filter>
      </defs>
      <g filter={`url(#${id('soften')})`}>
        {cells.map((cell, i) => (
          <rect key={i} x={cell.x - 2} y={cell.y - 2} width={cw + 4} height={ch + 4} fill={cell.fill} />
        ))}
      </g>
    </>
  );
}


/* ------------------------------------------------------------- map plate */

/**
 * State outlines, without any polygon union.
 *
 * Drawing every county of a state as one thick stroke and then painting the
 * county fills over it leaves only the outer half of that stroke showing -
 * which is the state border. Cheap, and exactly right.
 */
function stateOutlines(shapes: CountyShape[]): string[] {
  const byState = new Map<string, string>();
  for (const shape of shapes) {
    const state = shape.id.slice(0, 2);
    byState.set(state, (byState.get(state) ?? '') + shape.d);
  }
  return [...byState.values()];
}

/**
 * Depth over a flat vector map: a light from the north-west and darkened
 * edges. Without it, coloured counties read as a cartoon rather than terrain.
 */
function MapRelief({ frame }: { frame: { x: number; y: number; w: number; h: number } }) {
  const id = useGid();
  return (
    <>
      <defs>
        <linearGradient id={id('relief')} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.07" />
          <stop offset="46%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000a14" stopOpacity="0.18" />
        </linearGradient>
        <radialGradient id={id('map-vignette')} cx="0.5" cy="0.5" r="0.74">
          <stop offset="62%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#00060f" stopOpacity="0.26" />
        </radialGradient>
      </defs>
      <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill={`url(#${id('relief')})`} />
      <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill={`url(#${id('map-vignette')})`} />
    </>
  );
}

/**
 * The hairline county grid and the heavier state borders over it.
 *
 * Drawn in a tone lighter than the land rather than darker. Near-black lines
 * on a dark map are a map with no lines on it: they read as a grey wash from
 * across a room, which is the distance this is looked at from.
 */
function Boundaries({ shapes, tone = '#9dc4ef' }: { shapes: CountyShape[]; tone?: string }) {
  return (
    <>
      <path d={mergedPath(shapes)} fill="none" stroke={tone} strokeOpacity="0.5" strokeWidth="1.6" strokeLinejoin="round" />
      {stateOutlines(shapes).map((d, i) => (
        <path key={i} d={d} fill="none" stroke={tone} strokeOpacity="0.92" strokeWidth="4.5" strokeLinejoin="round" />
      ))}
    </>
  );
}

/* --------------------------------------------------------- heat index map */

function HeatIndexGraphic({ f, station, market, stamp, places, lite }: TemplateProps & { places: GraphicPlace[]; lite?: boolean }) {
  const id = useGid();
  const usable = places.filter((place) => place.feels !== null || place.temp !== null);
  const shapes = useCountyShapes(!lite && usable.length > 1);
  const key = usable.map((p) => `${p.name}:${p.lat}:${p.lon}`).join('|');
  const fit = useMemo(() => (usable.length > 1 ? fitProjection(usable, BAR_MAP) : null), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const parts = useMemo(() => (shapes && fit ? countyShapes(shapes, fit) : []), [shapes, fit]);
  const spots = fit
    ? layoutCallouts(usable, fit.project, '', BAR_MAP, (place) => ({
        w: Math.max(textWidth(place.name, 28), 104),
        h: 104,
      }))
    : [];

  return (
    <>
      <SunsetScene />
      <defs>
        <clipPath id={id('map')}>
          <rect x={BAR_MAP.x} y={BAR_MAP.y} width={BAR_MAP.w} height={BAR_MAP.h} />
        </clipPath>
      </defs>

      <g clipPath={`url(#${id('map')})`}>
        <rect x={BAR_MAP.x} y={BAR_MAP.y} width={BAR_MAP.w} height={BAR_MAP.h} fill="#6d2a16" />
        {fit && <HeatField places={usable} project={fit.project} frame={BAR_MAP} />}
        <Boundaries shapes={parts} />
        <MapRelief frame={BAR_MAP} />
      </g>
      <rect x={BAR_MAP.x} y={BAR_MAP.y} width={BAR_MAP.w} height={BAR_MAP.h} fill="none" stroke="#03101c" strokeOpacity="0.8" strokeWidth="3" />

      {usable.length < 2 && <Empty>Loading the heat index</Empty>}
      {spots.map(({ place, px, py, cx, cy, w, h }) => {
        const reading = place.feels ?? place.temp;
        const [lx, ly] = leaderEnd(px, py, cx, cy, w, h);
        const moved = lx !== cx || ly !== cy;
        return (
          <g key={place.name}>
            {/* Every town keeps its own dot and its own line to it, so a
                reading that had to move still says which town it belongs to. */}
            {moved && <line x1={px} y1={py} x2={lx} y2={ly} stroke="#2a1108" strokeOpacity="0.65" strokeWidth="4" />}
            <circle cx={px} cy={py} r="7" fill="#ffffff" stroke="#2a1108" strokeWidth="3" />
            <text x={cx} y={cy + 6} textAnchor="middle" fontFamily={FONT} fontSize="62" fontWeight="800" letterSpacing="-3" {...OUTLINE}>
              {reading === null ? '--' : Math.round(reading)}
            </text>
            <text x={cx} y={cy + 40} textAnchor="middle" fontFamily={FONT} fontSize="28" fontWeight="700" {...OUTLINE} strokeWidth="7">
              {place.name}
            </text>
          </g>
        );
      })}

      <StationBar title={f.kicker || "Today's Heat Index"} subtitle={f.detail || stamp.replace('As of ', '')} />
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
  const fit = useMemo(() => (places.length > 1 ? fitProjection(places, BAR_MAP) : null), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const parts = useMemo(() => (shapes && fit ? countyShapes(shapes, fit) : []), [shapes, fit]);
  const labels = fit
    ? layoutCallouts(
        places,
        fit.project,
        '',
        BAR_MAP,
        (place) => ({ w: textWidth(place.name, 32), h: 46 }),
        MAP_SLOTS,
        [{ x0: BAR_MAP.x + 16, y0: BAR_MAP.y + 16, x1: BAR_MAP.x + 620, y1: BAR_MAP.y + 360 }],
      )
    : [];

  const byCounty = new Map(areas.map((area) => [area.id, area]));
  // Legend order follows severity, so the worst alert reads first.
  const legend = [...new Map(areas.map((area) => [area.label, area])).values()]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 4);

  return (
    <>
      <TerrainScene />
      <defs>
        <clipPath id={id('map')}>
          <rect x={BAR_MAP.x} y={BAR_MAP.y} width={BAR_MAP.w} height={BAR_MAP.h} />
        </clipPath>
        <linearGradient id={id('land')} x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stopColor="#2f4436" />
          <stop offset="100%" stopColor="#1d2f28" />
        </linearGradient>
      </defs>

      <g clipPath={`url(#${id('map')})`}>
        <rect x={BAR_MAP.x} y={BAR_MAP.y} width={BAR_MAP.w} height={BAR_MAP.h} fill={`url(#${id('land')})`} />
        {/* States first and thick: the county fills painted over them leave
            just the outer edge, which is the border. */}
        {stateOutlines(parts).map((d, i) => (
          <path key={i} d={d} fill="none" stroke="#050f16" strokeOpacity="0.9" strokeWidth="9" strokeLinejoin="round" />
        ))}
        {parts.map((shape) => {
          const area = byCounty.get(shape.id);
          return (
            <path
              key={shape.id}
              d={shape.d}
              fill={area ? area.color : '#35503f'}
              fillOpacity={area ? 0.88 : 0.9}
              stroke="#08141d"
              strokeOpacity="0.4"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          );
        })}
        <MapRelief frame={BAR_MAP} />
      </g>
      <rect x={BAR_MAP.x} y={BAR_MAP.y} width={BAR_MAP.w} height={BAR_MAP.h} fill="none" stroke="#03101c" strokeOpacity="0.8" strokeWidth="3" />

      {places.length < 2 && <Empty>Loading the coverage area</Empty>}
      {labels.map(({ place, px, py, cx, cy, w, h }) => {
        const [lx, ly] = leaderEnd(px, py, cx, cy, w, h);
        const moved = lx !== cx || ly !== cy;
        return (
          <g key={place.name}>
            {moved && <line x1={px} y1={py} x2={lx} y2={ly} stroke="#0a0a0a" strokeOpacity="0.7" strokeWidth="4" />}
            <circle cx={px} cy={py} r="8" fill="#ffffff" stroke="#0a0a0a" strokeWidth="4" />
            <text x={cx} y={cy + 11} textAnchor="middle" fontFamily={FONT} fontSize="32" fontWeight="700" {...OUTLINE} strokeWidth="8">
              {place.name}
            </text>
          </g>
        );
      })}

      {legend.map((area, i) => {
        const label = area.label.toUpperCase();
        const width = label.length * 20 + 48;
        return (
          <g key={area.label} transform={`translate(${BAR_MAP.x + 36} ${BAR_MAP.y + 36 + i * 84})`}>
            <rect width={width} height="64" fill={area.color} stroke="#050f16" strokeWidth="3" />
            <text x="24" y="43" fontFamily={FONT} fontSize="30" fontWeight="800" letterSpacing="1" fill="#0a0a0a">
              {label}
            </text>
          </g>
        );
      })}
      {legend.length === 0 && places.length > 1 && (
        <text x={BAR_MAP.x + 36} y={BAR_MAP.y + 80} fontFamily={FONT} fontSize="40" fontWeight="700" {...OUTLINE} strokeWidth="9">
          No active alerts
        </text>
      )}

      <StationBar title={f.kicker || 'Weather Alerts'} subtitle={f.detail || 'In effect now'} stamp={stamp} />
      <Band station={station} market={market} />
    </>
  );
}

/* ---------------------------------------------------------- spc outlook */

/** SPC risk levels, least to most significant, for the legend. */
const SPC_LEVELS: Array<{ level: number; label: string; color: string }> = [
  { level: 0, label: 'Thunderstorms', color: '#C1E9C1' },
  { level: 1, label: 'Marginal', color: '#66A366' },
  { level: 2, label: 'Slight', color: '#FFE066' },
  { level: 3, label: 'Enhanced', color: '#FFA366' },
  { level: 4, label: 'Moderate', color: '#E06666' },
  { level: 5, label: 'High', color: '#FF66FF' },
];

/**
 * The Storm Prediction Center's outlook over the coverage area.
 *
 * The polygons are continental; the map frame clips them. Only the levels
 * that actually reach this area appear in the legend - a national key listing
 * risks nobody here is under tells a viewer nothing.
 */
function SpcGraphic({
  f,
  station,
  market,
  stamp,
  places,
  outlook,
  lite,
}: TemplateProps & { places: GraphicPlace[]; outlook: GraphicOutlookShape[]; lite?: boolean }) {
  const id = useGid();
  const shapes = useCountyShapes(!lite && places.length > 1);
  const key = places.map((p) => `${p.name}:${p.lat}:${p.lon}`).join('|');
  const fit = useMemo(() => (places.length > 1 ? fitProjection(places, BAR_MAP) : null), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const parts = useMemo(() => (shapes && fit ? countyShapes(shapes, fit) : []), [shapes, fit]);
  const labels = fit
    ? layoutCallouts(
        places,
        fit.project,
        '',
        BAR_MAP,
        (place) => ({ w: textWidth(place.name, 32), h: 46 }),
        MAP_SLOTS,
        // The risk key stacks down the left; with no outlook plotted a line
        // of hint text runs across instead. Neither is somewhere a town name
        // may land.
        [{ x0: BAR_MAP.x + 16, y0: BAR_MAP.y + 16, x1: BAR_MAP.x + 900, y1: BAR_MAP.y + 116 },
         { x0: BAR_MAP.x + 16, y0: BAR_MAP.y + 16, x1: BAR_MAP.x + 520, y1: BAR_MAP.y + 340 }],
      )
    : [];

  const drawn = useMemo(() => {
    if (!fit) return [];
    return [...outlook]
      .sort((a, b) => a.level - b.level)
      .map((shape) => ({
        ...shape,
        d: shape.rings
          .map((ring) => ring.map((pt, i) => {
            const [x, y] = fit.project(pt[0], pt[1]);
            return `${i ? 'L' : 'M'}${x.toFixed(0)} ${y.toFixed(0)}`;
          }).join('') + 'Z')
          .join(''),
      }));
  }, [outlook, fit]);

  const present = SPC_LEVELS.filter((lvl) => drawn.some((shape) => shape.level === lvl.level)).reverse();

  return (
    <>
      <TerrainScene />
      <defs>
        <clipPath id={id('map')}>
          <rect x={BAR_MAP.x} y={BAR_MAP.y} width={BAR_MAP.w} height={BAR_MAP.h} />
        </clipPath>
        <linearGradient id={id('land')} x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stopColor="#15324f" />
          <stop offset="100%" stopColor="#0a1e33" />
        </linearGradient>
      </defs>

      <g clipPath={`url(#${id('map')})`}>
        <rect x={BAR_MAP.x} y={BAR_MAP.y} width={BAR_MAP.w} height={BAR_MAP.h} fill={`url(#${id('land')})`} />
        {/* The land is a map before anything is plotted on it: counties are
            filled and outlined, so an outlook with no risk areas still shows
            the viewer where they live. */}
        {parts.map((shape) => (
          <path key={shape.id} d={shape.d} fill="#123f6d" fillOpacity="0.72" stroke="none" />
        ))}
        <Boundaries shapes={parts} />
        {/* Risk over the top, and opaque enough to win against it. */}
        {drawn.map((shape, i) => (
          <path key={i} d={shape.d} fill={shape.color} fillOpacity="0.68" stroke={shape.color} strokeOpacity="0.95" strokeWidth="3" strokeLinejoin="round" />
        ))}
        <MapRelief frame={BAR_MAP} />
      </g>
      <rect x={BAR_MAP.x} y={BAR_MAP.y} width={BAR_MAP.w} height={BAR_MAP.h} fill="none" stroke="#03101c" strokeOpacity="0.8" strokeWidth="3" />

      {places.length < 2 && <Empty>Loading the coverage area</Empty>}
      {places.length > 1 && drawn.length === 0 && (
        <text x={BAR_MAP.x + 36} y={BAR_MAP.y + 80} fontFamily={FONT} fontSize="40" fontWeight="700" {...OUTLINE} strokeWidth="9">
          Press Plot outlook to draw the latest risk areas
        </text>
      )}

      {labels.map(({ place, px, py, cx, cy, w, h }) => {
        const [lx, ly] = leaderEnd(px, py, cx, cy, w, h);
        const moved = lx !== cx || ly !== cy;
        return (
          <g key={place.name}>
            {moved && <line x1={px} y1={py} x2={lx} y2={ly} stroke="#04121f" strokeOpacity="0.75" strokeWidth="4" />}
            <circle cx={px} cy={py} r="8" fill="#ffffff" stroke="#04121f" strokeWidth="4" />
            <text x={cx} y={cy + 11} textAnchor="middle" fontFamily={FONT} fontSize="32" fontWeight="700" {...OUTLINE} strokeWidth="8">
              {place.name}
            </text>
          </g>
        );
      })}

      {present.map((lvl, i) => {
        const label = lvl.label.toUpperCase();
        return (
          <g key={lvl.level} transform={`translate(${BAR_MAP.x + 36} ${BAR_MAP.y + 36 + i * 74})`}>
            <rect width={label.length * 20 + 96} height="56" fill="#061019" fillOpacity="0.88" stroke="#050f16" strokeWidth="2" />
            <rect x="10" y="10" width="36" height="36" fill={lvl.color} stroke="#050f16" strokeWidth="2" />
            <text x="60" y="39" fontFamily={FONT} fontSize="28" fontWeight="800" letterSpacing="1" fill="#ffffff">
              {label}
            </text>
          </g>
        );
      })}

      <StationBar
        title={f.kicker || 'Severe Weather Outlook'}
        subtitle={f.detail || 'Storm Prediction Center'}
        stamp={stamp}
      />
      <Band station={station} market={market} />
    </>
  );
}

/* --------------------------------------------------------- station chrome */

/**
 * The header every full-screen graphic wears: the station block, then a red
 * plate carrying the title under a thin gold rule. It is the loudest thing in
 * the top of frame, which is what makes a graphic read from across a room.
 */
function AlertHeader({ title, stamp }: { title: string; stamp?: string }) {
  const id = useGid();
  return (
    <g filter={`url(#${id('shadow')})`}>
      <defs>
        <linearGradient id={id('plate')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#c8151b" />
          <stop offset="62%" stopColor="#9d1014" />
          <stop offset="100%" stopColor="#5f0a0d" />
        </linearGradient>
        <linearGradient id={id('rule')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#e9c75a" />
          <stop offset="45%" stopColor="#fff6da" />
          <stop offset="100%" stopColor="#fff6da" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id('block')} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#7a1c17" />
          <stop offset="100%" stopColor="#3d0c0a" />
        </linearGradient>
      </defs>

      <rect x="40" y="24" width="252" height="104" fill={`url(#${id('block')})`} />
      <Tile x={58} y={44} w={86} h={64} fontSize={46} />
      <text x="160" y="78" fontFamily={FONT} fontSize="26" fontWeight="800" fill="#ffffff">
        STORM 12
      </text>
      <text x="160" y="108" fontFamily={FONT} fontSize="19" fontWeight="600" letterSpacing="4" fill="#e7b9b6">
        WEATHER
      </text>

      <rect x="306" y="26" width="1574" height="7" fill={`url(#${id('rule')})`} />
      <rect x="306" y="33" width="1574" height="86" fill={`url(#${id('plate')})`} />
      <text x="342" y="94" fontFamily={FONT} fontSize="54" fontWeight="800" letterSpacing="0.5" fill="#ffffff">
        {title.toUpperCase().slice(0, 34)}
      </text>
      {stamp && (
        <text x="1852" y="90" textAnchor="end" fontFamily={FONT} fontSize="28" fontWeight="600" fill="#f0c9c7">
          {stamp}
        </text>
      )}
    </g>
  );
}

/** The red plate the readings sit on. */
function RedPanel({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const id = useGid();
  return (
    <>
      <defs>
        <linearGradient id={id('panel-red')} x1="0" y1="0" x2="0.45" y2="1">
          <stop offset="0%" stopColor="#d61c1c" />
          <stop offset="55%" stopColor="#b01313" />
          <stop offset="100%" stopColor="#7d0c0c" />
        </linearGradient>
      </defs>
      <rect x={x} y={y} width={w} height={h} fill={`url(#${id('panel-red')})`} />
    </>
  );
}

/** A heading with the hairline rules a station puts above and below it. */
function PanelHeading({ x, y, w, text: label }: { x: number; y: number; w: number; text: string }) {
  return (
    <>
      <text x={x + w / 2} y={y} textAnchor="middle" fontFamily={FONT} fontSize="54" fontWeight="800" letterSpacing="2" fill="#f3dede">
        {label.toUpperCase().slice(0, 18)}
      </text>
      <rect x={x + 30} y={y + 22} width={w - 60} height="4" fill="#ffffff" fillOpacity="0.45" />
    </>
  );
}

const Rule = ({ x, y, w }: { x: number; y: number; w: number }) => (
  <rect x={x} y={y} width={w} height="4" fill="#ffffff" fillOpacity="0.45" />
);

/** Which days a two-panel outlook should show. */
function pickPair(days: GraphicDay[], mode: string): GraphicDay[] {
  if (mode === 'weekend') {
    const weekend = days.filter((day) => {
      const at = parseDay(day.date);
      return at ? at.getDay() === 6 || at.getDay() === 0 : false;
    });
    if (weekend.length >= 2) return weekend.slice(0, 2);
  }
  return days.slice(0, 2);
}

/** A forecast date is a plain YYYY-MM-DD; read it as local, not as UTC. */
function parseDay(date: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '');
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/* ------------------------------------------------------- two-panel outlook */

function TwoPanelGraphic({ f, station, market, stamp, days }: TemplateProps & { days: GraphicDay[] }) {
  const pair = pickPair(days, f.span ?? 'next');
  const panels = [
    { day: pair[0], label: f.labelA, note: f.noteA, x: 60 },
    { day: pair[1], label: f.labelB, note: f.noteB, x: 980 },
  ];

  return (
    <>
      <Scene kind={f.scene} />
      <AlertHeader title={f.kicker || (f.span === 'weekend' ? 'Weekend Forecast' : 'Your Forecast')} stamp={stamp} />

      {days.length < 2 && <Empty>Loading the forecast</Empty>}
      {panels.map(({ day, label, note, x }) => {
        if (!day) return null;
        const heading = label || formatDayName(day.date, 'long');
        const lines = wrap(note ?? '', 22, 2);
        return (
          <g key={x}>
            <RedPanel x={x} y={176} w={880} h={744} />
            <PanelHeading x={x} y={258} w={880} text={heading} />
            <g transform={`translate(${x + 70} 330)`}>
              <WeatherIcon name={day.icon} size={300} animated={false} />
            </g>
            <text x={x + 830} y={790} textAnchor="end" fontFamily={FONT} fontSize="190" fontWeight="800" letterSpacing="-6" fill="#ffffff">
              {day.high === null ? '--' : Math.round(day.high)}
            </text>
            <Rule x={x + 30} y={826} w={820} />
            {lines.map((line, k) => (
              <text key={k} x={x + 40} y={886 + k * 54} fontFamily={FONT} fontSize="44" fontWeight="800" letterSpacing="1" fill="#ffffff">
                {line.toUpperCase()}
              </text>
            ))}
          </g>
        );
      })}

      <Band station={station} market={market} />
    </>
  );
}

/* ------------------------------------------------------------ hour strip */

function HourStripGraphic({ f, station, market, stamp, hours }: TemplateProps & { hours: GraphicHour[] }) {
  const list = hours.slice(0, 7);
  const gap = 16;
  const colW = (1800 - gap * 6) / 7;

  return (
    <>
      <Scene kind={f.scene} />
      <AlertHeader title={f.kicker || 'Hour by Hour Forecast'} stamp={stamp} />

      {list.length === 0 && <Empty>Loading the hourly forecast</Empty>}
      {list.map((hour, i) => {
        const x = 60 + i * (colW + gap);
        return (
          <g key={hour.time || i}>
            <RedPanel x={x} y={176} w={colW} h={744} />
            <PanelHeading x={x} y={248} w={colW} text={i === 0 ? 'Now' : hour.label.replace(' ', '')} />
            <g transform={`translate(${x + colW / 2 - 75} 310)`}>
              <WeatherIcon name={hour.icon} size={150} animated={false} />
            </g>
            <text x={x + colW / 2} y={790} textAnchor="middle" fontFamily={FONT} fontSize="112" fontWeight="800" letterSpacing="-4" fill="#ffffff">
              {hour.temp === null ? '--' : Math.round(hour.temp)}
            </text>
            <Rule x={x + 24} y={830} w={colW - 48} />
          </g>
        );
      })}

      <Band station={station} market={market} />
    </>
  );
}

/* --------------------------------------------------------- rain chance */

/** Rain chance rises through yellow to red, the way a station ramps it. */
function chanceColor(value: number): string {
  if (value >= 80) return '#c81414';
  if (value >= 60) return '#e2681a';
  if (value >= 40) return '#eab308';
  return '#b9a13a';
}

function RainTimingGraphic({ f, station, market, stamp, hours }: TemplateProps & { hours: GraphicHour[] }) {
  // Every second hour: five columns covering ten hours reads better on air
  // than ten columns nobody can take in.
  const list = hours.filter((_, i) => i % 2 === 0).slice(0, 5);
  const panel = { x: 60, y: 176, w: 1800, h: 744 };
  const colW = panel.w / Math.max(list.length, 1);
  const base = 830;
  const top = 320;

  return (
    <>
      <Scene kind={f.scene ?? 'storm'} />
      <AlertHeader title={f.kicker || 'Rain Chance Timing'} stamp={stamp} />
      <rect x={panel.x} y={panel.y} width={panel.w} height={panel.h} fill="#0b1c2a" fillOpacity="0.55" />

      {[100, 75, 50, 25].map((mark) => {
        const y = base - (mark / 100) * (base - top);
        return (
          <g key={mark}>
            <rect x={panel.x + 100} y={y} width={panel.w - 140} height="2" fill="#ffffff" fillOpacity="0.16" />
            <text x={panel.x + 26} y={y + 12} fontFamily={FONT} fontSize="30" fontWeight="700" fill="#9fb4c8">
              {mark}%
            </text>
          </g>
        );
      })}
      <rect x={panel.x + 26} y={base} width={panel.w - 52} height="3" fill="#ffffff" fillOpacity="0.5" />

      {list.length === 0 && <Empty>Loading the hourly forecast</Empty>}
      {list.map((hour, i) => {
        const chance = Math.max(0, Math.min(100, hour.precip ?? 0));
        // A dry hour keeps a stub, so five zero columns read as a dry stretch
        // rather than a graphic that failed to draw.
        const height = Math.max((chance / 100) * (base - top), 10);
        const centre = panel.x + colW * (i + 0.5);
        return (
          <g key={hour.time || i}>
            <rect x={centre - 130} y={top} width="260" height={base - top} fill="#ffffff" fillOpacity="0.07" />
            <rect x={centre - 130} y={base - height} width="260" height={height} fill={chanceColor(chance)} />
            <text x={centre} y={base - height - 26} textAnchor="middle" fontFamily={FONT} fontSize="66" fontWeight="800" fill="#ffffff">
              {chance}%
            </text>
            <text x={centre} y={base + 66} textAnchor="middle" fontFamily={FONT} fontSize="56" fontWeight="800" letterSpacing="1" fill="#ffffff">
              {(i === 0 ? 'Now' : hour.label).replace(' ', '').toUpperCase()}
            </text>
          </g>
        );
      })}

      <Band station={station} market={market} />
    </>
  );
}

/* ------------------------------------------------------- three periods */

function ThreePeriodGraphic({
  f,
  station,
  market,
  stamp,
  days,
  hours,
}: TemplateProps & { days: GraphicDay[]; hours: GraphicHour[] }) {
  const today = days[0];
  const tomorrow = days[1];
  const tonight = hours.find((hour) => hour.hour >= 22) ?? hours[hours.length - 1];

  const columns = [
    { label: f.labelA || 'Afternoon', value: today?.high ?? null, icon: today?.icon ?? 'cloudy' },
    { label: f.labelB || 'Tonight', value: today?.low ?? tonight?.temp ?? null, icon: tonight?.icon ?? 'clear-night' },
    {
      label: f.labelC || (tomorrow ? formatDayName(tomorrow.date, 'long') : 'Tomorrow'),
      value: tomorrow?.high ?? null,
      icon: tomorrow?.icon ?? 'cloudy',
    },
  ];
  const panel = { x: 60, y: 176, w: 1800, h: 700 };
  const colW = panel.w / 3;

  return (
    <>
      <Scene kind={f.scene ?? 'storm'} />
      <AlertHeader title={f.kicker || 'Forecast'} stamp={stamp} />
      <RedPanel x={panel.x} y={panel.y} w={panel.w} h={panel.h} />

      {days.length === 0 && <Empty>Loading the forecast</Empty>}
      {columns.map((column, i) => {
        const x = panel.x + colW * i;
        return (
          <g key={column.label}>
            <PanelHeading x={x} y={260} w={colW} text={column.label} />
            <g transform={`translate(${x + colW / 2 - 110} 320)`}>
              <WeatherIcon name={column.icon} size={220} animated={false} />
            </g>
            <text x={x + colW / 2} y={790} textAnchor="middle" fontFamily={FONT} fontSize="150" fontWeight="800" letterSpacing="-5" fill="#ffffff">
              {column.value === null ? '--' : Math.round(column.value)}
            </text>
            {i < 2 && <rect x={x + colW - 2} y={panel.y + 60} width="3" height={panel.h - 120} fill="#ffffff" fillOpacity="0.28" />}
          </g>
        );
      })}

      <Band station={station} market={market} />
    </>
  );
}

/* ------------------------------------------------------------- records */

function RecordsGraphic({ f, station, market, stamp, days }: TemplateProps & { days: GraphicDay[] }) {
  const high = f.high || (days[0]?.high === null || days[0] === undefined ? '--' : String(Math.round(days[0].high as number)));
  // Normals and records come from no free feed, so a field left blank drops its
  // row instead of putting a dash on air.
  const normal = (f.normal ?? '').trim();
  const record = (f.record ?? '').trim();
  const year = (f.year ?? '').trim();
  const foot = Boolean(record || year);
  // One number does not need the full slab, so the panel narrows to what is on it.
  const width = normal ? 1520 : 940;
  const height = foot ? 640 : 420;
  // Whatever the panel ends up holding, it sits centred in the clear area.
  const panel = { x: (1920 - width) / 2, y: 176 + (744 - height) / 2, w: width, h: height };
  const half = panel.w / 2;
  const date = f.date || new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <>
      <Scene kind={f.scene ?? 'storm'} />
      <AlertHeader title={f.kicker || "Today's Records"} stamp={stamp} />
      <text x={panel.x} y={panel.y - 34} fontFamily={FONT} fontSize="40" fontWeight="800" letterSpacing="3" fill="#dbe6f4">
        {date.toUpperCase()}
      </text>

      <RedPanel x={panel.x} y={panel.y} w={panel.w} h={panel.h} />

      <text
        x={normal ? panel.x + half / 2 : panel.x + half}
        y={panel.y + 106}
        textAnchor="middle"
        fontFamily={FONT}
        fontSize="72"
        fontWeight="800"
        letterSpacing="2"
        fill="#f3dede"
      >
        HIGH
      </text>
      <text
        x={normal ? panel.x + half / 2 : panel.x + half}
        y={panel.y + 300}
        textAnchor="middle"
        fontFamily={FONT}
        fontSize="200"
        fontWeight="800"
        letterSpacing="-6"
        fill="#ffffff"
      >
        {high}°
      </text>

      {normal !== '' && (
        <>
          <rect x={panel.x + half - 2} y={panel.y + 56} width="3" height="320" fill="#ffffff" fillOpacity="0.35" />
          <text x={panel.x + half + half / 2} y={panel.y + 106} textAnchor="middle" fontFamily={FONT} fontSize="72" fontWeight="800" letterSpacing="2" fill="#f3dede">
            NORMAL
          </text>
          <text x={panel.x + half + half / 2} y={panel.y + 300} textAnchor="middle" fontFamily={FONT} fontSize="200" fontWeight="800" letterSpacing="-6" fill="#ffffff">
            {normal}°
          </text>
        </>
      )}

      {foot && (
        <>
          <Rule x={panel.x + 40} y={panel.y + 380} w={panel.w - 80} />
          <text x={panel.x + 60} y={panel.y + 490} fontFamily={FONT} fontSize="60" fontWeight="800" letterSpacing="2" fill="#f3dede">
            RECORD HIGH
          </text>
          <text x={panel.x + 560} y={panel.y + 490} fontFamily={FONT} fontSize="60" fontWeight="800" fill="#ffffff">
            {record || '--'}°
          </text>
          {year !== '' && (
            <>
              <text x={panel.x + 60} y={panel.y + 580} fontFamily={FONT} fontSize="52" fontWeight="800" letterSpacing="2" fill="#f3dede">
                SET IN
              </text>
              <text x={panel.x + 320} y={panel.y + 580} fontFamily={FONT} fontSize="52" fontWeight="800" fill="#ffffff">
                {year}
              </text>
            </>
          )}
        </>
      )}

      <Band station={station} market={market} />
    </>
  );
}

/* ------------------------------------------------------------ activity */

/** Lawn mowing, car washing, the game tonight: three days, one question. */
function ActivityGraphic({ f, station, market, stamp, days }: TemplateProps & { days: GraphicDay[] }) {
  const list = days.slice(0, 3);
  const table = { x: 470, y: 300, w: 1000, rowH: 116, gap: 12 };

  return (
    <>
      <Scene kind={f.scene ?? 'sunset'} />
      <AlertHeader title={f.kicker || 'Lawn Mowing Forecast'} stamp={stamp} />

      {list.length === 0 && <Empty>Loading the forecast</Empty>}
      <rect
        x={table.x - 16}
        y={table.y - 16}
        width={table.w + 32}
        height={list.length * (table.rowH + table.gap) + 20}
        fill="#ffffff"
        fillOpacity="0.92"
      />
      {list.map((day, i) => {
        const y = table.y + i * (table.rowH + table.gap);
        // The middle row is the one a viewer is being pointed at.
        const accent = i === 1;
        return (
          <g key={day.date || i}>
            {accent ? (
              <RedPanel x={table.x} y={y} w={table.w} h={table.rowH} />
            ) : (
              <rect x={table.x} y={y} width={table.w} height={table.rowH} fill="#ffffff" />
            )}
            <text
              x={table.x + 32}
              y={y + 76}
              fontFamily={FONT}
              fontSize="52"
              fontWeight="800"
              letterSpacing="1"
              fill={accent ? '#ffffff' : '#12233a'}
            >
              {(i === 0 ? 'Today' : formatDayName(day.date, 'long')).toUpperCase()}
            </text>
            <g transform={`translate(${table.x + 560} ${y + 16})`}>
              <WeatherIcon name={day.icon} size={84} animated={false} />
            </g>
            <text
              x={table.x + table.w - 32}
              y={y + 80}
              textAnchor="end"
              fontFamily={FONT}
              fontSize="66"
              fontWeight="800"
              fill={accent ? '#ffffff' : '#1d4f9c'}
            >
              {day.high === null ? '--' : Math.round(day.high)}°
            </text>
          </g>
        );
      })}

      <Band station={station} market={market} />
    </>
  );
}

/* --------------------------------------------------------- weather kids */

function KidsGraphic({ f, station, market, stamp, days }: TemplateProps & { days: GraphicDay[] }) {
  const today = days[0];
  const note = wrap(f.message || 'Thanks for sending us your weather picture!', 30, 3);

  return (
    <>
      <Scene kind={f.scene ?? 'storm'} />
      <AlertHeader title={f.kicker || 'Weather Kids'} stamp={stamp} />

      <RedPanel x={60} y={176} w={660} h={744} />
      <PanelHeading x={60} y={258} w={660} text={f.labelA || 'Today'} />
      <g transform="translate(150 340)">
        <WeatherIcon name={today?.icon ?? 'cloudy'} size={240} animated={false} />
      </g>
      <text x={670} y={800} textAnchor="end" fontFamily={FONT} fontSize="190" fontWeight="800" letterSpacing="-6" fill="#ffffff">
        {today?.high === null || today === undefined ? '--' : Math.round(today.high as number)}
      </text>
      <Rule x={90} y={836} w={600} />

      <RedPanel x={760} y={176} w={1100} h={744} />
      <PanelHeading x={760} y={258} w={1100} text={f.labelB || 'Our Weather Kid'} />
      <text x={1310} y={470} textAnchor="middle" fontFamily={FONT} fontSize="104" fontWeight="800" fill="#ffffff">
        {(f.name || 'Name here').slice(0, 22)}
      </text>
      <text x={1310} y={548} textAnchor="middle" fontFamily={FONT} fontSize="52" fontWeight="600" fill="#f3dede">
        {(f.town || 'Town here').slice(0, 30)}
      </text>
      <Rule x={820} y={608} w={980} />
      {note.map((line, i) => (
        <text key={i} x={1310} y={700 + i * 66} textAnchor="middle" fontFamily={FONT} fontSize="48" fontWeight="600" fill="#ffffff">
          {line}
        </text>
      ))}

      <Band station={station} market={market} />
    </>
  );
}

/* -------------------------------------------------------- what we watch */

/**
 * The three things worth knowing today, in order.
 *
 * Every line is typed: this is the meteorologist's read on the day, not a
 * number off a feed, and the whole value of the graphic is that a person
 * decided what mattered.
 */
function WatchingGraphic({ f, station, market, stamp, days }: TemplateProps & { days: GraphicDay[] }) {
  const rows = [
    { label: f.labelA || 'This Morning', text: f.textA || '', size: 62 },
    { label: f.labelB || 'This Afternoon', text: f.textB || '', size: 62 },
    { label: f.labelC || 'Tomorrow', text: f.textC || '', size: 78 },
  ].filter((row) => row.text);

  const panel = { x: 60, y: 176, w: 1800, h: 744 };
  const slot = panel.h / Math.max(rows.length, 1);

  return (
    <>
      <Scene kind={f.scene ?? 'storm'} />
      <AlertHeader title={f.kicker || "What We're Watching"} stamp={stamp} />
      <RedPanel x={panel.x} y={panel.y} w={panel.w} h={panel.h} />

      {rows.length === 0 && <Empty>Type what you are watching</Empty>}

      <g transform={`translate(${panel.x + panel.w - 340} ${panel.y + slot * 0.55})`}>
        <WeatherIcon name={days[0]?.icon ?? 'cloudy'} size={260} animated={false} />
      </g>

      {rows.map((row, i) => {
        const top = panel.y + slot * i;
        return (
          <g key={row.label}>
            {i > 0 && <Rule x={panel.x + 40} y={top} w={panel.w - 80} />}
            <text
              x={panel.x + 48}
              y={top + 82}
              fontFamily={FONT}
              fontSize="46"
              fontWeight="800"
              letterSpacing="2"
              fill="#ffffff"
            >
              {row.label.toUpperCase()}:
            </text>
            {wrap(row.text, 30, 2).map((line, k) => (
              <text
                key={k}
                x={panel.x + 48}
                y={top + 158 + k * (row.size + 8)}
                fontFamily={FONT}
                fontSize={row.size}
                fontWeight="800"
                letterSpacing="1"
                fill="#ffffff"
              >
                {line.toUpperCase()}
              </text>
            ))}
          </g>
        );
      })}

      <Band station={station} market={market} />
    </>
  );
}

/* ------------------------------------------------------------- bus stop */

/**
 * A school morning drawn rather than photographed.
 *
 * The reference for this one is a stock photograph, which is not something
 * that can ship inside the app - so the scene is built in SVG, the same way
 * every other backdrop in this package is.
 */
function SchoolScene() {
  const id = useGid();
  return (
    <>
      <defs>
        <linearGradient id={id('bus-sky')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8fb6d9" />
          <stop offset="55%" stopColor="#cfe0ee" />
          <stop offset="100%" stopColor="#e7eef4" />
        </linearGradient>
      </defs>
      <rect width="1920" height="1080" fill={`url(#${id('bus-sky')})`} />

      {/* the school behind */}
      <rect x="90" y="300" width="620" height="470" fill="#8f3f34" />
      <rect x="90" y="272" width="620" height="40" fill="#6e2f26" />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={150 + i * 140} y="360" width="88" height="110" fill="#d8e6f2" opacity="0.85" />
      ))}
      <rect x="330" y="600" width="130" height="170" fill="#5c2820" />

      {/* ground */}
      <rect y="770" width="1920" height="310" fill="#5a6b52" />
      <rect y="770" width="1920" height="18" fill="#47563f" />

      {/* the bus */}
      <g transform="translate(700 236)">
        <rect x="0" y="60" width="900" height="330" rx="26" fill="#f2b716" />
        <rect x="0" y="60" width="900" height="26" rx="13" fill="#d99f0c" />
        <rect x="760" y="130" width="140" height="150" rx="14" fill="#f7cc52" />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={40 + i * 140} y="110" width="112" height="120" rx="8" fill="#20313f" opacity="0.82" />
        ))}
        <rect x="0" y="300" width="900" height="26" fill="#2b2b2b" />
        <circle cx="180" cy="400" r="62" fill="#20232a" />
        <circle cx="180" cy="400" r="26" fill="#9aa3ab" />
        <circle cx="720" cy="400" r="62" fill="#20232a" />
        <circle cx="720" cy="400" r="26" fill="#9aa3ab" />
        {/* stop arm */}
        <rect x="-96" y="180" width="96" height="14" fill="#8a8f96" />
        <g transform="translate(-190 130)">
          <rect width="112" height="112" rx="10" fill="#c8102e" />
          <rect x="10" y="10" width="92" height="92" rx="6" fill="none" stroke="#ffffff" strokeWidth="6" />
          <text x="56" y="70" textAnchor="middle" fontFamily={FONT} fontSize="30" fontWeight="800" fill="#ffffff">
            STOP
          </text>
        </g>
        <circle cx="70" cy="40" r="18" fill="#ff3b30" />
        <circle cx="830" cy="40" r="18" fill="#ff3b30" />
      </g>
    </>
  );
}

function BusStopGraphic({ f, station, market, hours }: TemplateProps & { hours: GraphicHour[] }) {
  /** The nearest reading to a given hour of the day, if the feed reaches it. */
  const at = (hour: number) => {
    const match = hours.find((h) => h.hour === hour);
    return match?.temp ?? null;
  };

  const rows = [
    { label: f.labelA || 'Bus Stop', value: f.tempA || at(7), icon: hours.find((h) => h.hour === 7)?.icon },
    { label: f.labelB || 'Lunch / Recess', value: f.tempB || at(12), icon: hours.find((h) => h.hour === 12)?.icon },
    { label: f.labelC || 'Ride Home', value: f.tempC || at(15), icon: hours.find((h) => h.hour === 15)?.icon },
  ];

  // Low and narrow enough that the bus still reads behind it.
  const card = { x: 150, y: 545, w: 1180, h: 395 };
  const rowH = card.h / 3;

  return (
    <>
      <SchoolScene />

      <g transform="translate(1320 70)">
        <rect width="540" height="96" fill="#b3121f" />
        <text x="270" y="64" textAnchor="middle" fontFamily={FONT} fontSize="52" fontWeight="800" letterSpacing="1" fill="#ffffff">
          {(f.kicker || 'Bus Stop Forecast').toUpperCase()}
        </text>
      </g>

      <rect x={card.x} y={card.y} width={card.w} height={card.h} fill="#ffffff" stroke="#8d1220" strokeWidth="6" />

      {rows.map((row, i) => {
        const top = card.y + rowH * i;
        // The middle row is the warm part of the day; the reference gives it
        // the red bar, so the eye lands on the peak.
        const accent = i === 1;
        return (
          <g key={row.label}>
            {accent ? (
              <RedPanel x={card.x + 6} y={top + 4} w={card.w - 12} h={rowH - 8} />
            ) : (
              i > 0 && <rect x={card.x + 24} y={top} width={card.w - 48} height="3" fill="#d8dee6" />
            )}
            <text
              x={card.x + 44}
              y={top + rowH / 2 + 18}
              fontFamily={FONT}
              fontSize="54"
              fontWeight="700"
              fill={accent ? '#ffffff' : '#12233a'}
            >
              {row.label}:
            </text>
            <g transform={`translate(${card.x + card.w - 420} ${top + rowH / 2 - 52})`}>
              <WeatherIcon name={row.icon ?? 'partly-cloudy-day'} size={104} animated={false} />
            </g>
            <text
              x={card.x + card.w - 48}
              y={top + rowH / 2 + 26}
              textAnchor="end"
              fontFamily={FONT}
              fontSize="78"
              fontWeight="800"
              fill={accent ? '#ffffff' : '#1d4f9c'}
            >
              {row.value === null || row.value === undefined || row.value === '' ? '--' : `${row.value}\u00b0`}
            </text>
          </g>
        );
      })}

      <Band station={station} market={market} />
    </>
  );
}

/* ---------------------------------------------------------- super seven */

function SuperSevenGraphic({ f, station, market, stamp, days }: TemplateProps & { days: GraphicDay[] }) {
  const id = useGid();
  const list = days.slice(0, 7);
  const gap = 10;
  const colW = (1800 - gap * 6) / 7;

  // "2,4" marks those columns as alert days; the banner is the point of the
  // graphic on a severe week, so it is typed rather than guessed at.
  const flagged = new Set(
    String(f.alertDays ?? '')
      .split(/[,\s]+/)
      .map((n) => Number.parseInt(n, 10))
      .filter((n) => Number.isFinite(n)),
  );
  const noteOn = Number.parseInt(String(f.noteDay ?? ''), 10);

  return (
    <>
      <Scene kind={f.scene ?? 'winter'} />
      <defs>
        <linearGradient id={id('cool')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1f5eb4" />
          <stop offset="100%" stopColor="#0b2a5c" />
        </linearGradient>
      </defs>
      <AlertHeader title={f.kicker || 'Super 7 Day Forecast'} stamp={stamp} />

      {list.length === 0 && <Empty>Loading the seven day forecast</Empty>}
      {list.map((day, i) => {
        const x = 60 + i * (colW + gap);
        const parsed = parseDay(day.date);
        const weekend = parsed ? [0, 6].includes(parsed.getDay()) : false;
        const alert = flagged.has(i + 1);

        return (
          <g key={day.date || i}>
            {weekend ? (
              <RedPanel x={x} y={176} w={colW} h={744} />
            ) : (
              <rect x={x} y={176} width={colW} height="744" fill={`url(#${id('cool')})`} />
            )}

            {alert && (
              <g>
                <rect x={x} y={176} width={colW} height="74" fill="#6b1410" />
                <text x={x + colW / 2} y={214} textAnchor="middle" fontFamily={FONT} fontSize="24" fontWeight="800" letterSpacing="1" fill="#ffd9d4">
                  STORM 12
                </text>
                <text x={x + colW / 2} y={240} textAnchor="middle" fontFamily={FONT} fontSize="22" fontWeight="700" letterSpacing="3" fill="#ffd9d4">
                  ALERT
                </text>
              </g>
            )}

            <text
              x={x + colW / 2}
              y={alert ? 306 : 252}
              textAnchor="middle"
              fontFamily={FONT}
              fontSize="44"
              fontWeight="800"
              letterSpacing="2"
              fill="#ffffff"
            >
              {(i === 0 ? 'Today' : formatDayName(day.date)).toUpperCase()}
            </text>

            <g transform={`translate(${x + colW / 2 - 70} ${alert ? 336 : 286})`}>
              <WeatherIcon name={day.icon} size={140} animated={false} />
            </g>

            {typeof day.precipProbability === 'number' && day.precipProbability > 0 && (
              <text x={x + colW / 2} y={alert ? 530 : 486} textAnchor="middle" fontFamily={FONT} fontSize="34" fontWeight="800" fill="#ffe9a8">
                {Math.round(day.precipProbability)}%
              </text>
            )}

            {noteOn === i + 1 && f.noteText && (
              <text x={x + colW / 2} y={alert ? 570 : 526} textAnchor="middle" fontFamily={FONT} fontSize="28" fontWeight="700" fill="#ffffff">
                {f.noteText.slice(0, 18)}
              </text>
            )}

            <text
              x={x + colW / 2}
              y="720"
              textAnchor="middle"
              fontFamily={FONT}
              fontSize="104"
              fontWeight="800"
              letterSpacing="-4"
              fill="#ffffff"
            >
              {day.high === null ? '--' : Math.round(day.high)}
            </text>
            <Rule x={x + 20} y={752} w={colW - 40} />
            <text
              x={x + colW / 2}
              y="838"
              textAnchor="middle"
              fontFamily={FONT}
              fontSize="62"
              fontWeight="800"
              fill="#cfe0f5"
            >
              {day.low === null ? '--' : Math.round(day.low)}
            </text>
          </g>
        );
      })}

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
    case 'hourstrip':
      body = <HourStripGraphic {...props} hours={data.hours ?? []} />;
      break;
    case 'raintiming':
      body = <RainTimingGraphic {...props} hours={data.hours ?? []} />;
      break;
    case 'threeperiod':
      body = <ThreePeriodGraphic {...props} days={data.days} hours={data.hours ?? []} />;
      break;
    case 'records':
      body = <RecordsGraphic {...props} days={data.days} />;
      break;
    case 'activity':
      body = <ActivityGraphic {...props} days={data.days} />;
      break;
    case 'kids':
      body = <KidsGraphic {...props} days={data.days} />;
      break;
    case 'watching':
      body = <WatchingGraphic {...props} days={data.days} />;
      break;
    case 'busstop':
      body = <BusStopGraphic {...props} hours={data.hours ?? []} />;
      break;
    case 'superseven':
      body = <SuperSevenGraphic {...props} days={data.days} />;
      break;
    case 'areatemps':
      body = <AreaTempsGraphic {...props} places={data.places ?? []} lite={lite} />;
      break;
    case 'heatindex':
      body = <HeatIndexGraphic {...props} places={data.places ?? []} lite={lite} />;
      break;
    case 'alertmap':
      body = <AlertMapGraphic {...props} places={data.places ?? []} areas={data.areas ?? []} lite={lite} />;
      break;
    case 'spcmap':
      body = <SpcGraphic {...props} places={data.places ?? []} outlook={data.outlook ?? []} lite={lite} />;
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
      body = <TwoPanelGraphic {...props} days={data.days} />;
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
