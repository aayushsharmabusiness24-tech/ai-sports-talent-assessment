import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { listAssessments } from '../services/api';
import { formatDate, scoreClass, statusInfo } from '../utils/format';
import './dashboard.css';

const avg = (list) => (list.length ? list.reduce((s, a) => s + a.formScore, 0) / list.length : 0);

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// Simple SVG line chart. `items` must be oldest -> newest.
function ProgressChart({ items }) {
  if (!items.length) {
    return <p className="sd-muted">No scored tests for this exercise yet.</p>;
  }
  const W = 620, H = 210, L = 30, R = 10, T = 10, B = 24;
  const pw = W - L - R;
  const ph = H - T - B;
  const n = items.length;
  const x = (i) => L + (n > 1 ? (i * pw) / (n - 1) : pw / 2);
  const y = (v) => T + ph - (Math.min(100, Math.max(0, v)) / 100) * ph;
  const points = items.map((a, i) => `${x(i)},${y(a.formScore)}`).join(' ');
  return (
    <svg className="sd-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Score progress">
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="sd-grid" />
          <text x="0" y={y(v) + 4}>{v}</text>
        </g>
      ))}
      <polyline points={points} className="sd-line" />
      {items.map((a) => (
        <circle key={a.id} cx={x(items.indexOf(a))} cy={y(a.formScore)} r="4.5" className="sd-dot">
          <title>{`${a.exerciseLabel} · ${Math.round(a.formScore)} · ${formatDate(a.createdAt)}`}</title>
        </circle>
      ))}
      <text x={L} y={H - 4}>{formatDate(items[0].createdAt)}</text>
      <text x={W - R} y={H - 4} textAnchor="end">{formatDate(items[n - 1].createdAt)}</text>
    </svg>
  );
}

