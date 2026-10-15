import { useEffect, useRef, useState } from 'react';
import ActivitySelector, { CameraViewSelect } from '../components/ActivitySelector';
import VideoUpload from '../components/VideoUpload';
import AssessmentResults from '../components/AssessmentResults';
import { createAssessment, getHealth } from '../services/api';

export default function Assessment() {
  const [activity, setActivity] = useState('pushups');
  const [cameraView, setCameraView] = useState('auto');
  const [file, setFile] = useState(null);

  const [limits, setLimits] = useState({ maxUploadMb: 100, allowedExtensions: undefined });
  const [aiProblems, setAiProblems] = useState([]);

  const [phase, setPhase] = useState('idle'); // idle | uploading | analysing
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const controllerRef = useRef(null);

  const busy = phase !== 'idle';

  // Ask the server for its limits and whether the AI service is ready. This never blocks the page.
  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((h) => {
        if (cancelled) return;
        if (h.limits) {
          setLimits({ maxUploadMb: h.limits.maxUploadMb, allowedExtensions: h.limits.allowedExtensions });
        }
        if (h.ai && h.ai.ok === false) {
          setAiProblems(h.ai.problems && h.ai.problems.length ? h.ai.problems : ['The AI service is not ready.']);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // "Analysing for N seconds" counter.
  useEffect(() => {
    if (phase !== 'analysing') {
      setElapsed(0);
      return undefined;
    }
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Stop waiting if the user leaves the page.
  useEffect(() => () => {
    if (controllerRef.current) controllerRef.current.abort();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file || busy) return;

    setError(null);
    setProgress(0);
    setPhase('uploading');
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const saved = await createAssessment({
        file,
        activity,
        cameraView,
        signal: controller.signal,
        onProgress: setProgress,
        onUploaded: () => setPhase('analysing'),
      });
      setAssessment(saved);
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (!(err && err.name === 'AbortError')) setError(err);
    } finally {
      controllerRef.current = null;
      setPhase('idle');
    }
  }

  function startOver() {
    setAssessment(null);
    setFile(null);
    setError(null);
  }

  // ---------------- results ----------------
  if (assessment) {
    return (
      <div>
        <div className="page-header row between">
          <div>
            <h1 className="page-title">Assessment result</h1>
            <p className="page-subtitle">Saved to your history</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={startOver}>
            Analyse another video
          </button>
        </div>
        <AssessmentResults assessment={assessment} />
      </div>
    );
  }

  // ---------------- form ----------------
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">New assessment</h1>
        <p className="page-subtitle">Choose an activity, upload a video and get an AI analysis.</p>
      </div>

      {aiProblems.length > 0 && (
        <div className="alert alert-warning">
          <strong>The AI service is not ready yet.</strong>
          <ul className="list-clean mt-1">
            {aiProblems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          <strong>The analysis could not be completed.</strong>
          <div>{error.message}</div>
          {error.assessmentId && (
            <div className="small mt-1">This attempt was saved in your History as "Failed".</div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="card">
          <div className="card-title">1. Choose the activity</div>
          <ActivitySelector value={activity} onChange={setActivity} disabled={busy} />
        </div>

        <div className="card">
          <div className="card-title">2. Camera view</div>
          <CameraViewSelect value={cameraView} onChange={setCameraView} disabled={busy} />
          <div className="form-hint">
            "Auto-detect" works for most videos. Choose a view only if you are sure how you filmed.
          </div>
        </div>

        <div className="card">
          <div className="card-title">3. Upload your video</div>
          <VideoUpload
            file={file}
            onChange={setFile}
            disabled={busy}
            maxMb={limits.maxUploadMb}
            extensions={limits.allowedExtensions}
          />
          <p className="form-hint mt-1">
            Only one person should be in the video, with the whole body visible and good lighting. Your
            video is deleted from the server right after the analysis.
          </p>
        </div>

        <button type="submit" className="btn btn-primary mt-2" disabled={!file || busy}>
          Analyse video
        </button>
      </form>

      {busy && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Analysis in progress">
          <div className="overlay-box">
            {phase === 'uploading' ? (
              <>
                <h3>Uploading video...</h3>
                <div className="progress mt-2">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <p className="muted mt-1">{progress}%</p>
              </>
            ) : (
              <>
                <h3>Analysing your movement...</h3>
                <div className="progress progress-indeterminate mt-2">
                  <div className="progress-fill" />
                </div>
                <p className="muted mt-1">
                  {elapsed} seconds so far. This usually takes under two minutes, longer for long videos.
                  Please keep this page open.
                </p>
              </>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-sm mt-2"
              onClick={() => controllerRef.current && controllerRef.current.abort()}
            >
              Stop waiting
            </button>
          </div>
        </div>
      )}
    </div>
  );
}