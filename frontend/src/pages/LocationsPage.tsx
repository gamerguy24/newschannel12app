import { useState } from 'react';
import { useLocation } from '../context/LocationContext';
import { useDebounced, useResource } from '../hooks';
import { getCountyDetail, getCurrent, searchLocations } from '../services/weather';
import WeatherIcon from '../components/ui/WeatherIcon';
import { Button, EmptyState, ErrorState, Panel, Spinner } from '../components/ui/Primitives';
import { formatTemp } from '../utils/format';
import type { SavedLocation, SearchResult } from '../api/types';
import './LocationsPage.css';

/**
 * MY LOCATIONS
 *
 * The viewer's own list of places, kept on their device. Every entry shows
 * live conditions, can be renamed, reordered and made the active location for
 * the whole app in one tap.
 */

/**
 * County search hits carry no coordinate until their zone is resolved, so a
 * county has to be looked up before it can be saved.
 */
async function toSavedLocation(result: SearchResult): Promise<SavedLocation> {
  if (result.lat != null && result.lon != null) {
    return {
      id: result.id,
      type: result.type,
      name: result.name,
      label: result.label,
      state: result.state,
      detail: result.detail,
      lat: result.lat,
      lon: result.lon,
    };
  }
  const detail = await getCountyDetail(result.id);
  return {
    id: result.id,
    type: 'county',
    name: detail.county.name,
    label: detail.county.label,
    state: detail.county.state,
    lat: detail.county.lat,
    lon: detail.county.lon,
    zoneId: result.id,
  };
}

