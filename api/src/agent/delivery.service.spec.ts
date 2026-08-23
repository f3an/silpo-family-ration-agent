import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { DeliveryService } from './delivery.service';

/** Dispatches by tool name, same shape callMcpToolStructured expects
 * (`{isError, structuredContent}`) — one handler per MCP tool this test
 * needs, missing tools throw so an unexpected call fails loudly instead of
 * silently returning undefined. */
function fakeMcp(handlers: Record<string, (args: unknown) => unknown>): Client {
  return {
    callTool: jest
      .fn()
      .mockImplementation(
        ({ name, arguments: args }: { name: string; arguments: unknown }) => {
          const handler = handlers[name];
          if (!handler)
            throw new Error(`fakeMcp: no handler registered for ${name}`);
          return Promise.resolve({
            isError: false,
            structuredContent: handler(args),
          });
        },
      ),
  } as unknown as Client;
}

const CART = {
  shoppingCartId: 'cart-1',
  cart: {
    deliveryType: 'DeliveryHome',
    timeslot: {
      start: '2026-08-24T06:00:00+00:00',
      end: '2026-08-24T07:30:00+00:00',
    },
    address: {
      addressType: 'flat',
      entrance: '2',
      floor: '4',
      flat: '40',
      latitude: '50.4193686',
      longitude: '30.5502170',
      courrierComment: '',
      phone: null,
      country: 'Україна',
      postCode: null,
      region: null,
      district: 'Звіринець',
      city: 'Київ',
      street: 'Бастіонна вулиця',
      house: '3',
      locality: null,
      polygonId: null,
    },
    shipments: [{ branchId: 'branch-1', companyId: 'company-1' }],
  },
};

function baseHandlers(): Record<string, (args: unknown) => unknown> {
  return {
    silpo_get_my_shopping_cart: () => ({ shoppingCartId: CART.shoppingCartId }),
    silpo_get_shopping_cart_by_id: () => ({ cart: CART.cart }),
  };
}

