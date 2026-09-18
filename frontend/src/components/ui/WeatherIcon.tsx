import './WeatherIcon.css';
import type { IconName } from '../../api/types';

/**
 * Original Storm 12 weather icon set.
 *
 * One flat, high-contrast SVG family built for broadcast legibility: bold
 * silhouettes that stay readable at 18px in a forecast strip and at 120px on
 * a wall monitor. Motion is subtle and honours prefers-reduced-motion.
 */

interface WeatherIconProps {
  name: IconName | string;
  size?: number;
  animated?: boolean;
  className?: string;
  title?: string;
}

const SUN = '#FFC233';
const SUN_DEEP = '#FF8A1F';
const MOON = '#DCE9F6';
const CLOUD = '#E6EFF8';
const CLOUD_DARK = '#A8BDD1';
const CLOUD_STORM = '#7E93A8';
const RAIN = '#3FD8FF';
const SNOW = '#DFF4FF';
const BOLT = '#FFD400';
const ALERT = '#FF3D3D';

function Sun({ cx = 32, cy = 30, r = 11 }: { cx?: number; cy?: number; r?: number }) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const angle = (i * Math.PI) / 4;
    const inner = r + 3.5;
    const outer = r + 8;
    return (
      <line
        key={i}
        x1={cx + Math.cos(angle) * inner}
        y1={cy + Math.sin(angle) * inner}
        x2={cx + Math.cos(angle) * outer}
        y2={cy + Math.sin(angle) * outer}
        stroke={SUN}
        strokeWidth="3"
        strokeLinecap="round"
      />
    );
  });
  return (
    <g className="wx-sun">
      <g className="wx-sun__rays">{rays}</g>
      <circle cx={cx} cy={cy} r={r} fill={SUN} />
      <circle cx={cx} cy={cy} r={r} fill="url(#wx-sun-grad)" />
    </g>
  );
}

function Moon({ cx = 32, cy = 29, r = 12 }: { cx?: number; cy?: number; r?: number }) {
  return (
    <g className="wx-moon">
      <path
        d={`M${cx + r * 0.45} ${cy - r} a${r} ${r} 0 1 0 ${r * 0.72} ${r * 1.5} a${r * 0.86} ${r * 0.86} 0 1 1 -${r * 0.72} -${r * 1.5} Z`}
        fill={MOON}
      />
      <circle cx={cx + 12} cy={cy - 12} r="1.6" fill={MOON} opacity="0.8" />
      <circle cx={cx + 17} cy={cy - 5} r="1.1" fill={MOON} opacity="0.6" />
    </g>
  );
}

function Cloud({
  x = 0,
  y = 0,
  scale = 1,
  fill = CLOUD,
  className = '',
}: { x?: number; y?: number; scale?: number; fill?: string; className?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} className={className}>
      <path
        d="M20 44a11 11 0 0 1 1.2-21.9A15 15 0 0 1 49 24.6 10.2 10.2 0 0 1 47.6 44H20Z"
        fill={fill}
      />
    </g>
  );
}

function Drops({ color = RAIN, count = 3, heavy = false }: { color?: string; count?: number; heavy?: boolean }) {
  return (
    <g className="wx-drops">
      {Array.from({ length: count }, (_, i) => (
        <line
          key={i}
          className="wx-drop"
          style={{ animationDelay: `${i * 0.18}s` }}
          x1={22 + i * 9}
          y1={47}
          x2={19 + i * 9}
          y2={heavy ? 58 : 55}
          stroke={color}
          strokeWidth={heavy ? 3.4 : 2.8}
          strokeLinecap="round"
        />
      ))}
    </g>
  );
}

function Flakes() {
  return (
    <g className="wx-flakes">
      {[0, 1, 2].map((i) => (
        <g key={i} className="wx-flake" style={{ animationDelay: `${i * 0.35}s` }}>
          <circle cx={23 + i * 9} cy={52} r="2.6" fill={SNOW} />
        </g>
      ))}
    </g>
  );
}

function Bolt() {
  return <path className="wx-bolt" d="M34 42h9l-6 9h7L30 62l4-11h-7l7-9Z" fill={BOLT} />;
}

