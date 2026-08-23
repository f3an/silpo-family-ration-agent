import { Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import AuthGate from '../components/AuthGate';
import { selectAuth } from '../app/authSlice';

export default function LoginPage() {
  const { isAuthenticated, isChecked } = useSelector(selectAuth);

  if (isChecked && isAuthenticated) return <Navigate to="/" replace />;

  return (
    <main id="app">
      <AuthGate />
    </main>
  );
}
