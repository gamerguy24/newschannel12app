import { useState } from 'react';
import { Slider, Toggle } from '../ui/Primitives';
import type { RadarPalette, RadarProduct, RadarSite } from '../../api/types';
import './LayerPanel.css';

/**
 * The radar's layer selector: which product is painted, which vector overlays
 * sit on top, the colour palette, layer opacity and which WSR-88D site the
 * per-site products come from.
 */

const OVERLAY_LABELS: Array<{ id: string; label: string; hint: string }> = [
  { id: 'warnings', label: 'Warnings', hint: 'Tornado, severe thunderstorm, flash flood' },
  { id: 'watches', label: 'Watches', hint: 'Tornado and severe thunderstorm watches' },
  { id: 'advisories', label: 'Advisories', hint: 'Advisories and special weather statements' },
  { id: 'tracks', label: 'Storm Tracks', hint: 'Projected paths from NWS storm motion' },
  { id: 'spc', label: 'SPC Outlook', hint: 'Convective outlook risk areas' },
  { id: 'reports', label: 'Storm Reports', hint: "Today's tornado, wind and hail reports" },
  { id: 'stations', label: 'METAR Stations', hint: 'Live surface observations' },
];

interface LayerPanelProps {
  products: RadarProduct[];
  productId: string;
  onProduct: (id: string) => void;
  overlays: Record<string, boolean>;
  onToggleOverlay: (id: string) => void;
  palettes: RadarPalette[];
  palette: number;
  onPalette: (id: number) => void;
  opacity: number;
  onOpacity: (value: number) => void;
  sites: RadarSite[];
  site: string;
  onSite: (site: RadarSite) => void;
  spcDay: 'day1' | 'day2' | 'day3';
  onSpcDay: (day: 'day1' | 'day2' | 'day3') => void;
  onClose: () => void;
}

export function LayerPanel({
  products,
  productId,
  onProduct,
  overlays,
  onToggleOverlay,
  palettes,
  palette,
  onPalette,
  opacity,
  onOpacity,
  sites,
  site,
  onSite,
  spcDay,
  onSpcDay,
  onClose,
}: LayerPanelProps) {
  const [tab, setTab] = useState<'products' | 'overlays' | 'settings'>('products');
  const [siteQuery, setSiteQuery] = useState('');

  const selected = products.find((p) => p.id === productId);
  const filteredSites = siteQuery
    ? sites.filter(
        (s) => s.id.toLowerCase().includes(siteQuery.toLowerCase()) || s.name.toLowerCase().includes(siteQuery.toLowerCase()),
      )
    : sites;

  return (
    <aside className="nc-layers nc-enter" aria-label="Radar layers">
      <header className="nc-layers__head">
        <div className="nc-layers__tabs" role="tablist">
          {(['products', 'overlays', 'settings'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'is-active' : ''}
              onClick={() => setTab(id)}
            >
              {id === 'products' ? 'Products' : id === 'overlays' ? 'Overlays' : 'Settings'}
            </button>
          ))}
        </div>
        <button type="button" className="nc-layers__close" onClick={onClose} aria-label="Close layers panel">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="nc-layers__body">
        {tab === 'products' && (
          <ul className="nc-layers__products">
            {products.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  className={`${productId === product.id ? 'is-active' : ''}${product.available ? '' : ' is-unavailable'}`}
                  onClick={() => product.available && onProduct(product.id)}
                  disabled={!product.available}
                  title={product.available ? product.description : product.unavailableReason}
                >
                  <span className="nc-layers__product-code">{product.short}</span>
                  <span className="nc-layers__product-text">
                    <strong>{product.name}</strong>
                    <em>{product.available ? product.description : product.unavailableReason}</em>
                  </span>
                  <span className="nc-layers__product-tags">
                    {product.animated && <span className="is-anim">LOOP</span>}
                    <span>{product.scope === 'site' ? site : 'US'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {tab === 'overlays' && (
          <div className="nc-layers__overlays">
            {OVERLAY_LABELS.map((overlay) => (
              <Toggle
                key={overlay.id}
                label={overlay.label}
                description={overlay.hint}
                checked={Boolean(overlays[overlay.id])}
                onChange={() => onToggleOverlay(overlay.id)}
              />
            ))}

            {overlays.spc && (
              <div className="nc-layers__spc-days">
                <span className="nc-layers__sub">Outlook day</span>
                <div className="nc-segmented nc-segmented--sm">
                  {(['day1', 'day2', 'day3'] as const).map((day) => (
                    <button
                      key={day}
                      type="button"
                      className={spcDay === day ? 'is-active' : ''}
                      onClick={() => onSpcDay(day)}
                    >
                      Day {day.slice(-1)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'settings' && (
          <div className="nc-layers__settings">
            <Slider
              label="Layer opacity"
              value={Math.round(opacity * 100)}
              min={10}
              max={100}
              onChange={(value) => onOpacity(value / 100)}
              format={(v) => `${v}%`}
            />

            {selected?.animated && palettes.length > 0 && (
              <div className="nc-layers__group">
                <span className="nc-layers__sub">Colour palette</span>
                <ul className="nc-layers__palettes">
                  {palettes.map((option) => (
                    <li key={option.id}>
                      <button
                        type="button"
                        className={palette === option.id ? 'is-active' : ''}
                        onClick={() => onPalette(option.id)}
                        title={option.description}
                      >
                        {option.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="nc-layers__group">
              <span className="nc-layers__sub">Radar site</span>
              <input
                type="search"
                value={siteQuery}
                onChange={(e) => setSiteQuery(e.target.value)}
                placeholder="Search WSR-88D sites"
                aria-label="Search radar sites"
                className="nc-layers__site-search"
              />
              <ul className="nc-layers__sites">
                {filteredSites.slice(0, 40).map((option) => (
                  <li key={option.id}>
                    <button
                      type="button"
                      className={site === option.id ? 'is-active' : ''}
                      onClick={() => onSite(option)}
                    >
                      <strong>{option.id}</strong>
                      <span>{option.name}</span>
                      {option.distance !== undefined && <em className="nc-readout">{option.distance} mi</em>}
                      {option.status && !option.status.includes('On-line') && (
                        <span className="nc-layers__site-status">offline</span>
                      )}
                    </button>
                  </li>
                ))}
                {filteredSites.length === 0 && <li className="nc-layers__empty">No matching radar site.</li>}
              </ul>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

export default LayerPanel;
