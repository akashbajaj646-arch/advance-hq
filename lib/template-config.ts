// Template system types and defaults

export type BlockType = 'field' | 'text' | 'image' | 'table' | 'line' | 'rectangle';

export interface TemplateBlock {
  id: string;
  type: BlockType;
  x: number;       // mm from left
  y: number;       // mm from top
  width: number;   // mm
  height: number;  // mm
  // Field block
  fieldKey?: string;
  fieldLabel?: string;
  showLabel?: boolean;
  // Text block
  content?: string;
  // Shared styling
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  textAlign?: 'left' | 'center' | 'right';
  color?: string;
  bgColor?: string;
  // Image block
  imageKey?: string; // 'logo' or custom
  // Table block
  tableColumns?: { key: string; header: string; width?: number; align?: 'left' | 'center' | 'right' }[];
  tableSource?: string; // 'order_items', 'invoice_items', etc.
  showTotals?: boolean;
  // Overflow behavior for text/field blocks
  overflow?: 'wrap' | 'shrink' | 'truncate' | 'clip';
  // Line/rectangle
  lineColor?: string;
  lineWidth?: number;
}

export interface PrintTemplate {
  id?: string;
  name: string;
  entity_type: 'order' | 'invoice' | 'pick_ticket' | 'shipment';
  page_size: 'letter' | 'a4';
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };
  blocks: TemplateBlock[];
  notes_1?: string;  // Custom note 1 (bank details, terms, etc.)
  notes_2?: string;  // Custom note 2
  is_default?: boolean;
  created_at?: string;
  updated_at?: string;
}

