import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import DishGrid from './DishGrid';
import { SILPO_CART_URL } from '../constants';
import { selectSessionId } from '../app/settingsSlice';
import { selectActiveConversationId, setPendingRequestText } from '../app/chatUiSlice';
import { setStatus } from '../app/statusSlice';
import { useCheckoutMutation, useSendMessageMutation, useSendFamilyMessageMutation } from '../app/api';

export default function DishPlanWidget({ dishes, staleDishNames = new Set(), scope = 'personal' }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const sessionId = useSelector(selectSessionId);
  const conversationId = useSelector(selectActiveConversationId);
  const [checkout, { isLoading: isCheckingOut }] = useCheckoutMutation();
  const [sendPersonalMessage] = useSendMessageMutation();
  const [sendFamilyMessage] = useSendFamilyMessageMutation();
  const sendMessage = scope === 'family' ? sendFamilyMessage : sendPersonalMessage;
  const chatPathPrefix = scope === 'family' ? '/family/c/' : '/c/';
  const [swappingKey, setSwappingKey] = useState(null);
  // Stale dishes (superseded by a later swap) start unselected and can't be
  // re-checked — see toggle() below and ChatPanel's buildFreshnessIndex.
  const [selectedIndexes, setSelectedIndexes] = useState(
    () => new Set(dishes.map((_, i) => i).filter((i) => !staleDishNames.has(dishes[i].name))),
  );
  // Keys are `${dishIndex}:${ingredientIndex}` — lets a guest exclude a
  // single ingredient they already have at home (e.g. olive oil) without
  // dropping the whole dish from the cart.
  const [excludedIngredients, setExcludedIngredients] = useState(() => new Set());

  function toggle(index) {
    if (staleDishNames.has(dishes[index].name)) return;
    setSelectedIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleIngredient(key) {
    setExcludedIngredients((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleRequestSwap(dishIndex, ingIndex) {
    const dish = dishes[dishIndex];
    const ing = dish.ingredients[ingIndex];
    const key = `${dishIndex}:${ingIndex}`;

    // Two distinct asks depending on whether there's already a matched
    // product: a real swap ("replace X"), or — when the lean pipeline left
    // productId null because no confident match existed — a fresh search
    // for *any* real candidates at all, phrased so the model doesn't try
    // to "replace" a product that was never there.
    const hasProduct = Boolean(ing.productId);
    const displayMessage = hasProduct
      ? `Заміни "${ing.name}" у страві «${dish.name}»`
      : `Шукаю товар для "${ing.name}" у страві «${dish.name}»`;
    // Sends ALL dishes in this widget (not just the one being edited) —
    // when this card came from a multi-dish plan, the agent echoes every
    // other dish back unchanged via propose_dish_card too (see
    // systemPrompt.ts), so the resulting card is a complete plan snapshot
    // instead of losing the rest of the plan to just the swapped dish.
    const message = hasProduct
      ? `Заміни інгредієнт "${ing.name}" (${ing.quantityLabel}) у страві "${dish.name}" на щось схоже — знайди 2-3 реальні альтернативи. Ось повні поточні дані ВСІХ страв (JSON, масив dishes) — онови страву "${dish.name}" з новим інгредієнтом, а кожну іншу страву поверни точно без змін:\n${JSON.stringify(dishes)}`
      : `Для інгредієнта "${ing.name}" (${ing.quantityLabel}) у страві "${dish.name}" не знайшлося точного товару — пошукай ширше (інші бренди/фасування/суміжні категорії) і запропонуй 2-3 реальні варіанти з каталогу Сільпо. Ось повні поточні дані ВСІХ страв (JSON, масив dishes) — онови страву "${dish.name}" з обраним інгредієнтом, а кожну іншу страву поверни точно без змін:\n${JSON.stringify(dishes)}`;

    setSwappingKey(key);
    dispatch(setPendingRequestText(displayMessage));

    try {
      const data = await sendMessage({
        sessionId,
        message,
        displayMessage,
        conversationId: conversationId ?? undefined,
      }).unwrap();
      if (conversationId !== data.conversationId) navigate(`${chatPathPrefix}${data.conversationId}`);
    } catch (err) {
      dispatch(setStatus(`Помилка: ${err?.data?.message ?? err?.message ?? 'сталася помилка'}`, true));
    } finally {
      setSwappingKey(null);
      dispatch(setPendingRequestText(null));
    }
  }

  const selectedDishes = dishes.filter((_, i) => selectedIndexes.has(i));
  const totalCalories = selectedDishes.reduce((sum, d) => sum + d.calories, 0);
  const summaryText = selectedDishes.length
    ? `Обрано страв: ${selectedDishes.length} · ~${totalCalories} ккал/порція сумарно`
    : 'Нічого не обрано';
  const allStale = dishes.every((d) => staleDishNames.has(d.name));

  async function handleCheckout() {
    const aggregated = new Map();
    dishes.forEach((dish, dishIndex) => {
      if (!selectedIndexes.has(dishIndex)) return;
      dish.ingredients.forEach((ing, ingIndex) => {
        if (!ing.productId || !ing.cartQuantity) return;
        if (excludedIngredients.has(`${dishIndex}:${ingIndex}`)) return;
        const existing = aggregated.get(ing.productId);
        if (existing) {
          existing.quantity += ing.cartQuantity;
        } else {
          aggregated.set(ing.productId, {
            productId: ing.productId,
            companyId: ing.companyId,
            branchId: ing.branchId,
            quantity: ing.cartQuantity,
          });
        }
      });
    });

    const items = Array.from(aggregated.values());
    if (!items.length) {
      dispatch(setStatus('У обраних стравах немає товарів, готових до кошика.', true));
      return;
    }

    dispatch(setStatus('🛒 Додаю товари в кошик Сільпо...'));

    try {
      const data = await checkout({ sessionId, items }).unwrap();
      if (!data.success) throw new Error('кошик не оновлено');

      dispatch(setStatus(`✅ Готово — ${items.length} товар(и) додано в кошик Сільпо.`));
      window.open(SILPO_CART_URL, '_blank', 'noopener');
    } catch (err) {
      dispatch(setStatus(`Помилка: ${err?.data?.message ?? err?.message ?? 'сталася помилка'}`, true));
    }
  }

  return (
    <div className="chat-widget">
      <DishGrid
        dishes={dishes}
        selectedIndexes={selectedIndexes}
        onToggle={toggle}
        excludedIngredients={excludedIngredients}
        onToggleIngredient={toggleIngredient}
        onRequestSwap={handleRequestSwap}
        swappingKey={swappingKey}
        staleDishNames={staleDishNames}
      />
      {allStale ? (
        <p className="chat-empty">Ця картка застаріла — дивись оновлену нижче ⬇</p>
      ) : (
        <div className="checkout-bar">
          <span className="selection-summary">{summaryText}</span>
          <button
            className="primary-btn"
            type="button"
            onClick={handleCheckout}
            disabled={selectedDishes.length === 0 || isCheckingOut}
          >
            🛒 Купити в Сільпо
          </button>
        </div>
      )}
    </div>
  );
}
