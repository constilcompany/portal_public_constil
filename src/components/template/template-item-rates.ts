/* eslint-disable @typescript-eslint/no-explicit-any */

import { getApiList } from "../../utils/api-list";

export const listFromApi = (data: any): any[] => getApiList(data);

export function isExplicitFeeDisabled(key: unknown): boolean {
  return key === false || key === "False" || String(key).toLowerCase() === "false";
}

export function isFeeSectionActive(
  showSection: Record<number, boolean> | undefined,
  index: number
): boolean {
  if (!showSection) return true;
  return !!showSection[index];
}

export function sumFeeOptionRates(options: any[] | undefined): number {
  return (options || []).reduce((sum, o) => sum + (Number(o?.rate) || 0), 0);
}

export function getItemDiscountRateFromForm(
  item: any,
  index: number,
  selectedDiscountOptions: any[][],
  showDiscountSection?: Record<number, boolean>
): number {
  if (!isFeeSectionActive(showDiscountSection, index)) return 0;
  if (isExplicitFeeDisabled(item?.discount_key)) return 0;
  return sumFeeOptionRates(selectedDiscountOptions[index]);
}

export function getItemTaxRateFromForm(
  item: any,
  index: number,
  selectedTaxOptions: any[][],
  showTaxSection?: Record<number, boolean>
): number {
  if (!isFeeSectionActive(showTaxSection, index)) return 0;
  if (isExplicitFeeDisabled(item?.tax_key)) return 0;
  return sumFeeOptionRates(selectedTaxOptions[index]);
}

export function formatFeeRate(rate: number): string {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return Number.isInteger(n) ? `${n}%` : `${n.toFixed(2)}%`;
}

export function resolveDiscountRate(item: any, discountCatalog?: any): number {
  if (isExplicitFeeDisabled(item.discount_key)) return 0;

  if (typeof item.discount === "number" && !Number.isNaN(item.discount)) {
    return item.discount > 0 ? item.discount : 0;
  }

  let fromArray = 0;
  if (Array.isArray(item.discount) && item.discount.length > 0) {
    const catalog = listFromApi(discountCatalog);
    fromArray = item.discount.reduce((sum: number, entry: any) => {
      if (entry && typeof entry === "object") {
        return (
          sum +
          (parseFloat(entry.rate) ||
            parseFloat(entry.discount?.rate) ||
            parseFloat(entry.value?.rate) ||
            0)
        );
      }
      const found = catalog.find((d) => String(d.id) === String(entry));
      return sum + (parseFloat(found?.rate) || 0);
    }, 0);
  }

  const fromNested = (
    item.estimate_item_discounts ||
    item.invoice_item_discounts ||
    []
  ).reduce(
    (sum: number, d: any) =>
      sum + (parseFloat(d.discount?.rate) || parseFloat(d.rate) || 0),
    0
  );

  return fromArray || fromNested;
}

export function resolveTaxRate(item: any, taxCatalog?: any): number {
  if (isExplicitFeeDisabled(item.tax_key)) return 0;

  if (typeof item.tax === "number" && !Number.isNaN(item.tax)) {
    return item.tax > 0 ? item.tax : 0;
  }

  let fromArray = 0;
  if (Array.isArray(item.tax) && item.tax.length > 0) {
    const catalog = listFromApi(taxCatalog);
    fromArray = item.tax.reduce((sum: number, entry: any) => {
      if (entry && typeof entry === "object") {
        return (
          sum +
          (parseFloat(entry.rate) ||
            parseFloat(entry.tax?.rate) ||
            parseFloat(entry.value?.rate) ||
            0)
        );
      }
      const found = catalog.find((t) => String(t.id) === String(entry));
      return sum + (parseFloat(found?.rate) || 0);
    }, 0);
  }

  const fromNested = (item.estimate_item_taxes || item.invoice_item_taxes || []).reduce(
    (sum: number, t: any) =>
      sum + (parseFloat(t.tax?.rate) || parseFloat(t.rate) || 0),
    0
  );

  return fromArray || fromNested;
}

export function mapItemsForTemplate(
  items: any[] = [],
  options: {
    products?: any;
    taxes?: any;
    discounts?: any;
  } = {}
): any[] {
  const products = listFromApi(options.products);
  const taxes = options.taxes;
  const discounts = options.discounts;

  return items.map((item) => {
    const productObj =
      products.find((p) => String(p.id) === String(item.product)) ||
      (typeof item.product === "object" ? item.product : null);

    const discountRate = resolveDiscountRate(item, discounts);
    const taxRate = resolveTaxRate(item, taxes);

    return {
      ...item,
      productName:
        item.productName ||
        productObj?.name ||
        item.product?.name ||
        item.item_title ||
        (typeof item.product === "string" ? item.product : "Unknown Product"),
      description:
        item.description ?? productObj?.description ?? item.product?.description ?? "",
      discount: discountRate,
      tax: taxRate,
    };
  });
}

export function buildTemplateSender(user: any) {
  if (!user) return {};
  if (user.register) return user;
  return {
    ...user,
    register: {
      name: user.first_name || user.name,
      company_name: user.company_name,
      email: user.email,
      phone: user.phone,
      address: user.company?.address || user.address,
    },
    company: user.company || {},
  };
}

export function buildTemplateClient(client: any) {
  if (!client) return {};
  return {
    ...client,
    name: client.name || client.first_name,
    email: client.email,
    phone: client.phone,
    address: client.address || client.observation,
  };
}

export function formatTemplateDate(dateStr: any) {
  if (!dateStr) return "";
  const s = String(dateStr);
  return s.includes("T") ? s.split("T")[0] : s;
}
