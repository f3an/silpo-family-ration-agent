import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import ProfileMenu from './ProfileMenu';
import { PanelIcon, SearchIcon, FamilyIcon } from './Icons';
import { getInitials, formatPhone, SILPO_LOYALTY_URL } from '../constants';
import { selectSessionId } from '../app/settingsSlice';
import { selectActiveConversationId, selectIsSidenavCollapsed, selectIsCreatingChat, toggleSidenav } from '../app/chatUiSlice';
import {
  useListChatsQuery,
  useDeleteChatMutation,
  useGetProfileQuery,
  useGetFamilyQuery,
  useListFamilyChatsQuery,
  useDeleteFamilyChatMutation,
} from '../app/api';

/** Toggles the whole sidenav between personal and family scope — see
 * RootLayout.jsx: `scope` is derived from whether the route starts with
 * `/family`, so switching is just a navigation. Only rendered when the
 * guest actually has a family (see `hasFamily` below) — nothing to switch
 * to otherwise. */
function FamilyScopeToggle({ scope, onToggle }) {
  const isFamily = scope === 'family';
  return (
    <button
      type="button"
      className={`sidenav-icon-btn${isFamily ? ' active' : ''}`}
      aria-label={isFamily ? 'Перейти до особистих чатів' : 'Перейти до сімейних чатів'}
      aria-pressed={isFamily}
      onClick={onToggle}
    >
      <FamilyIcon />
    </button>
  );
}

