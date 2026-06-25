/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  detectItemsLayout,
  generateItemsForLayout,
  getItemsLayoutCss,
} from "./template-item-layouts";
import {
  mapItemsForTemplate,
  resolveDiscountRate,
  resolveTaxRate,
} from "./template-item-rates";

export {
  mapItemsForTemplate,
  resolveDiscountRate,
  resolveTaxRate,
  buildTemplateSender,
  buildTemplateClient,
  formatTemplateDate,
} from "./template-item-rates";

const formatMoney = (value: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: 2 });

export const TEMPLATE_COMPACT_STYLES = `
<style id="constil-template-compact">
  @page { size: A4; margin: 20mm 0mm; }

  *, *::before, *::after { box-sizing: border-box; }

  body, .main-container, #invoice {
    font-family: 'Inter', 'Segoe UI', system-ui, sans-serif !important;
    font-size: 12px !important;
    line-height: 1.45 !important;
    color: #334155 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .min-h-screen, #invoice.min-h-screen { min-height: auto !important; }

  .pdf-page-spacer {
    display: block !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
    flex-shrink: 0 !important;
  }

  .constil-items-section {
    page-break-inside: auto !important;
  }

  .constil-items-stack {
    display: flex !important;
    flex-direction: column !important;
    gap: 28px !important;
  }

  .constil-item-card,
  .invoice-item-row.constil-item-card {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }

  .doc-summary-section,
  .footer-summary,
  .flex.justify-end.mt-16,
  .flex.justify-end.mt-20 {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .doc-footer-section,
  footer {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .floating-content-card {
    margin-top: 0 !important;
    box-shadow: none !important;
    border: 1px solid #e2e8f0 !important;
    border-radius: 12px !important;
  }

  .blue-gradient-top {
    padding-bottom: 28px !important;
    border-radius: 0 0 20px 20px !important;
  }

  .pt-12 { padding-top: 1rem !important; }
  .py-10 { padding-top: 0.875rem !important; padding-bottom: 0.875rem !important; }
  .py-8 { padding-top: 0.625rem !important; padding-bottom: 0.625rem !important; }
  .px-12, .px-10 { padding-left: 1.25rem !important; padding-right: 1.25rem !important; }
  .p-12, .p-10 { padding: 1rem !important; }
  .rounded-3xl { border-radius: 14px !important; }
  .mb-12 { margin-bottom: 1rem !important; }
  .mt-20, .mt-16 { margin-top: 1.25rem !important; }
  .mt-12 { margin-top: 0.875rem !important; }
  .gap-12 { gap: 1rem !important; }
  .space-y-6 > * + * { margin-top: 0.625rem !important; }

  .text-4xl { font-size: 1.5rem !important; line-height: 1.2 !important; letter-spacing: -0.02em !important; }
  .text-3xl { font-size: 1.25rem !important; line-height: 1.25 !important; letter-spacing: -0.02em !important; }
  .text-2xl { font-size: 1.0625rem !important; line-height: 1.3 !important; }
  .text-lg { font-size: 0.875rem !important; line-height: 1.35 !important; }

  .main-container {
    width: 100% !important;
    max-width: 794px !important;
    padding: 18px 22px 24px !important;
    margin: 0 auto !important;
  }

  .blue-card, .blue-banner, .lux-header {
    padding: 22px 26px !important;
    margin: 10px 14px !important;
    border-radius: 18px !important;
  }

  .gray-info-card, .billing-container {
    padding: 16px 20px !important;
    margin: 0 14px 14px 14px !important;
    gap: 20px !important;
    border-radius: 14px !important;
  }

  .total-box, .total-due-card, .white-total-card {
    padding: 14px 18px !important;
    min-width: 180px !important;
    border-radius: 12px !important;
  }

  .logo-header { margin-bottom: 12px !important; }
  .logo-header div { font-size: 1.375rem !important; font-weight: 700 !important; }

  .value-main, .info-group .value-main { font-size: 1.375rem !important; font-weight: 700 !important; }
  .value-sub, .info-group .value-sub { font-size: 0.8125rem !important; font-weight: 600 !important; }
  .total-due-value { font-size: 1.375rem !important; font-weight: 700 !important; }
  .total-final { font-size: 1rem !important; }

  .banner-info { gap: 16px !important; }
  .info-group .label, .billing-col .label, .total-due-label {
    font-size: 9px !important;
    margin-bottom: 4px !important;
    letter-spacing: 0.08em !important;
  }

  .billing-col .details { font-size: 11px !important; line-height: 1.5 !important; }
  .billing-col .details strong { font-size: 12px !important; margin-bottom: 4px !important; }

  .footer-summary { margin-top: 14px !important; padding-right: 10px !important; }
  .summary-list { padding: 12px !important; }
  .summary-list div { font-size: 10px !important; margin-bottom: 6px !important; }

  footer, .mx-10.mt-16 { margin-top: 12px !important; }

  img[style*="max-height"] {
    max-height: 44px !important;
    width: auto !important;
    object-fit: contain !important;
  }
</style>
`;

