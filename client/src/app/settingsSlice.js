import { createSlice } from '@reduxjs/toolkit';
import { API_URL_KEY, SESSION_KEY, THEME_KEY } from '../constants';

function loadSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

const initialState = {
  apiUrl: localStorage.getItem(API_URL_KEY) || 'http://localhost:3000',
  sessionId: loadSessionId(),
  theme: localStorage.getItem(THEME_KEY) || 'system',
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setApiUrl(state, action) {
      state.apiUrl = action.payload;
      localStorage.setItem(API_URL_KEY, action.payload.trim());
    },
    setSessionId(state, action) {
      state.sessionId = action.payload;
      localStorage.setItem(SESSION_KEY, action.payload);
    },
    setTheme(state, action) {
      state.theme = action.payload;
      localStorage.setItem(THEME_KEY, action.payload);
    },
  },
});

export const { setApiUrl, setSessionId, setTheme } = settingsSlice.actions;
export default settingsSlice.reducer;

export const selectApiUrl = (state) => state.settings.apiUrl;
export const selectSessionId = (state) => state.settings.sessionId;
export const selectTheme = (state) => state.settings.theme;
export const selectApiBase = (state) => state.settings.apiUrl.trim().replace(/\/$/, '');
