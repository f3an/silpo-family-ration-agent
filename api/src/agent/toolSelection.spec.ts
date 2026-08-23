import { selectRelevantTools } from './toolSelection';
import type Anthropic from '@anthropic-ai/sdk';

const ALL_TOOL_NAMES = [
  'silpo_find_address',
  'silpo_get_time_slots',
  'silpo_find_products_batch',
  'silpo_get_products',
  'silpo_get_promotions',
  'silpo_get_popular_categories',
  'silpo_get_category',
  'silpo_get_categories',
  'silpo_get_categories_tree',
  'silpo_get_my_shopping_cart',
  'silpo_get_shopping_cart_by_id',
  'silpo_add_or_update_cart_products',
  'silpo_remove_cart_products',
  'silpo_clear_shopping_cart',
  'silpo_update_shopping_cart',
  'silpo_get_my_online_orders',
  'silpo_get_product_details',
  'silpo_get_similar_products',
  'silpo_get_replacements',
  'silpo_get_my_coupons',
  'silpo_get_loyalty_info',
  'silpo_get_coupon_details',
  'silpo_get_my_delivery_addresses',
  'silpo_get_my_food_restrictions',
  'silpo_get_my_profile',
  'silpo_get_my_promos',
  'silpo_get_promo_codes',
  'silpo_list_branches',
  'silpo_get_product_sets',
  'silpo_get_my_family',
  'silpo_get_available_delivery_types',
  'silpo_find_nova_poshta_settlements',
  'silpo_find_nova_poshta_offices',
  'silpo_get_my_offline_orders',
  'silpo_get_my_certificates',
  'silpo_get_my_premium_subscription',
  'silpo_get_my_favorites',
  'silpo_add_or_update_favorite_products',
  'silpo_add_or_update_certificates',
];

function fakeTools(): Anthropic.Tool[] {
  return ALL_TOOL_NAMES.map((name) => ({
    name,
    description: name,
    input_schema: { type: 'object', properties: {} },
  }));
}

function names(tools: Anthropic.Tool[]): string[] {
  return tools.map((tool) => tool.name).sort();
}

describe('selectRelevantTools', () => {
  it('returns only the core ration-planning set for a generic family/ration request', () => {
    const selected = selectRelevantTools(
      fakeTools(),
      "зроби раціон на 3 дні для сім'ї з дитиною 5 років",
    );

    expect(names(selected)).toEqual(
      [
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
      ].sort(),
    );
  });

  it('adds the loyalty group when the message mentions bonuses/coupons', () => {
    const selected = names(
      selectRelevantTools(fakeTools(), 'які в мене є бонуси і купони?'),
    );

    expect(selected).toEqual(
      expect.arrayContaining([
        'silpo_get_loyalty_info',
        'silpo_get_my_coupons',
        'silpo_get_promo_codes',
      ]),
    );
    // stays out of unrelated optional groups
    expect(selected).not.toContain('silpo_list_branches');
    expect(selected).not.toContain('silpo_get_my_certificates');
  });

  it('adds the branches group for an English keyword too', () => {
    const selected = names(
      selectRelevantTools(fakeTools(), 'which branch is closest to me?'),
    );

    expect(selected).toContain('silpo_list_branches');
  });

  it('never drops a tool the server returns that this module does not recognize', () => {
    const tools: Anthropic.Tool[] = [
      {
        name: 'silpo_get_my_family',
        description: '',
        input_schema: { type: 'object' },
      },
      {
        name: 'silpo_brand_new_tool',
        description: '',
        input_schema: { type: 'object' },
      },
    ];

    const selected = names(selectRelevantTools(tools, 'привіт'));

    expect(selected).toEqual(
      ['silpo_brand_new_tool', 'silpo_get_my_family'].sort(),
    );
  });
});
