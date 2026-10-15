// All communication with the backend goes through this file.
// Every function either returns data or throws an ApiError with a readable message.

const BASE = '/api';
const TOKEN_KEY = 'ast_token';

export const AUTH_EXPIRED_EVENT = 'auth:expired';

export const tokenStore = {
  get() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch (err) {
      return null;
    }
  },
  set(token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch (err) {
      /* ignore */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch (err) {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  constructor(status, code, message, assessmentId = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status; // 0 = the server could not be reached
    this.code = code;
    this.assessmentId = assessmentId;
  }
}

function networkError() {
  return new ApiError(
    0,
    'NETWORK_ERROR',
    'Cannot reach the server. Make sure the app is running (scripts\\start.bat) and try again.'
  );
}

// Turns an HTTP response into data, or throws an ApiError.
function interpret(status, text) {
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      data = null;
    }
  }

  if (status >= 200 && status < 300) return data;

  const code = data && data.error && data.error.code;
  if (status === 401 && (code === 'AUTH_INVALID' || code === 'AUTH_REQUIRED')) {
    tokenStore.clear();
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }

  if (data && data.error) {
    throw new ApiError(status, data.error.code, data.error.message, data.assessmentId || null);
  }
  throw new ApiError(
    status,
    'BAD_RESPONSE',
    `The server did not respond correctly (status ${status}). Make sure the backend is running.`
  );
}

async function request(path, { method = 'GET', json, signal } = {}) {
  const headers = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }

  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body, signal });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw networkError();
  }
  const text = await res.text();
  return interpret(res.status, text);
}

// ------------------------------------------------------------------ auth
export async function register({ name, email, password }) {
  return request('/auth/register', { method: 'POST', json: { name, email, password } });
}

export async function login({ email, password }) {
  return request('/auth/login', { method: 'POST', json: { email, password } });
}

export async function fetchMe() {
  const data = await request('/auth/me');
  return data.user;
}

// ------------------------------------------------------------------ health
export async function getHealth() {
  return request('/health');
}

// ------------------------------------------------------------------ assessments
export async function listAssessments({ limit = 100, offset = 0 } = {}) {
  return request(`/assessments?limit=${limit}&offset=${offset}`); // { total, assessments }
}

export async function getAssessment(id) {
  const data = await request(`/assessments/${id}`);
  return data.assessment;
}

export async function getAssessmentStatus(id) {
  return request(`/assessments/${id}/status`);
}

// Uploads a video and waits for the analysis. Uses XMLHttpRequest because fetch cannot report
// upload progress.
//   onProgress(percent)  - called while the file is being sent (0-100)
//   onUploaded()         - called once the whole file has been sent (analysis starts after this)
//   signal               - optional AbortSignal to cancel
// Resolves with the saved assessment object.
export function createAssessment({ file, activity, cameraView = 'auto', onProgress, onUploaded, signal }) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('activity', activity);
    form.append('cameraView', cameraView);
    form.append('video', file); // the file goes last

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/assessments`);
    const token = tokenStore.get();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.timeout = 0; // the backend enforces its own analysis time limit

    let uploadFinished = false;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.upload.onload = () => {
      uploadFinished = true;
      if (onProgress) onProgress(100);
      if (onUploaded) onUploaded();
    };

    xhr.onload = () => {
      try {
        const data = interpret(xhr.status, xhr.responseText);
        resolve(data.assessment);
      } catch (err) {
        reject(err);
      }
    };

    xhr.onerror = () => {
      if (!uploadFinished && onProgress) {
        reject(
          new ApiError(
            0,
            'UPLOAD_INTERRUPTED',
            'The upload was interrupted. The video may be too large, or the server is not running.'
          )
        );
      } else {
        reject(networkError());
      }
    };

    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Upload cancelled', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(form);
  });
}