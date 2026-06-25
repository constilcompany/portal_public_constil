/* eslint-disable @typescript-eslint/no-explicit-any */

import { resolveDiscountRate, resolveTaxRate, formatFeeRate } from "./template-item-rates";

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const formatMoney = (value: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: 2 });

export type ItemsLayoutType =
  | "stacked-area"
  | "stacked-box2"
  | "stacked-3"
  | "stacked-4"
  | "stacked-5"
  | "stacked-6"
  | "stacked-7"
  | "stacked-8"
  | "stacked-9"
  | "tailwind-grid"
  | "template5-card";

type ItemLabels = {
  item: string;
  qty: string;
  price: string;
  disc: string;
  tax: string;
  total: string;
};

const DEFAULT_LABELS: ItemLabels = {
  item: "Item / Description",
  qty: "Qty",
  price: "Price",
  disc: "Disc.",
  tax: "Tax",
  total: "Total",
};

const NINE_LABELS: ItemLabels = {
  item: "Item / Description",
  qty: "Qty/PCS",
  price: "Price",
  disc: "Disc.",
  tax: "Tax",
  total: "Total",
};

/** Stacked scope card with aligned header + meta bar */
export const CSS_STACKED_ITEMS = `
        .constil-items-section {
            width: 100% !important;
        }
        .constil-items-header {
            display: grid !important;
            grid-template-columns: minmax(0, 1fr) 9% 13% 9% 9% 14% !important;
            gap: 6px !important;
            align-items: center !important;
            padding: 10px 16px !important;
            background: #f8fafc !important;
            border: none !important;
            border-radius: 0 !important;
            font-size: 9px !important;
            font-weight: 800 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.08em !important;
            color: #94a3b8 !important;
        }
        .constil-items-header .h-item {
            text-align: left !important;
        }
        .constil-items-header .h-qty,
        .constil-items-header .h-price,
        .constil-items-header .h-disc,
        .constil-items-header .h-tax {
            text-align: center !important;
        }
        .constil-items-header .h-total {
            text-align: right !important;
        }
        .constil-items-stack {
            display: flex !important;
            flex-direction: column !important;
            gap: 0 !important;
            width: 100% !important;
            border: none !important;
            border-radius: 0 !important;
            overflow: visible !important;
        }
        .constil-item-card,
        .invoice-item-row.constil-item-card {
            padding: 16px 16px 14px !important;
            border: none !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
        }
        .constil-item-card:last-child {
            border: none !important;
        }
        .constil-item-title {
            font-size: 14px !important;
            font-weight: 700 !important;
            color: #0f172a !important;
            margin: 0 0 8px 0 !important;
            line-height: 1.35 !important;
        }
        .constil-item-desc {
            font-size: 11px !important;
            line-height: 1.55 !important;
            color: #475569 !important;
            margin: 0 0 12px 0 !important;
            white-space: pre-wrap !important;
        }
        .constil-item-meta-bar {
            display: grid !important;
            grid-template-columns: minmax(0, 1fr) 9% 13% 9% 9% 14% !important;
            gap: 6px !important;
            align-items: center !important;
            background: #f1f5f9 !important;
            border-radius: 8px !important;
            padding: 10px 12px !important;
            margin-top: 2px !important;
            font-size: 12px !important;
            font-weight: 600 !important;
            color: #0f172a !important;
        }
        .constil-item-meta-bar .meta-spacer {
            display: block !important;
        }
        .constil-item-meta-bar .meta-qty,
        .constil-item-meta-bar .meta-price,
        .constil-item-meta-bar .meta-disc,
        .constil-item-meta-bar .meta-tax {
            text-align: center !important;
        }
        .constil-item-meta-bar .meta-total {
            text-align: right !important;
            font-weight: 700 !important;
        }
        div:has(.constil-items-section) > .grid.grid-cols-12,
        div:has(> .constil-items-section) > .grid.grid-cols-12,
        .table-header {
            display: none !important;
        }
`;

/** @deprecated Mantido para scripts; usar CSS_STACKED_ITEMS */
export const CSS_ITEMS_TABLE = CSS_STACKED_ITEMS;
export const CSS_STACKED_ITEMS_AREA = CSS_STACKED_ITEMS;
export const CSS_STACKED_ITEMS_BOX2 = CSS_STACKED_ITEMS;
export const CSS_STACKED_ITEMS_3 = CSS_STACKED_ITEMS;
export const CSS_STACKED_ITEMS_4 = CSS_STACKED_ITEMS;
export const CSS_STACKED_ITEMS_5 = CSS_STACKED_ITEMS;
export const CSS_STACKED_ITEMS_6 = CSS_STACKED_ITEMS;
export const CSS_STACKED_ITEMS_7 = CSS_STACKED_ITEMS;
export const CSS_STACKED_ITEMS_8 = CSS_STACKED_ITEMS;
export const CSS_STACKED_ITEMS_9 = CSS_STACKED_ITEMS;
export const CSS_TEMPLATE5_ITEMS = CSS_STACKED_ITEMS;

