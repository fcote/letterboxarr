import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  CalendarIcon,
  CogIcon,
  FilmIcon,
  Squares2X2Icon,
  ArrowRightOnRectangleIcon
} from '@heroicons/react/24/outline';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navigation = [
    { name: 'Overview', href: '/', icon: Squares2X2Icon },
    { name: 'Watch lists', href: '/watch-items', icon: FilmIcon },
    { name: 'Upcoming', href: '/upcoming', icon: CalendarIcon },
    { name: 'Settings', href: '/config', icon: CogIcon },
  ];

  return (
    <div className="min-h-screen bg-dark-bg-primary lg:pl-56">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand-blue focus:p-3 focus:text-dark-bg-primary">
        Skip to content
      </a>
      <aside className="border-b border-dark-border/50 bg-dark-bg-secondary lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-56 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3 px-5 pt-5 lg:px-6 lg:pt-8">
          <Link to="/" className="flex items-center gap-2 text-lg font-bold tracking-tight" aria-label="Letterboxarr overview">
            <img src="/assets/logo.svg" alt="" className="h-8 w-8" />
            Letterboxarr
          </Link>
          <button onClick={handleLogout} className="rounded-md p-2 text-dark-text-muted hover:text-dark-text-primary lg:hidden" aria-label="Log out">
            <ArrowRightOnRectangleIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Main navigation" className="grid grid-cols-4 gap-1 px-3 py-4 lg:mt-9 lg:grid-cols-1 lg:gap-2 lg:px-4 lg:py-0">
          {navigation.map(item => {
            const isCurrent = location.pathname === item.href
              || (item.href === '/watch-items' && location.pathname.startsWith('/movies/'));
            return (
              <Link
                key={item.href}
                to={item.href}
                aria-current={isCurrent ? 'page' : undefined}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-md px-2 py-2.5 text-xs font-medium transition-colors sm:text-sm lg:justify-start lg:px-3 ${
                  isCurrent
                    ? 'bg-dark-bg-primary text-brand-blue'
                    : 'text-dark-text-muted hover:bg-dark-bg-primary/50 hover:text-dark-text-primary'
                }`}
              >
                <item.icon className="hidden h-4 w-4 flex-shrink-0 sm:block" aria-hidden="true" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto hidden px-6 pb-7 pt-8 lg:block">
          <p className="text-xs text-dark-text-muted">Your personal film collection</p>
          <p className="mt-2 truncate text-sm text-dark-text-secondary" title={user?.username}>{user?.username}</p>
          <button onClick={handleLogout} className="mt-4 inline-flex items-center gap-2 rounded-md py-2 text-xs text-dark-text-muted hover:text-dark-text-primary">
            <ArrowRightOnRectangleIcon className="h-4 w-4" aria-hidden="true" />
            Log out
          </button>
        </div>
      </aside>

      <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-2 sm:px-6 lg:px-10 lg:py-4">
        {children}
      </main>
    </div>
  );
};

export default Layout;
