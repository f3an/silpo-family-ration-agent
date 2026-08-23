import { Injectable } from '@nestjs/common';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { callMcpToolStructured } from './mcpTools';

export interface DeliverySlot {
  start: string;
  end: string;
  available: boolean;
}

export interface DeliveryInfo {
  addressLabel: string;
  deliveryType: string;
  timeslot: { start: string; end: string } | null;
}

export interface DeliveryAddressOption {
  id: string;
  label: string;
  city: string | null;
  street: string | null;
  building: string | null;
  apartment: string | null;
  floor: string | null;
  entrance: string | null;
  latitude: number;
  longitude: number;
  comment: string | null;
}

export interface AddressTimeslots {
  deliveryType: string;
  branchId: string;
  slots: DeliverySlot[];
}

interface RawAddress {
  addressType?: string;
  entrance?: string | null;
  floor?: string | null;
  flat?: string | null;
  latitude?: string;
  longitude?: string;
  courrierComment?: string | null;
  phone?: string | null;
  country?: string | null;
  postCode?: string | null;
  region?: string | null;
  district?: string | null;
  city?: string | null;
  street?: string | null;
  house?: string | null;
  locality?: string | null;
  polygonId?: string | null;
}

interface RawCart {
  cart?: {
    deliveryType?: string;
    timeslot?: { start?: string; end?: string };
    address?: RawAddress;
    shipments?: { branchId?: string; companyId?: string }[];
  };
}

interface RawSavedAddress {
  id: string;
  tag?: string | null;
  city?: string | null;
  street?: string | null;
  building?: string | null;
  apartment?: string | null;
  floor?: string | null;
  entrance?: string | null;
  latitude: number;
  longitude: number;
  comment?: string | null;
}

// Only these two carry a real branchId for a straight courier-to-door
// delivery — SelfPickup/NovaPoshta need their own multi-step branch/office
// resolution (silpo_list_branches / silpo_find_nova_poshta_*) the "change
// address" UI deliberately doesn't support (see the ProfileModal entry
// point's scope decision: courier-only for v1).
const HOME_DELIVERY_TYPES = ['DeliveryHome', 'WideAssortDelivery'];
const TIMESLOT_WINDOW_DAYS = 3;

/**
 * Lets a guest see and change the delivery timeslot and (saved) address
 * their Silpo cart is currently pinned to — surfaced because
 * `resolveDeliveryContext` (leanProductResolver.ts) and every MCP product
 * search always use whatever the cart *already* has, with no way for the
 * agent (or the guest, before this) to change it. Confirmed live this
 * session: a stale/inconvenient timeslot or branch can make a product look
 * unavailable ("stock: 0, available: false" for that specific branch +
 * timeslot) even when it's genuinely in stock elsewhere.
 */
@Injectable()
export class DeliveryService {
  private async getCart(mcp: Client) {
    const ref = (await callMcpToolStructured(
      mcp,
      'silpo_get_my_shopping_cart',
      {},
    )) as { shoppingCartId?: string } | undefined;
    if (!ref?.shoppingCartId) {
      throw new Error('This account has no active Silpo cart yet.');
    }
    const details = (await callMcpToolStructured(
      mcp,
      'silpo_get_shopping_cart_by_id',
      { shoppingCartId: ref.shoppingCartId },
    )) as RawCart | undefined;
    const cart = details?.cart;
    if (!cart?.shipments?.[0]?.branchId || !cart.deliveryType) {
      throw new Error('Cart has no delivery branch/type set yet.');
    }
    return { shoppingCartId: ref.shoppingCartId, cart };
  }

  private formatAddressLabel(address: RawAddress | undefined): string {
    if (!address) return '—';
    const parts = [address.street, address.house].filter(Boolean);
    let label = parts.length ? parts.join(', ') : '—';
    if (address.flat) label += `, кв. ${address.flat}`;
    return label;
  }

  async getInfo(mcp: Client): Promise<DeliveryInfo> {
    const { cart } = await this.getCart(mcp);
    return {
      addressLabel: this.formatAddressLabel(cart.address),
      deliveryType: cart.deliveryType!,
      timeslot:
        cart.timeslot?.start && cart.timeslot.end
          ? { start: cart.timeslot.start, end: cart.timeslot.end }
          : null,
    };
  }

  /** `Date.toISOString()` always uses a `Z` UTC suffix — silpo_get_time_slots
   * 400s on that ("API returned 400 Bad Request", confirmed live) and only
   * accepts the `+00:00` offset form instead, even though both represent
   * the exact same instant. */
  private toApiIso(date: Date): string {
    return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
  }

