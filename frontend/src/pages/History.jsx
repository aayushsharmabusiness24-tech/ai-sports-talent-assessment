import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAssessments } from '../services/api';
import { ACTIVITIES } from '../components/ActivitySelector';
import AssessmentResults from '../components/AssessmentResults';
import { formatDate, scoreClass, statusInfo } from '../utils/format';

export default function History() {
  const [state, setState] = useState({ loading: true, error: '', total: 0, items: [] });
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const detailRef = useRef(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = await listAssessments({ limit: 200 });
      setState({ loading: false, error: '', total: data.total, items: data.assessments });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const items = filter === 'all' ? state.items : state.items.filter((a) => a.exerciseType === filter);
  const selected = state.items.find((a) => a.id === selectedId) || null;

  useEffect(() => {
    if (selected && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="page-header row between">
        <div>
          <h1 className="page-title">History</h1>
          <p className="page-subtitle">All your past assessments</p>
        </div>
        <Link to="/assessment" className="btn btn-primary">
          + New assessment
        </Link>
      </div>

      {state.loading && (
        <div className="empty-state">
          <div className="spinner" style={{ margin: '0 auto' }} aria-label="Loading" />
        </div>
      )}

      {state.error && (
        <>
          <div className="alert alert-error">{state.error}</div>
          <button type="button" className="btn btn-secondary" onClick={load}>
            Try again
          </button>
        </>
      )}

      {!state.loading && !state.error && state.total === 0 && (
        <div className="card empty-state">
          <h2>Nothing here yet</h2>
          <p className="muted">Your assessments will be listed here.</p>
          <Link to="/assessment" className="btn btn-primary">
            Start your first assessment
          </Link>
        </div>
      )}

      {!state.loading && !state.error && state.total > 0 && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title" style={{ margin: 0 }}>
              {items.length} assessment{items.length === 1 ? '' : 's'}
            </h3>
            <select
              className="form-select"
              style={{ width: 'auto' }}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter by activity"
            >
              <option value="all">All activities</option>
              {ACTIVITIES.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          {items.length === 0 ? (
            <p className="muted">No assessments for this activity.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Activity</th>
                    <th>Reps</th>
                    <th>Score</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => {
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
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setSelectedId(a.id)}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {state.total > state.items.length && (
            <p className="muted small mt-1">
              Showing the latest {state.items.length} of {state.total} assessments.
            </p>
          )}
        </div>
      )}

      {selected && (
        <div ref={detailRef} className="mt-3">
          <div className="row between mb-2">
            <h2 style={{ margin: 0 }}>Details</h2>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedId(null)}>
              Close
            </button>
          </div>
          <AssessmentResults assessment={selected} />
        </div>
      )}
    </div>
  );
}