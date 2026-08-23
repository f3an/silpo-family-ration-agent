import { checkoutCart } from './checkout';
import type { CheckoutRequest } from './dishPlan.schema';

function fakeMcp(overrides: Record<string, unknown> = {}) {
  return {
    callTool: jest.fn().mockImplementation(({ name }: { name: string }) => {
      if (name === 'silpo_get_my_shopping_cart') {
        return Promise.resolve({
          isError: false,
          structuredContent: { success: true, shoppingCartId: 'cart-1' },
        });
      }
      return Promise.resolve({
        isError: false,
        structuredContent: { success: true },
      });
    }),
    ...overrides,
  };
}

const ITEM_A = {
  productId: 'p1',
  companyId: 'c1',
  branchId: 'b1',
  quantity: 0.4,
};
const ITEM_B = {
  productId: 'p2',
  companyId: 'c1',
  branchId: 'b1',
  quantity: 2,
};

describe('checkoutCart', () => {
  it('fetches the cart id then adds the given products', async () => {
    const mcp = fakeMcp();

    const result = await checkoutCart(mcp as never, [ITEM_A, ITEM_B]);

    expect(result).toEqual({ success: true });
    expect(mcp.callTool).toHaveBeenNthCalledWith(1, {
      name: 'silpo_get_my_shopping_cart',
      arguments: {},
    });
    expect(mcp.callTool).toHaveBeenNthCalledWith(2, {
      name: 'silpo_add_or_update_cart_products',
      arguments: {
        shoppingCartId: 'cart-1',
        products: [
          { ...ITEM_A, addQuantity: true },
          { ...ITEM_B, addQuantity: true },
        ],
      },
    });
  });

  it('sums quantities when two dishes share the same ingredient', async () => {
    const mcp = fakeMcp();
    const items: CheckoutRequest['items'] = [
      ITEM_A,
      { ...ITEM_A, quantity: 0.6 },
    ];

    await checkoutCart(mcp as never, items);

    expect(mcp.callTool).toHaveBeenNthCalledWith(2, {
      name: 'silpo_add_or_update_cart_products',
      arguments: {
        shoppingCartId: 'cart-1',
        products: [{ ...ITEM_A, quantity: 1, addQuantity: true }],
      },
    });
  });

  it('returns success: false when the cart lookup fails', async () => {
    const mcp = fakeMcp({
      callTool: jest.fn().mockResolvedValue({ isError: true }),
    });

    const result = await checkoutCart(mcp as never, [ITEM_A]);

    expect(result).toEqual({ success: false });
  });
});