export default function ChatSidenav({ scope = 'personal' }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const sessionId = useSelector(selectSessionId);
  const activeId = useSelector(selectActiveConversationId);
  const isCollapsed = useSelector(selectIsSidenavCollapsed);
  const isCreatingChat = useSelector(selectIsCreatingChat);
  const { data: conversations = [] } = useListChatsQuery(sessionId);
  const { data: accountInfo } = useGetProfileQuery(sessionId);
  const [deleteChat] = useDeleteChatMutation();
  // familyId: null (or query not yet resolved) — no real Silpo family, or
  // this account hasn't logged in with anyone who is one — hides the whole
  // family-chats section rather than showing an empty one.
  const { data: familyInfo } = useGetFamilyQuery(sessionId);
  const hasFamily = Boolean(familyInfo?.familyId);
  const { data: familyConversations = [] } = useListFamilyChatsQuery(sessionId, { skip: !hasFamily });
  const [deleteFamilyChat] = useDeleteFamilyChatMutation();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const wrapperRef = useRef(null);
  const searchDialogRef = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    if (!isMenuOpen) return undefined;

    function handlePointerDown(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setIsMenuOpen(false);
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') setIsMenuOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  async function handleDelete(id) {
    await deleteChat({ sessionId, id });
    if (id === activeId) navigate('/');
  }

  async function handleDeleteFamily(id) {
    await deleteFamilyChat({ sessionId, id });
    if (id === activeId) navigate('/family');
  }

  function openSearch() {
    searchDialogRef.current?.showModal();
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function closeSearch() {
    searchDialogRef.current?.close();
  }

  function handleSearchNavigate(id) {
    navigate(`/c/${id}`);
    closeSearch();
  }

  const fullName = [accountInfo?.lastName, accountInfo?.firstName].filter(Boolean).join(' ');
  const filteredConversations = searchQuery.trim()
    ? conversations.filter((c) => c.title.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : conversations;

  const searchModal = (
    <dialog
      ref={searchDialogRef}
      className="search-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeSearch();
      }}
      onClose={() => setSearchQuery('')}
    >
      <input
        ref={searchInputRef}
        type="text"
        className="search-modal-input"
        placeholder="Пошук у розмовах..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      <div className="search-modal-list">
        {filteredConversations.length === 0 && (
          <p className="chat-history-empty">{searchQuery.trim() ? 'Нічого не знайдено' : 'Історія порожня'}</p>
        )}
        {filteredConversations.map((c) => (
          <button
            key={c.id}
            type="button"
            className="search-modal-item"
            onClick={() => handleSearchNavigate(c.id)}
          >
            {c.title}
          </button>
        ))}
      </div>
    </dialog>
  );

  if (isCollapsed) {
    return (
      <>
        <aside className="chat-sidenav collapsed">
          <button
            type="button"
            className="sidenav-icon-btn"
            aria-label="Розгорнути бічну панель"
            onClick={() => dispatch(toggleSidenav())}
          >
            <PanelIcon />
          </button>
          <button
            type="button"
            className="primary-btn sidenav-icon-btn-new"
            aria-label={scope === 'family' ? 'Нова сімейна розмова' : 'Нова розмова'}
            onClick={() => navigate(scope === 'family' ? '/family' : '/')}
          >
            +
          </button>
          <button type="button" className="sidenav-icon-btn" aria-label="Пошук у розмовах" onClick={openSearch}>
            <SearchIcon />
          </button>
          {hasFamily && (
            <FamilyScopeToggle
              scope={scope}
              onToggle={() => navigate(scope === 'family' ? '/' : '/family')}
            />
          )}

          <div className="sidenav-collapsed-spacer" />

          <div className="profile-menu-wrapper sidenav-collapsed-profile" ref={wrapperRef}>
            {isMenuOpen && <ProfileMenu accountInfo={accountInfo} onDone={() => setIsMenuOpen(false)} />}
            <button
              type="button"
              className={`profile-badge${isMenuOpen ? ' open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              aria-label="Профіль"
              onClick={() => setIsMenuOpen((v) => !v)}
            >
              {getInitials(accountInfo)}
            </button>
          </div>
        </aside>
        {searchModal}
      </>
    );
  }

  return (
    <>
      <aside className="chat-sidenav">
        <div className="sidenav-header">
          <span className="sidenav-header-title">Silpo AI-Agent</span>
          <div className="sidenav-header-actions">
            {hasFamily && (
              <FamilyScopeToggle
                scope={scope}
                onToggle={() => navigate(scope === 'family' ? '/' : '/family')}
              />
            )}
            <button type="button" className="sidenav-icon-btn" aria-label="Пошук у розмовах" onClick={openSearch}>
              <SearchIcon />
            </button>
            <button
              type="button"
              className="sidenav-icon-btn"
              aria-label="Згорнути бічну панель"
              onClick={() => dispatch(toggleSidenav())}
            >
              <PanelIcon />
            </button>
          </div>
        </div>

        <div className="sidenav-scroll">
        {scope === 'family' ? (
          <>
            <button className="primary-btn chat-new-btn" type="button" onClick={() => navigate('/family')}>
              + Новий чат
            </button>
            <div className="chat-history-list">
              {isCreatingChat && (
                <div className="chat-history-item chat-history-item-pending">
                  <span className="chat-history-title">Нова розмова...</span>
                </div>
              )}
              {familyConversations.length === 0 && !isCreatingChat && (
                <p className="chat-history-empty">Історія порожня</p>
              )}
              {familyConversations.map((c) => (
                <div key={c.id} className={`chat-history-item${c.id === activeId ? ' active' : ''}`}>
                  <button type="button" className="chat-history-title" onClick={() => navigate(`/family/c/${c.id}`)}>
                    {c.title}
                  </button>
                  <button
                    type="button"
                    className="chat-history-delete"
                    aria-label="Видалити розмову"
                    onClick={() => handleDeleteFamily(c.id)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <button className="primary-btn chat-new-btn" type="button" onClick={() => navigate('/')}>
              + Новий чат
            </button>
            <div className="chat-history-list">
              {isCreatingChat && (
                <div className="chat-history-item chat-history-item-pending">
                  <span className="chat-history-title">Нова розмова...</span>
                </div>
              )}
              {conversations.length === 0 && !isCreatingChat && (
                <p className="chat-history-empty">Історія порожня</p>
              )}
              {conversations.map((c) => (
                <div key={c.id} className={`chat-history-item${c.id === activeId ? ' active' : ''}`}>
                  <button type="button" className="chat-history-title" onClick={() => navigate(`/c/${c.id}`)}>
                    {c.title}
                  </button>
                  <button
                    type="button"
                    className="chat-history-delete"
                    aria-label="Видалити розмову"
                    onClick={() => handleDelete(c.id)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        </div>

        <div className="sidenav-footer">
          <div className="sidenav-account-row">
            <div className="profile-menu-wrapper" ref={wrapperRef}>
              {isMenuOpen && <ProfileMenu accountInfo={accountInfo} onDone={() => setIsMenuOpen(false)} />}
              <button
                type="button"
                className={`profile-badge${isMenuOpen ? ' open' : ''}`}
                aria-haspopup="menu"
                aria-expanded={isMenuOpen}
                aria-label="Профіль"
                onClick={() => setIsMenuOpen((v) => !v)}
              >
                {getInitials(accountInfo)}
              </button>
            </div>
            <div className="sidenav-account-info">
              <span className="sidenav-account-name">{fullName || 'Гість'}</span>
              {accountInfo?.phone && <span className="sidenav-account-phone">{formatPhone(accountInfo.phone)}</span>}
            </div>
            {accountInfo?.bonusBalance != null && (
              <a
                className="sidenav-account-bonus"
                href={SILPO_LOYALTY_URL}
                target="_blank"
                rel="noopener"
                title="Бонусний рахунок Сільпо"
              >
                {accountInfo.bonusBalance.toFixed(2)}
                <span className="bonus-icon" aria-hidden="true">
                  ₴
                </span>
              </a>
            )}
          </div>
        </div>
      </aside>
      {searchModal}
    </>
  );
}
