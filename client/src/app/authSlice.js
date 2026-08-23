import { createSlice } from '@reduxjs/toolkit';

/** `isChecked` flips true the first time we get a real answer (the initial
 * /auth/silpo/status check, a ?silpoAuth= redirect, or a 401 from any RTK
 * Query endpoint) — RequireAuth waits for it so a guest who's actually
 * still logged in doesn't get bounced to /login for one frame on load. */
const authSlice = createSlice({
  name: 'auth',
  initialState: { isAuthenticated: false, isChecked: false },
  reducers: {
    setAuthenticated(state, action) {
      state.isAuthenticated = action.payload;
      state.isChecked = true;
    },
  },
});

export const { setAuthenticated } = authSlice.actions;
export default authSlice.reducer;
export const selectAuth = (state) => state.auth;
export const selectIsAuthenticated = (state) => state.auth.isAuthenticated;
