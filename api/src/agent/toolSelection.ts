import type Anthropic from '@anthropic-ai/sdk';

/**
 * The Silpo MCP server exposes 39 tools, and Claude pays for every unused
 * definition in tokens on every turn. `selectRelevantTools` cuts the list
 * down to what the conversation actually needs.
 *
 * CORE always ships: it's the family → search → cart → delivery-slot path
 * every ration-planning conversation walks. Everything else (loyalty,
 * order history, branches, certificates, ...) is opt-in, switched on by a
 * bilingual (uk/en) keyword match against what the user actually asked.
 */
const CORE_TOOL_NAMES = [
  'silpo_get_my_family',
  'silpo_get_my_food_restrictions',
  'silpo_get_my_profile',
  'silpo_get_my_shopping_cart',
  'silpo_get_shopping_cart_by_id',
  'silpo_add_or_update_cart_products',
  'silpo_remove_cart_products',
  'silpo_clear_shopping_cart',
  'silpo_update_shopping_cart',
  'silpo_find_products_batch',
  'silpo_get_products',
  'silpo_get_product_details',
  'silpo_get_similar_products',
  'silpo_get_replacements',
  'silpo_get_time_slots',
  'silpo_get_available_delivery_types',
];

interface ToolGroup {
  keywords: string[];
  tools: string[];
}

const OPTIONAL_TOOL_GROUPS: ToolGroup[] = [
  {
    keywords: [
      'категор',
      'розділ',
      'підбірк',
      'колекц',
      'category',
      'collection',
    ],
    tools: [
      'silpo_get_categories',
      'silpo_get_categories_tree',
      'silpo_get_category',
      'silpo_get_popular_categories',
      'silpo_get_product_sets',
    ],
  },
  {
    keywords: [
      'бонус',
      'купон',
      'промо',
      'акці',
      'знижк',
      'loyalty',
      'coupon',
      'promo',
      'discount',
    ],
    tools: [
      'silpo_get_promotions',
      'silpo_get_my_coupons',
      'silpo_get_loyalty_info',
      'silpo_get_coupon_details',
      'silpo_get_my_promos',
      'silpo_get_promo_codes',
    ],
  },
  {
    keywords: ['історі', 'попередн', 'куповував', 'order', 'history'],
    tools: ['silpo_get_my_online_orders', 'silpo_get_my_offline_orders'],
  },
  {
    keywords: ['філі', 'магазин', 'найближч', 'branch', 'store'],
    tools: ['silpo_list_branches'],
  },
  {
    keywords: [
      'адрес',
      'пошт',
      'відділенн',
      'самовивіз',
      'address',
      'nova poshta',
    ],
    tools: [
      'silpo_find_address',
      'silpo_get_my_delivery_addresses',
      'silpo_find_nova_poshta_settlements',
      'silpo_find_nova_poshta_offices',
    ],
  },
  {
    keywords: [
      'сертифікат',
      'подарунков',
      'плюс',
      'підписк',
      'certificate',
      'premium',
      'subscription',
      'gift',
    ],
    tools: [
      'silpo_get_my_certificates',
      'silpo_add_or_update_certificates',
      'silpo_get_my_premium_subscription',
    ],
  },
  {
    keywords: ['улюблен', 'вибран', 'favorite', 'wishlist'],
    tools: ['silpo_get_my_favorites', 'silpo_add_or_update_favorite_products'],
  },
];

const CATEGORIZED_TOOL_NAMES = new Set([
  ...CORE_TOOL_NAMES,
  ...OPTIONAL_TOOL_GROUPS.flatMap((group) => group.tools),
]);

/**
 * Narrows `tools` to CORE plus any optional group whose keywords appear in
 * `conversationText`. Tools the server returns that we don't recognize
 * (e.g. a future addition to the Silpo MCP catalog) always pass through
 * uncategorized, so this can only hide *known*, deliberately-grouped
 * tools — never silently drop something new.
 */
export function selectRelevantTools(
  tools: Anthropic.Tool[],
  conversationText: string,
): Anthropic.Tool[] {
  const text = conversationText.toLowerCase();
  const selectedNames = new Set(CORE_TOOL_NAMES);

  for (const group of OPTIONAL_TOOL_GROUPS) {
    if (group.keywords.some((keyword) => text.includes(keyword))) {
      for (const name of group.tools) selectedNames.add(name);
    }
  }

  return tools.filter(
    (tool) =>
      selectedNames.has(tool.name) || !CATEGORIZED_TOOL_NAMES.has(tool.name),
  );
}
