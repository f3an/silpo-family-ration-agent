export const PROFILE_KEY = 'silpo-agent-profile';
export const API_URL_KEY = 'silpo-agent-api-url';
export const SESSION_KEY = 'silpo-agent-session-id';
export const THEME_KEY = 'silpo-agent-theme';
export const SILPO_CART_URL = 'https://silpo.ua/basket';
export const SILPO_LOYALTY_URL = 'https://myvr.silpo.ua/';
export const SILPO_FAMILY_URL = 'https://id.silpo.ua/family';
export const TOTAL_STEPS = 8;

export const COOKING_STYLE_LABELS = {
  fast: '⚡ швидкі страви щодня',
  daily: '🍳 готую щодня',
  batch: '📦 meal-prep (готуємо 1-2 рази на весь період)',
};

export const ALLERGEN_OPTIONS = [
  { value: 'глютен', emoji: '🌾', label: 'глютен' },
  { value: 'лактоза', emoji: '🥛', label: 'лактоза' },
  { value: 'горіхи', emoji: '🥜', label: 'горіхи' },
  { value: 'яйця', emoji: '🥚', label: 'яйця' },
  { value: 'риба/морепродукти', emoji: '🐟', label: 'риба/морепродукти' },
  { value: 'соя', emoji: '🫘', label: 'соя' },
  { value: 'вегетаріанське', emoji: '🥦', label: 'вегетаріанське' },
];

export const CUISINE_OPTIONS = [
  { value: '', emoji: '✨', label: 'без переваг' },
  { value: 'українська', emoji: '🇺🇦', label: 'українська' },
  { value: 'італійська', emoji: '🍝', label: 'італійська' },
  { value: 'азійська', emoji: '🥢', label: 'азійська' },
  { value: 'середземноморська', emoji: '🫒', label: 'середземноморська' },
];

export const EQUIPMENT_OPTIONS = [
  { value: 'плита', emoji: '🔥', label: 'плита' },
  { value: 'духовка', emoji: '🥧', label: 'духовка' },
  { value: 'мультиварка', emoji: '🍲', label: 'мультиварка' },
  { value: 'блендер', emoji: '🥤', label: 'блендер' },
  { value: 'аірфраєр', emoji: '🍟', label: 'аірфраєр' },
  { value: 'мікрохвильовка', emoji: '🔌', label: 'мікрохвильовка' },
];

export const COOKING_STYLE_OPTIONS = [
  { value: 'fast', emoji: '⚡', title: 'Швидкі страви', desc: 'Готуємо щодня, мінімум часу й кроків' },
  { value: 'daily', emoji: '🍳', title: 'Готую щодня', desc: 'Окрема свіжа страва на кожен день' },
  { value: 'batch', emoji: '📦', title: 'Meal-prep', desc: 'Готуємо 1-2 рази великими партіями на весь період' },
];

/** Slots come back as UTC ISO strings (see delivery.service.ts) — Date +
 * the browser's own locale/timezone handles the conversion, no manual
 * offset math needed. Shared by DeliveryModal and the wizard forms'
 * inline timeslot picker. */
export function formatSlot(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const day = start.toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' });
  const startTime = start.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  const endTime = end.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${startTime}–${endTime}`;
}

export function getInitials(accountInfo) {
  if (!accountInfo) return '👤';
  const initials = [accountInfo.firstName, accountInfo.lastName]
    .filter(Boolean)
    .map((s) => s.trim()[0])
    .filter(Boolean)
    .join('')
    .toUpperCase();
  return initials || '👤';
}

/** Just spacing — masking now happens server-side (see userProfile.ts's
 * maskPhone), so the full number never reaches the browser to begin with.
 * A no-op passthrough on an already-masked value (its `*`/`+`/spaces don't
 * survive the digit strip below, so `digits.length !== 12` and the input
 * comes back unchanged) — this only still does real formatting for a raw
 * 12-digit number, which nothing sends anymore but costs nothing to keep. */
export function formatPhone(phone) {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length !== 12) return phone;
  return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10, 12)}`;
}

export const DEFAULT_PROFILE = {
  people: 2,
  days: 3,
  allergens: [],
  allergensOther: '',
  cuisine: '',
  equipment: [],
  cookingStyle: 'daily',
  budgetUah: 1500,
  notes: '',
};
