import { forwardRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import OptionGrid from './OptionGrid';
import TimeslotField from './TimeslotField';
import {
  ALLERGEN_OPTIONS,
  CUISINE_OPTIONS,
  EQUIPMENT_OPTIONS,
  COOKING_STYLE_OPTIONS,
  COOKING_STYLE_LABELS,
  PROFILE_KEY,
} from '../constants';
import { selectSessionId } from '../app/settingsSlice';
import { selectActiveConversationId, setPendingRequestText, setIsCreatingChat } from '../app/chatUiSlice';
import { selectProfileDraft, setField, toggleAllergen, toggleEquipment } from '../app/profileDraftSlice';
import { setStatus } from '../app/statusSlice';
import { useGeneratePlanMutation, useSetDeliveryTimeslotMutation } from '../app/api';

function Stepper({ label, value, onChange, min, max }) {
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <div className="stepper-control">
        <button type="button" className="stepper-btn" onClick={() => onChange(Math.max(min, value - 1))}>
          −
        </button>
        <span className="stepper-value">{value}</span>
        <button type="button" className="stepper-btn" onClick={() => onChange(Math.min(max, value + 1))}>
          +
        </button>
      </div>
    </div>
  );
}

const PlanForm = forwardRef(function PlanForm({ onClose }, ref) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  // PlanForm is mounted once outside the routed subtree (see ModalContext),
  // so — like RootLayout — it reads scope straight off the URL rather than
  // a prop; the modal itself has no other way to know which chat "space"
  // it was opened from.
  const isFamily = useLocation().pathname.startsWith('/family');
  const sessionId = useSelector(selectSessionId);
  const conversationId = useSelector(selectActiveConversationId);
  const profile = useSelector(selectProfileDraft);
  const [generatePlan, { isLoading: isGenerating }] = useGeneratePlanMutation();
  const [setDeliveryTimeslot] = useSetDeliveryTimeslotMutation();
  // Ephemeral, per-request toggle — not part of the saved profile draft
  // (unlike people/days/cuisine/etc., which persist to localStorage).
  const [forChildren, setForChildren] = useState(false);
  // "start|end" or null (keep the cart's current slot) — see TimeslotField.
  const [timeslotValue, setTimeslotValue] = useState(null);

  async function handleSubmit() {
    if (timeslotValue) {
      const [start, end] = timeslotValue.split('|');
      try {
        await setDeliveryTimeslot({ sessionId, start, end }).unwrap();
      } catch (err) {
        dispatch(setStatus(`Не вдалося застосувати час доставки: ${err?.data?.message ?? 'сталася помилка'}`, true));
        return;
      }
    }

    const payload = {
      sessionId,
      conversationId: conversationId ?? undefined,
      people: profile.people,
      days: profile.days,
      budgetUah: profile.budgetUah,
      allergens: [
        ...profile.allergens,
        ...profile.allergensOther.split(',').map((s) => s.trim()).filter(Boolean),
      ],
      cuisine: profile.cuisine,
      equipment: profile.equipment,
      cookingStyle: profile.cookingStyle,
      notes: profile.notes,
      forChildren,
      familyChat: isFamily,
    };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));

    // Generating a full multi-day plan can take a while (many MCP tool
    // round-trips) — close the modal and hand the wait off to the chat
    // thread itself (ChatPanel renders this as a pending bubble) instead of
    // leaving the guest staring at a disabled button with no feedback.
    // Every selected field, not just cuisine — the guest picked equipment
    // and a cooking format too (they're in `payload` and reach the agent
    // either way), and omitting them from the bubble they actually see made
    // it look like those choices were silently dropped.
    const summary = [
      `Скласти раціон: ${profile.people} ос., ${profile.days} дн., бюджет ${profile.budgetUah} грн`,
      profile.cuisine && `кухня: ${profile.cuisine}`,
      profile.equipment.length && `обладнання: ${profile.equipment.join(', ')}`,
      COOKING_STYLE_LABELS[profile.cookingStyle],
      forChildren && 'дитяче меню',
    ]
      .filter(Boolean)
      .join(', ');
    const isNewChat = !conversationId;
    dispatch(setPendingRequestText(summary));
    if (isNewChat) dispatch(setIsCreatingChat(true));
    onClose();

    try {
      const data = await generatePlan(payload).unwrap();
      if (conversationId !== data.conversationId) {
        navigate(`${isFamily ? '/family/c/' : '/c/'}${data.conversationId}`);
      }
    } catch (err) {
      dispatch(setStatus(`Помилка: ${err?.data?.message ?? 'сталася помилка'}`, true));
    } finally {
      dispatch(setPendingRequestText(null));
      if (isNewChat) dispatch(setIsCreatingChat(false));
      setForChildren(false);
      setTimeslotValue(null);
    }
  }

  return (
    <dialog
      ref={ref}
      className="plan-form-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button className="modal-close" type="button" aria-label="Закрити" onClick={onClose}>
        ✕
      </button>
      <div className="step-icon">🍽️</div>
      <h2>Скласти раціон</h2>
      <p className="step-hint">Заповни, що важливо — решту агент дотягне сам</p>

      <TimeslotField sessionId={sessionId} value={timeslotValue} onChange={setTimeslotValue} />

      <div className="profile-field">
        <div className="stepper-row">
          <Stepper
            label="Людей"
            value={profile.people}
            min={1}
            max={20}
            onChange={(v) => dispatch(setField('people', v))}
          />
          <Stepper
            label="📅 Днів"
            value={profile.days}
            min={1}
            max={14}
            onChange={(v) => dispatch(setField('days', v))}
          />
        </div>
      </div>

      <div className="profile-field">
        <span className="stepper-label">Алергени чи обмеження</span>
        <OptionGrid
          id="planAllergensGrid"
          options={ALLERGEN_OPTIONS}
          selected={profile.allergens}
          onSelect={(v) => dispatch(toggleAllergen(v))}
        />
        <input
          className="text-field"
          placeholder="Інше (через кому)"
          value={profile.allergensOther}
          onChange={(e) => dispatch(setField('allergensOther', e.target.value))}
        />
      </div>

      <div className="profile-field">
        <span className="stepper-label">Кухня</span>
        <OptionGrid
          id="planCuisineGrid"
          options={CUISINE_OPTIONS}
          selected={profile.cuisine}
          single
          onSelect={(v) => dispatch(setField('cuisine', v))}
        />
      </div>

      <div className="profile-field">
        <span className="stepper-label">Кухонне обладнання</span>
        <OptionGrid
          id="planEquipmentGrid"
          options={EQUIPMENT_OPTIONS}
          selected={profile.equipment}
          onSelect={(v) => dispatch(toggleEquipment(v))}
        />
      </div>

      <div className="profile-field">
        <span className="stepper-label">Формат готування</span>
        <OptionGrid
          id="planStyleGrid"
          options={COOKING_STYLE_OPTIONS}
          selected={profile.cookingStyle}
          single
          styleVariant
          onSelect={(v) => dispatch(setField('cookingStyle', v))}
        />
      </div>

      <div className="profile-field">
        <label className="checkbox-field">
          <input type="checkbox" checked={forChildren} onChange={(e) => setForChildren(e.target.checked)} />
          👶 Дитяче меню
        </label>
      </div>

      <div className="profile-field">
        <span className="stepper-label">Бюджет на весь раціон</span>
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
        <span className="stepper-label">Додаткові побажання</span>
        <textarea
          className="notes-textarea"
          rows="2"
          placeholder="Напр.: більше овочів, без гострого..."
          value={profile.notes}
          onChange={(e) => dispatch(setField('notes', e.target.value))}
        />
      </div>

      <button className="primary-btn" type="button" onClick={handleSubmit} disabled={isGenerating}>
        {isGenerating ? 'Складаю раціон...' : 'Скласти раціон 🍽️'}
      </button>
    </dialog>
  );
});

export default PlanForm;
