import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useStoredState } from '../hooks';
import { useLocation } from './LocationContext';
import { openAlertStream } from '../services/weather';
import type { WeatherAlert } from '../api/types';

/**
 * WEATHER ALERT NOTIFICATIONS
 *
 * A single Server-Sent Events subscription feeds the breaking banner, the
 * alert badge and the browser notification. One connection per device rather
 * than every panel polling the NWS separately.
 */

export interface NotificationSettings {
  enabled: boolean;
  /** 'critical' = warnings only, 'all' = watches and advisories too. */
  level: 'critical' | 'all';
  sound: boolean;
  vibration: boolean;
  quietHours: { enabled: boolean; start: string; end: string };
  /** Which location the subscription follows. */
  scope: 'current' | 'saved' | 'county';
  types: Record<string, boolean>;
}

export const ALERT_TYPE_OPTIONS = [
  { id: 'tornado', label: 'Tornado Warnings', critical: true },
  { id: 'thunderstorm', label: 'Severe Thunderstorm Warnings', critical: true },
  { id: 'flood', label: 'Flood & Flash Flood', critical: true },
  { id: 'winter', label: 'Winter Weather', critical: false },
  { id: 'tropical', label: 'Tropical Alerts', critical: true },
  { id: 'wind', label: 'Wind Alerts', critical: false },
  { id: 'heat', label: 'Heat Alerts', critical: false },
  { id: 'other', label: 'Other NWS Alerts', critical: false },
];

export const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  level: 'critical',
  sound: true,
  vibration: true,
  quietHours: { enabled: false, start: '22:00', end: '07:00' },
  scope: 'current',
  types: Object.fromEntries(ALERT_TYPE_OPTIONS.map((t) => [t.id, true])),
};

interface AlertContextValue {
  alerts: WeatherAlert[];
  connected: boolean;
  lastUpdate: string | null;
  settings: NotificationSettings;
  updateSettings: (patch: Partial<NotificationSettings>) => void;
  permission: NotificationPermission | 'unsupported';
  requestPermission: () => Promise<void>;
  dismissed: string[];
  dismiss: (id: string) => void;
  restore: () => void;
  testNotification: () => void;
}

const AlertContext = createContext<AlertContextValue | null>(null);

/** Is `now` inside the configured quiet-hours window (which may wrap midnight)? */
export function inQuietHours(settings: NotificationSettings, now = new Date()): boolean {
  if (!settings.quietHours.enabled) return false;
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const start = toMinutes(settings.quietHours.start);
  const end = toMinutes(settings.quietHours.end);
  const current = now.getHours() * 60 + now.getMinutes();
  return start <= end ? current >= start && current < end : current >= start || current < end;
}

/** A short alert chime, synthesised so the app ships no audio binaries. */
function playChime(urgent: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const tones = urgent ? [880, 1174, 880, 1174] : [660, 880];
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const start = now + i * 0.18;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(urgent ? 0.28 : 0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.18);
    });
    window.setTimeout(() => ctx.close().catch(() => undefined), (tones.length + 1) * 200);
  } catch {
    // Audio is a nicety; a blocked AudioContext must not break alerting.
  }
}

