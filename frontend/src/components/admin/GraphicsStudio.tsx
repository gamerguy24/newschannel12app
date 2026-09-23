import { useEffect, useRef, useState } from 'react';
import { Field } from './StationPanels';
import { Button } from '../ui/Primitives';
import { GRAPHIC_TEMPLATES, GraphicSvg, H, W, isOverlay, templateDef, templateName, type Fields } from '../graphics/templates';
import { useLocation } from '../../context/LocationContext';
import { useResource } from '../../hooks';
import { getCurrent, getDaily, getHourly, getMarkets, getSevereCenter, getSpcOutlook } from '../../services/weather';
import { clearProgram, deleteGraphic, saveGraphic, takeProgram } from '../../services/admin';
import { formatDayName, formatRelative, formatTemp, formatTime, formatWind } from '../../utils/format';
import type {
  AdminState,
  GraphicAlertArea,
  GraphicDay,
  GraphicHour,
  GraphicOutlook,
  GraphicOutlookShape,
  GraphicPlace,
  GraphicSnapshot,
  ProgramGraphic,
  StationGraphic,
} from '../../api/types';

/**
 * GRAPHICS STUDIO
 *
 * A two-monitor playout workspace, laid out the way a graphics operator
 * works a show:
 *
 *   - The GALLERY picks a template from the package, with live thumbnails.
 *   - PREVIEW is the graphic being built or cued. Nothing here is on air.
 *   - TAKE freezes the preview into a snapshot and puts it on PROGRAM.
 *   - PROGRAM mirrors exactly what the /output browser source is playing.
 *   - The RUNDOWN holds saved graphics, ready to cue or take directly.
 *
 * Live data fills every template by default; anything typed in the inspector
 * overrides it. A saved rundown item keeps only the overrides, so it takes to
 * air with the numbers current at the moment of the take.
 */

const GROUPS = ['Full screen', 'Maps', 'Overlays'] as const;

/** Every field any template fills from the live observation. */
const LIVE_KEYS = Array.from(
  new Set(GRAPHIC_TEMPLATES.flatMap((t) => t.fields.filter((f) => f.live).map((f) => f.key))),
);

/* ----------------------------------------------------------- font embed */

const FONT_CSS =
  'https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=Russo+One&display=swap';
let embeddedFonts: Promise<string> | null = null;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(binary);
}

/**
 * An SVG painted as an image cannot fetch web fonts, so without this the PNG
 * falls back to Arial. The faces are inlined as data URIs - latin subsets
 * only. On failure the export still works, with fallback fonts.
 */
function loadEmbeddedFonts(): Promise<string> {
  if (!embeddedFonts) {
    embeddedFonts = (async () => {
      const css = await (await fetch(FONT_CSS)).text();
      const blocks = css.split('/* ').filter((block) => block.startsWith('latin */'));
      const faces = await Promise.all(
        blocks.map(async (block) => {
          const face = block.slice(block.indexOf('@font-face'));
          const match = face.match(/url\((https:[^)]+)\)/);
          if (!match) return '';
          const data = toBase64(await (await fetch(match[1])).arrayBuffer());
          return face.replace(match[1], `data:font/woff2;base64,${data}`);
        }),
      );
      return faces.join('\n');
    })().catch(() => {
      embeddedFonts = null;
      return '';
    });
  }
  return embeddedFonts;
}

/* ------------------------------------------------------------- component */

