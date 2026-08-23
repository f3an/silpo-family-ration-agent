import { useEffect } from 'react';
import { Routes, Route, useSearchParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import RootLayout from './routes/RootLayout';
import RequireAuth from './routes/RequireAuth';
import LoginPage from './routes/LoginPage';
import Toast from './components/Toast';
import { selectSessionId, selectTheme } from './app/settingsSlice';
import { setAuthenticated } from './app/authSlice';
import { setStatus } from './app/statusSlice';
import { useAuthStatusQuery } from './app/api';

export default function App() {
  const dispatch = useDispatch();
  const sessionId = useSelector(selectSessionId);
  const theme = useSelector(selectTheme);
  const [searchParams, setSearchParams] = useSearchParams();
  const authParam = searchParams.get('silpoAuth');

  // The backend redirects back here with ?silpoAuth=success|already|error
  // after the guest finishes (or fails) logging in on Silpo's own site.
  const { data: statusData } = useAuthStatusQuery(sessionId, { skip: Boolean(authParam) });

  useEffect(() => {
    if (authParam === 'success' || authParam === 'already') {
      dispatch(setAuthenticated(true));
      dispatch(setStatus(authParam === 'success' ? '✅ Успішно увійшов у Сільпо!' : ''));
    } else if (authParam === 'error') {
      dispatch(setAuthenticated(false));
      dispatch(setStatus('Не вдалось увійти в Сільпо — спробуй ще раз.', true));
    }
    if (authParam) {
      setSearchParams({}, { replace: true });
    }
    // Runs once per authParam value, mirroring the original page-load bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authParam]);

  useEffect(() => {
    if (statusData) dispatch(setAuthenticated(Boolean(statusData.authenticated)));
  }, [statusData, dispatch]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <>
      <Toast />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<RootLayout />} />
          <Route path="/c/:conversationId" element={<RootLayout />} />
          <Route path="/family" element={<RootLayout />} />
          <Route path="/family/c/:conversationId" element={<RootLayout />} />
        </Route>
      </Routes>
    </>
  );
}
