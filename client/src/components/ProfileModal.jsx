import { forwardRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import OptionGrid from './OptionGrid';
import { FamilyIcon, TruckIcon } from './Icons';
import { CUISINE_OPTIONS, EQUIPMENT_OPTIONS, COOKING_STYLE_OPTIONS } from '../constants';
import { selectSessionId } from '../app/settingsSlice';
import { selectIsAuthenticated } from '../app/authSlice';
import { selectProfileDraft, setField, toggleEquipment } from '../app/profileDraftSlice';
import { setStatus } from '../app/statusSlice';
import { useGetProfileQuery, useSavePreferencesMutation, useGetFamilyQuery } from '../app/api';
import { useModals } from '../context/ModalContext';

const ProfileModal = forwardRef(function ProfileModal({ onClose }, ref) {
  const dispatch = useDispatch();
  const sessionId = useSelector(selectSessionId);
  const isAuthenticated = useSelector(selectIsAuthenticated);
  const profile = useSelector(selectProfileDraft);
  const { data: accountInfo } = useGetProfileQuery(sessionId, { skip: !isAuthenticated });
  const { data: familyInfo } = useGetFamilyQuery(sessionId, { skip: !isAuthenticated });
  const hasFamily = Boolean(familyInfo?.familyId);
  const { openFamilyModal, openDeliveryModal } = useModals();
  const [savePreferences, { isLoading: isSaving }] = useSavePreferencesMutation();

  async function handleSave() {
    dispatch(setStatus('💾 Зберігаю профіль...'));
    try {
      await savePreferences({
        sessionId,
        cuisine: profile.cuisine,
        equipment: profile.equipment,
        cookingStyle: profile.cookingStyle,
        budgetUah: profile.budgetUah,
        notes: profile.notes,
      }).unwrap();

      dispatch(setStatus('✅ Профіль збережено'));
      onClose();
    } catch (err) {
      dispatch(setStatus(`Помилка: ${err?.data?.message ?? 'сталася помилка'}`, true));
    }
  }

  return (
    <dialog
      ref={ref}
      className="profile-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button className="modal-close" type="button" aria-label="Закрити" onClick={onClose}>
        ✕
      </button>

      <div className="step-icon">👤</div>
      <h2>Мій профіль</h2>
      <p className="step-hint">Дані з акаунту Сільпо — лише для читання, змінити можна на сайті Сільпо</p>

      <div className="review-summary profile-readonly">
        <div className="review-row">
          <span className="review-emoji">👨‍👩‍👧‍👦</span>
          <span>{accountInfo ? `${accountInfo.people} осіб у сім'ї (з акаунту Сільпо)` : '—'}</span>
        </div>
        <div className="review-row">
          <span className="review-emoji">🚫</span>
          <span>
            {accountInfo
              ? accountInfo.allergens.length
                ? `${accountInfo.allergens.join(', ')} (з акаунту Сільпо)`
                : 'без обмежень (з акаунту Сільпо)'
              : '—'}
          </span>
        </div>
        {hasFamily && (
          <button
            type="button"
            className="review-row review-row-button"
            onClick={() => {
              onClose();
              openFamilyModal();
            }}
          >
            <FamilyIcon /> Моя сім'я
          </button>
        )}
        <button
          type="button"
          className="review-row review-row-button"
          onClick={() => {
            onClose();
            openDeliveryModal();
          }}
        >
          <TruckIcon /> Доставка
        </button>
      </div>

      <h3 className="profile-subheading">Мої вподобання (зберігаються в акаунті)</h3>

      <div className="profile-field">
        <span className="stepper-label">Кухня</span>
        <OptionGrid
          id="profileCuisineGrid"
          options={CUISINE_OPTIONS}
          selected={profile.cuisine}
          single
          onSelect={(v) => dispatch(setField('cuisine', v))}
        />
      </div>

      <div className="profile-field">
        <span className="stepper-label">Кухонне обладнання</span>
        <OptionGrid
          id="profileEquipmentGrid"
          options={EQUIPMENT_OPTIONS}
          selected={profile.equipment}
          onSelect={(v) => dispatch(toggleEquipment(v))}
        />
      </div>

      <div className="profile-field">
        <span className="stepper-label">Формат готування</span>
        <OptionGrid
          id="profileStyleGrid"
          options={COOKING_STYLE_OPTIONS}
          selected={profile.cookingStyle}
          single
          styleVariant
          onSelect={(v) => dispatch(setField('cookingStyle', v))}
        />
      </div>

      <div className="profile-field">
        <span className="stepper-label">Бюджет за замовчуванням</span>
        <div className="budget-input">
          <input
            type="range"
            min="200"
            max="5000"
            step="50"
            value={profile.budgetUah}
            onChange={(e) => dispatch(setField('budgetUah', Number(e.target.value)))}
          />
          <div className="budget-value">
            <span>{profile.budgetUah}</span> грн
          </div>
        </div>
      </div>

      <div className="profile-field">
        <span className="stepper-label">Постійні побажання</span>
        <textarea
          className="notes-textarea"
          rows="2"
          placeholder="Напр.: завжди без гострого..."
          value={profile.notes}
          onChange={(e) => dispatch(setField('notes', e.target.value))}
        />
      </div>

      <button className="primary-btn" type="button" onClick={handleSave} disabled={isSaving}>
        Зберегти
      </button>
    </dialog>
  );
});

export default ProfileModal;
