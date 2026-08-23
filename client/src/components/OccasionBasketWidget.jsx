import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { SILPO_CART_URL } from '../constants';
import { selectSessionId } from '../app/settingsSlice';
import { selectActiveConversationId, setPendingRequestText } from '../app/chatUiSlice';
import { setStatus } from '../app/statusSlice';
import { useCheckoutMutation, useSendMessageMutation, useSendFamilyMessageMutation } from '../app/api';

/** Same shape as a dish card's ingredient row, but flat — an occasion
 * basket isn't a recipe, so there's no per-dish grouping/macros, just one
 * themed list of real products. Reuses the exact ingredient-row classes
 * DishGrid already established for visual consistency. */
export default function OccasionBasketWidget({ basket, isStale = false, scope = 'personal' }) {
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
  // Keys are the item's index — lets a guest exclude a single item they
  // don't need without dropping the whole basket.
  const [excludedItems, setExcludedItems] = useState(() => new Set());

  function toggleItem(key) {
    setExcludedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleRequestSwap(index) {
    const item = basket.items[index];
    const key = String(index);

    const hasProduct = Boolean(item.productId);
    const displayMessage = hasProduct
      ? `Заміни "${item.name}" у наборі «${basket.theme}»`
      : `Шукаю товар для "${item.name}" у наборі «${basket.theme}»`;
    const message = hasProduct
      ? `Заміни товар "${item.name}" (${item.quantityLabel}) у наборі "${basket.theme}" на щось схоже — знайди 2-3 реальні альтернативи. Ось повні поточні дані набору (JSON), онови картку зі складом ідентичним цьому, крім заміненого товару:\n${JSON.stringify(basket)}`
      : `Для товару "${item.name}" (${item.quantityLabel}) у наборі "${basket.theme}" не знайшлося точного збігу — пошукай ширше (інші бренди/фасування/суміжні категорії) і запропонуй 2-3 реальні варіанти з каталогу Сільпо. Ось повні поточні дані набору (JSON), онови картку зі складом ідентичним цьому, крім цього товару:\n${JSON.stringify(basket)}`;

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

  async function handleCheckout() {
    const aggregated = new Map();
    basket.items.forEach((item, index) => {
      if (!item.productId || !item.cartQuantity) return;
      if (excludedItems.has(String(index))) return;
      const existing = aggregated.get(item.productId);
      if (existing) {
        existing.quantity += item.cartQuantity;
      } else {
        aggregated.set(item.productId, {
          productId: item.productId,
          companyId: item.companyId,
          branchId: item.branchId,
          quantity: item.cartQuantity,
        });
      }
    });

    const items = Array.from(aggregated.values());
    if (!items.length) {
      dispatch(setStatus('У наборі немає товарів, готових до кошика.', true));
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
      <article className="dish-card">
        <div className="dish-header">
          <h3>🎉 {basket.theme}</h3>
          <span className="badge">👥 {basket.guestCount} гостей</span>
        </div>
        <p className="dish-description">{basket.description}</p>

        <ul className="ingredient-list">
          {basket.items.map((item, i) => {
            const purchasable = Boolean(item.productId);
            const key = String(i);
            const isExcluded = purchasable && excludedItems.has(key);
            return (
              <li
                key={i}
                className={[!purchasable && 'ingredient-unmatched', isExcluded && 'ingredient-excluded']
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="ingredient-checkbox-slot">
                  {purchasable && (
                    <input
                      type="checkbox"
                      className="ingredient-checkbox"
                      checked={!isExcluded}
                      onChange={() => toggleItem(key)}
                      aria-label={`Купити: ${item.name}`}
                    />
                  )}
                </span>
                {item.imageUrl ? (
                  <img className="ingredient-thumb" src={item.imageUrl} alt={item.name} loading="lazy" />
                ) : (
                  <span className="ingredient-thumb ingredient-thumb-placeholder" aria-hidden="true">
                    🛒
                  </span>
                )}
                <span className="ingredient-text">
                  {item.name} — {item.quantityLabel}
                </span>
                <button
                  type="button"
                  className={`ingredient-swap-btn${!purchasable ? ' ingredient-swap-btn-missing' : ''}`}
                  aria-label={purchasable ? `Замінити: ${item.name}` : `Знайти товар: ${item.name}`}
                  title={purchasable ? 'Знайти заміну' : 'Товар не знайдено — підібрати варіанти'}
                  disabled={swappingKey === key}
                  onClick={() => handleRequestSwap(i)}
                >
                  {swappingKey === key ? '⏳' : purchasable ? '🔄' : '🔍'}
                </button>
              </li>
            );
          })}
        </ul>
      </article>

      {isStale ? (
        <p className="chat-empty">Ця картка застаріла — дивись оновлену нижче ⬇</p>
      ) : (
        <div className="checkout-bar">
          <span className="selection-summary">{basket.items.length} позицій у наборі</span>
          <button className="primary-btn" type="button" onClick={handleCheckout} disabled={isCheckingOut}>
            🛒 Купити в Сільпо
          </button>
        </div>
      )}
    </div>
  );
}
