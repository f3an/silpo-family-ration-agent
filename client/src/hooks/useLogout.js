import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { api, useLogoutMutation } from '../app/api';
import { selectSessionId, setSessionId } from '../app/settingsSlice';
import { setAuthenticated } from '../app/authSlice';
import { setStatus } from '../app/statusSlice';
import { resetProfileDraft } from '../app/profileDraftSlice';
import { useModals } from '../context/ModalContext';
import { PROFILE_KEY } from '../constants';

/** Bundles everything "log out" touches — server-side session teardown,
 * a fresh sessionId for the next login, clearing every cache/draft, and
 * closing whatever modal happens to be open — behind one call, so
 * ProfileMenu doesn't have to orchestrate it itself. */
export function useLogout() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const sessionId = useSelector(selectSessionId);
  const [logout] = useLogoutMutation();
  const { closePlanForm, closeProfileModal } = useModals();

  return async function handleLogout() {
    try {
      await logout(sessionId).unwrap();
    } catch {
      // best-effort — the guest is logged out locally either way
    }

    closePlanForm();
    closeProfileModal();

    localStorage.removeItem(PROFILE_KEY);
    dispatch(setSessionId(crypto.randomUUID()));
    dispatch(resetProfileDraft());
    dispatch(api.util.resetApiState());
    dispatch(setAuthenticated(false));
    dispatch(setStatus('Вийшов з акаунту Сільпо.'));
    navigate('/');
  };
}