describe('DeliveryService', () => {
  describe('getInfo', () => {
    it('formats the current cart into a display-ready summary', async () => {
      const service = new DeliveryService();
      const mcp = fakeMcp(baseHandlers());

      await expect(service.getInfo(mcp)).resolves.toEqual({
        addressLabel: 'Бастіонна вулиця, 3, кв. 40',
        deliveryType: 'DeliveryHome',
        timeslot: {
          start: '2026-08-24T06:00:00+00:00',
          end: '2026-08-24T07:30:00+00:00',
        },
      });
    });
  });

  describe('listTimeslots', () => {
    it("fetches slots for the cart's current branch and delivery type", async () => {
      const service = new DeliveryService();
      const getTimeSlots = jest.fn().mockReturnValue({
        slots: [{ start: 'a', end: 'b', available: true }],
      });
      const mcp = fakeMcp({
        ...baseHandlers(),
        silpo_get_time_slots: getTimeSlots,
      });

      const result = await service.listTimeslots(mcp);

      expect(result).toEqual([{ start: 'a', end: 'b', available: true }]);
      expect(getTimeSlots).toHaveBeenCalledWith(
        expect.objectContaining({
          branchId: 'branch-1',
          deliveryTypes: ['DeliveryHome'],
        }),
      );
    });

    // silpo_get_time_slots 400s on Date.toISOString()'s default `Z` suffix
    // and only accepts `+00:00` — confirmed live (see delivery.service.ts's
    // toApiIso doc). Regression test for that exact live incident.
    it("sends start/end with a +00:00 offset, never Date's default Z suffix", async () => {
      const service = new DeliveryService();
      const getTimeSlots = jest.fn().mockReturnValue({ slots: [] });
      const mcp = fakeMcp({
        ...baseHandlers(),
        silpo_get_time_slots: getTimeSlots,
      });

      await service.listTimeslots(mcp);

      const [call] = getTimeSlots.mock.calls[0] as [
        { start: string; end: string },
      ];
      expect(call.start).toMatch(/\+00:00$/);
      expect(call.end).toMatch(/\+00:00$/);
      expect(call.start).not.toMatch(/Z$/);
      expect(call.end).not.toMatch(/Z$/);
    });
  });

  describe('setTimeslot', () => {
    it("reuses the cart's existing address/shipments unchanged, only replacing the timeslot", async () => {
      const service = new DeliveryService();
      const updateCart = jest.fn().mockReturnValue({ success: true });
      const mcp = fakeMcp({
        ...baseHandlers(),
        silpo_update_shopping_cart: updateCart,
      });

      await service.setTimeslot(
        mcp,
        '2026-08-25T09:00:00+00:00',
        '2026-08-25T10:30:00+00:00',
      );

      expect(updateCart).toHaveBeenCalledWith({
        shoppingCartId: 'cart-1',
        deliveryType: 'DeliveryHome',
        timeslot: {
          start: '2026-08-25T09:00:00+00:00',
          end: '2026-08-25T10:30:00+00:00',
        },
        address: CART.cart.address,
        shipments: [{ branchId: 'branch-1', companyId: 'company-1' }],
      });
    });
  });

  describe('listMyAddresses', () => {
    it('maps saved addresses into display-ready options', async () => {
      const service = new DeliveryService();
      const mcp = fakeMcp({
        silpo_get_my_delivery_addresses: () => ({
          addresses: [
            {
              id: 'addr-1',
              tag: null,
              city: 'Київ',
              street: 'Бастіонна вулиця',
              building: '3',
              apartment: '40',
              floor: '4',
              entrance: '2',
              latitude: 50.4193686,
              longitude: 30.550217,
              comment: '',
            },
            {
              id: 'addr-2',
              tag: 'Приватний будинок',
              city: 'Київ',
              street: null,
              building: null,
              apartment: null,
              floor: null,
              entrance: null,
              latitude: 50.5,
              longitude: 30.4,
              comment: null,
            },
          ],
        }),
      });

      const result = await service.listMyAddresses(mcp);

      expect(result).toEqual([
        {
          id: 'addr-1',
          label: 'Бастіонна вулиця, 3, кв. 40',
          city: 'Київ',
          street: 'Бастіонна вулиця',
          building: '3',
          apartment: '40',
          floor: '4',
          entrance: '2',
          latitude: 50.4193686,
          longitude: 30.550217,
          comment: '',
        },
        {
          id: 'addr-2',
          label: 'Приватний будинок',
          city: 'Київ',
          street: null,
          building: null,
          apartment: null,
          floor: null,
          entrance: null,
          latitude: 50.5,
          longitude: 30.4,
          comment: null,
        },
      ]);
    });
  });

  describe('listTimeslotsForAddress', () => {
    function addressHandlers() {
      return {
        silpo_get_my_delivery_addresses: () => ({
          addresses: [
            {
              id: 'addr-1',
              city: 'Київ',
              street: 'Хрещатик',
              building: '1',
              apartment: '5',
              latitude: 50.44,
              longitude: 30.52,
            },
          ],
        }),
      };
    }

    it('prefers DeliveryHome when both DeliveryHome and WideAssortDelivery are available', async () => {
      const service = new DeliveryService();
      const getTimeSlots = jest.fn().mockReturnValue({ slots: [] });
      const mcp = fakeMcp({
        ...addressHandlers(),
        silpo_get_available_delivery_types: () => ({
          options: [
            { deliveryType: 'DeliveryHome', branchId: 'branch-home' },
            { deliveryType: 'WideAssortDelivery', branchId: 'branch-wide' },
            { deliveryType: 'SelfPickup', branchId: null },
          ],
        }),
        silpo_get_time_slots: getTimeSlots,
      });

      const result = await service.listTimeslotsForAddress(mcp, 'addr-1');

      expect(result.deliveryType).toBe('DeliveryHome');
      expect(result.branchId).toBe('branch-home');
      expect(getTimeSlots).toHaveBeenCalledWith(
        expect.objectContaining({
          branchId: 'branch-home',
          deliveryTypes: ['DeliveryHome'],
        }),
      );
    });

    it('falls back to WideAssortDelivery when DeliveryHome has no branch', async () => {
      const service = new DeliveryService();
      const mcp = fakeMcp({
        ...addressHandlers(),
        silpo_get_available_delivery_types: () => ({
          options: [
            { deliveryType: 'DeliveryHome', branchId: null },
            { deliveryType: 'WideAssortDelivery', branchId: 'branch-wide' },
          ],
        }),
        silpo_get_time_slots: () => ({ slots: [] }),
      });

      const result = await service.listTimeslotsForAddress(mcp, 'addr-1');

      expect(result.deliveryType).toBe('WideAssortDelivery');
      expect(result.branchId).toBe('branch-wide');
    });

    it('throws when neither DeliveryHome nor WideAssortDelivery is available', async () => {
      const service = new DeliveryService();
      const mcp = fakeMcp({
        ...addressHandlers(),
        silpo_get_available_delivery_types: () => ({
          options: [
            { deliveryType: 'SelfPickup', branchId: null },
            { deliveryType: 'NovaPoshta', branchId: null },
          ],
        }),
      });

      await expect(
        service.listTimeslotsForAddress(mcp, 'addr-1'),
      ).rejects.toThrow(/кур'єрської доставки/);
    });

    it('throws when the addressId is not among the saved addresses', async () => {
      const service = new DeliveryService();
      const mcp = fakeMcp(addressHandlers());

      await expect(
        service.listTimeslotsForAddress(mcp, 'missing'),
      ).rejects.toThrow(/не знайдено/);
    });
  });

  describe('setAddress', () => {
    it('resolves branch/company for the new address and applies it with the chosen timeslot', async () => {
      const service = new DeliveryService();
      const updateCart = jest.fn().mockReturnValue({ success: true });
      const mcp = fakeMcp({
        ...baseHandlers(),
        silpo_get_my_delivery_addresses: () => ({
          addresses: [
            {
              id: 'addr-1',
              city: 'Київ',
              street: 'Хрещатик',
              building: '1',
              apartment: '5',
              floor: '3',
              entrance: '1',
              latitude: 50.44,
              longitude: 30.52,
              comment: 'дзвонити знизу',
            },
          ],
        }),
        silpo_get_available_delivery_types: () => ({
          options: [{ deliveryType: 'DeliveryHome', branchId: 'branch-new' }],
        }),
        silpo_list_branches: () => ({
          branches: [{ branchId: 'branch-new', companyId: 'company-new' }],
        }),
        silpo_update_shopping_cart: updateCart,
      });

      await service.setAddress(
        mcp,
        'addr-1',
        '2026-08-25T09:00:00+00:00',
        '2026-08-25T10:30:00+00:00',
      );

      expect(updateCart).toHaveBeenCalledWith({
        shoppingCartId: 'cart-1',
        deliveryType: 'DeliveryHome',
        timeslot: {
          start: '2026-08-25T09:00:00+00:00',
          end: '2026-08-25T10:30:00+00:00',
        },
        address: {
          addressType: 'flat',
          entrance: '1',
          floor: '3',
          flat: '5',
          latitude: '50.44',
          longitude: '30.52',
          courrierComment: 'дзвонити знизу',
          phone: null,
          country: 'Україна',
          postCode: null,
          region: null,
          district: null,
          city: 'Київ',
          street: 'Хрещатик',
          house: '1',
          locality: null,
          polygonId: null,
        },
        shipments: [{ branchId: 'branch-new', companyId: 'company-new' }],
      });
    });

    it('throws when silpo_list_branches has no match for the resolved branch', async () => {
      const service = new DeliveryService();
      const mcp = fakeMcp({
        ...baseHandlers(),
        silpo_get_my_delivery_addresses: () => ({
          addresses: [
            {
              id: 'addr-1',
              city: 'Київ',
              street: 'Х',
              building: '1',
              latitude: 1,
              longitude: 2,
            },
          ],
        }),
        silpo_get_available_delivery_types: () => ({
          options: [{ deliveryType: 'DeliveryHome', branchId: 'branch-new' }],
        }),
        silpo_list_branches: () => ({ branches: [] }),
      });

      await expect(
        service.setAddress(mcp, 'addr-1', 'start', 'end'),
      ).rejects.toThrow(/мережу магазинів/);
    });
  });
});
