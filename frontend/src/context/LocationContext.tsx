import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useStoredState } from '../hooks';
import { getAppConfig, reverseGeocode, getCountyDetail } from '../services/weather';
import type { AppConfig, SavedLocation, SearchResult } from '../api/types';

/**
 * LOCATION SYSTEM
 *
 * Owns the active location, the viewer's saved favourites and the geolocation
 * handshake. Saved locations persist locally so the app opens on the right
 * market without an account.
 */

interface LocationContextValue {
  location: SavedLocation;
  config: AppConfig | null;
  saved: SavedLocation[];
  isSaved: (id: string) => boolean;
  setLocation: (location: SavedLocation) => void;
  selectSearchResult: (result: SearchResult) => Promise<void>;
  save: (location: SavedLocation, nickname?: string) => void;
  remove: (id: string) => void;
  rename: (id: string, nickname: string) => void;
  reorder: (from: number, to: number) => void;
  useCurrentLocation: () => Promise<void>;
  geolocating: boolean;
  geolocationError: string | null;
  resolving: boolean;
}

const LocationContext = createContext<LocationContextValue | null>(null);

const FALLBACK: SavedLocation = {
  id: 'default:nashville',
  type: 'city',
  name: 'Nashville',
  state: 'TN',
  label: 'Nashville, TN',
  lat: 36.1627,
  lon: -86.7816,
};

export function LocationProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [active, setActive] = useStoredState<SavedLocation>('nc12.location', FALLBACK);
  const [saved, setSaved] = useStoredState<SavedLocation[]>('nc12.savedLocations', []);
  const [geolocating, setGeolocating] = useState(false);
  const [geolocationError, setGeolocationError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [bootstrapped, setBootstrapped] = useStoredState('nc12.bootstrapped', false);

  // Adopt the station's configured market the first time the app is opened.
  useEffect(() => {
    let cancelled = false;
    getAppConfig()
      .then((cfg) => {
        if (cancelled) return;
        setConfig(cfg);
        if (!bootstrapped) {
          const [name, state] = cfg.defaultLocation.name.split(',').map((s) => s.trim());
          setActive({
            id: `market:${cfg.defaultLocation.lat},${cfg.defaultLocation.lon}`,
            type: 'city',
            name,
            state,
            label: cfg.defaultLocation.name,
            lat: cfg.defaultLocation.lat,
            lon: cfg.defaultLocation.lon,
          });
          setBootstrapped(true);
        }
      })
      .catch(() => {
        // Config is a convenience; the stored/fallback location still works.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocation = useCallback(
    (next: SavedLocation) => {
      setActive(next);
      setGeolocationError(null);
    },
    [setActive],
  );

  /**
   * Turn a search hit into an active location. County results have no
   * coordinate until their zone geometry is resolved, so do that first.
   */
  const selectSearchResult = useCallback(
    async (result: SearchResult) => {
      if (result.type === 'county' && (result.lat == null || result.lon == null)) {
        setResolving(true);
        try {
          const detail = await getCountyDetail(result.id);
          setLocation({
            id: result.id,
            type: 'county',
            name: detail.county.name,
            state: detail.county.state,
            label: detail.county.label,
            lat: detail.county.lat,
            lon: detail.county.lon,
            zoneId: result.id,
          });
        } finally {
          setResolving(false);
        }
        return;
      }
      if (result.lat == null || result.lon == null) return;
      setLocation({
        id: result.id,
        type: result.type,
        name: result.name,
        state: result.state,
        label: result.label,
        detail: result.detail,
        lat: result.lat,
        lon: result.lon,
      });
    },
    [setLocation],
  );

  const useCurrentLocation = useCallback(async () => {
    if (!('geolocation' in navigator)) {
      setGeolocationError('This device does not support location services.');
      return;
    }
    setGeolocating(true);
    setGeolocationError(null);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 12000,
          maximumAge: 300000,
        });
      });
      const { latitude, longitude } = position.coords;
      let named: SavedLocation = {
        id: 'current',
        type: 'coords',
        name: 'Current Location',
        label: 'Current Location',
        lat: latitude,
        lon: longitude,
      };
      try {
        const place = await reverseGeocode({ lat: latitude, lon: longitude });
        named = { ...named, name: place.name, label: place.label, state: place.state };
      } catch {
        // Naming is cosmetic; the coordinate is what the forecast needs.
      }
      setLocation(named);
    } catch (err) {
      const code = (err as GeolocationPositionError)?.code;
      setGeolocationError(
        code === 1
          ? 'Location permission denied. Search for your city or ZIP instead.'
          : code === 3
            ? 'Location request timed out. Try again or search manually.'
            : 'Could not determine your location. Search for your city or ZIP instead.',
      );
    } finally {
      setGeolocating(false);
    }
  }, [setLocation]);

  const save = useCallback(
    (location: SavedLocation, nickname?: string) => {
      setSaved((prev) => {
        if (prev.some((l) => l.id === location.id)) return prev;
        return [...prev, { ...location, nickname }];
      });
    },
    [setSaved],
  );

  const remove = useCallback((id: string) => setSaved((prev) => prev.filter((l) => l.id !== id)), [setSaved]);

  const rename = useCallback(
    (id: string, nickname: string) =>
      setSaved((prev) => prev.map((l) => (l.id === id ? { ...l, nickname: nickname.trim() || undefined } : l))),
    [setSaved],
  );

  const reorder = useCallback(
    (from: number, to: number) =>
      setSaved((prev) => {
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        if (!moved) return prev;
        next.splice(to, 0, moved);
        return next;
      }),
    [setSaved],
  );

  const isSaved = useCallback((id: string) => saved.some((l) => l.id === id), [saved]);

  const value = useMemo<LocationContextValue>(
    () => ({
      location: active,
      config,
      saved,
      isSaved,
      setLocation,
      selectSearchResult,
      save,
      remove,
      rename,
      reorder,
      useCurrentLocation,
      geolocating,
      geolocationError,
      resolving,
    }),
    [
      active, config, saved, isSaved, setLocation, selectSearchResult, save, remove, rename,
      reorder, useCurrentLocation, geolocating, geolocationError, resolving,
    ],
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationContextValue {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used inside a LocationProvider');
  return ctx;
}
