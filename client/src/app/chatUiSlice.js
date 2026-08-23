import { createSlice } from '@reduxjs/toolkit';

/** Mirrors the router's :conversationId param into the store — RootLayout
 * (the route element, so it has useParams()) syncs it here on every
 * navigation. Needed because PlanForm is mounted by ModalContext outside
 * the routed subtree (so it can stay open across navigation) and has no
 * other way to know which conversation is currently active. */
const chatUiSlice = createSlice({
  name: 'chatUi',
  initialState: {
    activeConversationId: null,
    isSidenavCollapsed: false,
    pendingRequestText: null,
    isCreatingChat: false,
  },
  reducers: {
    setActiveConversationId(state, action) {
      state.activeConversationId = action.payload;
    },
    toggleSidenav(state) {
      state.isSidenavCollapsed = !state.isSidenavCollapsed;
    },
    /** Set by PlanForm/DishForm right before they close and fire off a
     * mutation that may take a while (multiple MCP tool round-trips) — lets
     * ChatPanel show an immediate pending bubble in the chat itself instead
     * of leaving the guest staring at a closed modal with no feedback. */
    setPendingRequestText(state, action) {
      state.pendingRequestText = action.payload;
    },
    /** Set right before sending the very first message of a brand-new
     * conversation (no conversationId yet) — the real record only shows up
     * in `GET /agent/chats` once the whole turn resolves (that's when the
     * cache gets invalidated), so ChatSidenav renders a placeholder off
     * this flag instead of leaving the guest wondering if anything
     * happened. */
    setIsCreatingChat(state, action) {
      state.isCreatingChat = action.payload;
    },
  },
});

export const { setActiveConversationId, toggleSidenav, setPendingRequestText, setIsCreatingChat } = chatUiSlice.actions;
export default chatUiSlice.reducer;
export const selectActiveConversationId = (state) => state.chatUi.activeConversationId;
export const selectIsSidenavCollapsed = (state) => state.chatUi.isSidenavCollapsed;
export const selectPendingRequestText = (state) => state.chatUi.pendingRequestText;
export const selectIsCreatingChat = (state) => state.chatUi.isCreatingChat;