// Available fields per entity type
export const ENTITY_FIELDS: Record<string, { label: string; fields: { key: string; label: string; group: string }[] }> = {
  order: {
    label: 'Order',
    fields: [
      // Core
      { key: 'order_number', label: 'Order #', group: 'Core' },
      { key: 'po_number', label: 'PO Number', group: 'Core' },
      { key: 'order_date', label: 'Order Date', group: 'Core' },
      { key: 'order_status', label: 'Status', group: 'Core' },
      { key: 'order_type', label: 'Order Type', group: 'Core' },
      { key: 'season', label: 'Season', group: 'Core' },
      { key: 'division_id', label: 'Division', group: 'Core' },
      // Customer
      { key: 'customer_name', label: 'Customer Name', group: 'Customer' },
      { key: 'apparel_magic_customer_id', label: 'Customer ID', group: 'Customer' },
      { key: 'customer_po', label: 'Customer PO', group: 'Customer' },
      { key: 'credit_status', label: 'Credit Status', group: 'Customer' },
      { key: 'terms_id', label: 'Terms', group: 'Customer' },
      // Shipping
      { key: 'ship_date', label: 'Ship Date', group: 'Shipping' },
      { key: 'cancel_date', label: 'Cancel Date', group: 'Shipping' },
      { key: 'ship_to_name', label: 'Ship To Name', group: 'Shipping' },
      { key: 'ship_to_address_1', label: 'Ship To Address', group: 'Shipping' },
      { key: 'ship_to_city', label: 'Ship To City', group: 'Shipping' },
      { key: 'ship_to_state', label: 'Ship To State', group: 'Shipping' },
      { key: 'ship_to_zip', label: 'Ship To Zip', group: 'Shipping' },
      { key: 'ship_to_country', label: 'Ship To Country', group: 'Shipping' },
      { key: 'shipping_method', label: 'Shipping Method', group: 'Shipping' },
      { key: 'ship_via', label: 'Ship Via', group: 'Shipping' },
      { key: 'warehouse_id', label: 'Warehouse', group: 'Shipping' },
      // Amounts
      { key: 'total_amount', label: 'Total Amount', group: 'Amounts' },
      { key: 'subtotal', label: 'Subtotal', group: 'Amounts' },
      { key: 'discount_amount', label: 'Discount', group: 'Amounts' },
      { key: 'shipping_amount', label: 'Shipping', group: 'Amounts' },
      { key: 'tax_amount', label: 'Tax', group: 'Amounts' },
      { key: 'balance', label: 'Balance', group: 'Amounts' },
      { key: 'amount_paid', label: 'Amount Paid', group: 'Amounts' },
      // Quantities
      { key: 'qty', label: 'Total Qty', group: 'Quantities' },
      { key: 'qty_open', label: 'Qty Open', group: 'Quantities' },
      { key: 'qty_shipped', label: 'Qty Shipped', group: 'Quantities' },
      { key: 'qty_alloc', label: 'Qty Allocated', group: 'Quantities' },
      { key: 'qty_picked', label: 'Qty Picked', group: 'Quantities' },
      // Other
      { key: 'sales_rep', label: 'Sales Rep', group: 'Other' },
      { key: 'trade_show', label: 'Trade Show', group: 'Other' },
      { key: 'notes', label: 'Notes', group: 'Other' },
      { key: 'private_notes', label: 'Private Notes', group: 'Other' },
      { key: 'description_misc', label: 'Misc Description', group: 'Other' },
    ],
  },
  invoice: {
    label: 'Invoice',
    fields: [
      { key: 'invoice_number', label: 'Invoice #', group: 'Core' },
      { key: 'apparel_magic_order_id', label: 'Order #', group: 'Core' },
      { key: 'invoice_date', label: 'Invoice Date', group: 'Core' },
      { key: 'due_date', label: 'Due Date', group: 'Core' },
      { key: 'payment_status', label: 'Payment Status', group: 'Core' },
      { key: 'season', label: 'Season', group: 'Core' },
      { key: 'pick_ticket_id', label: 'Pick Ticket ID', group: 'Core' },
      // Customer
      { key: 'customer_po', label: 'Customer PO', group: 'Customer' },
      { key: 'salesperson', label: 'Salesperson', group: 'Customer' },
      { key: 'terms_id', label: 'Terms', group: 'Customer' },
      // Shipping
      { key: 'ship_to_name', label: 'Ship To Name', group: 'Shipping' },
      { key: 'address_1', label: 'Address 1', group: 'Shipping' },
      { key: 'address_2', label: 'Address 2', group: 'Shipping' },
      { key: 'city', label: 'City', group: 'Shipping' },
      { key: 'state', label: 'State', group: 'Shipping' },
      { key: 'postal_code', label: 'Postal Code', group: 'Shipping' },
      { key: 'country', label: 'Country', group: 'Shipping' },
      { key: 'ship_via', label: 'Ship Via', group: 'Shipping' },
      { key: 'tracking_number', label: 'Tracking #', group: 'Shipping' },
      { key: 'warehouse_id', label: 'Warehouse', group: 'Shipping' },
      // Amounts
      { key: 'total_amount', label: 'Total Amount', group: 'Amounts' },
      { key: 'subtotal', label: 'Subtotal', group: 'Amounts' },
      { key: 'amount_paid', label: 'Amount Paid', group: 'Amounts' },
      { key: 'balance_due', label: 'Balance Due', group: 'Amounts' },
      { key: 'discount_amount', label: 'Discount', group: 'Amounts' },
      { key: 'tax_amount', label: 'Tax', group: 'Amounts' },
      { key: 'qty', label: 'Total Qty', group: 'Amounts' },
      // Other
      { key: 'notes', label: 'Notes', group: 'Other' },
      { key: 'private_notes', label: 'Private Notes', group: 'Other' },
    ],
  },
  pick_ticket: {
    label: 'Pick Ticket',
    fields: [
      { key: 'pick_ticket_id', label: 'Pick Ticket #', group: 'Core' },
      { key: 'apparel_magic_order_id', label: 'Order #', group: 'Core' },
      { key: 'invoice_id', label: 'Invoice #', group: 'Core' },
      { key: 'pick_ticket_date', label: 'PT Date', group: 'Core' },
      { key: 'date_due', label: 'Due Date', group: 'Core' },
      { key: 'status', label: 'Status', group: 'Core' },
      { key: 'wms_status', label: 'WMS Status', group: 'Core' },
      { key: 'carton_status', label: 'Carton Status', group: 'Core' },
      { key: 'is_void', label: 'Void', group: 'Core' },
      // Customer
      { key: 'customer_name', label: 'Customer Name', group: 'Customer' },
      { key: 'account_number', label: 'Account #', group: 'Customer' },
      { key: 'customer_po', label: 'Customer PO', group: 'Customer' },
      { key: 'salesperson', label: 'Salesperson', group: 'Customer' },
      { key: 'credit_status', label: 'Credit Status', group: 'Customer' },
      // Shipping
      { key: 'ship_to_name', label: 'Ship To Name', group: 'Shipping' },
      { key: 'ship_to_address_1', label: 'Ship To Address', group: 'Shipping' },
      { key: 'ship_to_city', label: 'Ship To City', group: 'Shipping' },
      { key: 'ship_to_state', label: 'Ship To State', group: 'Shipping' },
      { key: 'ship_to_zip', label: 'Ship To Zip', group: 'Shipping' },
      { key: 'ship_via', label: 'Ship Via', group: 'Shipping' },
      { key: 'warehouse_id', label: 'Warehouse', group: 'Shipping' },
      // Amounts
      { key: 'total_amount', label: 'Total Amount', group: 'Amounts' },
      { key: 'qty', label: 'Total Qty', group: 'Amounts' },
      { key: 'qty_cartoned', label: 'Qty Cartoned', group: 'Amounts' },
      { key: 'weight', label: 'Weight', group: 'Amounts' },
      // Other
      { key: 'division_name', label: 'Division', group: 'Other' },
      { key: 'notes', label: 'Notes', group: 'Other' },
      { key: 'private_notes', label: 'Private Notes', group: 'Other' },
      { key: 'department_name', label: 'Department', group: 'Other' },
      { key: 'mark_for_store', label: 'Mark For Store', group: 'Other' },
    ],
  },
  shipment: {
    label: 'Shipment',
    fields: [
      { key: 'am_shipment_id', label: 'Shipment #', group: 'Core' },
      { key: 'shipstation_id', label: 'ShipStation ID', group: 'Core' },
      { key: 'am_invoice_id', label: 'Invoice #', group: 'Core' },
      { key: 'ship_date', label: 'Ship Date', group: 'Core' },
      { key: 'shipment_status', label: 'Status', group: 'Core' },
      // Customer
      { key: 'customer_name', label: 'Customer Name', group: 'Customer' },
      { key: 'am_customer_id', label: 'Customer ID', group: 'Customer' },
      // Shipping
      { key: 'carrier_name', label: 'Carrier', group: 'Shipping' },
      { key: 'service_name', label: 'Service', group: 'Shipping' },
      { key: 'tracking_number', label: 'Tracking #', group: 'Shipping' },
      { key: 'tracking_url', label: 'Tracking URL', group: 'Shipping' },
      { key: 'ship_to_name', label: 'Ship To Name', group: 'Shipping' },
      { key: 'ship_to_address_1', label: 'Ship To Address', group: 'Shipping' },
      { key: 'ship_to_city', label: 'Ship To City', group: 'Shipping' },
      { key: 'ship_to_state', label: 'Ship To State', group: 'Shipping' },
      { key: 'ship_to_zip', label: 'Ship To Zip', group: 'Shipping' },
      { key: 'ship_via', label: 'Ship Via', group: 'Shipping' },
      { key: 'bill_of_lading', label: 'Bill of Lading', group: 'Shipping' },
      { key: 'pro_number', label: 'PRO Number', group: 'Shipping' },
      { key: 'warehouse_id', label: 'Warehouse', group: 'Shipping' },
      // Quantities
      { key: 'qty', label: 'Qty', group: 'Quantities' },
      { key: 'qty_boxes', label: 'Boxes', group: 'Quantities' },
      { key: 'qty_pallets', label: 'Pallets', group: 'Quantities' },
      { key: 'weight', label: 'Weight', group: 'Quantities' },
      { key: 'amount_freight', label: 'Freight Amount', group: 'Quantities' },
      // Other
      { key: 'division_name', label: 'Division', group: 'Other' },
      { key: 'notes', label: 'Notes', group: 'Other' },
      { key: 'delivery_date', label: 'Delivery Date', group: 'Other' },
      { key: 'estimated_delivery_date', label: 'Est. Delivery Date', group: 'Other' },
    ],
  },
};

