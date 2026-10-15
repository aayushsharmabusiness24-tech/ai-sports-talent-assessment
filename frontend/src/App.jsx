import { Component, useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes, Link, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import Register from './pages/Register';
import Home from './pages/Home';
import Assessment from './pages/Assessment';
import History from './pages/History';

function FullScreenSpinner() {
  return (
    <div className="center-screen">
      <div className="spinner" aria-label="Loading" />
    </div>
  );
}

// Shows the app layout (top bar + side menu) for logged-in users only.
function ProtectedLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu whenever the page changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  if (loading) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return (
    <div className="app-shell">
      <Navbar onMenuClick={() => setMenuOpen((open) => !open)} />
      <div className="layout">
        <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
        <main className="content">
          <div className="content-inner">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

// Login and Register pages. Logged-in users are sent to the page they came from (or Home).
function PublicOnly() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullScreenSpinner />;
  if (user) {
    const from = (location.state && location.state.from) || '/';
    return <Navigate to={from} replace />;
  }
  return <Outlet />;
}

function NotFound() {
  return (
    <div className="center-screen">
      <div className="card empty-state">
        <h2>Page not found</h2>
        <p className="muted">The page you are looking for does not exist.</p>
        <Link className="btn btn-primary" to="/">
          Go to Home
        </Link>
      </div>
    </div>
  );
}

// Shows a friendly message instead of a blank white screen if something crashes.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ui] Unexpected error:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-screen">
        <div className="card empty-state">
          <h2>Something went wrong</h2>
          <p className="muted">The page crashed unexpectedly. Reloading usually fixes it.</p>
          <button className="btn btn-primary" onClick={() => window.location.assign('/')}>
            Reload the app
          </button>
        </div>
      </div>
    );
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<PublicOnly />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Route>

        <Route element={<ProtectedLayout />}>
          <Route index element={<Home />} />
          <Route path="assessment" element={<Assessment />} />
          <Route path="history" element={<History />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </ErrorBoundary>
  );
}