import { useDispatch, useSelector } from 'react-redux';
import { formatPhone, SILPO_LOYALTY_URL } from '../constants';
import { selectTheme, setTheme } from '../app/settingsSlice';
import { useModals } from '../context/ModalContext';
import { useLogout } from '../hooks/useLogout';
import { SettingsIcon, LogoutIcon, MonitorIcon, SunIcon, MoonIcon } from './Icons';

const THEME_OPTIONS = [
  { value: 'system', Icon: MonitorIcon, label: 'Системна' },
  { value: 'light', Icon: SunIcon, label: 'Світла' },
  { value: 'dark', Icon: MoonIcon, label: 'Темна' },
];

export default function ProfileMenu({ accountInfo, onDone }) {
  const dispatch = useDispatch();
  const theme = useSelector(selectTheme);
  const { openProfileModal } = useModals();
  const handleLogout = useLogout();

  const fullName = [accountInfo?.lastName, accountInfo?.firstName].filter(Boolean).join(' ');

  return (
    <div className="profile-menu">
      {accountInfo && (fullName || accountInfo.phone) && (
        <>
          <div className="profile-menu-identity">
            <span className="profile-menu-name">{fullName || 'Гість'}</span>
            {accountInfo.phone && <span className="profile-menu-phone">{formatPhone(accountInfo.phone)}</span>}
            {accountInfo.bonusBalance != null && (
              <a
                className="profile-menu-bonus"
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
          <hr className="profile-menu-divider" />
        </>
      )}

      <button
        type="button"
        className="profile-menu-item"
        onClick={() => {
          onDone();
          openProfileModal();
        }}
      >
        <SettingsIcon /> Налаштування
      </button>

      <hr className="profile-menu-divider" />

      <span className="profile-menu-label">Тема</span>
      <div className="theme-switch">
        {THEME_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`theme-switch-option${theme === opt.value ? ' selected' : ''}`}
            title={opt.label}
            aria-label={opt.label}
            onClick={() => dispatch(setTheme(opt.value))}
          >
            <opt.Icon />
          </button>
        ))}
      </div>

      <hr className="profile-menu-divider" />

      <button
        type="button"
        className="profile-menu-item danger"
        onClick={() => {
          onDone();
          handleLogout();
        }}
      >
        <LogoutIcon /> Вийти
      </button>
    </div>
  );
}
