import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './hooks/useAuth';

// Pages
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ConfigPage from './pages/ConfigPage';
import WatchItemsPage from './pages/WatchItemsPage';
import MoviesPage from './pages/MoviesPage';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

// Protected Route component
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-bg-primary">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-blue"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

// App component
const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router>
          <div className="App">
            <Toaster 
              position="top-right"
              toastOptions={{
                duration: 4000,
                style: {
                  background: '#1E293B',
                  color: '#F8FAFC',
                  border: '1px solid #475569',
                },
                success: {
                  duration: 3000,
                  iconTheme: {
                    primary: '#00E676',
                    secondary: '#F8FAFC',
                  },
                },
                error: {
                  duration: 5000,
                  iconTheme: {
                    primary: '#FF6B35',
                    secondary: '#F8FAFC',
                  },
                },
              }}
            />
            
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              
              <Route 
                path="/" 
                element={
                  <ProtectedRoute>
                    <DashboardPage />
                  </ProtectedRoute>
                } 
              />
              
              <Route 
                path="/config" 
                element={
                  <ProtectedRoute>
                    <ConfigPage />
                  </ProtectedRoute>
                } 
              />
              
              <Route 
                path="/watch-items" 
                element={
                  <ProtectedRoute>
                    <WatchItemsPage />
                  </ProtectedRoute>
                } 
              />
              
              <Route 
                path="/movies/:itemId" 
                element={
                  <ProtectedRoute>
                    <MoviesPage />
                  </ProtectedRoute>
                } 
              />
              
              {/* Redirect any unknown routes to dashboard */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </Router>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;