export function AlertProvider({ children }: { children: ReactNode }) {
  const { location } = useLocation();
  const [alerts, setAlerts] = useState<WeatherAlert[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [settings, setSettings] = useStoredState<NotificationSettings>('nc12.notifications', DEFAULT_SETTINGS);
  const [dismissed, setDismissed] = useStoredState<string[]>('nc12.dismissedAlerts', []);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const notified = useRef<Set<string>>(new Set());

  const shouldNotify = useCallback(
    (alert: WeatherAlert) => {
      if (!settings.enabled || permission !== 'granted') return false;
      if (settings.types[alert.group] === false) return false;
      if (settings.level === 'critical' && alert.kind !== 'warning') return false;
      // Life-threatening products override quiet hours, exactly as a weather
      // radio would; everything else stays silent.
      if (inQuietHours(settings) && !(alert.isEmergency || alert.tier === 'catastrophic')) return false;
      return true;
    },
    [settings, permission],
  );

  const fire = useCallback(
    (alert: WeatherAlert) => {
      if (notified.current.has(alert.id)) return;
      notified.current.add(alert.id);
      if (!shouldNotify(alert)) return;

      const urgent = alert.isEmergency || alert.tier === 'catastrophic';
      try {
        const notification = new Notification(`STORM 12 WEATHER · ${alert.event.toUpperCase()}`, {
          body: alert.headline ?? alert.areaDesc,
          tag: alert.id,
          requireInteraction: urgent,
          silent: !settings.sound,
        });
        notification.onclick = () => {
          window.focus();
          window.location.hash = '';
          notification.close();
        };
      } catch {
        // Notification construction can throw on locked-down browsers.
      }
      if (settings.sound) playChime(urgent);
      if (settings.vibration && 'vibrate' in navigator) {
        navigator.vibrate(urgent ? [220, 90, 220, 90, 400] : [160, 80, 160]);
      }
    },
    [shouldNotify, settings.sound, settings.vibration],
  );

  // One SSE subscription, re-established when the viewer changes location.
  useEffect(() => {
    let source: EventSource | null = null;
    let retry: number | undefined;
    let attempts = 0;
    let closed = false;

    const connect = () => {
      if (closed) return;
      source = openAlertStream(location);

      source.addEventListener('open', () => {
        attempts = 0;
        setConnected(true);
      });

      source.addEventListener('alerts', (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as {
          alerts: WeatherAlert[];
          fresh: WeatherAlert[];
          updatedAt: string;
        };
        setAlerts(payload.alerts);
        setLastUpdate(payload.updatedAt);
        setConnected(true);
        for (const alert of payload.fresh) fire(alert);
      });

      source.onerror = () => {
        setConnected(false);
        source?.close();
        if (closed) return;
        // Exponential backoff caps at 30s so a long outage does not hammer.
        attempts += 1;
        retry = window.setTimeout(connect, Math.min(30000, 1000 * 2 ** attempts));
      };
    };

    connect();
    return () => {
      closed = true;
      source?.close();
      if (retry) window.clearTimeout(retry);
      setConnected(false);
    };
  }, [location.lat, location.lon, fire]);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') {
      setPermission('unsupported');
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') setSettings((prev) => ({ ...prev, enabled: true }));
  }, [setSettings]);

  const updateSettings = useCallback(
    (patch: Partial<NotificationSettings>) => setSettings((prev) => ({ ...prev, ...patch })),
    [setSettings],
  );

  const dismiss = useCallback((id: string) => setDismissed((prev) => [...new Set([...prev, id])]), [setDismissed]);
  const restore = useCallback(() => setDismissed([]), [setDismissed]);

  const testNotification = useCallback(() => {
    if (permission === 'granted') {
      try {
        // eslint-disable-next-line no-new
        new Notification('STORM 12 WEATHER · TEST ALERT', {
          body: 'Alert notifications are working. This is a test from the Storm 12 Weather app.',
        });
      } catch {
        // Ignore - the chime below still confirms the settings.
      }
    }
    if (settings.sound) playChime(false);
    if (settings.vibration && 'vibrate' in navigator) navigator.vibrate([160, 80, 160]);
  }, [permission, settings.sound, settings.vibration]);

  const value = useMemo<AlertContextValue>(
    () => ({
      alerts,
      connected,
      lastUpdate,
      settings,
      updateSettings,
      permission,
      requestPermission,
      dismissed,
      dismiss,
      restore,
      testNotification,
    }),
    [alerts, connected, lastUpdate, settings, updateSettings, permission, requestPermission, dismissed, dismiss, restore, testNotification],
  );

  return <AlertContext.Provider value={value}>{children}</AlertContext.Provider>;
}

export function useAlerts(): AlertContextValue {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error('useAlerts must be used inside an AlertProvider');
  return ctx;
}
