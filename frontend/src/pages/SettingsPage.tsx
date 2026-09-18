import { ALERT_TYPE_OPTIONS, useAlerts } from '../context/AlertContext';
import { useLocation } from '../context/LocationContext';
import { useResource } from '../hooks';
import { getHealth } from '../services/weather';
import {
  Button,
  Chip,
  DataStamp,
  Panel,
  SegmentedControl,
  Toggle,
} from '../components/ui/Primitives';
import { formatRelative } from '../utils/format';
import './SettingsPage.css';

/**
 * ALERTS & SETTINGS
 *
 * Everything about how this device is warned. Life-threatening products
 * (tornado emergencies, catastrophic-tier warnings) deliberately override
 * quiet hours, exactly as a weather radio does - that behaviour is stated
 * here rather than hidden.
 */
export function SettingsPage() {
  const {
    settings,
    updateSettings,
    permission,
    requestPermission,
    connected,
    lastUpdate,
    alerts,
    dismissed,
    restore,
    testNotification,
  } = useAlerts();
  const { location, config, saved } = useLocation();

  const health = useResource(() => getHealth(), [], { refreshMs: 60000 });

  const granted = permission === 'granted';
  const unsupported = permission === 'unsupported';

  const toggleType = (id: string) =>
    updateSettings({ types: { ...settings.types, [id]: !(settings.types[id] ?? true) } });

  return (
    <div className="nc-page nc-settings">
      <header>
        <p className="nc-eyebrow">Storm 12 Weather</p>
        <h1 className="nc-page__title">Alerts &amp; Settings</h1>
        <p className="nc-settings__sub">
          Weather alert notifications for this device, following {location.nickname ?? location.label}. Settings are
          stored locally &mdash; nothing here leaves your browser.
        </p>
      </header>

      {/* ------------------------------------------------------ permission */}

      <Panel
        eyebrow="Browser permission"
        title="Alert Notifications"
        accent={granted ? 'var(--nc-green)' : 'var(--nc-gold)'}
      >
        <div className="nc-settings__permission">
          <div>
            <p className="nc-settings__permission-state">
              {unsupported
                ? 'This browser cannot show notifications'
                : granted
                  ? 'Notifications are allowed'
                  : permission === 'denied'
                    ? 'Notifications are blocked'
                    : 'Notifications are not enabled yet'}
            </p>
            <p className="nc-settings__permission-help">
              {unsupported
                ? 'The alert banner, the on-screen ticker and the audible chime still work; only system notifications are unavailable.'
                : permission === 'denied'
                  ? 'Your browser is blocking notifications for this site. Re-allow them in the site permissions for this page, then reload.'
                  : granted
                    ? 'Warnings for your active location will be delivered even when this tab is in the background.'
                    : 'Allow notifications so severe weather warnings reach you when this tab is not in front.'}
            </p>
          </div>
          {!granted && !unsupported && permission !== 'denied' && (
            <Button variant="primary" onClick={requestPermission}>
              Enable notifications
            </Button>
          )}
        </div>

        <div className="nc-settings__controls">
          <Toggle
            label="Weather alert notifications"
            description="Deliver National Weather Service alerts for the active location."
            checked={settings.enabled}
            onChange={(next) => updateSettings({ enabled: next })}
            disabled={!granted}
          />

          <div className="nc-settings__field">
            <span className="nc-settings__field-label">Alert level</span>
            <SegmentedControl
              size="sm"
              value={settings.level}
              onChange={(level) => updateSettings({ level })}
              options={[
                { value: 'critical', label: 'Warnings only' },
                { value: 'all', label: 'All alerts' },
              ]}
            />
            <p className="nc-settings__field-help">
              {settings.level === 'critical'
                ? 'Only warnings - the products that mean act now.'
                : 'Warnings, watches, advisories and statements.'}
            </p>
          </div>

          <Toggle
            label="Alert chime"
            description="Play a tone when an alert arrives. Warnings use a more urgent pattern."
            checked={settings.sound}
            onChange={(sound) => updateSettings({ sound })}
          />
          <Toggle
            label="Vibration"
            description="Vibrate on phones and tablets that support it."
            checked={settings.vibration}
            onChange={(vibration) => updateSettings({ vibration })}
          />

          <Button variant="outline" size="sm" onClick={testNotification}>
            Send a test alert
          </Button>
        </div>
      </Panel>

      {/* ----------------------------------------------------- alert types */}

      <Panel eyebrow="What gets through" title="Alert Types">
        <p className="nc-settings__note">
          Turn off the products you do not want delivered. Every alert still appears in the Severe Weather Center and
          on the ticker &mdash; this only controls notifications.
        </p>
        <div className="nc-settings__types">
          {ALERT_TYPE_OPTIONS.map((option) => (
            <Chip
              key={option.id}
              active={settings.types[option.id] ?? true}
              onClick={() => toggleType(option.id)}
              color={option.critical ? 'var(--nc-red)' : 'var(--nc-cyan)'}
              title={option.critical ? 'Life-threatening products' : 'Impact products'}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </Panel>

      {/* ---------------------------------------------------- quiet hours */}

      <Panel eyebrow="Overnight" title="Quiet Hours">
        <Toggle
          label="Silence non-critical alerts overnight"
          description="Watches, advisories and statements are held during these hours."
          checked={settings.quietHours.enabled}
          onChange={(enabled) => updateSettings({ quietHours: { ...settings.quietHours, enabled } })}
        />

        <div className="nc-settings__times">
          <label>
            <span className="nc-settings__field-label">Start</span>
            <input
              type="time"
              value={settings.quietHours.start}
              disabled={!settings.quietHours.enabled}
              onChange={(e) => updateSettings({ quietHours: { ...settings.quietHours, start: e.target.value } })}
            />
          </label>
          <label>
            <span className="nc-settings__field-label">End</span>
            <input
              type="time"
              value={settings.quietHours.end}
              disabled={!settings.quietHours.enabled}
              onChange={(e) => updateSettings({ quietHours: { ...settings.quietHours, end: e.target.value } })}
            />
          </label>
        </div>

        <p className="nc-settings__warning">
          Tornado emergencies and other catastrophic-tier warnings always come through, quiet hours or not. A warning
          that means take cover now is never held back.
        </p>
      </Panel>

      {/* ------------------------------------------------------ connection */}

      <Panel eyebrow="Live alert feed" title="Connection">
        <dl className="nc-settings__stats">
          <div>
            <dt>Alert stream</dt>
            <dd className={connected ? 'is-good' : 'is-bad'}>{connected ? 'Connected' : 'Reconnecting'}</dd>
          </div>
          <div>
            <dt>Last update</dt>
            <dd className="nc-readout">{lastUpdate ? formatRelative(lastUpdate) : '--'}</dd>
          </div>
          <div>
            <dt>Active alerts</dt>
            <dd className="nc-readout">{alerts.length}</dd>
          </div>
          <div>
            <dt>Saved locations</dt>
            <dd className="nc-readout">{saved.length}</dd>
          </div>
          <div>
            <dt>API</dt>
            <dd className={health.data?.ok ? 'is-good' : 'is-bad'}>
              {health.data ? (health.data.ok ? 'Up' : 'Degraded') : health.error ? 'Unreachable' : 'Checking'}
            </dd>
          </div>
          <div>
            <dt>API uptime</dt>
            <dd className="nc-readout">
              {health.data ? `${Math.floor(health.data.uptimeSeconds / 60)} min` : '--'}
            </dd>
          </div>
        </dl>

        {dismissed.length > 0 && (
          <div className="nc-settings__dismissed">
            <p>
              {dismissed.length} alert banner{dismissed.length === 1 ? '' : 's'} dismissed on this device.
            </p>
            <Button variant="outline" size="sm" onClick={restore}>
              Show them again
            </Button>
          </div>
        )}
      </Panel>

      {/* --------------------------------------------------------- sources */}

      {config && (
        <Panel eyebrow="Where the weather comes from" title="Data Sources">
          <p className="nc-settings__note">
            {config.station.name} builds every forecast, radar frame and alert on this page from official government
            sources. Nothing is invented or filled in.
          </p>
          <ul className="nc-settings__sources">
            {config.sources.map((source) => (
              <li key={source.id}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.name}
                </a>
                <span className="nc-readout">{source.url.replace(/^https?:\/\//, '')}</span>
              </li>
            ))}
          </ul>
          <div className="nc-settings__features">
            <Chip color={config.features.lightning ? 'var(--nc-gold)' : undefined} active={config.features.lightning}>
              Lightning {config.features.lightning ? 'configured' : 'not configured'}
            </Chip>
            <Chip
              color={config.features.stormRelativeVelocity ? 'var(--nc-cyan)' : undefined}
              active={config.features.stormRelativeVelocity}
            >
              Storm-relative velocity {config.features.stormRelativeVelocity ? 'available' : 'unavailable'}
            </Chip>
            <Chip color={config.features.liveStream ? 'var(--nc-red)' : undefined} active={config.features.liveStream}>
              Live stream {config.features.liveStream ? 'configured' : 'not configured'}
            </Chip>
          </div>
        </Panel>
      )}

      <DataStamp source={config?.station.name ?? 'Storm 12 Weather'} updatedAt={health.updatedAt} />
    </div>
  );
}

export default SettingsPage;