export function buildStackedItemCss(): string {
  return CSS_STACKED_ITEMS;
}

export function detectItemsLayout(template: string): ItemsLayoutType {
  if (template.includes("items-9-list-area")) return "stacked-9";
  if (template.includes("items-8-body-list")) return "stacked-8";
  if (template.includes("items-7-content")) return "stacked-7";
  if (template.includes("items-6-box")) return "stacked-6";
  if (template.includes("items-5-list")) return "stacked-5";
  if (template.includes("items-4-body")) return "stacked-4";
  if (template.includes("items-3-grid")) return "stacked-3";
  if (template.includes("items-area-box-2")) return "stacked-box2";
  if (
    template.includes("item-desc-main") ||
    (template.includes("item-meta-grid") && template.includes("content-area"))
  ) {
    return "template5-card";
  }
  if (
    template.includes("grid-cols-12") &&
    (template.includes("col-span-4") || template.includes("Item Details")) &&
    (template.includes("space-y-1") ||
      template.includes("space-y-2") ||
      template.includes("space-y-4") ||
      template.includes("divide-y"))
  ) {
    return "tailwind-grid";
  }
  if (template.includes("items-area")) return "stacked-area";
  return "stacked-area";
}

export function getItemsLayoutCss(_layout: ItemsLayoutType): string {
  return CSS_STACKED_ITEMS;
}

function buildItemsHeader(labels: ItemLabels): string {
  return `
    <div class="constil-items-header">
      <span class="h-item">${labels.item}</span>
      <span class="h-qty">${labels.qty}</span>
      <span class="h-price">${labels.price}</span>
      <span class="h-disc">${labels.disc}</span>
      <span class="h-tax">${labels.tax}</span>
      <span class="h-total">${labels.total}</span>
    </div>`;
}

function buildStackedCard(
  name: string,
  description: string,
  quantity: number,
  price: number,
  discountRate: number,
  taxRate: number,
  total: number
): string {
  const disc = formatFeeRate(discountRate);
  const tax = formatFeeRate(taxRate);

  return `
    <div class="constil-item-card invoice-item-row">
      <h4 class="constil-item-title">${escapeHtml(name)}</h4>
      ${description ? `<p class="constil-item-desc">${description}</p>` : ""}
      <div class="constil-item-meta-bar">
        <span class="meta-spacer" aria-hidden="true"></span>
        <span class="meta-qty">${quantity}</span>
        <span class="meta-price">$${formatMoney(price)}</span>
        <span class="meta-disc">${disc}</span>
        <span class="meta-tax">${tax}</span>
        <span class="meta-total">$${formatMoney(total)}</span>
      </div>
    </div>`;
}

function resolveItemFields(item: any) {
  const quantity = Number(item.quantity || 1);
  const price = parseFloat(item.price || item.unit_price || item.product?.price || "0");
  const discountRate = resolveDiscountRate(item);
  const taxRate = resolveTaxRate(item);

  const subtotal = price * quantity;
  const discountAmount = (subtotal * discountRate) / 100;
  const taxableAmount = subtotal - discountAmount;
  const taxAmount = (taxableAmount * taxRate) / 100;
  const total = taxableAmount + taxAmount;

  const name =
    item.productName ||
    item.product?.name ||
    item.name ||
    item.item_title ||
    "Unnamed Item";
  const description = escapeHtml(item.description || item.product?.description || "");

  return { quantity, price, discountRate, taxRate, total, name, description };
}

function generateStackedItems(items: any[], labels: ItemLabels): string {
  const header = buildItemsHeader(labels);
  const cards = items
    .map((item) => {
      const f = resolveItemFields(item);
      return buildStackedCard(
        f.name,
        f.description,
        f.quantity,
        f.price,
        f.discountRate,
        f.taxRate,
        f.total
      );
    })
    .join("");

  return `
    <div class="constil-items-section">
      ${header}
      <div class="constil-items-stack">${cards}</div>
    </div>`;
}

export function generateItemsForLayout(
  items: any[] = [],
  layout: ItemsLayoutType
): string {
  const labels = layout === "stacked-9" ? NINE_LABELS : DEFAULT_LABELS;
  return generateStackedItems(items, labels);
}