// Loads the user's assessments itself, so the Home page only needs to render <Dashboard />.
export default function Dashboard() {
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, error: '', total: 0, assessments: [] });
  const [filter, setFilter] = useState('All');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = await listAssessments({ limit: 200 });
      setState({ loading: false, error: '', total: data.total, assessments: data.assessments });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Completed + scored tests, oldest first (the API returns newest first).
  const scored = useMemo(
    () =>
      state.assessments
        .filter((a) => a.status === 'completed' && typeof a.formScore === 'number')
        .slice()
        .reverse(),
    [state.assessments]
  );

  const exercises = useMemo(() => ['All', ...new Set(scored.map((a) => a.exerciseLabel))], [scored]);
  const chartItems = filter === 'All' ? scored : scored.filter((a) => a.exerciseLabel === filter);

  const stats = useMemo(() => {
    const reps = state.assessments.reduce(
      (sum, a) => sum + (a.status === 'completed' && typeof a.repetitions === 'number' ? a.repetitions : 0),
      0
    );
    return {
      scoredCount: scored.length,
      reps,
      avg: scored.length ? avg(scored) : null,
      best: scored.length ? Math.max(...scored.map((a) => a.formScore)) : null,
    };
  }, [state.assessments, scored]);

  const insight = useMemo(() => {
    // If the list data includes the AI coach note, show it. Otherwise calculate a short insight.
    const withNote = [...scored].reverse().find((a) => a.coaching && a.coaching.overview);
    if (scored.length < 4) {
      return {
        change: null,
        text: withNote ? withNote.coaching.overview : 'Complete a few more assessments to unlock insights.',
      };
    }
    const recentAvg = avg(scored.slice(-3));
    const beforeAvg = avg(scored.slice(-6, -3));
    const change = beforeAvg ? Math.round(((recentAvg - beforeAvg) / beforeAvg) * 100) : 0;
    const byExercise = {};
    scored.forEach((a) => {
      (byExercise[a.exerciseLabel] = byExercise[a.exerciseLabel] || []).push(a);
    });
    const ranked = Object.entries(byExercise)
      .map(([name, list]) => [name, avg(list)])
      .sort((p, q) => q[1] - p[1]);
    const strongest = ranked[0];
    const weakest = ranked[ranked.length - 1];
    let text = `Your last 3 tests average ${Math.round(recentAvg)}, ${change >= 0 ? 'up' : 'down'} ${Math.abs(change)}% on the 3 before.`;
    if (ranked.length > 1) {
      text += ` ${strongest[0]} is your strongest exercise (${Math.round(strongest[1])}). Focus next on ${weakest[0]} (${Math.round(weakest[1])}).`;
    }
    return { change, text: withNote ? withNote.coaching.overview : text };
  }, [scored]);

  const firstName = user && user.name ? user.name.split(' ')[0] : '';
  const recent = state.assessments.slice(0, 5);

  const header = (
    <div className="sd-top">
      <div>
        <h1>
          {greeting()}
          {firstName ? `, ${firstName}` : ''} 👋
        </h1>
        <p className="sd-muted">Track your athletic potential</p>
      </div>
      <Link to="/assessment" className="sd-btn sd-link">
        ⚡ Start AI Assessment
      </Link>
    </div>
  );

  if (state.loading) {
    return (
      <div className="sd-wrap">
        {header}
        <div className="empty-state">
          <div className="spinner" style={{ margin: '0 auto' }} aria-label="Loading" />
        </div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="sd-wrap">
        {header}
        <div className="alert alert-error">{state.error}</div>
        <button type="button" className="sd-btn sd-ghost" onClick={load}>
          Try again
        </button>
      </div>
    );
  }

  if (state.total === 0) {
    return (
      <div className="sd-wrap">
        {header}
        <div className="sd-panel">
          <h2>No assessments yet</h2>
          <p className="sd-muted">Upload a short video of an exercise to get your first analysis.</p>
          <Link to="/assessment" className="sd-btn sd-link">
            Start your first assessment
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="sd-wrap">
      {header}

      <section className="sd-stats">
        <div className="sd-stat">
          <small>🏆 Total tests</small>
          <strong>{state.total}</strong>
        </div>
        <div className="sd-stat">
          <small>✓ Reps counted</small>
          <strong>{stats.reps}</strong>
        </div>
        <div className="sd-stat">
          <small>⚡ Average score</small>
          <strong className={scoreClass(stats.avg)}>{stats.avg === null ? '—' : Math.round(stats.avg)}</strong>
        </div>
        <div className="sd-stat">
          <small>🥇 Best score</small>
          <strong className={scoreClass(stats.best)}>{stats.best === null ? '—' : Math.round(stats.best)}</strong>
        </div>
      </section>

      <section className="sd-panel">
        <div className="sd-head">
          <h2>📈 Performance progress</h2>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by exercise">
            {exercises.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
        <ProgressChart items={chartItems} />
      </section>

      <section className="sd-two">
        <div className="sd-panel sd-insight">
          <h2>🧠 AI insight</h2>
          {insight.change !== null && (
            <p className={insight.change >= 0 ? 'sd-up' : 'sd-down'}>
              Score {insight.change >= 0 ? '↑' : '↓'} {Math.abs(insight.change)}%
            </p>
          )}
          <p>{insight.text}</p>
          <Link to="/history" className="sd-btn sd-ghost sd-link">
            View insights
          </Link>
        </div>

        <div className="sd-panel">
          <div className="sd-head">
            <h2>Recent tests</h2>
            <Link to="/history" className="sd-btn sd-ghost sd-link">
              View all
            </Link>
          </div>
          <ul className="sd-list">
            {recent.map((a) => {
              const status = statusInfo(a.status);
              return (
                <li key={a.id}>
                  <div>
                    {a.exerciseLabel}
                    <br />
                    <span className="sd-muted">
                      {formatDate(a.createdAt)} ·{' '}
                      {typeof a.repetitions === 'number' ? `${a.repetitions} reps` : status.label}
                    </span>
                  </div>
                  <strong className={scoreClass(a.formScore)}>
                    {typeof a.formScore === 'number' ? Math.round(a.formScore) : '—'}
                  </strong>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}
