import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CheckoutRequest } from './dishPlan.schema';

export interface CheckoutResult {
  success: boolean;
}

/**
 * Adds the given products to the guest's real Silpo cart. No Claude call —
 * `/agent/plan` already resolved productId/companyId/branchId/quantity per
 * ingredient, so this is pure aggregation (dishes can share an ingredient)
 * plus the two MCP calls silpo_add_or_update_cart_products actually needs.
 */
export async function checkoutCart(
  mcp: Client,
  items: CheckoutRequest['items'],
): Promise<CheckoutResult> {
  const cartResult = await mcp.callTool({
    name: 'silpo_get_my_shopping_cart',
    arguments: {},
  });
  const cart = cartResult.structuredContent as
    { success?: boolean; shoppingCartId?: string } | undefined;
  if (cartResult.isError || !cart?.shoppingCartId) {
    return { success: false };
  }

  const aggregated = new Map<string, CheckoutRequest['items'][number]>();
  for (const item of items) {
    const existing = aggregated.get(item.productId);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      aggregated.set(item.productId, { ...item });
    }
  }

  const addResult = await mcp.callTool({
    name: 'silpo_add_or_update_cart_products',
    arguments: {
      shoppingCartId: cart.shoppingCartId,
      products: Array.from(aggregated.values()).map((item) => ({
        ...item,
        addQuantity: true,
      })),
    },
  });

  if (addResult.isError) return { success: false };
  const parsed = addResult.structuredContent as
    { success?: boolean } | undefined;
  return { success: parsed?.success ?? true };
}
