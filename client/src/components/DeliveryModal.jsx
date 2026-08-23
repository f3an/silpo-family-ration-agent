import { forwardRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { ClockIcon, MapPinIcon } from './Icons';
import { formatSlot } from '../constants';
import { selectSessionId } from '../app/settingsSlice';
import {
  useGetDeliveryQuery,
  useGetDeliveryAddressesQuery,
  useLazyGetDeliveryAddressTimeslotsQuery,
  useSetDeliveryAddressMutation,
} from '../app/api';

function SlotList({ slots, isLoading, error, selectedKey, isApplying, onPick }) {
  if (isLoading) return <p className="chat-history-empty">Завантажую слоти...</p>;
  if (error) {
    return (
      <p className="chat-history-empty">
        Помилка завантаження слотів: {error?.data?.message ?? error?.error ?? 'сталася помилка'}
      </p>
    );
  }
  const available = slots.filter((s) => s.available);
  if (!available.length) return <p className="chat-history-empty">Немає доступних слотів</p>;

  return (
    <div className="delivery-slot-list">
      {available.map((slot) => {
        const key = `${slot.start}|${slot.end}`;
        return (
          <button
            key={key}
            type="button"
            className="delivery-slot-btn"
            disabled={isApplying}
            onClick={() => onPick(slot)}
          >
            {selectedKey === key && isApplying ? 'Застосовую...' : formatSlot(slot.start, slot.end)}
          </button>
        );
      })}
    </div>
  );
}

/** Address only — timeslot changes moved into the composer wizards
 * (PlanForm/DishForm/OccasionForm — see TimeslotField.jsx) or plain chat
 * ("постав доставку на завтра о 13:00", see systemPrompt.ts), both of
 * which naturally happen right when the guest is about to ask for
 * something, instead of a disconnected settings screen. */
const DeliveryModal = forwardRef(function DeliveryModal({ onClose }, ref) {
  const sessionId = useSelector(selectSessionId);
  const [mode, setMode] = useState('overview'); // 'overview' | 'address'
  const [selectedAddressId, setSelectedAddressId] = useState(null);
  const [pickingSlotKey, setPickingSlotKey] = useState(null);

  const { data: info, isLoading: isInfoLoading } = useGetDeliveryQuery(sessionId);

  const { data: addresses = [], isLoading: isAddressesLoading } = useGetDeliveryAddressesQuery(sessionId, {
    skip: mode !== 'address',
  });
  const [
    fetchAddressTimeslots,
    { data: addressTimeslots, isFetching: isAddressTimeslotsLoading, error: addressTimeslotsError },
  ] = useLazyGetDeliveryAddressTimeslotsQuery();
  const [setAddress, { isLoading: isApplyingAddress }] = useSetDeliveryAddressMutation();

  function backToOverview() {
    setMode('overview');
    setSelectedAddressId(null);
    setPickingSlotKey(null);
  }

  function handlePickAddress(addressId) {
    setSelectedAddressId(addressId);
    fetchAddressTimeslots({ sessionId, addressId });
  }

  async function handleConfirmAddress(slot) {
    if (!selectedAddressId) return;
    setPickingSlotKey(`${slot.start}|${slot.end}`);
    try {
      await setAddress({
        sessionId,
        addressId: selectedAddressId,
        start: slot.start,
        end: slot.end,
      }).unwrap();
      backToOverview();
    } finally {
      setPickingSlotKey(null);
    }
  }

  return (
    <dialog
      ref={ref}
      className="profile-modal delivery-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onClose={backToOverview}
    >
      <button className="modal-close" type="button" aria-label="Закрити" onClick={onClose}>
        ✕
      </button>

      <div className="step-icon">🚚</div>
      <h2>Доставка</h2>
      <p className="step-hint">
        Адреса, за якою агент шукає товари в Сільпо. Час доставки обирається під час запиту — у формі
        («Скласти раціон» тощо) чи прямо в чаті ("постав доставку на завтра о 13:00").
      </p>

      {mode === 'overview' && (
        <>
          <div className="review-summary">
            <div className="review-row">
              <MapPinIcon />
              <span>{isInfoLoading ? 'Завантажую...' : info?.addressLabel ?? '—'}</span>
            </div>
            <div className="review-row">
              <ClockIcon />
              <span>
                {isInfoLoading
                  ? 'Завантажую...'
                  : info?.timeslot
                    ? formatSlot(info.timeslot.start, info.timeslot.end)
                    : 'Час не вибрано'}
              </span>
            </div>
          </div>

          <div className="delivery-actions">
            <button type="button" className="review-row review-row-button" onClick={() => setMode('address')}>
              <MapPinIcon /> Змінити адресу доставки
            </button>
          </div>
        </>
      )}

      {mode === 'address' && !selectedAddressId && (
        <>
          <h3 className="profile-subheading">Оберіть збережену адресу</h3>
          {isAddressesLoading && <p className="chat-history-empty">Завантажую адреси...</p>}
          {!isAddressesLoading && addresses.length === 0 && (
            <p className="chat-history-empty">Немає збережених адрес — додай в акаунті Сільпо</p>
          )}
          <div className="delivery-address-list">
            {addresses.map((a) => (
              <button
                key={a.id}
                type="button"
                className="review-row review-row-button"
                onClick={() => handlePickAddress(a.id)}
              >
                <MapPinIcon /> {a.label}
              </button>
            ))}
          </div>
          <button type="button" className="ghost-btn option-keep-original" onClick={backToOverview}>
            ◀ Назад
          </button>
        </>
      )}

      {mode === 'address' && selectedAddressId && (
        <>
          <h3 className="profile-subheading">Оберіть час для цієї адреси</h3>
          <SlotList
            slots={addressTimeslots?.slots ?? []}
            isLoading={isAddressTimeslotsLoading}
            error={addressTimeslotsError}
            selectedKey={pickingSlotKey}
            isApplying={isApplyingAddress}
            onPick={handleConfirmAddress}
          />
          <button
            type="button"
            className="ghost-btn option-keep-original"
            onClick={() => setSelectedAddressId(null)}
          >
            ◀ Обрати іншу адресу
          </button>
        </>
      )}
    </dialog>
  );
});

export default DeliveryModal;
