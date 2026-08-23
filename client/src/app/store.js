import { configureStore } from '@reduxjs/toolkit';
import { api } from './api';
import settingsReducer from './settingsSlice';
import authReducer from './authSlice';
import statusReducer from './statusSlice';
import profileDraftReducer from './profileDraftSlice';
import chatUiReducer from './chatUiSlice';

export const store = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
    settings: settingsReducer,
    auth: authReducer,
    status: statusReducer,
    profileDraft: profileDraftReducer,
    chatUi: chatUiReducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(api.middleware),
});
