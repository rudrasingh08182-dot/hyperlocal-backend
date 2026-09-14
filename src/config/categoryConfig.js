// src/config/categoryConfig.js
//
// The "brain" of the Intelligent Product Builder. Adding a new category
// later should mean adding a new entry here — NOT touching the Add/Edit
// Product UI components.
//
// Field shape: { key, label, type: 'text'|'number'|'select'|'textarea', options?, required? }
// stockMode:
//   'managed'   — plain required stock number (default for anything unlisted)
//   'optional'  — stock is optional; blank = always "In Stock" (sweets rule)
//   'variant'   — stock lives on variant combinations; base stock defaults to 0
//
// NOTE: gender/footwear_type stay as their own dedicated product columns
// (not inside `attributes`) because existing buyer-side filtering already
// depends on those exact columns — see `extraFields` below.

export const CATEGORY_CONFIG = {
  fashion: {
    label: '👕 Fashion / Clothing',
    units: ['piece', 'pair', 'set'],
    defaultReturnPolicy: 'FASHION',
    stockMode: 'variant',
    attributeFields: [
      { key: 'brand', label: 'Brand', type: 'text' },
      { key: 'material', label: 'Fabric / Material', type: 'text' },
      { key: 'pattern', label: 'Pattern', type: 'text' },
      { key: 'fit', label: 'Fit', type: 'select', options: ['Regular', 'Slim', 'Loose', 'Relaxed'] },
      { key: 'gender', label: 'Gender', type: 'select', options: ['Men', 'Women', 'Unisex', 'Kids'] },
      { key: 'sleeve_type', label: 'Sleeve Type', type: 'text' },
      { key: 'neck_type', label: 'Neck Type', type: 'text' },
      { key: 'occasion', label: 'Occasion', type: 'text' },
      { key: 'season', label: 'Season', type: 'select', options: ['Summer', 'Winter', 'All Season'] },
    ],
    variantPreset: [
      { name: 'Color', hasImages: true },
      { name: 'Size', hasImages: false },
    ],
  },

  footwear: {
    label: '👟 Footwear',
    units: ['pair', 'piece'],
    defaultReturnPolicy: 'FASHION',
    stockMode: 'variant',
    extraFields: ['gender', 'footwear_type'], // existing dedicated columns — not in attributes
    attributeFields: [
      { key: 'brand', label: 'Brand', type: 'text' },
      { key: 'material', label: 'Material', type: 'text' },
      { key: 'sole_material', label: 'Sole Material', type: 'text' },
      { key: 'closure_type', label: 'Closure Type', type: 'text' },
      { key: 'occasion', label: 'Occasion', type: 'text' },
      { key: 'pattern', label: 'Pattern', type: 'text' },
    ],
    variantPreset: [
      { name: 'Color', hasImages: true },
      { name: 'Size', hasImages: false },
    ],
  },

  electronics: {
    label: '🎧 Electronics',
    units: ['piece'],
    defaultReturnPolicy: 'STANDARD_ELECTRONICS',
    stockMode: 'managed',
    attributeFields: [{ key: 'brand', label: 'Brand', type: 'text' }],
    variantPreset: [],
    subcategories: {
      mobile: {
        label: 'Mobile Phone',
        stockMode: 'variant',
        attributeFields: [
          { key: 'brand', label: 'Brand', type: 'text' },
          { key: 'model', label: 'Model', type: 'text' },
          { key: 'processor', label: 'Processor', type: 'text' },
          { key: 'display', label: 'Display', type: 'text' },
          { key: 'battery', label: 'Battery Capacity', type: 'text' },
          { key: 'camera', label: 'Camera', type: 'text' },
          { key: 'network', label: 'Network', type: 'select', options: ['4G', '5G'] },
          { key: 'warranty', label: 'Warranty', type: 'text' },
        ],
        variantPreset: [
          { name: 'Color', hasImages: true },
          { name: 'RAM', hasImages: false },
          { name: 'Storage', hasImages: false },
        ],
      },
      tv: {
        label: 'Television',
        attributeFields: [
          { key: 'brand', label: 'Brand', type: 'text' },
          { key: 'screen_size', label: 'Screen Size (inch)', type: 'text' },
          { key: 'display_type', label: 'Display Type', type: 'text' },
          { key: 'resolution', label: 'Resolution', type: 'select', options: ['HD', 'Full HD', '4K', '8K'] },
          { key: 'smart_tv', label: 'Smart TV', type: 'select', options: ['Yes', 'No'] },
          { key: 'operating_system', label: 'Operating System', type: 'text' },
          { key: 'warranty', label: 'Warranty', type: 'text' },
        ],
        variantPreset: [],
      },
      fridge: {
        label: 'Refrigerator',
        attributeFields: [
          { key: 'brand', label: 'Brand', type: 'text' },
          { key: 'capacity', label: 'Capacity (litres)', type: 'text' },
          { key: 'type', label: 'Type', type: 'select', options: ['Single Door', 'Double Door', 'Side by Side'] },
          { key: 'energy_rating', label: 'Energy Rating', type: 'select', options: ['1 Star', '2 Star', '3 Star', '4 Star', '5 Star'] },
          { key: 'color', label: 'Colour', type: 'text' },
          { key: 'warranty', label: 'Warranty', type: 'text' },
        ],
        variantPreset: [],
      },
    },
  },

  sweets: {
    label: '🍬 Sweets & Confectionery',
    units: ['piece', 'box', 'kg', 'g', 'dozen'],
    defaultReturnPolicy: 'PACKAGED_FOOD',
    stockMode: 'optional', // ← mandatory rule: stock optional, defaults to In Stock
    attributeFields: [
      { key: 'ingredients', label: 'Ingredients', type: 'textarea' },
      { key: 'flavour', label: 'Flavour', type: 'text' },
      { key: 'box_size', label: 'Box Size', type: 'text' },
      { key: 'pieces_per_box', label: 'Pieces per Box', type: 'number' },
      { key: 'packaging_type', label: 'Packaging Type', type: 'text' },
      { key: 'shelf_life', label: 'Shelf Life', type: 'text' },
      { key: 'storage_instructions', label: 'Storage Instructions', type: 'textarea' },
      { key: 'is_veg', label: 'Vegetarian', type: 'select', options: ['Veg', 'Non-Veg'] },
    ],
    // Optional — lets a seller do "250g / 500g / 1kg" style multi-pricing
    // if they want to, without forcing it.
    variantPreset: [{ name: 'Weight', hasImages: false }],
  },

  grocery: {
    label: '🛒 Grocery',
    units: ['g', 'kg', 'ml', 'litre', 'piece', 'pack', 'packet', 'bottle', 'jar', 'box', 'dozen'],
    defaultReturnPolicy: 'GROCERY',
    stockMode: 'managed',
    attributeFields: [
      { key: 'brand', label: 'Brand', type: 'text' },
      { key: 'net_quantity', label: 'Net Quantity', type: 'text' },
      { key: 'ingredients', label: 'Ingredients', type: 'textarea' },
      { key: 'manufacturer', label: 'Manufacturer', type: 'text' },
      { key: 'country_of_origin', label: 'Country of Origin', type: 'text' },
      { key: 'expiry', label: 'Expiry / Best Before', type: 'text' },
      { key: 'storage', label: 'Storage Instructions', type: 'text' },
    ],
    variantPreset: [{ name: 'Pack Size', hasImages: false }],
  },
};

