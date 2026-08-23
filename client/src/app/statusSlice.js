import { createSlice } from '@reduxjs/toolkit';

/** `id` increments on every dispatch, even if `text` repeats — Toast
 * watches it (not `text`) to know a *new* message arrived and restart its
 * auto-hide timer, rather than only reacting to a text change. */
const statusSlice = createSlice({
  name: 'status',
  initialState: { text: '', isError: false, id: 0 },
  reducers: {
    setStatus: {
      prepare: (text, isError = false) => ({ payload: { text, isError } }),
      reducer(state, action) {
        state.text = action.payload.text;
        state.isError = action.payload.isError;
        state.id += 1;
      },
    },
  },
});

export const { setStatus } = statusSlice.actions;
export default statusSlice.reducer;
export const selectStatus = (state) => state.status;
