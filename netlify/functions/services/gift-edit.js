/**
 * Staff edits to a paid gift order's recipient, message and schedule.
 *
 * Customers cannot edit after ordering (policy); they contact admin. Staff may
 * edit only while delivery has not been arranged (no courier shipment or rider
 * assigned yet), and never change the delivery city/state, because the
 * delivery fee the customer already paid was quoted for it.
 */
import { firstDeliveryError, validateDeliveryDetails } from './deliveryDetails.js';
import { checkGiftShipmentNotCreated } from './gift-cancel.js';
import { loadGiftCommercialSettings } from './gift-commercial.js';
import {
  loadGfcSchedulingContext,
  maxLeadTimeForGiftLines,
  validateOccasionDate,
  validateRequestedDeliveryDate,
} from './gift-delivery-schedule.js';

export class GiftEditError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const MAX_MESSAGE_LENGTH = 500; // matches the checkout field limit
const RECIPIENT_FIELDS = [
  'recipient_name',
  'recipient_phone',
  'recipient_email',
  'recipient_address',
  'recipient_city',
  'recipient_state',
  'recipient_zone',
];

const sameText = (a, b) =>
  String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

export async function updateGiftOrderDetailsByStaff(client, { giftOrderId, input, actorEmail }) {
  const { data: gift, error } = await client
    .from('gift_orders')
    .select(
      `id, order_id, order_kind, gift_status, gift_fulfilment_centre_id,
       ${RECIPIENT_FIELDS.join(', ')},
       gift_message, sender_visible, occasion, requested_delivery_date, occasion_date`
    )
    .eq('id', giftOrderId)
    .maybeSingle();
  if (error) throw error;
  if (!gift) throw new GiftEditError('Gift order not found', 404);

  if (['cancelled', 'delivered'].includes(gift.gift_status)) {
    throw new GiftEditError(`A ${gift.gift_status} gift cannot be edited`, 409);
  }
  const shipment = await checkGiftShipmentNotCreated(client, gift.order_id);
  if (!shipment.allowed) {
    throw new GiftEditError(
      'Delivery has already been arranged for this gift, so it can no longer be edited',
      409
    );
  }

  const patch = {};

  // --- recipient details -------------------------------------------------
  const touchesRecipient = RECIPIENT_FIELDS.some((f) => input[f] !== undefined);
  if (touchesRecipient) {
    const merged = {};
    for (const f of RECIPIENT_FIELDS) {
      merged[f] = input[f] !== undefined ? String(input[f] ?? '').trim() : gift[f];
    }

    const check = validateDeliveryDetails({
      name: merged.recipient_name,
      email: merged.recipient_email,
      phone: merged.recipient_phone,
      address: merged.recipient_address,
      city: merged.recipient_city,
      state: merged.recipient_state,
      requireEmail: false,
      nameLabel: 'Recipient name',
    });
    if (!check.ok) throw new GiftEditError(firstDeliveryError(check));

    if (!merged.recipient_zone) throw new GiftEditError('Delivery zone is required');
    if (
      !sameText(check.normalized.city, gift.recipient_city) ||
      !sameText(check.normalized.state, gift.recipient_state)
    ) {
      throw new GiftEditError(
        'The delivery city and state cannot be changed because the delivery fee was priced for them. ' +
          'Cancel and refund this gift and have the customer reorder.',
        409
      );
    }

    patch.recipient_name = check.normalized.name;
    patch.recipient_phone = merged.recipient_phone;
    patch.recipient_email = merged.recipient_email || null;
    patch.recipient_address = check.normalized.address;
    patch.recipient_zone = merged.recipient_zone;
  }

  // --- message / sender / occasion ---------------------------------------
  if (input.gift_message !== undefined) {
    const msg = String(input.gift_message ?? '').trim();
    if (msg.length > MAX_MESSAGE_LENGTH) {
      throw new GiftEditError(`Gift message must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
    }
    patch.gift_message = msg || null;
  }
  if (input.sender_visible !== undefined) patch.sender_visible = input.sender_visible !== false;
  if (input.occasion !== undefined) patch.occasion = String(input.occasion ?? '').trim() || null;

  // --- schedule ----------------------------------------------------------
  if (input.requested_delivery_date !== undefined) {
    const requested = String(input.requested_delivery_date || '').trim();
    if (!requested) throw new GiftEditError('requested_delivery_date cannot be empty');

    if (requested !== gift.requested_delivery_date) {
      const gfc = await loadGfcSchedulingContext(client, gift.gift_fulfilment_centre_id);
      const { data: lines, error: lineErr } = await client
        .from('gift_order_line_items')
        .select('product_id, pool_sourced_item_id')
        .eq('gift_order_id', gift.id);
      if (lineErr) throw lineErr;

      let maxLead = await maxLeadTimeForGiftLines(client, lines || [], gift.gift_fulfilment_centre_id);
      if (gift.order_kind === 'gift_custom') {
        const settings = await loadGiftCommercialSettings(client, gift.gift_fulfilment_centre_id);
        maxLead = Math.max(maxLead, Number(settings.byo_lead_time_days ?? 1));
      }

      const delivery = validateRequestedDeliveryDate({
        gfc,
        requestedDate: requested,
        maxLeadTimeDays: maxLead,
      });
      if (!delivery.valid) throw new GiftEditError(delivery.error);
      patch.requested_delivery_date = delivery.requested_delivery_date;
    }
  }
  if (input.occasion_date !== undefined) {
    const occ = validateOccasionDate(String(input.occasion_date || '').trim() || null);
    if (!occ.valid) throw new GiftEditError(occ.error);
    patch.occasion_date = occ.occasion_date;
  }

  // Only keep values that actually changed.
  const changed = Object.keys(patch).filter((k) => String(patch[k] ?? '') !== String(gift[k] ?? ''));
  if (!changed.length) throw new GiftEditError('No changes to save');
  const finalPatch = Object.fromEntries(changed.map((k) => [k, patch[k]]));

  const { error: updErr } = await client
    .from('gift_orders')
    .update({ ...finalPatch, updated_at: new Date().toISOString() })
    .eq('id', gift.id);
  if (updErr) throw updErr;

  // The linked order carries the delivery address used for dispatch.
  const orderPatch = {};
  if (finalPatch.recipient_address) orderPatch.delivery_address = finalPatch.recipient_address;
  if (finalPatch.recipient_zone) orderPatch.delivery_zone = finalPatch.recipient_zone;
  if (Object.keys(orderPatch).length) {
    const { error: orderErr } = await client.from('orders').update(orderPatch).eq('id', gift.order_id);
    if (orderErr) throw orderErr;
  }

  await client.from('gift_order_events').insert({
    gift_order_id: gift.id,
    status: gift.gift_status,
    note: `Details updated by staff: ${changed.join(', ')}`,
    actor_email: actorEmail || null,
  });

  return { changed, before: Object.fromEntries(changed.map((k) => [k, gift[k] ?? null])), after: finalPatch };
}
