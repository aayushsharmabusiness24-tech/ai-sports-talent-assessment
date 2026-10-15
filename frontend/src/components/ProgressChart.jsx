import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ACTIVITIES } from './ActivitySelector';
import { formatDate } from '../utils/format';

const COLOURS = {
  pushups: '#4f46e5',
  squats: '#059669',
  pullups: '#d97706',
  running: '#0284c7',
};

// Form score over time for ONE activity (scores of different activities are not comparable).
// `assessments` is the array returned by the API. Only completed, scored ones are plotted.
export default function ProgressChart({ assessments = [] }) {
  const [choice, setChoice] = useState(null);

  const scored = useMemo(
    () =>
      assessments.filter(
        (a) => a.status === 'completed' && typeof a.formScore === 'number'
      ),
    [assessments]
  );

  const counts = useMemo(() => {
    const c = {};
    scored.forEach((a) => {
      c[a.exerciseType] = (c[a.exerciseType] || 0) + 1;
    });
    return c;
  }, [scored]);

  const available = ACTIVITIES.filter((a) => counts[a.key]);
  const mostUsed = available.slice().sort((a, b) => counts[b.key] - counts[a.key])[0];
  const activity = choice && counts[choice] ? choice : mostUsed && mostUsed.key;

  const data = useMemo(
    () =>
      scored
        .filter((a) => a.exerciseType === activity)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .map((a, i) => ({
          n: i + 1,
          label: formatDate(a.createdAt),
          score: Math.round(a.formScore * 10) / 10,
        })),
    [scored, activity]
  );

  if (!available.length) {
    return (
      <div className="card empty-state">
        <h3>No scores yet</h3>
        <p className="muted">Your progress chart appears here after your first scored assessment.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title" style={{ margin: 0 }}>
          Progress over time
        </h3>
        <select
          className="form-select"
          style={{ width: 'auto' }}
          value={activity}
          onChange={(e) => setChoice(e.target.value)}
          aria-label="Activity to chart"
        >
          {available.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label} ({counts[a.key]})
            </option>
          ))}
        </select>
      </div>

      <div className="chart-box">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="n"
              allowDecimals={false}
              tickFormatter={(n) => `#${n}`}
              stroke="#94a3b8"
            />
            <YAxis domain={[0, 100]} stroke="#94a3b8" />
            <Tooltip
              labelFormatter={(n, payload) =>
                payload && payload[0] ? payload[0].payload.label : `#${n}`
              }
              formatter={(value) => [`${value}/100`, 'Form score']}
            />
            <Line
              type="monotone"
              dataKey="score"
              stroke={COLOURS[activity] || '#4f46e5'}
              strokeWidth={3}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="muted small mt-1">Each point is one assessment, oldest on the left.</p>
    </div>
  );
}