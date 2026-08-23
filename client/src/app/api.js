import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { selectApiBase } from './settingsSlice';
import { setAuthenticated } from './authSlice';

/** `apiUrl` is user-editable (session/settings state), so the base URL has
 * to be read fresh from the store on every call rather than baked in at
 * `createApi()` time. On any 401 — whichever endpoint hit it — flip
 * `auth.isAuthenticated` to false right here, once, instead of every
 * caller re-checking `res.status === 401` (as every handler used to). */
const dynamicBaseQuery = async (args, api, extraOptions) => {
  const baseUrl = selectApiBase(api.getState());
  const result = await fetchBaseQuery({ baseUrl })(args, api, extraOptions);
  if (result.error?.status === 401) {
    api.dispatch(setAuthenticated(false));
  }
  return result;
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery: dynamicBaseQuery,
  tagTypes: ['Auth', 'Profile', 'Chat', 'Family', 'FamilyChat', 'Delivery'],
  endpoints: (builder) => ({
    authStatus: builder.query({
      query: (sessionId) => `/auth/silpo/status?sessionId=${encodeURIComponent(sessionId)}`,
      providesTags: ['Auth'],
    }),

    logout: builder.mutation({
      query: (sessionId) => ({
        url: `/auth/silpo/logout?sessionId=${encodeURIComponent(sessionId)}`,
        method: 'POST',
      }),
      invalidatesTags: ['Auth', 'Profile', 'Chat'],
    }),

    getProfile: builder.query({
      query: (sessionId) => `/agent/profile?sessionId=${encodeURIComponent(sessionId)}`,
      providesTags: ['Profile'],
    }),

    savePreferences: builder.mutation({
      query: (body) => ({ url: '/agent/preferences', method: 'POST', body }),
      invalidatesTags: ['Profile'],
    }),

    listChats: builder.query({
      query: (sessionId) => `/agent/chats?sessionId=${encodeURIComponent(sessionId)}`,
      providesTags: (result) =>
        result
          ? [...result.map((c) => ({ type: 'Chat', id: c.id })), { type: 'Chat', id: 'LIST' }]
          : [{ type: 'Chat', id: 'LIST' }],
    }),

    getChat: builder.query({
      query: ({ sessionId, id }) => `/agent/chats/${id}?sessionId=${encodeURIComponent(sessionId)}`,
      providesTags: (result, error, { id }) => [{ type: 'Chat', id }],
    }),

    deleteChat: builder.mutation({
      query: ({ sessionId, id }) => ({
        url: `/agent/chats/${id}?sessionId=${encodeURIComponent(sessionId)}`,
        method: 'DELETE',
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: 'Chat', id },
        { type: 'Chat', id: 'LIST' },
      ],
    }),

    /** Patches the getChat cache for the (possibly brand-new) conversation
     * once the reply lands, instead of invalidating + refetching — seeds
     * the cache for a new conversationId so navigating to /c/:newId right
     * after renders instantly, matching the old optimistic-append UX with
     * no extra round-trip. The user's own bubble for a *brand-new* thread
     * (no conversationId yet, so no cache key to patch ahead of time) is
     * handled by ChatPanel's own local pending-echo state instead. */
    sendMessage: builder.mutation({
      query: (body) => ({ url: '/agent/messages', method: 'POST', body }),
      async onQueryStarted(
        { sessionId, conversationId, message, displayMessage },
        { dispatch, getState, queryFulfilled },
      ) {
        try {
          const { data } = await queryFulfilled;
          const cacheArg = { sessionId, id: data.conversationId };
          const existing = api.endpoints.getChat.select(cacheArg)(getState()).data;
          dispatch(
            api.util.upsertQueryData('getChat', cacheArg, {
              id: data.conversationId,
              title: data.title,
              messages: [
                ...(existing?.messages ?? []),
                { role: 'user', text: displayMessage ?? message },
                { role: 'assistant', text: data.reply, ...(data.widgets && { widgets: data.widgets }) },
              ],
            }),
          );
          if (conversationId !== data.conversationId) {
            dispatch(api.util.invalidateTags([{ type: 'Chat', id: 'LIST' }]));
          }
        } catch {
          // error surfaced via the mutation hook's own error state
        }
      },
    }),

    generatePlan: builder.mutation({
      query: (body) => ({ url: '/agent/plan', method: 'POST', body }),
      async onQueryStarted(
        { sessionId, conversationId, familyChat },
        { dispatch, getState, queryFulfilled },
      ) {
        try {
          const { data } = await queryFulfilled;
          const endpoint = familyChat ? 'getFamilyChat' : 'getChat';
          const tagType = familyChat ? 'FamilyChat' : 'Chat';
          const cacheArg = { sessionId, id: data.conversationId };
          const existing = api.endpoints[endpoint].select(cacheArg)(getState()).data;
          dispatch(
            api.util.upsertQueryData(endpoint, cacheArg, {
              id: data.conversationId,
              title: data.title,
              messages: [
                ...(existing?.messages ?? []),
                { role: 'user', text: data.requestText },
                {
                  role: 'assistant',
                  text: data.summaryText,
                  widgets: [{ kind: 'dish_plan', dishes: data.dishes }],
                },
              ],
            }),
          );
          if (conversationId !== data.conversationId) {
            dispatch(api.util.invalidateTags([{ type: tagType, id: 'LIST' }]));
          }
        } catch {
          // error surfaced via the mutation hook's own error state
        }
      },
    }),

    checkout: builder.mutation({
      query: (body) => ({ url: '/agent/checkout', method: 'POST', body }),
    }),

    // Drops the last turn server-side and re-runs it — the reply (and any
    // widget) genuinely change, and the number of raw messages can differ
    // too (a finalize call adds a tool round the plain first reply didn't
    // have), so hand-patching the cache isn't safe here — just invalidate
    // and let it refetch the real, authoritative transcript.
    retryLastMessage: builder.mutation({
      query: (body) => ({ url: '/agent/messages/retry', method: 'POST', body }),
      invalidatesTags: (result, error, { conversationId }) => [{ type: 'Chat', id: conversationId }],
    }),

    // Syncs + returns this account's Silpo family (see api/src/agent/family
    // .service.ts) — familyId: null means solo/no linked family, which is
    // when the client hides all family-chat UI.
    getFamily: builder.query({
      query: (sessionId) => `/agent/family?sessionId=${encodeURIComponent(sessionId)}`,
      providesTags: ['Family'],
    }),

    listFamilyChats: builder.query({
      query: (sessionId) => `/agent/family-chats?sessionId=${encodeURIComponent(sessionId)}`,
      providesTags: (result) =>
        result
          ? [...result.map((c) => ({ type: 'FamilyChat', id: c.id })), { type: 'FamilyChat', id: 'LIST' }]
          : [{ type: 'FamilyChat', id: 'LIST' }],
    }),

    getFamilyChat: builder.query({
      query: ({ sessionId, id }) => `/agent/family-chats/${id}?sessionId=${encodeURIComponent(sessionId)}`,
      providesTags: (result, error, { id }) => [{ type: 'FamilyChat', id }],
    }),

    deleteFamilyChat: builder.mutation({
      query: ({ sessionId, id }) => ({
        url: `/agent/family-chats/${id}?sessionId=${encodeURIComponent(sessionId)}`,
        method: 'DELETE',
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: 'FamilyChat', id },
        { type: 'FamilyChat', id: 'LIST' },
      ],
    }),

    // Same cache-patch shape as sendMessage — see the comment there.
    sendFamilyMessage: builder.mutation({
      query: (body) => ({ url: '/agent/family-messages', method: 'POST', body }),
      async onQueryStarted(
        { sessionId, conversationId, message, displayMessage },
        { dispatch, getState, queryFulfilled },
      ) {
        try {
          const { data } = await queryFulfilled;
          const cacheArg = { sessionId, id: data.conversationId };
          const existing = api.endpoints.getFamilyChat.select(cacheArg)(getState()).data;
          dispatch(
            api.util.upsertQueryData('getFamilyChat', cacheArg, {
              id: data.conversationId,
              title: data.title,
              messages: [
                ...(existing?.messages ?? []),
                { role: 'user', text: displayMessage ?? message },
                { role: 'assistant', text: data.reply, ...(data.widgets && { widgets: data.widgets }) },
              ],
            }),
          );
          if (conversationId !== data.conversationId) {
            dispatch(api.util.invalidateTags([{ type: 'FamilyChat', id: 'LIST' }]));
          }
        } catch {
          // error surfaced via the mutation hook's own error state
        }
      },
    }),

    // See delivery.service.ts — reads/writes whatever the guest's real
    // Silpo cart is currently pinned to (timeslot + saved address), which
    // every product search (resolveDeliveryContext) also reads from.
    getDelivery: builder.query({
      query: (sessionId) => `/agent/delivery?sessionId=${encodeURIComponent(sessionId)}`,
      providesTags: ['Delivery'],
    }),

    getDeliveryTimeslots: builder.query({
      query: (sessionId) => `/agent/delivery/timeslots?sessionId=${encodeURIComponent(sessionId)}`,
    }),

    setDeliveryTimeslot: builder.mutation({
      query: (body) => ({ url: '/agent/delivery/timeslot', method: 'POST', body }),
      invalidatesTags: ['Delivery'],
    }),

    getDeliveryAddresses: builder.query({
      query: (sessionId) => `/agent/delivery/addresses?sessionId=${encodeURIComponent(sessionId)}`,
    }),

    getDeliveryAddressTimeslots: builder.query({
      query: ({ sessionId, addressId }) =>
        `/agent/delivery/addresses/${addressId}/timeslots?sessionId=${encodeURIComponent(sessionId)}`,
    }),

    setDeliveryAddress: builder.mutation({
      query: (body) => ({ url: '/agent/delivery/address', method: 'POST', body }),
      invalidatesTags: ['Delivery'],
    }),
  }),
});

export const {
  useAuthStatusQuery,
  useLogoutMutation,
  useGetProfileQuery,
  useSavePreferencesMutation,
  useListChatsQuery,
  useGetChatQuery,
  useDeleteChatMutation,
  useSendMessageMutation,
  useGeneratePlanMutation,
  useCheckoutMutation,
  useRetryLastMessageMutation,
  useGetFamilyQuery,
  useListFamilyChatsQuery,
  useGetFamilyChatQuery,
  useDeleteFamilyChatMutation,
  useSendFamilyMessageMutation,
  useGetDeliveryQuery,
  useGetDeliveryTimeslotsQuery,
  useSetDeliveryTimeslotMutation,
  useGetDeliveryAddressesQuery,
  useLazyGetDeliveryAddressTimeslotsQuery,
  useSetDeliveryAddressMutation,
} = api;
