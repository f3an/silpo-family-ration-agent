import { forwardRef } from 'react';
import { useSelector } from 'react-redux';
import { ExternalLinkIcon } from './Icons';
import { formatPhone, SILPO_FAMILY_URL } from '../constants';
import { selectSessionId } from '../app/settingsSlice';
import { useGetFamilyQuery } from '../app/api';
import { useModals } from '../context/ModalContext';

function memberInitials(name) {
  const initials = (name ?? '')
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return initials || '👤';
}

const FamilyModal = forwardRef(function FamilyModal({ onClose }, ref) {
  const sessionId = useSelector(selectSessionId);
  const { data: familyInfo } = useGetFamilyQuery(sessionId);
  const members = familyInfo?.members ?? [];
  const { openProfileModal } = useModals();

  function handleBack() {
    onClose();
    openProfileModal();
  }

  return (
    <dialog
      ref={ref}
      className="profile-modal family-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button className="modal-close" type="button" aria-label="Закрити" onClick={onClose}>
        ✕
      </button>

      <div className="step-icon">👪</div>
      <h2>Моя сім'я</h2>
      <p className="step-hint">
        Учасники з акаунту Сільпо бачать і ведуть спільні сімейні чати та раціони
      </p>

      <div className="family-member-list">
        {members.map((m) => (
          <div className="family-member-row" key={m.accountId}>
            <span className="family-member-avatar">{memberInitials(m.name)}</span>
            <div className="family-member-info">
              <span className="family-member-name">{m.name || 'Гість'}</span>
              {m.phone && <span className="family-member-phone">{formatPhone(m.phone)}</span>}
            </div>
            {m.itsMe && <span className="family-member-you-badge">Я</span>}
          </div>
        ))}
        {members.length === 0 && <p className="chat-history-empty">Сімейний доступ не підключено</p>}
      </div>

      <a
        className="family-modal-cta"
        href={SILPO_FAMILY_URL}
        target="_blank"
        rel="noopener"
      >
        Керувати сім'єю в акаунті Сільпо
        <ExternalLinkIcon />
      </a>

      <button type="button" className="ghost-btn option-keep-original" onClick={handleBack}>
        ◀ Назад
      </button>
    </dialog>
  );
});

export default FamilyModal;
