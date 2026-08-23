import { createSlice } from '@reduxjs/toolkit';
import { PROFILE_KEY, DEFAULT_PROFILE } from '../constants';

function loadSavedProfile() {
  const saved = localStorage.getItem(PROFILE_KEY);
  if (!saved) return DEFAULT_PROFILE;
  try {
    return { ...DEFAULT_PROFILE, ...JSON.parse(saved) };
  } catch {
    return DEFAULT_PROFILE;
  }
}

/** The editable form draft shared by PlanForm + ProfileModal — people/days/
 * allergens/cuisine/equipment/cookingStyle/budgetUah/notes. Prefilled once
 * from localStorage on load and again from the Silpo account once it loads
 * (see hydrateFromAccount, dispatched from RootLayout). */
const profileDraftSlice = createSlice({
  name: 'profileDraft',
  initialState: loadSavedProfile(),
  reducers: {
    setField: {
      prepare: (key, value) => ({ payload: { key, value } }),
      reducer(state, action) {
        state[action.payload.key] = action.payload.value;
      },
    },
    toggleAllergen(state, action) {
      const set = new Set(state.allergens);
      if (set.has(action.payload)) set.delete(action.payload);
      else set.add(action.payload);
      state.allergens = Array.from(set);
    },
    toggleEquipment(state, action) {
      const set = new Set(state.equipment);
      if (set.has(action.payload)) set.delete(action.payload);
      else set.add(action.payload);
      state.equipment = Array.from(set);
    },
    hydrateFromAccount(state, action) {
      const { people, allergens, preferences } = action.payload;
      state.people = people;
      state.allergens = [];
      state.allergensOther = allergens.join(', ');
      if (preferences) {
        state.cuisine = preferences.cuisine;
        state.equipment = preferences.equipment;
        state.cookingStyle = preferences.cookingStyle;
        state.budgetUah = preferences.budgetUah;
        state.notes = preferences.notes;
      }
    },
    resetProfileDraft() {
      return DEFAULT_PROFILE;
    },
  },
});

export const {
  setField,
  toggleAllergen,
  toggleEquipment,
  hydrateFromAccount,
  resetProfileDraft,
} = profileDraftSlice.actions;
export default profileDraftSlice.reducer;
export const selectProfileDraft = (state) => state.profileDraft;
