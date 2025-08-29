import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { 
  CogIcon, 
  FilmIcon, 
  PlayIcon,
  ArrowRightOnRectangleIcon 
} from '@heroicons/react/24/outline';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navigation = [
    { name: 'Dashboard', href: '/', icon: PlayIcon },
    { name: 'Watch Items', href: '/watch-items', icon: FilmIcon },
    { name: 'Configuration', href: '/config', icon: CogIcon },
  ];

  return (
    <div className="min-h-screen bg-dark-bg-primary">
      <nav className="bg-dark-bg-secondary shadow-lg border-b border-dark-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <div className="flex items-center space-x-3">
                  <img src="/assets/logo.svg" alt="Letterboxarr" className="h-8 w-8" />
                  <h1 className="text-xl font-bold text-dark-text-primary">Letterboxarr</h1>
                </div>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                {navigation.map((item) => {
                  const isCurrent = location.pathname === item.href;
                  return (
                    <Link
                      key={item.name}
                      to={item.href}
                      className={`${
                        isCurrent
                          ? 'border-brand-blue text-dark-text-primary'
                          : 'border-transparent text-dark-text-muted hover:border-dark-border hover:text-dark-text-secondary'
                      } inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors`}
                    >
                      <item.icon className="h-4 w-4 mr-2" />
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center">
              <button
                onClick={handleLogout}
                className="btn-secondary inline-flex items-center text-sm font-medium"
              >
                <ArrowRightOnRectangleIcon className="h-4 w-4 mr-1" />
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
};

export default Layout;