import './Logo.css';

/**
 * STORM 12 WEATHER logo.
 *
 * A vector rebuild of the station lockup: a chrome "STORM" wordmark, the
 * numeral 12 set in a silver tile, and WEATHER set wide beneath. Drawn in
 * SVG so it stays crisp from a phone header to a 1080p wall monitor.
 * textLength pins every word to its slot, so the lockup keeps its
 * proportions even before the display face has loaded.
 */

interface LogoProps {
  variant?: 'full' | 'compact' | 'stacked' | 'broadcast';
  /** Base size in pixels - the height of the compact tile. */
  size?: number;
  /** Kept for existing call sites; the Storm 12 mark has no radar sweep. */
  sweep?: boolean;
  className?: string;
}

let gradientSeed = 0;

const FACE = "'Russo One', 'Arial Black', sans-serif";
const TILE_BLUE = '#1d4f9c';
const LABEL = 'Storm 12 Weather';

export function Logo({ variant = 'full', size = 36, className = '' }: LogoProps) {
  // Unique gradient ids so multiple logos can share a page safely.
  const uid = `storm12-${(gradientSeed += 1)}`;

  const defs = (
    <defs>
      <linearGradient id={`${uid}-chrome`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="46%" stopColor="#e6ebf1" />
        <stop offset="54%" stopColor="#a9b5c3" />
        <stop offset="100%" stopColor="#dfe5ec" />
      </linearGradient>
      <linearGradient id={`${uid}-tile`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#cfd8e2" />
      </linearGradient>
    </defs>
  );

  if (variant === 'compact') {
    return (
      <span className={`nc-logo nc-logo--compact ${className}`}>
        <svg className="nc-logo__mark" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={LABEL} focusable="false">
          {defs}
          <rect x="2" y="6" width="60" height="52" rx="9" fill={`url(#${uid}-tile)`} />
          <text
            x="32"
            y="47"
            textAnchor="middle"
            fontFamily={FACE}
            fontSize="38"
            fill={TILE_BLUE}
            textLength="46"
            lengthAdjust="spacingAndGlyphs"
          >
            12
          </text>
        </svg>
      </span>
    );
  }

  // The full lockup is 300 x 92 units; it scales from the base size.
  const height = Math.round(size * 1.25);
  const width = Math.round((height * 300) / 92);

  return (
    <span className={`nc-logo nc-logo--${variant} ${className}`}>
      <svg className="nc-logo__mark" width={width} height={height} viewBox="0 0 300 92" role="img" aria-label={LABEL} focusable="false">
        {defs}
        <text
          x="0"
          y="54"
          fontFamily={FACE}
          fontSize="56"
          fill={`url(#${uid}-chrome)`}
          textLength="198"
          lengthAdjust="spacingAndGlyphs"
        >
          STORM
        </text>
        <rect x="208" y="3" width="90" height="64" rx="9" fill={`url(#${uid}-tile)`} />
        <text
          x="253"
          y="55"
          textAnchor="middle"
          fontFamily={FACE}
          fontSize="52"
          fill={TILE_BLUE}
          textLength="70"
          lengthAdjust="spacingAndGlyphs"
        >
          12
        </text>
        <text
          x="14"
          y="89"
          fontFamily={FACE}
          fontSize="25"
          fill="#ffffff"
          textLength="172"
          lengthAdjust="spacingAndGlyphs"
        >
          WEATHER
        </text>
      </svg>
    </span>
  );
}

export default Logo;
