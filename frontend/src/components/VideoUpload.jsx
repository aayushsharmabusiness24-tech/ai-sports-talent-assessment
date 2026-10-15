import { useEffect, useRef, useState } from 'react';

const DEFAULT_EXTENSIONS = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.m4v'];

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Props:
//   file        the selected File (or null)
//   onChange    called with a File, or null when removed
//   maxMb       size limit shown to the user (the server enforces it too)
//   extensions  allowed file extensions
export default function VideoUpload({
  file,
  onChange,
  disabled = false,
  maxMb = 100,
  extensions = DEFAULT_EXTENSIONS,
}) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState(null);

  // Create (and clean up) a temporary address so the chosen video can be previewed.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function accept(f) {
    if (!f) return;
    const name = f.name.toLowerCase();
    if (!extensions.some((ext) => name.endsWith(ext))) {
      setError(`Unsupported file type. Allowed formats: ${extensions.join(', ')}.`);
      return;
    }
    if (f.size === 0) {
      setError('This file is empty. Choose a different video.');
      return;
    }
    if (f.size > maxMb * 1024 * 1024) {
      setError(`This video is ${formatSize(f.size)}. The limit is ${maxMb} MB.`);
      return;
    }
    setError('');
    onChange(f);
  }

  function openPicker() {
    if (!disabled && inputRef.current) inputRef.current.click();
  }

  function handleDrop(e) {
    e.preventDefault();
    setDrag(false);
    if (disabled) return;
    accept(e.dataTransfer.files && e.dataTransfer.files[0]);
  }

  function handleRemove(e) {
    e.stopPropagation();
    setError('');
    onChange(null);
  }

  return (
    <div>
      <div
        className={`dropzone${drag ? ' drag' : ''}${file ? ' has-file' : ''}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept={`video/*,${extensions.join(',')}`}
          hidden
          disabled={disabled}
          onChange={(e) => {
            accept(e.target.files && e.target.files[0]);
            e.target.value = ''; // lets you pick the same file again
          }}
        />
        {file ? (
          <>
            <div style={{ fontWeight: 700 }}>✅ {file.name}</div>
            <div className="muted small">{formatSize(file.size)}</div>
            <button
              type="button"
              className="btn btn-secondary btn-sm mt-1"
              onClick={handleRemove}
              disabled={disabled}
            >
              Remove video
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: '2rem' }} aria-hidden="true">
              🎥
            </div>
            <div style={{ fontWeight: 700 }}>Click to choose a video, or drag it here</div>
            <div className="muted small">
              {extensions.join(', ')} · up to {maxMb} MB
            </div>
          </>
        )}
      </div>

      {error && <div className="alert alert-error mt-1">{error}</div>}

      {previewUrl && (
        <>
          <video className="video-preview" src={previewUrl} controls muted playsInline />
          <p className="form-hint">
            The preview may not play for some formats. The analysis can still work.
          </p>
        </>
      )}
    </div>
  );
}