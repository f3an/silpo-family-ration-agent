import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { selectStatus } from '../app/statusSlice';

const AUTO_HIDE_MS = 4000;

export default function Toast() {
  const status = useSelector(selectStatus);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!status.text) {
      setVisible(false);
      return undefined;
    }
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
    // Re-runs on every dispatch (status.id), not just on text changes, so
    // the same message twice in a row still restarts the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.id]);

  if (!status.text || !visible) return null;

  return (
    <div className={`toast${status.isError ? ' toast-error' : ''}`} role="status" aria-live="polite">
      {status.text}
    </div>
  );
}
