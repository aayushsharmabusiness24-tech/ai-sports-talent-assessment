import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { listAssessments } from '../services/api';
import ProgressChart from './ProgressChart';
import { formatDate, scoreClass, statusInfo } from '../utils/format';

// Loads the user's assessments itself, so the Home page only needs to render <Dashboard />.
export default function Dashboard() {
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, error: '', total: 0, assessments: [] });

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

  const stats = useMemo(() => {
    const scored = state.assessments.filter(
      (a) => a.status === 'completed' && typeof a.formScore === 'number'
    );
    const avg = scored.length ? scored.reduce((sum, a) => sum + a.formScore, 0) / scored.length : null;
    const best = scored.length ? Math.max(...scored.map((a) => a.formScore)) : null;
    return { scoredCount: scored.length, avg, best };
  }, [state.assessments]);

  const firstName = user && user.name ? user.name.split(' ')[0] : '';
  const recent = state.assessments.slice(0, 5);

  const header = (
    <div className="page-header row between">
      <div>
        <h1 className="page-title">Hello{firstName ? `, ${firstName}` : ''}</h1>
        <p className="page-subtitle">Your assessment overview</p>
      </div>
      <Link to="/assessment" className="btn btn-primary">
        + New assessment
      </Link>
    </div>
  );

  if (state.loading) {
    return (
      <div>
        {header}
        <div className="empty-state">
          <div className="spinner" style={{ margin: '0 auto' }} aria-label="Loading" />
        </div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div>
        {header}
        <div className="alert alert-error">{state.error}</div>
        <button type="button" className="btn btn-secondary" onClick={load}>
          Try again
        </button>
      </div>
    );
  }

  if (state.total === 0) {
    return (
      <div>
        {header}
        <div className="card empty-state">
          <h2>No assessments yet</h2>
          <p className="muted">Upload a short video of an exercise to get your first analysis.</p>
          <Link to="/assessment" className="btn btn-primary">
            Start your first assessment
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      {header}

      <div className="grid grid-4">
        <div className="stat">
          <div className="stat-value">{state.total}</div>
          <div className="stat-label">Total assessments</div>
        </div>
        <div className="stat">
          <div className="stat-value">{stats.scoredCount}</div>
          <div className="stat-label">Scored assessments</div>
        </div>
        <div className="stat">
          <div className={`stat-value ${scoreClass(stats.avg)}`}>
            {stats.avg === null ? '—' : Math.round(stats.avg)}
          </div>
          <div className="stat-label">Average score</div>
        </div>
        <div className="stat">
          <div className={`stat-value ${scoreClass(stats.best)}`}>
            {stats.best === null ? '—' : Math.round(stats.best)}
          </div>
          <div className="stat-label">Best score</div>
        </div>
      </div>

      <ProgressChart assessments={state.assessments} />

      <div className="card">
        <div className="card-header">
          <h3 className="card-title" style={{ margin: 0 }}>
            Recent assessments
          </h3>
          <Link to="/history" className="btn btn-secondary btn-sm">
            View all
          </Link>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Activity</th>
                <th>Reps</th>
                <th>Score</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((a) => {
                const status = statusInfo(a.status);
                return (
                  <tr key={a.id}>
                    <td>{formatDate(a.createdAt)}</td>
                    <td>{a.exerciseLabel}</td>
                    <td>{typeof a.repetitions === 'number' ? a.repetitions : '—'}</td>
                    <td className={scoreClass(a.formScore)}>
                      {typeof a.formScore === 'number' ? Math.round(a.formScore) : '—'}
                    </td>
                    <td>
                      <span className={status.className}>{status.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}