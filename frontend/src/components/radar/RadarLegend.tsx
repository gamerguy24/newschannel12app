import { useState } from 'react';
import type { RadarProduct } from '../../api/types';
import './RadarLegend.css';

/**
 * Product legend. Reflectivity, velocity, echo tops and precipitation type
 * each read on a different scale, so the legend changes with the product
 * rather than showing one generic colour bar.
 */

interface Stop {
  color: string;
  label?: string;
}

const REFLECTIVITY: Stop[] = [
  { color: '#04e9e7', label: '5' },
  { color: '#019ff4' },
  { color: '#0300f4', label: '20' },
  { color: '#02fd02' },
  { color: '#01c501', label: '35' },
  { color: '#008e00' },
  { color: '#fdf802', label: '45' },
  { color: '#e5bc00' },
  { color: '#fd9500', label: '55' },
  { color: '#fd0000' },
  { color: '#d40000', label: '65' },
  { color: '#bc0000' },
  { color: '#f800fd', label: '75' },
  { color: '#9854c6' },
];

const VELOCITY: Stop[] = [
  { color: '#00ff00', label: '−64' },
  { color: '#00c400' },
  { color: '#008a00', label: '−32' },
  { color: '#004f00' },
  { color: '#1c1c1c', label: '0' },
  { color: '#4f0000' },
  { color: '#8a0000', label: '+32' },
  { color: '#c40000' },
  { color: '#ff0000', label: '+64' },
];

/** The Level III velocity ramp drawn by the decoder: teal in, gold out. */
const SRV: Stop[] = [
  { color: '#00e0e0', label: '−64' },
  { color: '#00a0a0' },
  { color: '#007000', label: '−20' },
  { color: '#00c800' },
  { color: '#beffbe', label: '0' },
  { color: '#ffbebe' },
  { color: '#dc0000', label: '+20' },
  { color: '#a00000' },
  { color: '#e07800' },
  { color: '#ffc800', label: '+64' },
];

const CORRELATION: Stop[] = [
  { color: '#282878', label: '0.2' },
  { color: '#008cc8' },
  { color: '#00c878', label: '0.8' },
  { color: '#dcdc00' },
  { color: '#fa9600', label: '0.95' },
  { color: '#fa2828', label: '1.0' },
];

const DIFFERENTIAL: Stop[] = [
  { color: '#5a5ab4', label: '−4' },
  { color: '#0096c8' },
  { color: '#78c878', label: '0' },
  { color: '#f0f050' },
  { color: '#fa9600', label: '+3' },
  { color: '#f02828' },
  { color: '#fafafa', label: '+8' },
];

const ECHO_TOPS: Stop[] = [
  { color: '#1b3a5c', label: '5' },
  { color: '#1f7fa8' },
  { color: '#22b14c', label: '20' },
  { color: '#c8e05a' },
  { color: '#ffd400', label: '35' },
  { color: '#ff8a1f' },
  { color: '#ff3d3d', label: '50' },
  { color: '#b21e7b', label: '60+' },
];

const PRECIP_TOTAL: Stop[] = [
  { color: '#1f4f74', label: '0.1' },
  { color: '#22b14c' },
  { color: '#9acd32', label: '0.5' },
  { color: '#ffd400' },
  { color: '#ff8a1f', label: '1.5' },
  { color: '#ff3d3d' },
  { color: '#b21e7b', label: '4+' },
];

const CATEGORICAL: Record<string, Array<{ color: string; label: string }>> = {
  'precip-type': [
    { color: '#22b14c', label: 'Rain' },
    { color: '#3fd8ff', label: 'Snow' },
    { color: '#ff69b4', label: 'Mix' },
    { color: '#b21e7b', label: 'Ice' },
  ],
  hydrometeor: [
    { color: '#22b14c', label: 'Rain' },
    { color: '#3fd8ff', label: 'Snow' },
    { color: '#ffd400', label: 'Graupel' },
    { color: '#ff3d3d', label: 'Hail' },
    { color: '#9854c6', label: 'Debris' },
    { color: '#7e93a8', label: 'Biological' },
  ],
  satellite: [
    { color: '#1b3a5c', label: 'Warm tops' },
    { color: '#7e93a8', label: 'Mid' },
    { color: '#ffffff', label: 'Cold tops' },
  ],
  temperature: [
    { color: '#7b68ee', label: '0°' },
    { color: '#3fd8ff', label: '32°' },
    { color: '#22c55e', label: '50°' },
    { color: '#ffd400', label: '72°' },
    { color: '#ff8a1f', label: '85°' },
    { color: '#ff3d3d', label: '95°+' },
  ],
};

function scaleFor(product?: RadarProduct): { stops: Stop[]; unit: string } | null {
  if (!product) return null;
  switch (product.id) {
    case 'composite':
    case 'reflectivity':
    case 'N0B':
      return { stops: REFLECTIVITY, unit: 'dBZ' };
    case 'velocity':
      return { stops: VELOCITY, unit: 'knots' };
    case 'N0S':
      return { stops: SRV, unit: 'knots' };
    case 'N0C':
      return { stops: CORRELATION, unit: '' };
    case 'N0X':
      return { stops: DIFFERENTIAL, unit: 'dB' };
    case 'echo-tops':
      return { stops: ECHO_TOPS, unit: 'kft' };
    case 'precip-total':
      return { stops: PRECIP_TOTAL, unit: 'inches' };
    default:
      return null;
  }
}

export function RadarLegend({
  product,
  compact,
}: {
  product?: RadarProduct;
  palette?: number;
  compact?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(Boolean(compact));
  if (!product) return null;

  const scale = scaleFor(product);
  const categorical = CATEGORICAL[product.id];
  if (!scale && !categorical) return null;

  return (
    <div className={`nc-legend${collapsed ? ' is-collapsed' : ''}`}>
      <button
        type="button"
        className="nc-legend__toggle"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span>{product.short}</span>
        {scale && <em>{scale.unit}</em>}
      </button>

      {!collapsed && (
        <div className="nc-legend__body">
          {scale && (
            <>
              <div className="nc-legend__ramp">
                {scale.stops.map((stop, i) => (
                  <span key={i} style={{ background: stop.color }} />
                ))}
              </div>
              <div className="nc-legend__labels">
                {scale.stops.map((stop, i) => (
                  <span key={i} className="nc-readout">
                    {stop.label ?? ''}
                  </span>
                ))}
              </div>
            </>
          )}

          {categorical && (
            <ul className="nc-legend__keys">
              {categorical.map((item) => (
                <li key={item.label}>
                  <span style={{ background: item.color }} />
                  {item.label}
                </li>
              ))}
            </ul>
          )}

          <p className="nc-legend__note">{product.description}</p>
        </div>
      )}
    </div>
  );
}

export default RadarLegend;