/** Summary totals + terms & conditions (estimate/invoice templates) */
export const TEMPLATE_SUMMARY_STYLES = `
<style id="constil-template-summary">
  .footer-summary,
  .totals-section,
  .totals-minimal,
  .footer-totals,
  .totals-summarized,
  .footer-totals-minimal,
  .final-totals-area,
  .summary-flex-final,
  .totals-wrap-btm,
  .summary-container {
    margin-top: 1.5rem !important;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }

  .footer-summary {
    display: flex !important;
    justify-content: flex-end !important;
    padding-right: 0.5rem !important;
  }

  .summary-list,
  .summary-table,
  .summary-card-inner {
    min-width: 240px !important;
    max-width: 300px !important;
    background: #f8fafc !important;
    border-radius: 14px !important;
    padding: 16px 20px !important;
    border: 1px solid #f1f5f9 !important;
  }

  .summary-list > div,
  .summary-row,
  .summary-item-flex,
  .totals-row,
  .total-line,
  .total-line-sm,
  .tot-row-sm,
  .summ-line-text,
  .total-item-sm,
  .totals-minimal > div {
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    gap: 1.25rem !important;
    padding: 5px 0 !important;
    font-size: 10px !important;
    font-weight: 700 !important;
    color: #94a3b8 !important;
    text-transform: uppercase !important;
    letter-spacing: 0.05em !important;
  }

  .summary-list > div span:last-child,
  .summary-row span:last-child,
  .summary-item-flex span:last-child,
  .totals-row span:last-child,
  .total-line span:last-child,
  .total-line-sm span:last-child,
  .tot-row-sm span:last-child,
  .summ-line-text span:last-child,
  .total-item-sm span:last-child,
  .totals-minimal > div span:last-child {
    color: #0f172a !important;
    font-weight: 700 !important;
    text-transform: none !important;
    letter-spacing: 0 !important;
  }

  .summary-list .total-final,
  .totals-minimal .grand-bold,
  .footer-totals .grand-total-bold,
  .final-total-row,
  .grand-total-final-box {
    margin-top: 10px !important;
    padding-top: 10px !important;
    border-top: 1px solid #e2e8f0 !important;
  }

  .summary-list .total-final,
  .totals-minimal .grand-bold {
    font-size: 12px !important;
    color: #0f172a !important;
  }

  .summary-list .total-final span:last-child,
  .totals-minimal .grand-bold span:last-child,
  .footer-totals .grand-total-bold span:last-child,
  .final-total-row .value,
  .grand-total-final-box .amount,
  .total-item-sm.final-total-bold span:last-child {
    color: #3b82f6 !important;
    font-size: 1rem !important;
    font-weight: 900 !important;
  }

  .totals-section {
    display: flex !important;
    justify-content: flex-end !important;
  }

  .totals-blue-card {
    min-width: 260px !important;
    background: #f8fafc !important;
    border-radius: 16px !important;
    padding: 18px 22px !important;
    border: 1px solid #f1f5f9 !important;
  }

  .final-total-row {
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    gap: 1rem !important;
  }

  .final-total-row .label {
    font-size: 11px !important;
    font-weight: 800 !important;
    color: #0f172a !important;
    letter-spacing: 0.08em !important;
  }

  .footer-totals,
  .totals-summarized,
  .footer-totals-minimal,
  .final-totals-area,
  .totals-minimal,
  .totals-wrap-btm {
    display: flex !important;
    flex-direction: column !important;
    align-items: flex-end !important;
    gap: 6px !important;
  }

  .summary-flex-final {
    display: flex !important;
    justify-content: flex-end !important;
  }

  .grand-total-final-box {
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
    gap: 1rem !important;
  }

  .grand-total-final-box .label {
    font-size: 10px !important;
    font-weight: 800 !important;
    color: #94a3b8 !important;
    text-transform: uppercase !important;
  }

  .terms-box,
  .footer-terms,
  .footer-terms-box,
  .terms-conditions-wrap,
  .terms-wrap-final,
  .terms-part,
  footer.terms-box {
    margin-top: 1.5rem !important;
    padding: 16px 20px !important;
    background: #f8fafc !important;
    border-radius: 12px !important;
    border: 1px solid #f1f5f9 !important;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }

  .terms-box h6,
  .footer-terms h6,
  .footer-terms-box h6,
  .terms-conditions-wrap h6,
  .terms-wrap-final h6,
  .terms-part h6 {
    font-size: 9px !important;
    font-weight: 800 !important;
    color: #94a3b8 !important;
    text-transform: uppercase !important;
    letter-spacing: 0.1em !important;
    margin: 0 0 8px 0 !important;
  }

  .terms-box p,
  .footer-terms p,
  .footer-terms-box p,
  .terms-conditions-wrap p,
  .terms-wrap-final p,
  .terms-part p {
    font-size: 11px !important;
    line-height: 1.6 !important;
    color: #64748b !important;
    margin: 0 !important;
    white-space: pre-wrap !important;
  }

  .main-container .flex.justify-between.items-end .terms-box {
    max-width: 48% !important;
    margin-top: 0 !important;
  }
</style>
`;