/** Every icon in the set, keyed by the name the data layer emits. */
function renderIcon(name: string) {
  switch (name) {
    case 'clear-day':
      return <Sun />;
    case 'clear-night':
      return <Moon />;
    case 'partly-cloudy-day':
      return (
        <>
          <Sun cx={24} cy={22} r={9} />
          <Cloud x={4} y={8} scale={0.86} />
        </>
      );
    case 'partly-cloudy-night':
      return (
        <>
          <Moon cx={24} cy={20} r={9} />
          <Cloud x={4} y={8} scale={0.86} />
        </>
      );
    case 'mostly-cloudy':
      return (
        <>
          <Cloud x={-2} y={-4} scale={0.72} fill={CLOUD_DARK} />
          <Cloud x={4} y={8} scale={0.9} />
        </>
      );
    case 'cloudy':
      return (
        <>
          <Cloud x={-4} y={-2} scale={0.68} fill={CLOUD_DARK} />
          <Cloud x={6} y={6} scale={0.92} />
        </>
      );
    case 'rain':
      return (
        <>
          <Cloud x={2} y={-2} scale={0.9} fill={CLOUD_DARK} />
          <Drops />
        </>
      );
    case 'showers':
      return (
        <>
          <Sun cx={48} cy={16} r={7} />
          <Cloud x={-2} y={0} scale={0.88} fill={CLOUD_DARK} />
          <Drops count={2} />
        </>
      );
    case 'thunderstorm':
      return (
        <>
          <Cloud x={2} y={-4} scale={0.92} fill={CLOUD_STORM} />
          <Drops count={2} color={RAIN} />
          <Bolt />
        </>
      );
    case 'snow':
      return (
        <>
          <Cloud x={2} y={-2} scale={0.9} fill={CLOUD_DARK} />
          <Flakes />
        </>
      );
    case 'sleet':
      return (
        <>
          <Cloud x={2} y={-2} scale={0.9} fill={CLOUD_DARK} />
          <Drops count={2} color={RAIN} />
          <circle cx={41} cy={53} r="2.6" fill={SNOW} />
        </>
      );
    case 'blizzard':
      return (
        <>
          <Cloud x={2} y={-4} scale={0.9} fill={CLOUD_STORM} />
          <Flakes />
          <line x1="14" y1="46" x2="34" y2="46" stroke={SNOW} strokeWidth="2.6" strokeLinecap="round" opacity="0.75" />
          <line x1="20" y1="58" x2="44" y2="58" stroke={SNOW} strokeWidth="2.6" strokeLinecap="round" opacity="0.6" />
        </>
      );
    case 'fog':
      return (
        <>
          <Cloud x={2} y={-8} scale={0.86} fill={CLOUD_DARK} />
          {[0, 1, 2].map((i) => (
            <line
              key={i}
              className="wx-fog-line"
              style={{ animationDelay: `${i * 0.4}s` }}
              x1={12}
              y1={44 + i * 7}
              x2={52}
              y2={44 + i * 7}
              stroke={CLOUD}
              strokeWidth="3.4"
              strokeLinecap="round"
              opacity={0.8 - i * 0.18}
            />
          ))}
        </>
      );
    case 'windy':
      return (
        <g className="wx-wind">
          {[
            'M8 24h26a7 7 0 1 0-7-7',
            'M8 36h34a7.5 7.5 0 1 1-7.5 7.5',
            'M8 48h20',
          ].map((d, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={CLOUD}
              strokeWidth="3.6"
              strokeLinecap="round"
              className="wx-wind-line"
              style={{ animationDelay: `${i * 0.25}s` }}
            />
          ))}
        </g>
      );
    case 'hot':
      return (
        <>
          <Sun cx={26} cy={26} r={11} />
          <rect x="44" y="14" width="7" height="30" rx="3.5" fill={CLOUD} opacity="0.35" />
          <rect x="45.5" y="24" width="4" height="20" rx="2" fill={SUN_DEEP} />
          <circle cx="47.5" cy="49" r="7" fill={SUN_DEEP} />
        </>
      );
    case 'cold':
      return (
        <>
          <g className="wx-cold" stroke={RAIN} strokeWidth="3" strokeLinecap="round">
            <line x1="32" y1="12" x2="32" y2="52" />
            <line x1="15" y1="22" x2="49" y2="42" />
            <line x1="15" y1="42" x2="49" y2="22" />
            <line x1="32" y1="12" x2="26" y2="19" />
            <line x1="32" y1="12" x2="38" y2="19" />
            <line x1="32" y1="52" x2="26" y2="45" />
            <line x1="32" y1="52" x2="38" y2="45" />
          </g>
        </>
      );
    case 'tornado':
      return (
        <g className="wx-tornado">
          {[
            { y: 14, w: 44 },
            { y: 22, w: 36 },
            { y: 30, w: 27 },
            { y: 38, w: 19 },
            { y: 46, w: 12 },
            { y: 54, w: 6 },
          ].map((band, i) => (
            <rect
              key={i}
              x={32 - band.w / 2}
              y={band.y}
              width={band.w}
              height="5"
              rx="2.5"
              fill={i < 2 ? CLOUD_STORM : ALERT}
              opacity={0.55 + i * 0.07}
              className="wx-tornado-band"
              style={{ animationDelay: `${i * 0.09}s` }}
            />
          ))}
        </g>
      );
    case 'hurricane':
      return (
        <g className="wx-hurricane">
          <path
            d="M32 12c11 0 20 5 20 12 0 5-5 8-12 8 6 3 9 7 9 12 0 7-9 12-20 12s-20-5-20-12c0-5 5-8 12-8-6-3-9-7-9-12 0-7 9-12 20-12Z"
            fill={CLOUD_STORM}
            opacity="0.85"
          />
          <circle cx="32" cy="32" r="5.5" fill="#04101c" />
        </g>
      );
    default:
      return <Cloud x={4} y={4} scale={0.9} />;
  }
}

export function WeatherIcon({ name, size = 40, animated = true, className = '', title }: WeatherIconProps) {
  return (
    <svg
      className={`wx-icon${animated ? ' wx-icon--animated' : ''} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 64 68"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <radialGradient id="wx-sun-grad" cx="35%" cy="30%">
          <stop offset="0%" stopColor="#FFE7A3" stopOpacity="0.95" />
          <stop offset="100%" stopColor={SUN_DEEP} stopOpacity="0.35" />
        </radialGradient>
      </defs>
      {renderIcon(name)}
    </svg>
  );
}

export default WeatherIcon;
