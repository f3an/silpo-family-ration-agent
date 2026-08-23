import { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import DishPlanWidget from './DishPlanWidget';
import OccasionBasketWidget from './OccasionBasketWidget';
import IngredientOptionsWidget from './IngredientOptionsWidget';
import ChatComposer from './ChatComposer';

/** Ingredient-options widgets don't carry the dish/basket they're swapping
 * within (only the backend's own tool_use knows that) — found here instead
 * by scanning earlier messages for the most recent dish_plan/occasion_basket
 * widget, so a card pick can re-send the full current data to Claude. A
 * message can carry more than one widget (an event turn can attach both a
 * dish_plan and an occasion_basket — see systemPrompt.ts's occasion
 * scenario), so this checks all of them, not just one. */
function findSourceWidget(messages, beforeIndex) {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const widget = (messages[i].widgets ?? []).find(
      (w) => w.kind === 'dish_plan' || w.kind === 'occasion_basket',
    );
    if (widget) return widget;
  }
  return null;
}

/** A swap re-emits the whole dish (or basket) as a fresh widget later in
 * the same thread — the earlier card's "Купити" is then stale (it'd add
 * the pre-swap ingredients). Tracks the *last* message index each dish
 * name / basket theme appears at, so each widget instance can tell which
 * of its own dishes got superseded by a later one and drop them from
 * checkout instead of leaving a misleading working buy button around. */
function buildFreshnessIndex(messages) {
  const latestDishIndex = new Map();
  const latestBasketIndex = new Map();
  messages.forEach((m, i) => {
    for (const widget of m.widgets ?? []) {
      if (widget.kind === 'dish_plan') {
        widget.dishes.forEach((d) => latestDishIndex.set(d.name, i));
      } else if (widget.kind === 'occasion_basket') {
        latestBasketIndex.set(widget.basket.theme, i);
      }
    }
  });
  return { latestDishIndex, latestBasketIndex };
}
import { selectSessionId } from '../app/settingsSlice';
import { selectActiveConversationId, selectPendingRequestText, setIsCreatingChat } from '../app/chatUiSlice';
import { setStatus } from '../app/statusSlice';
import {
  useGetChatQuery,
  useSendMessageMutation,
  useGetFamilyChatQuery,
  useSendFamilyMessageMutation,
} from '../app/api';
import { useModals } from '../context/ModalContext';

/** `scope: 'family'` points every hook/route at the family-chat endpoints
 * instead of the personal ones (see agent/family.service.ts on the backend)
 * — same component either way, since the message list/composer/widget
 * rendering are otherwise identical. See routes/RootLayout.jsx for how
 * scope is derived from the URL. */
