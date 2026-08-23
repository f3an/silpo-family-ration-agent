import { forwardRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import TimeslotField from './TimeslotField';
import { selectSessionId } from '../app/settingsSlice';
import { selectActiveConversationId, setPendingRequestText, setIsCreatingChat } from '../app/chatUiSlice';
import { setStatus } from '../app/statusSlice';
import { useSendMessageMutation, useSendFamilyMessageMutation, useSetDeliveryTimeslotMutation } from '../app/api';

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

const OccasionForm = forwardRef(function OccasionForm({ onClose }, ref) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const isFamily = useLocation().pathname.startsWith('/family');
  const sessionId = useSelector(selectSessionId);
  const conversationId = useSelector(selectActiveConversationId);
  const [sendPersonalMessage, { isLoading: isSendingPersonal }] = useSendMessageMutation();
  const [sendFamilyMessage, { isLoading: isSendingFamily }] = useSendFamilyMessageMutation();
  const sendMessage = isFamily ? sendFamilyMessage : sendPersonalMessage;
  const isSending = isFamily ? isSendingFamily : isSendingPersonal;
  const [setDeliveryTimeslot] = useSetDeliveryTimeslotMutation();

  const [description, setDescription] = useState('');
  const [guestCount, setGuestCount] = useState(6);
  const [budgetUah, setBudgetUah] = useState(3000);
  const [includeAlcohol, setIncludeAlcohol] = useState(false);
  const [includeCake, setIncludeCake] = useState(false);
  // "start|end" or null (keep the cart's current slot) — see TimeslotField.
  const [timeslotValue, setTimeslotValue] = useState(null);

  async function handleSubmit() {
    const occasion = description.trim();
    if (!occasion || isSending) return;

    if (timeslotValue) {
      const [start, end] = timeslotValue.split('|');
      try {
        await setDeliveryTimeslot({ sessionId, start, end }).unwrap();
      } catch (err) {
        dispatch(setStatus(`Не вдалося застосувати час доставки: ${err?.data?.message ?? 'сталася помилка'}`, true));
        return;
      }
    }

    // Answers the basic clarifying questions the agent otherwise has to ask
    // turn-by-turn in chat (бюджет/алкоголь/торт) up front, so the wizard
    // path skips straight to the actual набір.
    const message = [
      `Набір товарів на подію: ${occasion}, ${guestCount} гостей, бюджет ${budgetUah} грн`,
      includeAlcohol ? 'включити алкоголь' : 'без алкоголю',
      includeCake ? 'потрібен торт/десерт' : 'без торта',
    ].join(', ');

    // Same reasoning as PlanForm/DishForm: this can take a while (product
    // search + possibly a clarifying round-trip), so hand the wait off to
    // the chat thread itself instead of blocking the modal.
    const isNewChat = !conversationId;
    dispatch(setPendingRequestText(message));
    if (isNewChat) dispatch(setIsCreatingChat(true));
    onClose();
    setDescription('');
    setGuestCount(6);
    setBudgetUah(3000);
    setIncludeAlcohol(false);
    setIncludeCake(false);
    setTimeslotValue(null);

    try {
      const data = await sendMessage({
        sessionId,
        message,
        conversationId: conversationId ?? undefined,
      }).unwrap();
      if (conversationId !== data.conversationId) {
        navigate(`${isFamily ? '/family/c/' : '/c/'}${data.conversationId}`);
      }
    } catch (err) {
      dispatch(setStatus(`Помилка: ${err?.data?.message ?? 'сталася помилка'}`, true));
    } finally {
      dispatch(setPendingRequestText(null));
      if (isNewChat) dispatch(setIsCreatingChat(false));
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
      <div className="step-icon">🎉</div>
      <h2>Набір під подію</h2>
      <p className="step-hint">Опиши подію й кількість гостей — агент підбере курований набір товарів</p>

      <TimeslotField sessionId={sessionId} value={timeslotValue} onChange={setTimeslotValue} />

      <div className="profile-field">
        <input
          className="text-field"
          placeholder="Напр.: день народження, гриль на вихідні"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="profile-field">
        <Stepper label="Гостей" value={guestCount} min={1} max={50} onChange={setGuestCount} />
      </div>

      <div className="profile-field">
        <span className="stepper-label">Бюджет на набір</span>
        <div className="budget-input">
          <input
            type="range"
            min="500"
            max="20000"
            step="250"
            value={budgetUah}
            onChange={(e) => setBudgetUah(Number(e.target.value))}
          />
          <div className="budget-value">
            <span>{budgetUah}</span> грн
          </div>
        </div>
      </div>

      <div className="profile-field">
        <label className="checkbox-field">
          <input type="checkbox" checked={includeAlcohol} onChange={(e) => setIncludeAlcohol(e.target.checked)} />
          🍾 Включити алкоголь
        </label>
        <label className="checkbox-field">
          <input type="checkbox" checked={includeCake} onChange={(e) => setIncludeCake(e.target.checked)} />
          🎂 Потрібен торт/десерт
        </label>
      </div>

      <button className="primary-btn" type="button" onClick={handleSubmit} disabled={!description.trim() || isSending}>
        {isSending ? 'Надсилаю...' : 'Зібрати набір 🎉'}
      </button>
    </dialog>
  );
});

export default OccasionForm;
