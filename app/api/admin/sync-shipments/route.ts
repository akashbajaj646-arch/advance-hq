import { NextResponse } from 'next/server';

export const maxDuration = 300;
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const APPARELMAGIC_API_TOKEN = process.env.APPARELMAGIC_TOKEN || '';
const BASE_URL = process.env.NEXT_PUBLIC_APPARELMAGIC_URL || 'https://advanceapparels.app.apparelmagic.com/api/json';
const SHIPSTATION_API_KEY = process.env.SHIPSTATION_API_KEY || '';
const SHIPSTATION_API_SECRET = process.env.SHIPSTATION_API_SECRET || '';

function getAuthParams() {
  const time = Math.floor(Date.now() / 1000).toString();
  return { time, token: APPARELMAGIC_API_TOKEN };
}

function toNum(val: any): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function toBool(val: any): boolean {
  return val === '1' || val === 1 || val === true;
}

function parseDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
  }
  return dateStr;
}

// ── ApparelMagic Shipments ──

async function fetchAllAMShipments() {
  let all: any[] = [];
  let lastId: string | null = null;
  let pageCount = 0;
  const maxPages = 200;

  console.log('Fetching shipments from ApparelMagic...');

  while (pageCount < maxPages) {
    const auth = getAuthParams();
    const params = new URLSearchParams({
      time: auth.time,
      token: auth.token,
      'pagination[page_size]': '200'
    });

    if (lastId) params.append('pagination[last_id]', lastId);

    const url = `${BASE_URL}/shipments?${params.toString()}`;
    const response = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'AdvanceHQ/1.0' } });

    if (!response.ok) throw new Error(`AM HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.response && Array.isArray(data.response)) {
      all = all.concat(data.response);
      console.log(`  Page ${pageCount + 1}: ${data.response.length} AM shipments (Total: ${all.length})`);
    }

    if (data.meta?.pagination?.last_id) {
      lastId = String(data.meta.pagination.last_id);
      pageCount++;
    } else {
      break;
    }
  }

  return all;
}

// ── ShipStation Shipments ──

async function fetchShipStationShipments() {
  let all: any[] = [];
  let page = 1;
  const maxPages = 50;

  if (!SHIPSTATION_API_KEY || !SHIPSTATION_API_SECRET) {
    console.log('ShipStation credentials not configured, skipping...');
    return all;
  }

  console.log('Fetching shipments from ShipStation...');
  const authHeader = 'Basic ' + Buffer.from(`${SHIPSTATION_API_KEY}:${SHIPSTATION_API_SECRET}`).toString('base64');

  while (page <= maxPages) {
    const url = `https://ssapi.shipstation.com/shipments?pageSize=500&page=${page}&sortBy=ShipDate&sortDir=DESC`;

    const response = await fetch(url, {
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      console.error(`ShipStation error: ${response.status}`);
      break;
    }

    const data = await response.json();
    if (data.shipments && data.shipments.length > 0) {
      all = all.concat(data.shipments);
      console.log(`  Page ${page}: ${data.shipments.length} SS shipments (Total: ${all.length})`);
    }

    if (data.pages && page < data.pages) {
      page++;
    } else {
      break;
    }
  }

  return all;
}