// Line items table columns per entity
export const TABLE_COLUMNS: Record<string, { key: string; header: string; align?: 'left' | 'center' | 'right' }[]> = {
  order_items: [
    { key: 'style_number', header: 'Style' },
    { key: 'description', header: 'Description' },
    { key: 'color', header: 'Color' },
    { key: 'size', header: 'Size' },
    { key: 'quantity_ordered', header: 'Qty Ordered', align: 'right' },
    { key: 'qty_shipped_am', header: 'Qty Shipped', align: 'right' },
    { key: 'qty_open', header: 'Qty Open', align: 'right' },
    { key: 'unit_price', header: 'Price', align: 'right' },
    { key: 'line_total', header: 'Amount', align: 'right' },
    { key: 'notes', header: 'Notes' },
    { key: 'warehouse_id', header: 'Warehouse' },
  ],
  invoice_items: [
    { key: 'style_number', header: 'Style' },
    { key: 'description', header: 'Description' },
    { key: 'attr_2', header: 'Color' },
    { key: 'size', header: 'Size' },
    { key: 'qty', header: 'Qty', align: 'right' },
    { key: 'unit_price', header: 'Price', align: 'right' },
    { key: 'amount', header: 'Amount', align: 'right' },
    { key: 'notes', header: 'Notes' },
  ],
  pick_ticket_items: [
    { key: 'style_number', header: 'Style' },
    { key: 'description', header: 'Description' },
    { key: 'attr_2', header: 'Color' },
    { key: 'size', header: 'Size' },
    { key: 'location', header: 'Location' },
    { key: 'qty', header: 'Qty', align: 'right' },
    { key: 'unit_price', header: 'Price', align: 'right' },
    { key: 'amount', header: 'Amount', align: 'right' },
    { key: 'upc', header: 'UPC' },
  ],
  shipment_boxes: [
    { key: 'box_number', header: 'Box #' },
    { key: 'tracking_number', header: 'Tracking' },
    { key: 'qty', header: 'Qty', align: 'right' },
    { key: 'weight', header: 'Weight', align: 'right' },
  ],
};