function injectTemplateItemLayoutStyles(html: string, template: string): string {
  const layoutCss = getItemsLayoutCss(detectItemsLayout(template));
  if (!layoutCss || html.includes("constil-template-items")) {
    return html;
  }
  const block = `<style id="constil-template-items">${layoutCss}</style>`;
  if (html.includes("</body>")) {
    return html.replace("</body>", `${block}</body>`);
  }
  return html + block;
}

export function injectTemplateCompactStyles(html: string, template?: string): string {
  const fontLink =
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">';

  let result = html;

  if (!result.includes("constil-template-compact")) {
    if (result.includes("</head>")) {
      result = result.replace("</head>", `${fontLink}</head>`);
    } else {
      result = fontLink + result;
    }

    if (result.includes("</body>")) {
      result = result.replace("</body>", `${TEMPLATE_COMPACT_STYLES}${TEMPLATE_SUMMARY_STYLES}</body>`);
    } else {
      result = result + TEMPLATE_COMPACT_STYLES + TEMPLATE_SUMMARY_STYLES;
    }
  } else if (!result.includes("constil-template-summary")) {
    if (result.includes("</body>")) {
      result = result.replace("</body>", `${TEMPLATE_SUMMARY_STYLES}</body>`);
    } else {
      result = result + TEMPLATE_SUMMARY_STYLES;
    }
  }

  if (template) {
    result = injectTemplateItemLayoutStyles(result, template);
  }

  return result;
}