export function LocationsPage() {
  const {
    location,
    saved,
    isSaved,
    setLocation,
    save,
    remove,
    rename,
    reorder,
    useCurrentLocation,
    geolocating,
    geolocationError,
  } = useLocation();

  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const debounced = useDebounced(query.trim(), 280);
  const search = useResource((signal) => searchLocations(debounced, signal), [debounced], {
    enabled: debounced.length >= 2,
  });

  const results = debounced.length >= 2 ? search.data?.results ?? [] : [];

  const add = async (result: SearchResult, makeActive: boolean) => {
    setAdding(result.id);
    setAddError(null);
    try {
      const resolved = await toSavedLocation(result);
      save(resolved);
      if (makeActive) setLocation(resolved);
      setQuery('');
    } catch {
      setAddError(`Could not look up ${result.label}. Try again in a moment.`);
    } finally {
      setAdding(null);
    }
  };

  const startRename = (item: SavedLocation) => {
    setEditing(item.id);
    setDraftName(item.nickname ?? '');
  };

  const commitRename = (id: string) => {
    rename(id, draftName);
    setEditing(null);
    setDraftName('');
  };

  return (
    <div className="nc-page nc-locations">
      <header>
        <p className="nc-eyebrow">Storm 12 Weather</p>
        <h1 className="nc-page__title">My Locations</h1>
        <p className="nc-locations__sub">
          Saved places live on this device only &mdash; no account, nothing sent anywhere. The active location drives
          the forecast, radar and alert notifications across the whole app.
        </p>
      </header>

      <Panel
        eyebrow="Active location"
        title={location.nickname ?? location.label}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => useCurrentLocation()}
            disabled={geolocating}
            icon={
              geolocating ? (
                <Spinner size={13} />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.9" />
                  <circle cx="12" cy="12" r="8.4" stroke="currentColor" strokeWidth="1.6" opacity="0.6" />
                  <path d="M12 1.6v3M12 19.4v3M1.6 12h3M19.4 12h3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                </svg>
              )
            }
          >
            {geolocating ? 'Locating' : 'Use my location'}
          </Button>
        }
      >
        <div className="nc-locations__active">
          <ActiveSummary location={location} />
          {!isSaved(location.id) && (
            <Button variant="primary" size="sm" onClick={() => save(location)}>
              Save this location
            </Button>
          )}
        </div>
        {geolocationError && <p className="nc-locations__error">{geolocationError}</p>}
      </Panel>

      <Panel eyebrow="Add a place" title="Search Cities, ZIP Codes and Counties">
        <div className="nc-locations__search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="6.6" stroke="currentColor" strokeWidth="2" />
            <path d="m16.2 16.2 4.3 4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="City, ZIP code or county"
            aria-label="Search for a location to save"
          />
          {search.loading && <Spinner size={15} />}
        </div>

        {addError && <p className="nc-locations__error">{addError}</p>}

        {search.error && debounced.length >= 2 && (
          <ErrorState title="Search unavailable" message={search.error.friendly} onRetry={search.reload} />
        )}

        {results.length > 0 && (
          <ul className="nc-locations__results">
            {results.map((result) => (
              <li key={result.id}>
                <div className="nc-locations__result-text">
                  <span className="nc-locations__result-name">{result.label}</span>
                  <span className="nc-locations__result-detail">
                    {result.detail ?? result.county ?? result.type.toUpperCase()}
                  </span>
                </div>
                <div className="nc-row">
                  <Button size="sm" variant="subtle" onClick={() => add(result, true)} disabled={adding === result.id}>
                    {adding === result.id ? 'Adding' : 'Set active'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => add(result, false)}
                    disabled={adding === result.id || isSaved(result.id)}
                  >
                    {isSaved(result.id) ? 'Saved' : 'Save'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {debounced.length >= 2 && !search.loading && results.length === 0 && !search.error && (
          <p className="nc-locations__none">No cities, ZIP codes or counties match &ldquo;{debounced}&rdquo;.</p>
        )}
      </Panel>

      <Panel eyebrow={`${saved.length} saved`} title="Saved Locations">
        {saved.length === 0 ? (
          <EmptyState
            title="No saved locations yet"
            message="Save the places you check most - home, work, the lake - and switch between them with one tap. They stay on this device."
          />
        ) : (
          <ul className="nc-locations__list">
            {saved.map((item, index) => (
              <li key={item.id} className={item.id === location.id ? 'is-active' : ''}>
                <SavedRow
                  item={item}
                  active={item.id === location.id}
                  editing={editing === item.id}
                  draftName={draftName}
                  onDraftChange={setDraftName}
                  onCommitRename={() => commitRename(item.id)}
                  onCancelRename={() => setEditing(null)}
                  onStartRename={() => startRename(item)}
                  onSelect={() => setLocation(item)}
                  onRemove={() => remove(item.id)}
                  onMoveUp={index > 0 ? () => reorder(index, index - 1) : undefined}
                  onMoveDown={index < saved.length - 1 ? () => reorder(index, index + 1) : undefined}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** Live conditions for the location currently driving the app. */
function ActiveSummary({ location }: { location: SavedLocation }) {
  const current = useResource((signal) => getCurrent(location, signal), [location.lat, location.lon], {
    refreshMs: 180000,
  });
  const observation = current.data?.observation;

  return (
    <div className="nc-locations__active-now">
      <WeatherIcon name={observation?.icon ?? 'cloudy'} size={46} />
      <div>
        <p className="nc-locations__active-temp">{formatTemp(observation?.temperature)}</p>
        <p className="nc-locations__active-cond">{observation?.condition ?? 'Conditions unavailable'}</p>
      </div>
      <div className="nc-locations__active-place">
        <p>{location.label}</p>
        <p className="nc-readout">
          {location.lat.toFixed(3)}, {location.lon.toFixed(3)}
        </p>
      </div>
    </div>
  );
}

interface SavedRowProps {
  item: SavedLocation;
  active: boolean;
  editing: boolean;
  draftName: string;
  onDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onStartRename: () => void;
  onSelect: () => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

/** One saved place, with its own live temperature. */
function SavedRow({
  item,
  active,
  editing,
  draftName,
  onDraftChange,
  onCommitRename,
  onCancelRename,
  onStartRename,
  onSelect,
  onRemove,
  onMoveUp,
  onMoveDown,
}: SavedRowProps) {
  const current = useResource((signal) => getCurrent(item, signal), [item.lat, item.lon], { refreshMs: 300000 });
  const observation = current.data?.observation;

  return (
    <div className={`nc-locations__row${active ? ' is-active' : ''}`}>
      <button
        type="button"
        className="nc-locations__row-main"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
      >
        <WeatherIcon name={observation?.icon ?? 'cloudy'} size={34} animated={false} />
        <span className="nc-locations__row-text">
          <span className="nc-locations__row-name">{item.nickname ?? item.label}</span>
          <span className="nc-locations__row-detail">
            {item.nickname ? item.label : item.detail ?? item.type.toUpperCase()}
          </span>
        </span>
        <span className="nc-locations__row-temp">{formatTemp(observation?.temperature)}</span>
        {active && <span className="nc-locations__row-flag">Active</span>}
      </button>

      {editing ? (
        <div className="nc-locations__rename">
          <input
            value={draftName}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder="Home, Work, The lake"
            aria-label={`Nickname for ${item.label}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename();
              if (e.key === 'Escape') onCancelRename();
            }}
            autoFocus
          />
          <Button size="sm" variant="primary" onClick={onCommitRename}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancelRename}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="nc-locations__row-actions">
          <Button size="sm" variant="ghost" onClick={onStartRename}>
            Rename
          </Button>
          <Button size="sm" variant="ghost" onClick={onMoveUp} disabled={!onMoveUp} aria-label="Move up">
            ↑
          </Button>
          <Button size="sm" variant="ghost" onClick={onMoveDown} disabled={!onMoveDown} aria-label="Move down">
            ↓
          </Button>
          <Button size="sm" variant="danger" onClick={onRemove}>
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}

export default LocationsPage;
