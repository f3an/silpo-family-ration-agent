import { useSelector } from 'react-redux';
import { selectApiBase, selectSessionId } from '../app/settingsSlice';

export default function AuthGate() {
  const apiBase = useSelector(selectApiBase);
  const sessionId = useSelector(selectSessionId);

  function handleLogin() {
    window.location.href = `${apiBase}/auth/silpo/authorize?sessionId=${encodeURIComponent(sessionId)}`;
  }

  return (
    <section className="auth-gate">
      <div className="step-icon">🔒</div>
      <h2>Спочатку увійди в Сільпо</h2>
      <p className="step-hint">
        Агенту потрібен доступ до твого акаунту Сільпо — щоб підібрати товари під твою філію й додати їх у твій
        справжній кошик.
      </p>
      <button className="primary-btn" type="button" onClick={handleLogin}>
        Увійти в Сільпо
      </button>
    </section>
  );
}
