import ScoreCard from './ScoreCard';
import { Link } from 'react-router-dom';
import {
  formatDate,
  formatDuration,
  humanizeKey,
  scoreClass,
  statusInfo,
} from '../utils/format';

function confidenceLabel(value) {
  if (value >= 0.75) return 'High';
  if (value >= 0.5) return 'Medium';
  return 'Low';
}

function MetricTable({ title, data }) {
  const rows = Object.entries(data || {}).filter(([, v]) => v !== null && v !== undefined);
  if (!rows.length) return null;
  return (
    <div className="mb-2">
      <h4>{title}</h4>
      <div className="table-wrap">
        <table className="table">
          <tbody>
            {rows.map(([key, value]) => (
              <tr key={key}>
                <td>{humanizeKey(key)}</td>
                <td>{String(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Warnings({ warnings }) {
  if (!warnings || !warnings.length) return null;
  return (
    <div className="alert alert-warning">
      <strong>Things that may affect accuracy</strong>
      <ul className="list-clean mt-1">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

// Shows one saved assessment (the object returned by the API).
export default function AssessmentResults({ assessment }) {
  if (!assessment) return null;

  const result = assessment.result;
  const status = statusInfo(assessment.status);
  const isRunning = assessment.exerciseType === 'running';

  const header = (
    <div className="card">
      <div className="card-header" style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>{assessment.exerciseLabel}</h2>
        <span className={status.className}>{status.label}</span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {formatDate(assessment.createdAt)}
        {result && result.cameraView ? ` · ${result.cameraView} view` : ''}
        {assessment.processingMs ? ` · analysed in ${formatDuration(assessment.processingMs)}` : ''}
      </p>
    </div>
  );

  // ---- failed or still processing ----
  if (assessment.status === 'failed') {
    return (
      <div>
        {header}
        <div className="alert alert-error mt-2">
          <strong>This video could not be analysed.</strong>
          <div>{assessment.error ? assessment.error.message : 'An unknown error occurred.'}</div>
        </div>
      </div>
    );
  }
  if (assessment.status === 'processing' || !result) {
    return (
      <div>
        {header}
        <div className="alert alert-info mt-2">This assessment is still being processed.</div>
      </div>
    );
  }

  const warnings = result.confidence ? result.confidence.warnings : [];
  const suggestions = result.suggestions || [];

  // ---- not enough reliable data: no score ----
  if (assessment.status === 'insufficient_data') {
    return (
      <div>
        {header}
        <div className="grid grid-2 mt-2">
          <ScoreCard
            score={null}
            title={isRunning ? 'Movement score' : 'Form score'}
            subtitle="No score: not enough reliable data"
          />
          <div className="card">
            <div className="card-title">Why there is no score</div>
            <ul className="list-clean">
              {(assessment.feedback || []).map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
            {suggestions.length > 0 && (
              <>
                <div className="card-title mt-2">How to get a better result</div>
                <ul className="list-clean">
                  {suggestions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
        <div className="mt-2">
          <Warnings warnings={warnings} />
        </div>
        <p className="muted small">{result.disclaimer}</p>
      </div>
    );
  }

  // ---- completed ----
  const hasReps = typeof assessment.repetitions === 'number';
  const estimated = (result.metrics && result.metrics.estimated) || {};
  const overall = result.confidence ? result.confidence.overall : 0;
  const breakdown = result.scoreBreakdown || [];
  const mistakes = result.mistakes || [];

  return (
    <div>
      {header}

      <div className="grid grid-2 mt-2">
        <ScoreCard
          score={assessment.formScore}
          title={isRunning ? 'Movement consistency' : 'Form score'}
          subtitle="Experimental estimate"
        />
        <div className="card">
          <div className="card-title">Summary</div>
          <p>{result.summary}</p>
          <div className="grid grid-3">
            {hasReps && (
              <>
                <div className="stat">
                  <div className="stat-value">{assessment.repetitions}</div>
                  <div className="stat-label">Completed reps</div>
                </div>
                <div className="stat">
                  <div className="stat-value">{assessment.incompleteRepetitions ?? 0}</div>
                  <div className="stat-label">Incomplete attempts</div>
                </div>
              </>
            )}
            {isRunning && estimated.cadenceStepsPerMinute != null && (
              <>
                <div className="stat">
                  <div className="stat-value">{estimated.cadenceStepsPerMinute}</div>
                  <div className="stat-label">Steps per minute (est.)</div>
                </div>
                <div className="stat">
                  <div className="stat-value">{estimated.detectedSteps ?? '—'}</div>
                  <div className="stat-label">Steps detected</div>
                </div>
              </>
            )}
            <div className="stat">
              <div className={`stat-value ${scoreClass(overall * 100)}`}>
                {confidenceLabel(overall)}
              </div>
              <div className="stat-label">Confidence ({Math.round(overall * 100)}%)</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2">
        <Warnings warnings={warnings} />
      </div>

      {breakdown.length > 0 && (
        <div className="card">
          <div className="card-title">How the score was calculated</div>
          {breakdown.map((c) => {
            const evaluated = c.score !== null && c.score !== undefined;
            return (
              <div className="breakdown-row" key={c.key}>
                <div className="breakdown-head">
                  <span>{c.label}</span>
                  <span className={evaluated ? scoreClass(c.score) : 'muted'}>
                    {evaluated ? `${Math.round(c.score)}/100` : 'Not evaluated'}
                  </span>
                </div>
                {evaluated && (
                  <div className="bar">
                    <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, c.score))}%` }} />
                  </div>
                )}
                <p className="muted small mt-1" style={{ marginBottom: 0 }}>
                  {c.explanation}
                  {evaluated && c.weight ? ` (counts for ${Math.round(c.weight * 100)}% of the score)` : ''}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {mistakes.length > 0 && (
        <div className="card">
          <div className="card-title">Issues found</div>
          {mistakes.map((m, i) => (
            <div className={`mistake mistake-${m.severity || 'low'}`} key={`${m.code}-${i}`}>
              <div className="mistake-title">{m.title}</div>
              <div className="small">{m.detail}</div>
              {m.repetitions && m.repetitions.length > 0 && (
                <div className="mt-1">
                  <span className="muted small">Repetitions: </span>
                  {m.repetitions.map((n) => (
                    <span className="tag" key={n}>
                      #{n}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
            {result.coaching && (
        <div className="card">
          <div className="card-header">
            <div className="card-title" style={{ margin: 0 }}>🤖 AI coach</div>
            <span className="badge badge-info">AI-written</span>
          </div>
          <p>{result.coaching.overview}</p>
          <ul className="list-clean">
            {(result.coaching.tips || []).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
          {result.coaching.nextSession && (
            <p className="mt-1">
              <strong>Next session:</strong> {result.coaching.nextSession}
            </p>
          )}
          <p className="muted small">
            Written by an AI language model from the measurements on this page. It can make
            mistakes, and the numbers above are the source of truth. Not medical advice.
          </p>
        </div>
      )}
      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="card-title">Feedback</div>
          <ul className="list-clean">
            {(assessment.feedback || []).map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="card-title">Suggestions</div>
          <ul className="list-clean">
            {suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      </div>

      {result.metrics &&
        (Object.keys(result.metrics.measured || {}).length > 0 ||
          Object.keys(result.metrics.estimated || {}).length > 0) && (
          <div className="card">
            <div className="card-title">Detailed measurements</div>
            <MetricTable title="Measured from the video" data={result.metrics.measured} />
            <MetricTable title="Estimated (less certain)" data={result.metrics.estimated} />
          </div>
        )}

      <p className="muted small mt-2">{result.disclaimer}</p>
    <div className="row mt-3">
  <Link to="/" className="btn btn-primary">Go to dashboard</Link>
  <Link to="/history" className="btn btn-secondary">View history</Link>
</div></div>
  );
}