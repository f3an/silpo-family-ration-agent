import { Navigate, Outlet } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { selectAuth } from '../app/authSlice';

/** Layout route wrapping / and /c/:conversationId — bounces to /login until
 * we know the guest is authenticated. Waits for `isChecked` before deciding
 * (see authSlice) so a guest who's actually still logged in doesn't get
 * redirected away for the one frame before the initial status check lands. */
export default function RequireAuth() {
  const { isAuthenticated, isChecked } = useSelector(selectAuth);

  if (!isChecked) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}
