import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { selectSessionId } from '../app/settingsSlice';
import { selectActiveConversationId, setPendingRequestText } from '../app/chatUiSlice';
import { setStatus } from '../app/statusSlice';
import { useSendMessageMutation, useSendFamilyMessageMutation } from '../app/api';

/** Renders 2-3 real product candidates (propose_ingredient_options) as
 * picker cards instead of a plain numbered text list. `sourceWidget` is the
 * dish_plan/occasion_basket widget this swap was requested against — found
 * client-side by ChatPanel by scanning earlier messages, not sent by the
 * backend — needed so picking a card can re-send the full current
 * dish/basket JSON (same reasoning as the swap request itself: Claude needs
 * it fresh for this one turn, but it's never persisted into `messages`). */
export default function IngredientOptionsWidget({ ingredientName, options, sourceWidget, scope = 'personal' }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const sessionId = useSelector(selectSessionId);
  const conversationId = useSelector(selectActiveConversationId);
  const [sendPersonalMessage] = useSendMessageMutation();
  const [sendFamilyMessage] = useSendFamilyMessageMutation();
  const sendMessage = scope === 'family' ? sendFamilyMessage : sendPersonalMessage;
  const chatPathPrefix = scope === 'family' ? '/family/c/' : '/c/';
  const [pickingIndex, setPickingIndex] = useState(null);
  const [keepingOriginal, setKeepingOriginal] = useState(false);

  // Sends ALL dishes from the source widget (not just the one containing
  // this ingredient) — when the card came from a multi-dish plan, the
  // agent echoes every other dish back unchanged too (see
  // systemPrompt.ts), so the resulting card stays a complete plan
  // snapshot instead of losing the rest of the plan.
  function buildSourcePayload() {
    return sourceWidget.kind === 'occasion_basket'
      ? { kind: 'occasion_basket', basket: sourceWidget.basket }
      : { kind: 'dish_plan', dishes: sourceWidget.dishes };
  }

  async function sendTurn(message, displayMessage) {
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
      dispatch(setPendingRequestText(null));
    }
  }

  async function handlePick(option, index) {
    if (!sourceWidget) {
      dispatch(setStatus('Не вдалось знайти страву для оновлення — спробуй написати повідомлення вручну.', true));
      return;
    }

    setPickingIndex(index);
    await sendTurn(
      `Обираю варіант "${option.label}" для інгредієнта "${ingredientName}". Ось повні поточні дані (JSON) — онови страву з цим інгредієнтом, застосувавши цей варіант замість "${ingredientName}", а кожну іншу страву поверни точно без змін:\n${JSON.stringify(buildSourcePayload())}\nОбраний варіант: ${JSON.stringify(option)}`,
      `Обираю: ${option.label}`,
    );
    setPickingIndex(null);
  }

  // Real turn, not a local-only dismissal — a client-side-only "hide the
  // picker" doesn't survive a reload (the widget is still in the persisted
  // transcript, so it'd just reappear). Sending this keeps the decision in
  // the actual chat history, same as picking an option does.
  async function handleKeepOriginal() {
    if (!sourceWidget) {
      dispatch(setStatus('Не вдалось знайти страву — спробуй написати повідомлення вручну.', true));
      return;
    }

    setKeepingOriginal(true);
    await sendTurn(
      `Залиш інгредієнт "${ingredientName}" без змін — не шукай заміну. Ось повні поточні дані (JSON), поверни картку(и) такими ж, без жодних змін:\n${JSON.stringify(buildSourcePayload())}`,
      `Залишаю "${ingredientName}" без змін`,
    );
    setKeepingOriginal(false);
  }

  return (
    <div className="chat-widget">
      <div className="option-cards">
        {options.map((option, i) => (
          <article key={i} className="option-card">
            {option.imageUrl ? (
              <img className="option-card-image" src={option.imageUrl} alt={option.label} loading="lazy" />
            ) : (
              <div className="option-card-image option-card-image-placeholder" aria-hidden="true">
                🛒
              </div>
            )}
            <div className="option-card-body">
              <h4 className="option-card-title">{option.label}</h4>
              <p className="option-card-note">{option.note}</p>
              <div className="option-card-footer">
                <span className="option-card-price">{option.price != null ? `₴${option.price}` : '—'}</span>
                <span className="option-card-qty">{option.quantityLabel}</span>
              </div>
              <button
                type="button"
                className="primary-btn option-card-pick"
                disabled={pickingIndex !== null || keepingOriginal}
                onClick={() => handlePick(option, i)}
              >
                {pickingIndex === i ? 'Обираю...' : 'Обрати'}
              </button>
            </div>
          </article>
        ))}
      </div>
      <button
        type="button"
        className="ghost-btn option-keep-original"
        disabled={pickingIndex !== null || keepingOriginal}
        onClick={handleKeepOriginal}
      >
        {keepingOriginal ? 'Залишаю...' : `◀ Залишити «${ingredientName}» без змін`}
      </button>
    </div>
  );
}
