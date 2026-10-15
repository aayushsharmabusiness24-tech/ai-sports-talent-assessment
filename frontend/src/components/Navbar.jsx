import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar({ onMenuClick }) {
  const { user, logout } = useAuth();

  return (
    <header className="navbar">
      <button type="button" className="menu-button" onClick={onMenuClick} aria-label="Open menu">
        ☰
      </button>
      <Link to="/" className="navbar-brand">
        <span aria-hidden="true">🏅</span> StrideAI
      </Link>
      <div className="navbar-spacer" />
      {user && <span className="navbar-user">{user.name}</span>}
      <button type="button" className="btn btn-secondary btn-sm" onClick={logout}>
        Log out
      </button>
    </header>
  );
}