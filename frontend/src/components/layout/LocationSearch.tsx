import { useEffect, useRef, useState } from 'react';
import { useDebounced, useResource } from '../../hooks';
import { useLocation } from '../../context/LocationContext';
import { searchLocations } from '../../services/weather';
import { Button, Spinner } from '../ui/Primitives';
import type { SearchResult } from '../../api/types';
import './LocationSearch.css';

/**
 * The single search surface for the whole app: city, ZIP or county, plus the
 * viewer's saved favourites and a one-tap "use my location".
 */
export function LocationSearch({ onClose }: { onClose: () => void }) {
  const { saved, setLocation, selectSearchResult, useCurrentLocation, geolocating, geolocationError, resolving } =
    useLocation();
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const debounced = useDebounced(query.trim(), 280);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, loading, error } = useResource(
    (signal) => searchLocations(debounced, signal),
    [debounced],
    { enabled: debounced.length >= 2 },
  );

  const results = debounced.length >= 2 ? data?.results ?? [] : [];

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Lock the page behind the sheet so iOS does not scroll the background.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  useEffect(() => setHighlight(0), [debounced]);

  const choose = async (result: SearchResult) => {
    await selectSearchResult(result);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = results[highlight];
      if (picked) void choose(picked);
    }
  };

  return (
    <div className="nc-search" role="dialog" aria-modal="true" aria-label="Change location">
      <button className="nc-search__scrim" onClick={onClose} aria-label="Close location search" type="button" />

      <div className="nc-search__sheet nc-enter">
        <div className="nc-search__field">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m16.5 16.5 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="City, ZIP code or county"
            aria-label="Search for a city, ZIP code or county"
            autoComplete="off"
            enterKeyHint="search"
          />
          {(loading || resolving) && <Spinner size={17} />}
          <button type="button" className="nc-search__close" onClick={onClose} aria-label="Close">
            ESC
          </button>
        </div>

        <div className="nc-search__body">
          <Button
            variant="outline"
            block
            onClick={async () => {
              await useCurrentLocation();
              onClose();
            }}
            disabled={geolocating}
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" opacity="0.55" />
                <path d="M12 1.6v3M12 19.4v3M22.4 12h-3M4.6 12h-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            }
          >
            {geolocating ? 'Locating…' : 'Use my current location'}
          </Button>

          {geolocationError && <p className="nc-search__error">{geolocationError}</p>}
          {error && debounced.length >= 2 && <p className="nc-search__error">{error.friendly}</p>}

          {results.length > 0 && (
            <ul className="nc-search__results" role="listbox">
              {results.map((result, index) => (
                <li key={result.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlight}
                    className={index === highlight ? 'is-highlighted' : ''}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => void choose(result)}
                  >
                    <span className={`nc-search__kind nc-search__kind--${result.type}`}>
                      {result.type === 'zip' ? 'ZIP' : result.type === 'county' ? 'CO' : 'CITY'}
                    </span>
                    <span className="nc-search__result-text">
                      <span className="nc-search__result-label">{result.label}</span>
                      {result.detail && <span className="nc-search__result-detail">{result.detail}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {debounced.length >= 2 && !loading && results.length === 0 && !error && (
            <p className="nc-search__empty">
              No match for “{debounced}”. Try a city name, a five-digit ZIP code, or a county.
            </p>
          )}

          {debounced.length < 2 && saved.length > 0 && (
            <div className="nc-search__saved">
              <p className="nc-eyebrow">My Locations</p>
              <ul>
                {saved.map((place) => (
                  <li key={place.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setLocation(place);
                        onClose();
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span>{place.nickname ?? place.label}</span>
                      {place.nickname && <em>{place.label}</em>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {debounced.length < 2 && saved.length === 0 && (
            <p className="nc-search__hint">
              Search any city, ZIP code or county in the coverage area. Save the places you check most from the
              My Locations page.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default LocationSearch;