export default function ChatPanel({ scope = 'personal' }) {
  const isFamily = scope === 'family';
  const chatPathPrefix = isFamily ? '/family/c/' : '/c/';
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const sessionId = useSelector(selectSessionId);
  const conversationId = useSelector(selectActiveConversationId);
  const pendingRequestText = useSelector(selectPendingRequestText);
  const { openPlanForm, openDishForm, openOccasionForm } = useModals();

  const { data: personalData, isLoading: personalLoading } = useGetChatQuery(
    { sessionId, id: conversationId },
    { skip: !conversationId || isFamily },
  );
  const { data: familyData, isLoading: familyLoading } = useGetFamilyChatQuery(
    { sessionId, id: conversationId },
    { skip: !conversationId || !isFamily },
  );
  const data = isFamily ? familyData : personalData;
  const isLoading = isFamily ? familyLoading : personalLoading;

  const [sendPersonalMessage, { isLoading: isSendingPersonal }] = useSendMessageMutation();
  const [sendFamilyMessage, { isLoading: isSendingFamily }] = useSendFamilyMessageMutation();
  const sendMessage = isFamily ? sendFamilyMessage : sendPersonalMessage;
  const isSending = isFamily ? isSendingFamily : isSendingPersonal;

  // Guarded on conversationId, not just on `data` — RootLayout doesn't
  // remount between "/" and "/c/:id" (same route element, only the param
  // changes), so this component and its RTK Query cache stay alive across
  // "+ Нова розмова"; without this guard the previous conversation's cached
  // messages could still render for the one render before the query fully
  // settles into its skipped state.
  const messages = conversationId ? (data?.messages ?? []) : [];
  const [draft, setDraft] = useState('');
  // Holds the guest's own message bubble from the moment it's sent until the
  // real reply lands in the cache (there's no optimistic cache patch — see
  // sendMessage's onQueryStarted in app/api.js, it only writes on success).
  // Also doubles as the "what to resend" payload for the retry button below:
  // kept around (not cleared) when the request fails, instead of vanishing
  // with only a toast to show for it.
  const [pendingUserText, setPendingUserText] = useState(null);
  // Set only when the last send actually failed (network/server error, or
  // an explicitly-aborted/truncated reply — both surface as a rejected
  // mutation) — the retry button below is gated on this, not on "there's a
  // previous assistant message", so it never appears after an ordinary
  // successful reply.
  const [failedText, setFailedText] = useState(null);
  const bottomRef = useRef(null);

  // A stale failure from a previous thread shouldn't linger after switching
  // conversations (ChatPanel doesn't remount between them — see the guard
  // above).
  useEffect(() => {
    setPendingUserText(null);
    setFailedText(null);
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, isSending, pendingUserText, pendingRequestText]);

  async function sendChatMessage(text) {
    setPendingUserText(text);
    const isNewChat = !conversationId;
    if (isNewChat) dispatch(setIsCreatingChat(true));

    try {
      const data = await sendMessage({
        sessionId,
        message: text,
        conversationId: conversationId ?? undefined,
      }).unwrap();
      if (conversationId !== data.conversationId) navigate(`${chatPathPrefix}${data.conversationId}`);
      setPendingUserText(null);
      setFailedText(null);
    } catch (err) {
      dispatch(setStatus(`Помилка: ${err?.data?.message ?? 'сталася помилка'}`, true));
      setFailedText(text);
    } finally {
      if (isNewChat) dispatch(setIsCreatingChat(false));
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || isSending) return;
    setDraft('');
    await sendChatMessage(text);
  }

  function handleRetry() {
    if (!failedText || isSending) return;
    sendChatMessage(failedText);
  }

  const showLoading = Boolean(conversationId) && isLoading;
  // Not gated on `!conversationId` — a *persisted* conversation with zero
  // messages is a real (if rare) state too: e.g. this tab loaded a
  // conversation another tab/request is still generating the first reply
  // for (the record is created up front, before the turn resolves — see
  // AgentService.sendMessage). Falling through to a blank screen there was
  // confusing; showing the same landing view lets the guest at least see
  // something and keep using the app instead of staring at nothing.
  const isLanding = !showLoading && messages.length === 0 && !pendingUserText && !isSending && !pendingRequestText;

  if (isLanding) {
    return (
      <div className="chat-panel">
        <div className="chat-landing">
          <div className="chat-landing-header">
            <span className="chat-landing-brand">{isFamily ? '👪 Сімейний чат' : 'Silpo AI-Agent'}</span>
            <h2 className="chat-landing-title">
              {isFamily ? 'Напиши — бачитимуть усі в родині' : 'З чого почнемо?'}
            </h2>
          </div>
          <div className="chat-landing-body">
            <ChatComposer draft={draft} onDraftChange={setDraft} onSubmit={handleSubmit} isSending={isSending} large />
            <div className="chat-landing-shortcuts">
              <button type="button" className="chat-landing-shortcut" onClick={openPlanForm}>
                <span className="chat-landing-shortcut-icon">📝</span>
                <span>
                  <span className="chat-landing-shortcut-title">Скласти раціон</span>
                  <span className="chat-landing-shortcut-desc">Швидка форма замість вільного тексту</span>
                </span>
              </button>
              <button type="button" className="chat-landing-shortcut" onClick={openDishForm}>
                <span className="chat-landing-shortcut-icon">🍲</span>
                <span>
                  <span className="chat-landing-shortcut-title">Скласти страву</span>
                  <span className="chat-landing-shortcut-desc">Інгредієнти для однієї страви</span>
                </span>
              </button>
              <button type="button" className="chat-landing-shortcut" onClick={openOccasionForm}>
                <span className="chat-landing-shortcut-icon">🎉</span>
                <span>
                  <span className="chat-landing-shortcut-title">Набір під подію</span>
                  <span className="chat-landing-shortcut-desc">Курована підбірка товарів</span>
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { latestDishIndex, latestBasketIndex } = buildFreshnessIndex(messages);

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {showLoading && <p className="chat-empty">Завантажую розмову...</p>}
        {!showLoading &&
          messages.map((m, i) => (
            // Keying on the array index alone lets React silently reuse a
            // widget component (and its local selection/checkbox state!)
            // across renders where the transcript's length/order shifts
            // slightly between the optimistic client-side view and a
            // server refetch (filtered tool-only turns don't always line
            // up 1:1) — a later widget at the same position would then
            // inherit an earlier one's stale useState. The first widget's
            // `messageIndex` is a stable id carried all the way from the
            // backend, so use that instead whenever a widget is present.
            <Fragment key={m.widgets?.length ? `widget-${m.widgets[0].messageIndex}` : `msg-${i}`}>
              {m.text && <div className={`chat-bubble chat-bubble-${m.role}`}>{m.text}</div>}
              {/* Usually one entry — an event turn can carry both a
                  dish_plan and an occasion_basket on the same message (see
                  systemPrompt.ts's occasion scenario: dishes that need
                  cooking + ready-to-buy extras in one turn). */}
              {(m.widgets ?? []).map((widget, wi) => (
                <Fragment key={`${widget.messageIndex}-${widget.kind}-${wi}`}>
                  {widget.kind === 'dish_plan' && (
                    <DishPlanWidget
                      dishes={widget.dishes}
                      staleDishNames={
                        new Set(
                          widget.dishes
                            .filter((d) => latestDishIndex.get(d.name) > i)
                            .map((d) => d.name),
                        )
                      }
                      scope={scope}
                    />
                  )}
                  {widget.kind === 'occasion_basket' && (
                    <OccasionBasketWidget
                      basket={widget.basket}
                      isStale={latestBasketIndex.get(widget.basket.theme) > i}
                      scope={scope}
                    />
                  )}
                  {widget.kind === 'ingredient_options' && (
                    <IngredientOptionsWidget
                      ingredientName={widget.ingredientName}
                      options={widget.options}
                      sourceWidget={findSourceWidget(messages, i)}
                      scope={scope}
                    />
                  )}
                </Fragment>
              ))}
            </Fragment>
          ))}
        {pendingUserText && (
          <>
            <div className="chat-bubble chat-bubble-user">{pendingUserText}</div>
            {!isSending && failedText && (
              <button type="button" className="ghost-btn chat-retry-btn" onClick={handleRetry}>
                🔄 Спробувати ще раз
              </button>
            )}
          </>
        )}
        {pendingRequestText && <div className="chat-bubble chat-bubble-user">{pendingRequestText}</div>}
        {(isSending || pendingRequestText) && (
          <div className="chat-bubble chat-bubble-assistant chat-bubble-pending">Думаю...</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <ChatComposer draft={draft} onDraftChange={setDraft} onSubmit={handleSubmit} isSending={isSending} />
      </div>
    </div>
  );
}