// Special blocks (logo, static elements)
export const SPECIAL_BLOCKS = [
  { type: 'image' as BlockType, label: 'Company Logo', imageKey: 'logo', width: 40, height: 16 },
  { type: 'text' as BlockType, label: 'Custom Text', content: 'Enter text here...', width: 60, height: 8 },
  { type: 'text' as BlockType, label: 'Note 1 (Bank/Terms)', content: '{{notes_1}}', width: 80, height: 20 },
  { type: 'text' as BlockType, label: 'Note 2 (Custom)', content: '{{notes_2}}', width: 80, height: 20 },
  { type: 'line' as BlockType, label: 'Horizontal Line', width: 180, height: 1 },
  { type: 'rectangle' as BlockType, label: 'Rectangle Box', width: 80, height: 30 },
];

// Default template for each entity type
function makeId(): string {
  return 'blk_' + Math.random().toString(36).slice(2, 10);
}

export function getDefaultTemplate(entityType: string): PrintTemplate {
  const fields = ENTITY_FIELDS[entityType]?.fields || [];
  const coreFields = fields.filter(f => f.group === 'Core').slice(0, 6);
  const customerFields = fields.filter(f => f.group === 'Customer').slice(0, 4);
  const shippingFields = fields.filter(f => f.group === 'Shipping').slice(0, 4);

  const tableSource = entityType === 'order' ? 'order_items'
    : entityType === 'invoice' ? 'invoice_items'
    : entityType === 'pick_ticket' ? 'pick_ticket_items'
    : 'shipment_boxes';

  const defaultTableCols = (TABLE_COLUMNS[tableSource] || []).slice(0, 7);

  const blocks: TemplateBlock[] = [
    // Logo
    { id: makeId(), type: 'image', x: 15, y: 15, width: 40, height: 16, imageKey: 'logo' },
    // Company info
    { id: makeId(), type: 'text', x: 130, y: 15, width: 65, height: 16, content: 'Advance Apparels Inc.\n180 Leuning St, South Hackensack, NJ 07606\nPhone: (201) 440-7300', fontSize: 8, textAlign: 'right', color: '#888888' },
    // Title bar
    { id: makeId(), type: 'rectangle', x: 15, y: 35, width: 180, height: 10, bgColor: '#00BCD4', lineColor: '#00BCD4' },
    { id: makeId(), type: 'text', x: 17, y: 36, width: 90, height: 8, content: entityType.replace('_', ' ').toUpperCase(), fontSize: 14, fontWeight: 'bold', color: '#FFFFFF' },
    // Document number field
    { id: makeId(), type: 'field', x: 140, y: 36, width: 53, height: 8, fieldKey: coreFields[0]?.key || 'id', fieldLabel: coreFields[0]?.label || 'ID', fontSize: 11, fontWeight: 'bold', color: '#FFFFFF', textAlign: 'right', showLabel: false },
    // Separator line
    { id: makeId(), type: 'line', x: 15, y: 48, width: 180, height: 1, lineColor: '#E0E0E0' },
  ];

  // Header fields grid
  let fieldY = 52;
  const allHeaderFields = [...coreFields.slice(1), ...customerFields, ...shippingFields];
  allHeaderFields.forEach((field, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    blocks.push({
      id: makeId(),
      type: 'field',
      x: 15 + col * 90,
      y: fieldY + row * 7,
      width: 85,
      height: 6,
      fieldKey: field.key,
      fieldLabel: field.label,
      showLabel: true,
      fontSize: 8,
    });
  });

  const tableY = fieldY + Math.ceil(allHeaderFields.length / 2) * 7 + 5;

  // Line items table
  blocks.push({
    id: makeId(),
    type: 'table',
    x: 15,
    y: tableY,
    width: 180,
    height: 60,
    tableSource,
    tableColumns: defaultTableCols,
    showTotals: true,
    fontSize: 8,
  });

  // Notes
  blocks.push({
    id: makeId(),
    type: 'text',
    x: 15,
    y: tableY + 65,
    width: 85,
    height: 20,
    content: '{{notes_1}}',
    fontSize: 8,
    color: '#666666',
  });

  blocks.push({
    id: makeId(),
    type: 'text',
    x: 105,
    y: tableY + 65,
    width: 90,
    height: 20,
    content: '{{notes_2}}',
    fontSize: 8,
    color: '#666666',
  });

  return {
    name: `Default ${ENTITY_FIELDS[entityType]?.label || entityType} Template`,
    entity_type: entityType as any,
    page_size: 'letter',
    orientation: 'portrait',
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
    blocks,
    notes_1: '',
    notes_2: '',
    is_default: true,
  };
}
