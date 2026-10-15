import { scoreClass } from '../utils/format';

const RADIUS = 64;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Circular 0-100 score. A null score shows "N/A" (never a made-up number).
export default function ScoreCard({ score, title = 'Form score', subtitle }) {
  const hasScore = typeof score === 'number' && Number.isFinite(score);
  const pct = hasScore ? Math.max(0, Math.min(100, score)) : 0;
  const colour = hasScore ? scoreClass(score) : 'muted';

  return (
    <div className="card center">
      <div className="card-title">{title}</div>
      <div className="score-ring-wrap">
        <svg
          viewBox="0 0 150 150"
          width="150"
          height="150"
          role="img"
          aria-label={hasScore ? `${Math.round(pct)} out of 100` : 'No score available'}
        >
          <circle cx="75" cy="75" r={RADIUS} fill="none" stroke="#e2e8f0" strokeWidth="12" />
          {hasScore && (
            <circle
              cx="75"
              cy="75"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={`${(CIRCUMFERENCE * pct) / 100} ${CIRCUMFERENCE}`}
              transform="rotate(-90 75 75)"
              className={colour}
            />
          )}
        </svg>
        <div className={`score-ring-label ${colour}`}>{hasScore ? Math.round(pct) : 'N/A'}</div>
      </div>
      {subtitle && <p className="muted small mt-1">{subtitle}</p>}
    </div>
  );
}