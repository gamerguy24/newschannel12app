import type { ReactNode } from 'react';
import './Primitives.css';

/** The shared broadcast-styled building blocks used across every screen. */

/* ------------------------------------------------------------------ panel */

interface PanelProps {
  title?: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
  accent?: string;
}

export function Panel({ title, eyebrow, action, children, className = '', flush, accent }: PanelProps) {
  return (
    <section
      className={`nc-panel ${className}`}
      style={accent ? ({ '--panel-accent': accent } as React.CSSProperties) : undefined}
    >
      {(title || action || eyebrow) && (
        <header className="nc-panel__head">
          <div className="nc-panel__headings">
            {eyebrow && <span className="nc-panel__eyebrow">{eyebrow}</span>}
            {title && <h2 className="nc-panel__title">{title}</h2>}
          </div>
          {action && <div className="nc-panel__action">{action}</div>}
        </header>
      )}
      <div className={flush ? '' : 'nc-panel__body'}>{children}</div>
    </section>
  );
}

/* ----------------------------------------------------------------- button */

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'outline' | 'danger' | 'subtle';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  active?: boolean;
  block?: boolean;
}

export function Button({
  variant = 'ghost',
  size = 'md',
  icon,
  active,
  block,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`nc-btn nc-btn--${variant} nc-btn--${size}${active ? ' is-active' : ''}${block ? ' is-block' : ''} ${className}`}
      aria-pressed={active === undefined ? undefined : active}
      {...rest}
    >
      {icon && <span className="nc-btn__icon">{icon}</span>}
      {children && <span className="nc-btn__label">{children}</span>}
    </button>
  );
}

/* ------------------------------------------------------------------- chip */

interface ChipProps {
  children: ReactNode;
  color?: string;
  active?: boolean;
  onClick?: () => void;
  count?: number;
  title?: string;
}

export function Chip({ children, color, active, onClick, count, title }: ChipProps) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      className={`nc-chip${active ? ' is-active' : ''}${onClick ? ' is-clickable' : ''}`}
      style={color ? ({ '--chip-color': color } as React.CSSProperties) : undefined}
      onClick={onClick}
      title={title}
      type={onClick ? 'button' : undefined}
      aria-pressed={onClick && active !== undefined ? active : undefined}
    >
      {children}
      {count !== undefined && <span className="nc-chip__count">{count}</span>}
    </Tag>
  );
}

/* ------------------------------------------------------------------ badge */

export function TierBadge({ tier, children }: { tier: string; children: ReactNode }) {
  return <span className={`nc-tier nc-tier--${tier}`}>{children}</span>;
}

/* ----------------------------------------------------------------- states */

export function Spinner({ size = 24, label }: { size?: number; label?: string }) {
  return (
    <span className="nc-spinner-wrap" role="status" aria-live="polite">
      <svg className="nc-spinner" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="16" fill="none" stroke="var(--nc-navy-500)" strokeWidth="4" />
        <path
          d="M20 4a16 16 0 0 1 16 16"
          fill="none"
          stroke="var(--nc-cyan)"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
      {label && <span className="nc-spinner__label">{label}</span>}
    </span>
  );
}

export function Skeleton({ height = 20, width = '100%', radius = 8 }: { height?: number | string; width?: number | string; radius?: number }) {
  return <div className="nc-skeleton" style={{ height, width, borderRadius: radius }} aria-hidden="true" />;
}

interface StateProps {
  title: string;
  message?: string;
  action?: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'error' | 'success';
}

export function EmptyState({ title, message, action, icon, tone = 'neutral' }: StateProps) {
  return (
    <div className={`nc-state nc-state--${tone}`}>
      {icon && <div className="nc-state__icon">{icon}</div>}
      <p className="nc-state__title">{title}</p>
      {message && <p className="nc-state__message">{message}</p>}
      {action && <div className="nc-state__action">{action}</div>}
    </div>
  );
}

/**
 * Failure surface. Always names what could not be reached and offers a retry,
 * because "something went wrong" is useless when a radar site drops out.
 */
export function ErrorState({
  title = 'Weather data unavailable',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      tone="error"
      title={title}
      message={message}
      icon={
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3 1.5 21h21L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M12 9.5v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="17.6" r="1.15" fill="currentColor" />
        </svg>
      }
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}

/** A small "data source / last updated" footer used under live panels. */
export function DataStamp({
  source,
  updatedAt,
  stale,
}: {
  source?: string;
  updatedAt?: number | string | null;
  stale?: boolean;
}) {
  const time =
    updatedAt === null || updatedAt === undefined
      ? null
      : new Date(updatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  return (
    <p className={`nc-stamp${stale ? ' is-stale' : ''}`}>
      {stale && <span className="nc-stamp__flag">LAST GOOD DATA</span>}
      {source && <span>{source}</span>}
      {time && <span className="nc-readout">Updated {time}</span>}
    </p>
  );
}

/* --------------------------------------------------------------- controls */

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`nc-toggle${disabled ? ' is-disabled' : ''}`}>
      <span className="nc-toggle__text">
        <span className="nc-toggle__label">{label}</span>
        {description && <span className="nc-toggle__description">{description}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span className="nc-toggle__track" aria-hidden="true">
        <span className="nc-toggle__thumb" />
      </span>
    </label>
  );
}

export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  label,
  format,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (next: number) => void;
  label: string;
  format?: (value: number) => string;
}) {
  return (
    <label className="nc-slider">
      <span className="nc-slider__head">
        <span>{label}</span>
        <span className="nc-readout">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </label>
  );
}

/** Horizontal segmented control used for day pickers and view switches. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  value: T;
  onChange: (next: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`nc-segmented nc-segmented--${size}`} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          disabled={option.disabled}
          className={value === option.value ? 'is-active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
