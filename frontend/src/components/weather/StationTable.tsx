import { useState } from 'react';
import { Panel, EmptyState } from '../ui/Primitives';
import { formatTemp, formatTime, formatWind } from '../../utils/format';
import type { StationObservation } from '../../api/types';
import './StationTable.css';

type SortKey = 'distance' | 'temperature' | 'dewpoint' | 'windSpeed' | 'visibility' | 'id';

/**
 * WEATHER STATIONS - the tabular view of live surface observations.
 * Every column is sortable, because during a wind event the question is
 * "who has the highest gust", not "who is closest".
 */
export function StationTable({
  stations,
  title = 'Weather Stations',
  eyebrow = 'Live observations',
}: {
  stations: StationObservation[];
  title?: string;
  eyebrow?: string;
}) {
  const [sort, setSort] = useState<SortKey>('distance');
  const [descending, setDescending] = useState(false);

  const sorted = [...stations].sort((a, b) => {
    const av = a[sort];
    const bv = b[sort];
    if (typeof av === 'string' || typeof bv === 'string') {
      return descending
        ? String(bv ?? '').localeCompare(String(av ?? ''))
        : String(av ?? '').localeCompare(String(bv ?? ''));
    }
    const an = av ?? -Infinity;
    const bn = bv ?? -Infinity;
    return descending ? Number(bn) - Number(an) : Number(an) - Number(bn);
  });

  const header = (key: SortKey, label: string, numeric = true) => (
    <th className={numeric ? 'is-numeric' : ''} aria-sort={sort === key ? (descending ? 'descending' : 'ascending') : 'none'}>
      <button
        type="button"
        onClick={() => {
          if (sort === key) setDescending((d) => !d);
          else {
            setSort(key);
            setDescending(key !== 'distance' && key !== 'id');
          }
        }}
      >
        {label}
        {sort === key && <span aria-hidden="true">{descending ? ' ▾' : ' ▴'}</span>}
      </button>
    </th>
  );

  if (!stations.length) {
    return (
      <Panel eyebrow={eyebrow} title={title}>
        <EmptyState
          title="No reporting stations"
          message="No METAR or ASOS stations are reporting in this area right now."
        />
      </Panel>
    );
  }

  return (
    <Panel eyebrow={eyebrow} title={title} action={<span className="nc-stations__count">{stations.length}</span>} flush>
      <div className="nc-stations__scroll">
        <table className="nc-stations">
          <thead>
            <tr>
              {header('id', 'Station', false)}
              {header('temperature', 'Temp')}
              {header('dewpoint', 'Dew Pt')}
              <th className="is-numeric">Wind</th>
              {header('windSpeed', 'Gust')}
              <th className="is-numeric">Pressure</th>
              {header('visibility', 'Vis')}
              <th className="is-numeric">Ceiling</th>
              <th>Weather</th>
              <th>Observed</th>
              {stations.some((s) => s.distance !== undefined) && header('distance', 'Dist')}
            </tr>
          </thead>
          <tbody>
            {sorted.map((station) => (
              <tr key={station.id}>
                <td>
                  <span className="nc-stations__id" style={{ '--fc': station.flightCategory.color } as React.CSSProperties}>
                    <span className="nc-stations__dot" aria-hidden="true" />
                    <strong>{station.id}</strong>
                  </span>
                  <span className="nc-stations__name">{station.name}</span>
                </td>
                <td className="is-numeric nc-readout">{formatTemp(station.temperature)}</td>
                <td className="is-numeric nc-readout">{formatTemp(station.dewpoint)}</td>
                <td className="is-numeric nc-readout">{formatWind(station.windSpeed, station.windCompass)}</td>
                <td className="is-numeric nc-readout">{station.windGust ? `${station.windGust}` : '--'}</td>
                <td className="is-numeric nc-readout">{station.altimeter ? station.altimeter.toFixed(2) : '--'}</td>
                <td className="is-numeric nc-readout">
                  {station.visibility === null ? '--' : `${station.visibility}${station.visibilityPlus ? '+' : ''}`}
                </td>
                <td className="is-numeric nc-readout">
                  {station.ceiling === null ? 'CLR' : station.ceiling.toLocaleString()}
                </td>
                <td>{station.presentWeather ?? station.sky}</td>
                <td className="nc-readout">{formatTime(station.observedAt)}</td>
                {station.distance !== undefined && <td className="is-numeric nc-readout">{station.distance} mi</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="nc-stations__foot">
        Temperature and dew point in °F · wind and gust in mph · pressure in inches of mercury · visibility in
        statute miles · ceiling in feet. Source: NOAA Aviation Weather Center METAR.
      </p>
    </Panel>
  );
}

export default StationTable;
