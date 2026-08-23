import { useEffect, useRef } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import ChatSidenav from '../components/ChatSidenav';
import ChatPanel from '../components/ChatPanel';
import { selectSessionId } from '../app/settingsSlice';
import { setActiveConversationId } from '../app/chatUiSlice';
import { hydrateFromAccount } from '../app/profileDraftSlice';
import { useGetProfileQuery } from '../app/api';

/** Only ever rendered once RequireAuth has confirmed the guest is logged
 * in — see routes/RequireAuth.jsx — so there's no auth branching here. */
export default function RootLayout() {
  const dispatch = useDispatch();
  const { conversationId } = useParams();
  // `/family` and `/family/c/:conversationId` share this same element (see
  // App.jsx) — scope comes from the URL prefix rather than a second route
  // tree, so ChatSidenav/ChatPanel can stay one component each instead of
  // forking into personal/family variants.
  const scope = useLocation().pathname.startsWith('/family') ? 'family' : 'personal';
  const sessionId = useSelector(selectSessionId);
  const { data: accountInfo } = useGetProfileQuery(sessionId);
  // getProfile refetches later too (e.g. savePreferences invalidates its
  // tag) — without this guard, hydrateFromAccount would fire again on every
  // such refetch and silently clobber whatever the guest had already picked
  // in a still-open PlanForm/ProfileModal with their last-*saved* values.
  const hasHydrated = useRef(false);

  // PlanForm lives outside the routed subtree (see ModalContext), so the
  // active conversation is mirrored into the store here, where useParams()
  // actually reflects the current route.
  useEffect(() => {
    dispatch(setActiveConversationId(conversationId ?? null));
  }, [conversationId, dispatch]);

  useEffect(() => {
    if (accountInfo && !hasHydrated.current) {
      hasHydrated.current = true;
      dispatch(hydrateFromAccount(accountInfo));
    }
  }, [accountInfo, dispatch]);

  return (
    <main id="app" className="app-chat">
      <div className="chat-layout">
        <ChatSidenav scope={scope} />
        <ChatPanel scope={scope} />
      </div>
    </main>
  );
}