export function GraphicsStudio({ state, onSaved }: { state: AdminState; onSaved: () => void }) {
  const { location } = useLocation();
  const [template, setTemplate] = useState<string>('conditions');
  const [fields, setFields] = useState<Fields>({});
  const [name, setName] = useState('');
  const [cuedId, setCuedId] = useState<string | null>(null);
  const [program, setProgram] = useState<ProgramGraphic | null>(state.program ?? null);
  const [busy, setBusy] = useState(false);
  const [safeAreas, setSafeAreas] = useState(false);
  const [outlook, setOutlook] = useState<GraphicOutlookShape[]>([]);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // A take from another seat arrives with the refreshed admin state.
  const serverProgramId = state.program?.id ?? null;
  useEffect(() => {
    setProgram(state.program ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverProgramId]);

  const current = useResource((signal) => getCurrent(location, signal), [location.lat, location.lon]);
  const daily = useResource((signal) => getDaily(location, 7, signal), [location.lat, location.lon]);
  const hourly = useResource((signal) => getHourly(location, 30, signal), [location.lat, location.lon]);
  const markets = useResource((signal) => getMarkets(signal), []);
  const severe = useResource((signal) => getSevereCenter(undefined, signal), []);

  const station = state.station.name;
  const market = state.station.market;
  const obs = current.data?.observation;
  const timeZone = current.data?.location.timeZone ?? undefined;

  /* ---------------------------------------------------------- live data */

  const live: Fields = obs
    ? {
        temperature: formatTemp(obs.temperature),
        condition: obs.condition ?? '',
        feelsLike: formatTemp(obs.feelsLike),
        wind: formatWind(obs.windSpeed, obs.windCompass, obs.windGust),
        humidity: obs.humidity === null ? '--' : `${Math.round(obs.humidity)}%`,
        location: current.data?.location.name ?? location.label,
      }
    : {};
  const stamp = obs?.observedAt
    ? `As of ${formatTime(obs.observedAt, timeZone)}`
    : `Updated ${formatTime(new Date().toISOString(), timeZone)}`;

  const days: GraphicDay[] = (daily.data?.days ?? []).slice(0, 7).map((d) => ({
    date: d.date,
    icon: d.icon,
    high: d.high,
    low: d.low,
    feelsHigh: d.feelsHigh,
    precipProbability: d.precipProbability,
  }));

  // Hour labels are fixed in the station's zone here, so playout on another
  // machine can never relabel them in its own.
  const hourLabel = new Intl.DateTimeFormat('en-US', { hour: 'numeric', timeZone });
  const hour24 = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone });
  const dayKey = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone });
  const today = dayKey.format(new Date());
  const tomorrow = dayKey.format(new Date(Date.now() + 86400000));
  const cutoff = Date.now() - 30 * 60000;
  const hours: GraphicHour[] = (hourly.data?.hours ?? [])
    .filter((h) => new Date(h.time).getTime() >= cutoff)
    .slice(0, 24)
    .map((h) => {
      const at = new Date(h.time);
      const key = dayKey.format(at);
      return {
        time: h.time,
        label: hourLabel.format(at),
        hour: Number(hour24.format(at)) % 24,
        dayLabel: key === today ? 'Today' : key === tomorrow ? 'Tomorrow' : formatDayName(h.time, 'short'),
        icon: h.icon,
        temp: h.temperature,
        precip: h.precipProbability,
        condition: h.condition ?? '',
      };
    });

  const places: GraphicPlace[] = (markets.data?.markets ?? []).map((m) => ({
    name: m.name,
    lat: m.lat,
    lon: m.lon,
    temp: m.temperature,
    // Heat index where the air warrants one, apparent temperature otherwise.
    feels: m.heatIndex ?? m.feelsLike,
    icon: m.icon,
  }));

  // Which counties are under which alert, for the alert map. SAME codes are
  // the county FIPS with a leading zero, which is how they match the outlines.
  const areaByCounty = new Map<string, GraphicAlertArea>();
  for (const alert of [
    ...(severe.data?.warnings ?? []),
    ...(severe.data?.watches ?? []),
    ...(severe.data?.advisories ?? []),
  ]) {
    for (const same of alert.same ?? []) {
      const id = same.replace(/^0/, '');
      const held = areaByCounty.get(id);
      // Lower rank is more severe: the worst alert owns the county's colour.
      if (!held || alert.rank < held.rank) {
        areaByCounty.set(id, { id, label: alert.event, color: alert.color, rank: alert.rank });
      }
    }
  }
  const areas: GraphicAlertArea[] = [...areaByCounty.values()];

  const outlooks: GraphicOutlook[] = (severe.data?.outlooks ?? []).map((o) => ({
    day: o.day,
    label: o.maxRisk?.LABEL2 ?? o.maxRisk?.label ?? 'No Severe Risk',
    level: o.maxRisk?.level ?? -1,
    color: o.maxRisk?.color ?? '#3a4656',
  }));

  /** Resolve a template plus overrides into the frozen values a take sends. */
  const snapshot = (tpl: string, overrides: Fields): GraphicSnapshot => {
    const merged: Fields = { ...live };
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value === 'string' && value.trim()) merged[key] = value;
    }
    return {
      template: tpl,
      fields: merged,
      days,
      hours,
      places,
      outlooks,
      areas,
      icon: obs?.icon ?? 'cloudy',
      stamp,
      station,
      market,
      // Risk polygons ride only with the graphic that draws them.
      outlook: tpl === 'spcmap' ? outlook : [],
    };
  };

  const def = templateDef(template);
  const preview = snapshot(template, fields);
  const hasLive = def.fields.some((f) => f.live);
  const overridden = LIVE_KEYS.some((key) => fields[key]?.trim());
  const outputUrl = `${window.location.origin}/output`;

  const set = (key: string, value: string) => setFields((prev) => ({ ...prev, [key]: value }));

  /* ----------------------------------------------------------- outlook */

  const DAY_LABEL: Record<string, string> = {
    day1: 'Day 1 · Today',
    day2: 'Day 2 · Tomorrow',
    day3: 'Day 3',
  };

  /**
   * Pull the Storm Prediction Center outlook and keep the parts that reach
   * this market. SPC publishes continental polygons with far more detail than
   * a regional map can show, so rings are thinned and rounded before they are
   * carried to air - otherwise a single take would be megabytes of geometry.
   */
  const plotOutlook = async (day: string) => {
    if (places.length < 2) {
      setNote('Waiting for the market list before the outlook can be placed.');
      return;
    }
    setBusy(true);
    try {
      const data = await getSpcOutlook(day, 'cat');
      const lats = places.map((p) => p.lat);
      const lons = places.map((p) => p.lon);
      const pad = 2.5;
      const box = {
        west: Math.min(...lons) - pad,
        east: Math.max(...lons) + pad,
        south: Math.min(...lats) - pad,
        north: Math.max(...lats) + pad,
      };

      const shapes: GraphicOutlookShape[] = [];
      for (const feature of data.features ?? []) {
        const props = (feature.properties ?? {}) as { level?: number; label?: string; color?: string };
        const geometry = feature.geometry;
        if (!geometry) continue;
        const polygons =
          geometry.type === 'Polygon'
            ? [geometry.coordinates]
            : geometry.type === 'MultiPolygon'
              ? geometry.coordinates
              : [];

        const rings: Array<Array<[number, number]>> = [];
        for (const polygon of polygons) {
          for (const ring of polygon) {
            const reaches = ring.some(
              (pt) => pt[0] >= box.west && pt[0] <= box.east && pt[1] >= box.south && pt[1] <= box.north,
            );
            if (!reaches) continue;
            const step = Math.max(1, Math.ceil(ring.length / 400));
            const thinned = ring
              .filter((_, i) => i % step === 0)
              .map((pt) => [Math.round(pt[0] * 100) / 100, Math.round(pt[1] * 100) / 100] as [number, number]);
            if (thinned.length > 3) rings.push(thinned);
          }
        }
        if (rings.length) {
          shapes.push({
            level: props.level ?? 0,
            label: props.label ?? 'Risk',
            color: props.color ?? '#8FA3BF',
            rings,
          });
        }
      }

      setOutlook(shapes);
      if (!fields.detail) set('detail', DAY_LABEL[day] ?? day);
      setNote(
        shapes.length
          ? `Plotted ${shapes.length} risk area${shapes.length === 1 ? '' : 's'} for ${DAY_LABEL[day] ?? day}.`
          : `No risk areas reach the coverage area for ${DAY_LABEL[day] ?? day}.`,
      );
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------ playout */

  const take = async (snap: GraphicSnapshot, label: string, sourceId: string | null) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await takeProgram({ ...snap, name: label, sourceId: sourceId ?? '' });
      setProgram(res.program);
      setNote(`${label} is on program.`);
      onSaved();
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const takePreview = () => take(preview, name.trim() || templateName(template), cuedId);

  const clear = async () => {
    if (busy || !program) return;
    setBusy(true);
    try {
      await clearProgram();
      setProgram(null);
      setNote('Program cleared.');
      onSaved();
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Ctrl+Enter takes, Ctrl+Backspace clears - the hands never leave the keys.
  const keys = useRef({ takePreview, clear });
  keys.current = { takePreview, clear };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        keys.current.takePreview();
      } else if (event.key === 'Backspace') {
        // In a text field Ctrl+Backspace deletes a word; leave that alone.
        const target = event.target as HTMLElement | null;
        if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
        event.preventDefault();
        keys.current.clear();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ------------------------------------------------------------ rundown */

  // A new template is a new graphic: the cued item's name, kicker and copy
  // must not ride along onto it, or program gets labelled as something else.
  const pickTemplate = (id: string) => {
    if (id === template) return;
    setTemplate(id);
    setFields({});
    setName('');
    setCuedId(null);
  };

  const cue = (graphic: StationGraphic) => {
    setTemplate(graphic.template);
    setFields(graphic.fields);
    setName(graphic.name);
    setCuedId(graphic.id);
    setNote(`Cued "${graphic.name}" in preview.`);
  };

  const store = async () => {
    const label = name.trim() || templateName(template);
    // Saving a cued item under the same name updates it in place.
    const existing = state.graphics.find((g) => g.id === cuedId && g.name === label);
    setBusy(true);
    try {
      const res = await saveGraphic({ id: existing?.id, name: label, template, fields });
      setCuedId(res.graphic.id);
      setName(label);
      setNote(existing ? `Updated "${label}" in the rundown.` : `Added "${label}" to the rundown.`);
      onSaved();
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (graphic: StationGraphic) => {
    await deleteGraphic(graphic.id);
    if (cuedId === graphic.id) setCuedId(null);
    onSaved();
  };

  const useLiveNumbers = () => {
    setFields((prev) => {
      const next = { ...prev };
      for (const key of LIVE_KEYS) delete next[key];
      return next;
    });
    setNote('Using live readings.');
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(outputUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setNote('Copy failed - select the address and copy it by hand.');
    }
  };

  /* ------------------------------------------------------------- export */

  const serialize = async () => {
    const node = svgRef.current;
    if (!node) return null;
    const clone = node.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.removeAttribute('class');
    const fontCss = await loadEmbeddedFonts();
    if (fontCss) {
      const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      style.textContent = fontCss;
      clone.insertBefore(style, clone.firstChild);
    }
    return new XMLSerializer().serializeToString(clone);
  };

  const filename = (ext: string) => {
    const base = (name || templateName(template))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return `storm12-${base}-${Date.now()}.${ext}`;
  };

  const download = (blob: Blob, file: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportSvg = async () => {
    const markup = await serialize();
    if (markup) download(new Blob([markup], { type: 'image/svg+xml' }), filename('svg'));
  };

  /** Paint the SVG onto a canvas once, at full 1920x1080, and save that. */
  const exportPng = async () => {
    const markup = await serialize();
    if (!markup) return;
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(image, 0, 0, W, H);
        canvas.toBlob((png) => {
          if (png) download(png, filename('png'));
          URL.revokeObjectURL(url);
        }, 'image/png');
      }
    };
    image.onerror = () => {
      setNote('Could not rasterise this graphic. The SVG export still works.');
      URL.revokeObjectURL(url);
    };
    image.src = url;
  };

  /* ------------------------------------------------------------- render */

  const previewName = name.trim() || templateName(template);
  const cuedMatches = state.graphics.some((g) => g.id === cuedId && g.name === previewName);

  return (
    <div className="nc-studio">
      <div className="nc-studio__gallery" aria-label="Templates">
        {GROUPS.map((group) => (
          <div className="nc-studio__group" key={group}>
            <span className="nc-studio__group-label">{group}</span>
            <div className="nc-studio__tpls">
              {GRAPHIC_TEMPLATES.filter((t) => t.group === group).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  data-template={t.id}
                  className={`nc-studio__tpl${template === t.id ? ' is-active' : ''}`}
                  onClick={() => pickTemplate(t.id)}
                  aria-pressed={template === t.id}
                >
                  <span className={`nc-studio__tpl-thumb${t.overlay ? ' is-transparent' : ''}`}>
                    <GraphicSvg data={snapshot(t.id, {})} lite decorative />
                  </span>
                  <span className="nc-studio__tpl-name">{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="nc-studio__monitors">
        <section className="nc-monitor is-pvw" aria-label="Preview monitor">
          <header className="nc-monitor__head">
            <span className="nc-monitor__tally">PVW</span>
            <span className="nc-monitor__title">{previewName}</span>
            <label className="nc-gfx__toggle">
              <input type="checkbox" checked={safeAreas} onChange={(e) => setSafeAreas(e.target.checked)} />
              Safe areas
            </label>
          </header>
          <div className={`nc-monitor__screen${isOverlay(template) ? ' is-transparent' : ''}`}>
            <GraphicSvg data={preview} svgRef={svgRef} className="nc-gfx__preview" label={`${previewName} preview`} />
            {safeAreas && (
              <svg className="nc-gfx__guides" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
                <rect x={W * 0.035} y={H * 0.035} width={W * 0.93} height={H * 0.93} />
                <rect x={W * 0.05} y={H * 0.05} width={W * 0.9} height={H * 0.9} className="is-title" />
              </svg>
            )}
          </div>
        </section>

        <section className={`nc-monitor is-pgm${program ? ' is-live' : ''}`} aria-label="Program monitor">
          <header className="nc-monitor__head">
            <span className="nc-monitor__tally">PGM</span>
            <span className="nc-monitor__title">{program ? program.name : 'Clear'}</span>
            {program && <span className="nc-monitor__since">On air {formatRelative(program.takenAt)}</span>}
          </header>
          <div className={`nc-monitor__screen${!program || isOverlay(program.template) ? ' is-transparent' : ''}`}>
            {program ? (
              <GraphicSvg data={program} className="nc-monitor__svg" label={`${program.name} on program`} />
            ) : (
              <p className="nc-monitor__empty">Nothing on program</p>
            )}
          </div>
        </section>
      </div>

      <div className="nc-studio__transport">
        <button type="button" className="nc-studio__take" onClick={takePreview} disabled={busy}>
          TAKE <kbd>Ctrl+Enter</kbd>
        </button>
        <button type="button" className="nc-studio__clear" onClick={clear} disabled={busy || !program}>
          CLEAR <kbd>Ctrl+Backspace</kbd>
        </button>
        <span className="nc-studio__status" role="status">
          {note ?? (program ? `${program.name} is on program.` : 'Program is clear.')}
        </span>
        <span className="nc-studio__spacer" />
        <Button variant="outline" onClick={exportPng}>
          Export PNG
        </Button>
        <Button variant="subtle" onClick={exportSvg}>
          Export SVG
        </Button>
      </div>

      <div className="nc-studio__lower">
        <section className="nc-studio__panel" aria-label="Inspector">
          <header className="nc-studio__panel-head">
            <h2>Inspector</h2>
            <span>{def.name}</span>
          </header>
          <div className="nc-studio__panel-body">
            <div className="nc-studio__fields">
              {def.hint && (
                <p className="nc-studio__hint is-wide">{def.fields.some((f) => f.live) && !obs ? 'Waiting for live data.' : def.hint}</p>
              )}
              {def.fields.map((field) => (
                <div key={field.key} className={field.wide || field.type === 'area' ? 'is-wide' : undefined}>
                  <Field label={field.label} help={field.help}>
                    {field.type === 'select' ? (
                      <select value={fields[field.key] ?? ''} onChange={(e) => set(field.key, e.target.value)}>
                        {(field.options ?? []).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : field.type === 'area' ? (
                      <textarea value={fields[field.key] ?? ''} onChange={(e) => set(field.key, e.target.value)} />
                    ) : (
                      <input
                        value={fields[field.key] ?? ''}
                        placeholder={(field.live ? live[field.key] : field.placeholder) ?? ''}
                        onChange={(e) => set(field.key, e.target.value)}
                      />
                    )}
                  </Field>
                </div>
              ))}
            </div>

            {template === 'spcmap' && (
              <div className="nc-studio__plot">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => plotOutlook('day1')}>
                  Plot today
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => plotOutlook('day2')}>
                  Plot tomorrow
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => plotOutlook('day3')}>
                  Plot day 3
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!outlook.length}
                  onClick={() => {
                    setOutlook([]);
                    setNote('Outlook cleared.');
                  }}
                >
                  Clear
                </Button>
                <span className="nc-studio__hint">
                  {outlook.length ? `${outlook.length} risk area${outlook.length === 1 ? '' : 's'} plotted` : 'Nothing plotted yet'}
                </span>
              </div>
            )}

            <div className="nc-studio__save">
              <Field label="Rundown name">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="6pm conditions" />
              </Field>
              <Button variant="primary" onClick={store} disabled={busy}>
                {cuedMatches ? 'Update item' : 'Add to rundown'}
              </Button>
              {hasLive && (
                <Button variant="ghost" onClick={useLiveNumbers} disabled={!overridden}>
                  Use live numbers
                </Button>
              )}
            </div>
          </div>
        </section>

        <div className="nc-studio__side">
          <section className="nc-studio__panel" aria-label="Rundown">
            <header className="nc-studio__panel-head">
              <h2>Rundown</h2>
              <span>{state.graphics.length} saved</span>
            </header>
            {state.graphics.length === 0 ? (
              <p className="nc-studio__empty">
                Nothing in the rundown yet. Build a graphic, name it and add it here to cue it during the show.
              </p>
            ) : (
              <ol className="nc-rundown">
                {state.graphics.map((graphic, i) => {
                  const isLive = Boolean(program && program.sourceId === graphic.id);
                  return (
                    <li
                      key={graphic.id}
                      className={`nc-rundown__item${isLive ? ' is-live' : ''}${cuedId === graphic.id ? ' is-cued' : ''}`}
                    >
                      <span className="nc-rundown__num">{i + 1}</span>
                      <button
                        type="button"
                        className={`nc-rundown__thumb${isOverlay(graphic.template) ? ' is-transparent' : ''}`}
                        onClick={() => cue(graphic)}
                        aria-label={`Cue ${graphic.name} in preview`}
                      >
                        <GraphicSvg data={snapshot(graphic.template, graphic.fields)} lite decorative />
                      </button>
                      <span className="nc-rundown__meta">
                        <strong>{graphic.name}</strong>
                        <em>
                          {templateName(graphic.template)} · {formatRelative(graphic.updatedAt)}
                        </em>
                      </span>
                      <span className="nc-rundown__actions">
                        {isLive && <span className="nc-rundown__live">On air</span>}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => take(snapshot(graphic.template, graphic.fields), graphic.name, graphic.id)}
                        >
                          Take
                        </Button>
                        <button
                          type="button"
                          className="nc-rundown__delete"
                          onClick={() => remove(graphic)}
                          aria-label={`Delete ${graphic.name}`}
                        >
                          ×
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className="nc-studio__panel" aria-label="Playout output">
            <header className="nc-studio__panel-head">
              <h2>Playout</h2>
              <span>Browser source · 1920 × 1080</span>
            </header>
            <div className="nc-studio__panel-body">
              <div className="nc-studio__output">
                <code>{outputUrl}</code>
                <Button size="sm" variant="outline" onClick={copyUrl}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button size="sm" variant="subtle" onClick={() => window.open(outputUrl, '_blank', 'noopener')}>
                  Open
                </Button>
              </div>
              <p className="nc-studio__hint">
                Add this address to vMix, OBS or TriCaster as a 1920×1080 browser source. It is transparent, so overlays
                key straight over video.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default GraphicsStudio;
