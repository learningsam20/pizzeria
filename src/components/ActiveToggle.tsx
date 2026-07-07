interface ActiveToggleProps {
  active: boolean;
  disabled?: boolean;
  busy?: boolean;
  onToggle: () => void;
  label?: string;
}

export default function ActiveToggle({ active, disabled, busy, onToggle, label }: ActiveToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={label || (active ? 'Active — click to deactivate' : 'Inactive — click to activate')}
      disabled={disabled || busy}
      onClick={onToggle}
      title={active ? 'Active — click to deactivate' : 'Inactive — click to activate'}
      className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        backgroundColor: active ? 'var(--noir-success-bg)' : 'var(--noir-toggle-off)',
        borderColor: active ? 'var(--noir-success-border)' : 'var(--noir-border)',
      }}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          active ? 'translate-x-5' : 'translate-x-1'
        } ${busy ? 'opacity-60' : ''}`}
      />
    </button>
  );
}
