import { formatSlot } from '../constants';
import { useGetDeliveryTimeslotsQuery } from '../app/api';

/** Optional inline timeslot picker for the composer wizards (PlanForm/
 * DishForm/OccasionForm) — the address stays whatever the cart already has
 * (see DeliveryModal for that), only the time is picked here, right when
 * the guest is about to ask for something. `value` is `"start|end"` or
 * `null` (keep whatever the cart currently has); the wizard's own submit
 * handler applies it via useSetDeliveryTimeslotMutation before sending the
 * actual request, so product search sees the new slot immediately. */
export default function TimeslotField({ sessionId, value, onChange }) {
  const { data: slots = [], isFetching } = useGetDeliveryTimeslotsQuery(sessionId);
  const available = slots.filter((s) => s.available);

  return (
    <div className="profile-field">
      <span className="stepper-label">🕐 Час доставки</span>
      <select
        className="text-field"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={isFetching}
      >
        <option value="">Поточний час доставки</option>
        {available.map((slot) => {
          const key = `${slot.start}|${slot.end}`;
          return (
            <option key={key} value={key}>
              {formatSlot(slot.start, slot.end)}
            </option>
          );
        })}
      </select>
    </div>
  );
}