  private async fetchSlots(
    mcp: Client,
    branchId: string,
    deliveryType: string,
  ): Promise<DeliverySlot[]> {
    const start = new Date();
    const end = new Date(
      start.getTime() + TIMESLOT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const result = (await callMcpToolStructured(mcp, 'silpo_get_time_slots', {
      branchId,
      deliveryTypes: [deliveryType],
      start: this.toApiIso(start),
      end: this.toApiIso(end),
      limit: 50,
    })) as { slots?: DeliverySlot[] } | undefined;
    return result?.slots ?? [];
  }

  async listTimeslots(mcp: Client): Promise<DeliverySlot[]> {
    const { cart } = await this.getCart(mcp);
    return this.fetchSlots(
      mcp,
      cart.shipments![0].branchId!,
      cart.deliveryType!,
    );
  }

  async setTimeslot(mcp: Client, start: string, end: string): Promise<void> {
    const { shoppingCartId, cart } = await this.getCart(mcp);
    // address MUST be passed exactly as the cart already has it — the tool
    // rejects a hand-built address object for an unchanged delivery type
    // (see silpo_update_shopping_cart's own description).
    await callMcpToolStructured(mcp, 'silpo_update_shopping_cart', {
      shoppingCartId,
      deliveryType: cart.deliveryType,
      timeslot: { start, end },
      address: cart.address,
      shipments: cart.shipments!.map((s) => ({
        branchId: s.branchId,
        companyId: s.companyId,
      })),
    });
  }

  private toAddressOption(a: RawSavedAddress): DeliveryAddressOption {
    const parts = [a.street, a.building].filter(Boolean);
    let label = parts.length ? parts.join(', ') : a.tag || 'Адреса без назви';
    if (a.apartment) label += `, кв. ${a.apartment}`;
    return {
      id: a.id,
      label,
      city: a.city ?? null,
      street: a.street ?? null,
      building: a.building ?? null,
      apartment: a.apartment ?? null,
      floor: a.floor ?? null,
      entrance: a.entrance ?? null,
      latitude: a.latitude,
      longitude: a.longitude,
      comment: a.comment ?? null,
    };
  }

  async listMyAddresses(mcp: Client): Promise<DeliveryAddressOption[]> {
    const result = (await callMcpToolStructured(
      mcp,
      'silpo_get_my_delivery_addresses',
      {},
    )) as { addresses?: RawSavedAddress[] } | undefined;
    return (result?.addresses ?? []).map((a) => this.toAddressOption(a));
  }

  private async findSavedAddress(
    mcp: Client,
    addressId: string,
  ): Promise<DeliveryAddressOption> {
    const addresses = await this.listMyAddresses(mcp);
    const found = addresses.find((a) => a.id === addressId);
    if (!found) throw new Error('Адресу не знайдено серед збережених.');
    return found;
  }

  /** DeliveryHome first, WideAssortDelivery as fallback — whichever this
   * address actually has a courier branch for. Throws if neither is
   * available (e.g. the address only supports SelfPickup/NovaPoshta). */
  private async resolveHomeDeliveryBranch(
    mcp: Client,
    latitude: number,
    longitude: number,
  ): Promise<{ deliveryType: string; branchId: string }> {
    const types = (await callMcpToolStructured(
      mcp,
      'silpo_get_available_delivery_types',
      { latitude, longitude },
    )) as
      | { options?: Array<{ deliveryType: string; branchId: string | null }> }
      | undefined;
    for (const deliveryType of HOME_DELIVERY_TYPES) {
      const match = types?.options?.find(
        (o) => o.deliveryType === deliveryType && o.branchId,
      );
      if (match?.branchId) {
        return { deliveryType, branchId: match.branchId };
      }
    }
    throw new Error(
      "За цією адресою немає кур'єрської доставки додому — лише самовивіз чи Нова Пошта.",
    );
  }

  /** Needed BEFORE the guest can confirm an address change —
   * silpo_update_shopping_cart requires a valid timeslot up front, and the
   * new address' branch almost certainly has a different slot calendar
   * than the current one. */
  async listTimeslotsForAddress(
    mcp: Client,
    addressId: string,
  ): Promise<AddressTimeslots> {
    const address = await this.findSavedAddress(mcp, addressId);
    const { deliveryType, branchId } = await this.resolveHomeDeliveryBranch(
      mcp,
      address.latitude,
      address.longitude,
    );
    const slots = await this.fetchSlots(mcp, branchId, deliveryType);
    return { deliveryType, branchId, slots };
  }

  /** companyId is required by silpo_update_shopping_cart's shipments entry
   * but silpo_get_available_delivery_types doesn't return it — only
   * silpo_list_branches does, keyed by branchId. */
  private async resolveCompanyId(
    mcp: Client,
    branchId: string,
  ): Promise<string> {
    const result = (await callMcpToolStructured(mcp, 'silpo_list_branches', {
      limit: 1000,
    })) as
      { branches?: Array<{ branchId: string; companyId: string }> } | undefined;
    const branch = result?.branches?.find((b) => b.branchId === branchId);
    if (!branch) {
      throw new Error('Не вдалося визначити мережу магазинів для цієї філії.');
    }
    return branch.companyId;
  }

  async setAddress(
    mcp: Client,
    addressId: string,
    start: string,
    end: string,
  ): Promise<void> {
    const address = await this.findSavedAddress(mcp, addressId);
    const { shoppingCartId } = await this.getCart(mcp);
    const { deliveryType, branchId } = await this.resolveHomeDeliveryBranch(
      mcp,
      address.latitude,
      address.longitude,
    );
    const companyId = await this.resolveCompanyId(mcp, branchId);

    await callMcpToolStructured(mcp, 'silpo_update_shopping_cart', {
      shoppingCartId,
      deliveryType,
      timeslot: { start, end },
      address: {
        // Best-effort — silpo_get_my_delivery_addresses doesn't expose a
        // flat/house distinction directly; an apartment number is the
        // clearest signal it's a "flat"-type address rather than a house.
        addressType: address.apartment ? 'flat' : 'house',
        entrance: address.entrance,
        floor: address.floor,
        flat: address.apartment,
        latitude: String(address.latitude),
        longitude: String(address.longitude),
        courrierComment: address.comment ?? '',
        phone: null,
        country: 'Україна',
        postCode: null,
        region: null,
        district: null,
        city: address.city,
        street: address.street,
        house: address.building,
        locality: null,
        polygonId: null,
      },
      shipments: [{ branchId, companyId }],
    });
  }
}