export async function POST(request: Request) {
  const startTime = Date.now();

  const { data: syncLog } = await supabase
    .from('sync_log')
    .insert({ sync_type: 'shipments', source: 'apparel_magic', status: 'started' })
    .select().single();

  try {
    console.log('🔄 Starting FULL shipment sync...');

    let amCreated = 0, amUpdated = 0, amBoxes = 0, amBoxItems = 0;
    let ssCreated = 0, ssUpdated = 0;
    let errors = 0;

    // ── Sync AM Shipments ──
    const amShipments = await fetchAllAMShipments();
    console.log(`✅ Fetched ${amShipments.length} AM shipments`);

    for (const ship of amShipments) {
      try {
        const shipData: Record<string, any> = {
          am_shipment_id: ship.id,
          am_customer_id: ship.customer_id || null,
          am_invoice_id: ship.invoice_id || null,
          selected_pick_ticket_ids: ship.selected_pick_ticket_ids || null,
          customer_name: ship.customer_name || null,

          ship_date: parseDate(ship.date) || ship.date_internal || null,
          date_shipped: ship.date_shipped || null,
          date_scheduled_delivery: ship.date_scheduled_delivery || null,

          tracking_number: ship.tracking_number || null,
          bill_of_lading: ship.bill_of_lading || null,
          shipping_approval_number: ship.shipping_approval_number || null,
          itn: ship.itn || null,
          ship_via: ship.ship_via || null,
          pro_number: ship.pro_number || null,

          // Ship-to
          ship_to_name: ship.name || ship.customer_name || null,
          ship_to_address_1: ship.address_1 || null,
          ship_to_address_2: ship.address_2 || null,
          ship_to_city: ship.city || null,
          ship_to_state: ship.state || null,
          ship_to_zip: ship.postal_code || null,
          ship_to_country: ship.country || null,
          ship_to_id: ship.ship_to_id || null,
          shipping_terms_id: ship.shipping_terms_id || null,
          warehouse_id: ship.warehouse_id || null,

          // Quantities / weights
          qty: toNum(ship.qty) || 0,
          qty_boxes: ship.qty_boxes || null,
          qty_pallets: ship.qty_pallets || '0',
          weight: toNum(ship.weight) || 0,
          weight_oz: null,

          // Freight
          amount_freight: toNum(ship.amount_freight) || 0,
          foreign_amount_freight: toNum(ship.foreign_amount_freight) || 0,
          freight_taxable: ship.freight_taxable || '0',
          shipment_cost: toNum(ship.amount_freight) || 0,

          // Currency
          currency_id: ship.currency_id || null,
          currency_rate: toNum(ship.currency_rate) || 1,
          currency_name: ship.currency_name || null,

          // Flags
          void: toBool(ship.void),
          is_locked: toBool(ship.is_locked),
          shipment_status: toBool(ship.void) ? 'voided' : 'shipped',
          notes: ship.notes || null,
          division_name: ship.division_name || null,
          print_url: ship.print_url || null,

          // ShipStation
          shipstation_id: ship.shipstation_id || null,
          shipstation_synced: ship.shipstation_synced || '0',
          shipstation_connection_id: ship.shipstation_connection_id || null,

          // Audit
          am_creation_time: ship.creation_time || null,
          am_creation_user_id: ship.creation_user_id || null,
          am_creation_user_name: ship.creation_user_name || null,
          am_last_modified_time: ship.last_modified_time || null,
          am_last_modified_command: ship.last_modified_command || null,
          am_last_modified_user_id: ship.last_modified_user_id || null,
          am_last_modified_user_name: ship.last_modified_user_name || null,

          last_synced_at: new Date().toISOString()
        };

        const { data: existing } = await supabase
          .from('shipments')
          .select('id')
          .eq('am_shipment_id', ship.id)
          .single();

        if (existing) {
          await supabase.from('shipments').update(shipData).eq('am_shipment_id', ship.id);
          amUpdated++;
        } else {
          await supabase.from('shipments').insert(shipData);
          amCreated++;
        }

        // Sync boxes
        if (ship.boxes && Array.isArray(ship.boxes) && ship.boxes.length > 0) {
          await supabase.from('shipment_box_items').delete().eq('am_box_id', ship.boxes.map((b: any) => b.id));
          await supabase.from('shipment_boxes').delete().eq('am_shipment_id', ship.id);

          for (const box of ship.boxes) {
            await supabase.from('shipment_boxes').insert({
              am_box_id: box.id,
              am_shipment_id: ship.id,
              box_number: box.box_number || null,
              qty: toNum(box.qty) || 0,
              ucc: box.ucc || null,
              weight: toNum(box.weight) || 0,
              tare_weight: toNum(box.tare_weight) || 0,
              weight_actual: toNum(box.weight_actual),
              length: toNum(box.length) || 0,
              width: toNum(box.width) || 0,
              height: toNum(box.height) || 0,
              sealed: box.sealed || '0',
              tracking_number: box.tracking_number || null,
              pallet_id: box.pallet_id || null,
              last_synced_at: new Date().toISOString()
            });
            amBoxes++;

            // Sync box items
            if (box.box_items && Array.isArray(box.box_items)) {
              for (const bi of box.box_items) {
                await supabase.from('shipment_box_items').insert({
                  am_item_id: bi.id || null,
                  box_id: null,
                  am_box_id: box.id,
                  pick_ticket_item_id: bi.pick_ticket_item_id || null,
                  pick_ticket_id: bi.pick_ticket_id || null,
                  invoice_id: bi.invoice_id || null,
                  order_id: bi.order_id || null,
                  product_id: bi.product_id || null,
                  sku_id: bi.sku_id || null,
                  style_number: bi.style_number || null,
                  description: bi.description || null,
                  attr_2: bi.attr_2 || null,
                  attr_3: bi.attr_3 || null,
                  size: bi.size || null,
                  upc: bi.upc || null,
                  qty: toNum(bi.qty) || 0,
                  weight: toNum(bi.weight) || 0,
                  retailer_sku: bi.retailer_sku || null,
                  edi_reference: bi.edi_reference || null,
                  mark_for_store: bi.mark_for_store || null,
                  group_number: bi.group_number || null,
                  last_synced_at: new Date().toISOString()
                });
                amBoxItems++;
              }
            }
          }
        }

        // Sync pallets
        if (ship.pallets && Array.isArray(ship.pallets) && ship.pallets.length > 0) {
          await supabase.from('shipment_pallets').delete().eq('am_shipment_id', ship.id);
          for (const pallet of ship.pallets) {
            await supabase.from('shipment_pallets').insert({
              am_pallet_id: pallet.id || null,
              am_shipment_id: ship.id,
              pallet_number: pallet.pallet_number || null,
              weight: toNum(pallet.weight) || 0,
              tare_weight: toNum(pallet.tare_weight) || 0,
              length: toNum(pallet.length) || 0,
              width: toNum(pallet.width) || 0,
              height: toNum(pallet.height) || 0,
              tracking_number: pallet.tracking_number || null,
              last_synced_at: new Date().toISOString()
            });
          }
        }

        if ((amCreated + amUpdated) % 100 === 0) {
          console.log(`AM Progress: ${amCreated + amUpdated}/${amShipments.length}, Boxes: ${amBoxes}, Box Items: ${amBoxItems}`);
        }

      } catch (err) {
        console.error(`Error syncing AM shipment ${ship.id}:`, err);
        errors++;
      }
    }

    // ── Sync ShipStation Shipments ──
    const ssShipments = await fetchShipStationShipments();
    console.log(`✅ Fetched ${ssShipments.length} ShipStation shipments`);

    for (const ss of ssShipments) {
      try {
        const ssData: Record<string, any> = {
          shipstation_id: String(ss.shipmentId),
          shipstation_order_id: String(ss.orderId),
          tracking_number: ss.trackingNumber || null,
          carrier_code: ss.carrierCode || null,
          carrier_name: ss.carrierCode || null,
          service_code: ss.serviceCode || null,
          shipment_status: 'shipped',
          ship_date: ss.shipDate || null,
          delivery_date: ss.deliveryDate || null,
          weight_oz: ss.weight?.value || null,
          dimensions_length: ss.dimensions?.length || null,
          dimensions_width: ss.dimensions?.width || null,
          dimensions_height: ss.dimensions?.height || null,
          shipment_cost: toNum(ss.shipmentCost) || 0,
          insurance_cost: toNum(ss.insuranceCost) || 0,
          ship_to_name: ss.shipTo?.name || null,
          ship_to_city: ss.shipTo?.city || null,
          ship_to_state: ss.shipTo?.state || null,
          ship_to_zip: ss.shipTo?.postalCode || null,
          ship_to_country: ss.shipTo?.country || null,
          ship_to_address_1: ss.shipTo?.street1 || null,
          ship_to_address_2: ss.shipTo?.street2 || null,
          tracking_url: ss.trackingNumber
            ? `https://www.google.com/search?q=${ss.trackingNumber}`
            : null,
          last_synced_at: new Date().toISOString()
        };

        // Try to link to pick ticket
        if (ss.orderNumber) {
          ssData.pick_ticket_id = ss.orderNumber;
        }

        const { data: existing } = await supabase
          .from('shipments')
          .select('id')
          .eq('shipstation_id', String(ss.shipmentId))
          .single();

        if (existing) {
          await supabase.from('shipments').update(ssData).eq('shipstation_id', String(ss.shipmentId));
          ssUpdated++;
        } else {
          await supabase.from('shipments').insert(ssData);
          ssCreated++;
        }

      } catch (err) {
        console.error(`Error syncing SS shipment ${ss.shipmentId}:`, err);
        errors++;
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'completed',
        records_processed: amShipments.length + ssShipments.length,
        records_created: amCreated + ssCreated,
        records_updated: amUpdated + ssUpdated,
        errors,
        completed_at: new Date().toISOString(),
        duration_seconds: duration
      }).eq('id', syncLog.id);
    }

    console.log(`✅ Shipment sync complete!`);
    console.log(`  AM: ${amCreated} created, ${amUpdated} updated, ${amBoxes} boxes, ${amBoxItems} box items`);
    console.log(`  SS: ${ssCreated} created, ${ssUpdated} updated`);
    console.log(`  Errors: ${errors}, Duration: ${duration}s`);

    return NextResponse.json({
      success: true,
      stats: {
        apparel_magic: { total: amShipments.length, created: amCreated, updated: amUpdated, boxes: amBoxes, box_items: amBoxItems },
        shipstation: { total: ssShipments.length, created: ssCreated, updated: ssUpdated },
        errors,
        duration: `${duration}s`
      }
    });

  } catch (error) {
    console.error('Shipment sync error:', error);
    if (syncLog) {
      await supabase.from('sync_log').update({
        status: 'failed',
        error_details: { message: error instanceof Error ? error.message : 'Unknown error' },
        completed_at: new Date().toISOString()
      }).eq('id', syncLog.id);
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
