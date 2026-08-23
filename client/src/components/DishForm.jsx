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

const DishForm = forwardRef(function DishForm({ onClose }, ref) {
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

  const [name, setName] = useState('');
  const [portions, setPortions] = useState(2);
  const [notes, setNotes] = useState('');
  // "start|end" or null (keep the cart's current slot) — see TimeslotField.
  const [timeslotValue, setTimeslotValue] = useState(null);

  async function handleSubmit() {
    const dishName = name.trim();
    if (!dishName || isSending) return;

    if (timeslotValue) {
      const [start, end] = timeslotValue.split('|');
      try {
        await setDeliveryTimeslot({ sessionId, start, end }).unwrap();
      } catch (err) {
        dispatch(setStatus(`Не вдалося застосувати час доставки: ${err?.data?.message ?? 'сталася помилка'}`, true));
        return;
      }
    }

    const parts = [dishName, `${portions} порцій`];
    if (notes.trim()) parts.push(notes.trim());
    const message = parts.join(', ');

    // Same reasoning as PlanForm: this can take a while (product search +
    // possibly a clarifying round-trip), so hand the wait off to the chat
    // thread itself instead of blocking the modal.
    const isNewChat = !conversationId;
    dispatch(setPendingRequestText(message));
    if (isNewChat) dispatch(setIsCreatingChat(true));
    onClose();
    setName('');
    setPortions(2);
    setNotes('');
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
      <div className="step-icon">🍲</div>
      <h2>Скласти страву</h2>
      <p className="step-hint">Назви страву й кількість порцій — агент підбере товари й покаже картку для купівлі</p>

      <TimeslotField sessionId={sessionId} value={timeslotValue} onChange={setTimeslotValue} />

      <div className="profile-field">
        <input
          className="text-field"
          placeholder="Напр.: борщ класичний"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="profile-field">
        <Stepper label="Порцій" value={portions} min={1} max={20} onChange={setPortions} />
      </div>

      <div className="profile-field">
        <span className="stepper-label">Побажання (необов'язково)</span>
        <textarea
          className="notes-textarea"
          rows="2"
          placeholder="Напр.: без гострого, пісний варіант..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <button className="primary-btn" type="button" onClick={handleSubmit} disabled={!name.trim() || isSending}>
        {isSending ? 'Надсилаю...' : 'Скласти страву 🍲'}
      </button>
    </dialog>
  );
});

export default DishForm;
