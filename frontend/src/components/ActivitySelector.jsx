// Activity keys must match the backend: pushups, squats, pullups, running.
export const ACTIVITIES = [
  {
    key: 'pushups',
    label: 'Push-ups',
    icon: '💪',
    desc: 'Depth, body line, repetitions',
    tip: 'Film from the side, about 2-3 metres away, with your whole body in frame.',
  },
  {
    key: 'squats',
    label: 'Squats',
    icon: '🏋️',
    desc: 'Depth, torso lean, knees',
    tip: 'Film from the side (best) or the front, with head to feet in frame.',
  },
  {
    key: 'pullups',
    label: 'Pull-ups',
    icon: '🧗',
    desc: 'Range of motion, control',
    tip: 'Film from the front, back or side. Keep your hands, elbows and shoulders visible.',
  },
  {
    key: 'running',
    label: 'Running',
    icon: '🏃',
    desc: 'Cadence, rhythm, symmetry',
    tip: 'Film from the side for at least 5-10 seconds, with both legs visible.',
  },
];

// Camera view keys must match the backend: auto, side, front, back.
export const CAMERA_VIEWS = [
  { key: 'auto', label: 'Auto-detect' },
  { key: 'side', label: 'Side view' },
  { key: 'front', label: 'Front view' },
  { key: 'back', label: 'Back view' },
];

export default function ActivitySelector({ value, onChange, disabled = false }) {
  const selected = ACTIVITIES.find((a) => a.key === value);

  return (
    <div>
      <div className="activity-grid" role="group" aria-label="Choose an activity">
        {ACTIVITIES.map((a) => (
          <button
            type="button"
            key={a.key}
            className={`activity-option${value === a.key ? ' selected' : ''}`}
            onClick={() => onChange(a.key)}
            disabled={disabled}
            aria-pressed={value === a.key}
          >
            <span className="activity-icon" aria-hidden="true">
              {a.icon}
            </span>
            <span className="activity-name">{a.label}</span>
            <span className="activity-desc">{a.desc}</span>
          </button>
        ))}
      </div>
      {selected && <p className="form-hint mt-1">Filming tip: {selected.tip}</p>}
    </div>
  );
}

export function CameraViewSelect({ value, onChange, disabled = false }) {
  return (
    <select
      className="form-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label="Camera view"
    >
      {CAMERA_VIEWS.map((v) => (
        <option key={v.key} value={v.key}>
          {v.label}
        </option>
      ))}
    </select>
  );
}