export const replacePlaceholders = (template: string, data: any): string => {
  const items = mapItemsForTemplate(data.items || [], {
    products: data.products,
    taxes: data.taxes || data.taxCatalog,
    discounts: data.discounts || data.discountCatalog,
  });
  const totals = items.reduce(
    (acc: any, item: any) => {
      const q = Number(item.quantity || 1);
      const p = parseFloat(item.price || item.unit_price || item.product?.price || "0");
      const dRate = resolveDiscountRate(item);
      const tRate = resolveTaxRate(item);

      const itemSubtotal = p * q;
      const itemDiscount = (itemSubtotal * dRate) / 100;
      const itemTaxable = itemSubtotal - itemDiscount;
      const itemTax = (itemTaxable * tRate) / 100;

      acc.subtotal += itemSubtotal;
      acc.discount += itemDiscount;
      acc.tax += itemTax;
      acc.total += itemTaxable + itemTax;
      return acc;
    },
    { subtotal: 0, discount: 0, tax: 0, total: 0 }
  );

  const subtotal = formatMoney(totals.subtotal);
  const totalDiscount = formatMoney(totals.discount);
  const totalTax = formatMoney(totals.tax);
  const totalAmount = formatMoney(totals.total);

  const fromName =
    data?.from?.register?.name ||
    data?.from?.company?.company_legal_name ||
    data?.from?.company_name ||
    data?.from?.first_name ||
    data?.from?.name ||
    "";
  const companyName =
    data?.from?.register?.company_name ||
    data?.from?.company_name ||
    data?.from?.company?.company_legal_name ||
    fromName ||
    "";
  const fromEmail = (
    data?.from?.company?.company_email ||
    data?.from?.register?.email ||
    data?.from?.email ||
    ""
  ).toLowerCase();
  const fromPhone =
    data?.from?.company?.company_phone ||
    data?.from?.register?.phone ||
    data?.from?.phone ||
    "";
  const fromAddressRaw =
    data?.from?.company?.address ||
    data?.from?.register?.address ||
    data?.from?.address ||
    "";
  const fromAddress = [fromAddressRaw, fromEmail, fromPhone].filter(Boolean).join(", ");

  const billToName = data?.billTo?.name || data?.billTo?.first_name || "";
  const billToEmail = data?.billTo?.email || "";
  const billToPhone = data?.billTo?.phone || "";
  const billToAddressRaw = data?.billTo?.address || data?.billTo?.observation || "";
  const billToAddress = [billToAddressRaw, billToEmail, billToPhone].filter(Boolean).join(", ");
  const billToNameFull = billToName || billToEmail || "";

  const docNumber = data.invoiceNumber || data.estimateNumber || "";
  const docDate = data.invoiceDate || data.estimateDate || "";

  const itemsLayout = detectItemsLayout(template);

  let htmlWithData = injectTemplateCompactStyles(template, template)
    .replace(/{{from}}/g, fromName)
    .replace(/{{fromAddress}}/g, fromAddress.replace(/, /g, "<br/>"))
    .replace(/{{companyName}}/g, companyName.replace(/, /g, "<br/>"))
    .replace(/{{billTo}}/g, billToNameFull)
    .replace(/{{billToAddress}}/g, billToAddress.replace(/, /g, "<br/>"))
    .replace(/{{shipTo}}/g, billToNameFull)
    .replace(/{{shipToAddress}}/g, billToAddress.replace(/, /g, "<br/>"))
    .replace(/{{amount}}/g, totalAmount)
    .replace(/{{totalAmount}}/g, totalAmount)
    .replace(/{{invoiceNumber}}/g, docNumber)
    .replace(/{{estimateNumber}}/g, docNumber)
    .replace(/{{invoiceDate}}/g, docDate)
    .replace(/{{estimateDate}}/g, docDate)
    .replace(/{{expirationDate}}/g, data.expirationDate || "")
    .replace(/{{terms}}/g, data.terms || "")
    .replace(/{{itemsTable}}/g, generateItemsForLayout(items, itemsLayout))
    .replace(/{{subtotal}}/g, subtotal)
    .replace(/{{totalTax}}/g, totalTax)
    .replace(/{{totalDiscount}}/g, totalDiscount);

  if (data.logo) {
    const imgTag = `<img src="${data.logo}" alt="Logo" style="max-height:44px;width:auto;object-fit:contain;">`;
    htmlWithData = htmlWithData
      .replace(/{{logo}}/g, imgTag)
      .replace(/{{companyLogo}}/g, imgTag)
      .replace(/{{logo_url}}/g, imgTag);
  } else {
    htmlWithData = htmlWithData
      .replace(/{{logo}}/g, "")
      .replace(/{{companyLogo}}/g, "")
      .replace(/{{logo_url}}/g, "");
  }

  if (data.signature) {
    const sigTag = `<img src="${data.signature}" alt="Signature" style="max-height:44px;width:auto;object-fit:contain;">`;
    htmlWithData = htmlWithData
      .replace(/{{signature}}/g, sigTag)
      .replace(/{{signature_url}}/g, sigTag)
      .replace(/{{signature_path}}/g, sigTag);
  } else {
    htmlWithData = htmlWithData
      .replace(/{{signature}}/g, "")
      .replace(/{{signature_url}}/g, "")
      .replace(/{{signature_path}}/g, "");
  }

  htmlWithData = htmlWithData
    .replace(
      /class="flex justify-end mt-16/g,
      'class="doc-summary-section flex justify-end mt-16'
    )
    .replace(
      /class="flex justify-end mt-20/g,
      'class="doc-summary-section flex justify-end mt-20'
    )
    .replace(/class="footer-summary/g, 'class="doc-summary-section footer-summary')
    .replace(
      /<div class="([^"]*\bfooter-summary[^"]*)"/g,
      '<div class="doc-summary-section $1"'
    )
    .replace(
      /class="(px-12 pb-16 pt-12 mt-12 border-t[^"]*)"/g,
      'class="doc-footer-section $1"'
    )
    .replace(
      /class="(mx-10 mt-16 pt-10 border-t[^"]*)"/g,
      'class="doc-footer-section $1"'
    )
    .replace(/class="footer-totals"/g, 'class="doc-summary-section footer-totals"')
    .replace(/class="totals-summarized"/g, 'class="doc-summary-section totals-summarized"')
    .replace(/class="footer-totals-minimal"/g, 'class="doc-summary-section footer-totals-minimal"')
    .replace(/class="final-totals-area"/g, 'class="doc-summary-section final-totals-area"')
    .replace(/class="totals-minimal"/g, 'class="doc-summary-section totals-minimal"')
    .replace(/class="totals-section"/g, 'class="doc-summary-section totals-section"')
    .replace(/class="summary-flex-final"/g, 'class="doc-summary-section summary-flex-final"')
    .replace(/class="totals-wrap-btm"/g, 'class="doc-summary-section totals-wrap-btm"')
    .replace(/class="terms-box"/g, 'class="doc-footer-section terms-box"')
    .replace(/class="footer-terms"/g, 'class="doc-footer-section footer-terms"')
    .replace(/class="footer-terms-box"/g, 'class="doc-footer-section footer-terms-box"')
    .replace(/class="terms-conditions-wrap"/g, 'class="doc-footer-section terms-conditions-wrap"')
    .replace(/class="terms-wrap-final"/g, 'class="doc-footer-section terms-wrap-final"');

  return htmlWithData;
};