// Fallback for any category not yet given a rich definition (fresh, food,
// beauty, kids_zone) — keeps AdminAddProduct working for them without
// forcing a rebuild every time a new category is data-defined later.
export const DEFAULT_CATEGORY_CONFIG = {
  label: 'Other',
  units: ['piece'],
  defaultReturnPolicy: 'GROCERY',
  stockMode: 'managed',
  attributeFields: [{ key: 'brand', label: 'Brand', type: 'text' }],
  variantPreset: [],
  maxImages: 5,
};

// Resolves the final, flat config an item should render from — merging a
// chosen subcategory over its parent's defaults where the subcategory
// doesn't override something.
export function resolveCategoryConfig(category, subcategory) {
  const base = CATEGORY_CONFIG[category] || DEFAULT_CATEGORY_CONFIG;

  if (base.subcategories) {
    if (!subcategory) return null; // caller must ask for a subcategory first
    const sub = base.subcategories[subcategory];
    if (!sub) return null;
    return {
      label: sub.label || base.label,
      units: sub.units || base.units || ['piece'],
      defaultReturnPolicy: sub.defaultReturnPolicy || base.defaultReturnPolicy || 'STANDARD_ELECTRONICS',
      stockMode: sub.stockMode || base.stockMode || 'managed',
      attributeFields: sub.attributeFields || base.attributeFields || [],
      variantPreset: sub.variantPreset || base.variantPreset || [],
      extraFields: sub.extraFields || base.extraFields || [],
      maxImages: sub.maxImages || base.maxImages || 5,
    };
  }

  return {
    maxImages: 5,
    extraFields: [],
    ...DEFAULT_CATEGORY_CONFIG,
    ...base,
  };
}

export const CATEGORY_OPTIONS_LIST = [
  { value: 'grocery', label: '🛒 Grocery' },
  { value: 'fresh', label: '🥬 Fresh' },
  { value: 'electronics', label: '🎧 Electronics' },
  { value: 'fashion', label: '👕 Fashion' },
  { value: 'food', label: '🍔 Food' },
  { value: 'sweets', label: '🍬 Sweets & Confectionery' },
  { value: 'beauty', label: '💄 Beauty & Accessories' },
  { value: 'footwear', label: '👟 Footwear' },
  { value: 'kids_zone', label: "🧸 Kid's Zone" },
];