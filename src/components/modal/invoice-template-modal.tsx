/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { templates, replacePlaceholders } from "./modal-invoices";
import { generatePdfFromHtml } from "../template/template-pdf-utils";
import axios from "axios";
import React, { useEffect, useState } from "react";
import { Box } from "@mui/material";
import { useLazyGetInvoiceDetailQuery, useSendInvoiceEmailMutation, useUpdateInvoiceMutation, useGetTaxesQuery, useGetDiscountsQuery } from "../../services/rtkapi/invoiceApi";
import { TemplateModalShell } from "./template-modal-shell";
import { TemplatePickerGallery } from "./template-picker-gallery";
import { TemplatePreviewToolbar } from "./template-preview-toolbar";
import { toast } from "react-toastify";
import { InvoiceData } from "../../types/invoice";
import { S3UploadService } from "../data/s3-data";
import { getApiList } from "../../utils/api-list";

import logoImage from '../template/invoice 3/assets/CONSTIL.svg'
import logoWhite from '../template/invoice 3/assets/CONSTILWHite.svg'
import Invoice8 from "../../assets/Invoice_8.png";
import Invoice9 from '../../assets/Invoice_9.png';


const formatTemplateDate = (dateStr: any) => {
  if (!dateStr) return "";
  const s = String(dateStr);
  return s.includes("T") ? s.split("T")[0] : s;
};

const InvoiceTemplateModal: React.FC<InvoiceTemplateModalProps> = ({
  open,
  onClose,
  invoiceId,
  templateNumber,
}) => {
  const { data: globalTaxes } = useGetTaxesQuery();
  const { data: globalDiscounts } = useGetDiscountsQuery();
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null);
  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null);
  const [loadingTemplateId, setLoadingTemplateId] = useState<number | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  const [getInvoiceDetail] = useLazyGetInvoiceDetailQuery();
  const [sendInvoiceEmail] = useSendInvoiceEmailMutation();
  const [updateInvoice] = useUpdateInvoiceMutation();
  const handleView = async (templateId: number) => {
    setLoadingTemplateId(templateId);
    try {
      const result = await getInvoiceDetail({ invoice_id: invoiceId }).unwrap();
      const data = result.data || result; console.log("[InvoiceModal] Raw Data:", data);
                        // AGGRESSIVE SEARCH for logo and signature
      const logoSource = data?.logo_url || data?.logo || data?.company_logo || 
                        data?.company?.logo_url || data?.company_profile?.logo_url || 
                        data?.user?.company?.logo_url || data?.user?.company_profile?.logo_url || 
                        data?.user?.logo_url || "";
                        
      const signatureSource = data?.signature_url || data?.signature || 
                             data?.user?.signature_url || data?.user?.signature || 
                             data?.user?.signature_path || "";
      
      console.log("[InvoiceModal] Detected Sources - Logo:", logoSource, "Signature:", signatureSource);
      
      const logoUrl = await S3UploadService.getFileAsBase64(logoSource, 'paybue-invoice-estimation/logos');
      const signatureUrl = await S3UploadService.getFileAsBase64(signatureSource, 'paybue-invoice-estimation/signatures');
      
      console.log("[InvoiceModal] Resolved Base64 - Logo:", logoUrl ? "FOUND" : "MISSING", "Signature:", signatureUrl ? "FOUND" : "MISSING");


            const transformedData: any = {
        id: data?.id || invoiceId,
        client_id: data?.client_id || data?.client?.id || data?.clients?.id || "",
        clientId: data?.client_id || data?.client?.id || data?.clients?.id || "",
        from: {
            ...data?.user,
            register: {
                name: data?.user?.first_name,
                company_name: data?.user?.company_name,
                email: data?.user?.email,
                phone: data?.user?.phone,
                address: data?.user?.company?.address || data?.user?.address
            }
        },
        billTo: {
            name: data?.clients?.name || data?.client?.name,
            email: data?.clients?.email || data?.client?.email,
            phone: data?.clients?.phone || data?.client?.phone,
            address: data?.clients?.address || data?.client?.address
        },
        invoiceNumber: data?.invoice_number ?? data?.estimate_number ?? "",
        invoiceDate: formatTemplateDate(data?.invoice_date ?? data?.estimate_date ?? ""),
        expirationDate: formatTemplateDate(data?.due_date ?? data?.valid_until ?? ""),
        terms: data?.notes ?? "",
        items: (data?.invoice_items || data?.estimate_items || []).map((it: any) => {
          // Resolve taxes from array of IDs or single value
          let resolvedTax = 0;
          if (Array.isArray(it.tax)) {
            resolvedTax = it.tax.reduce((sum: number, id: string) => {
              const taxObj = getApiList(globalTaxes).find((t: any) => String(t.id) === String(id));
              return sum + (taxObj?.rate || 0);
            }, 0);
          } else {
            resolvedTax = it.tax || 0;
          }

          // Resolve discounts from array of IDs or single value
          let resolvedDiscount = 0;
          if (Array.isArray(it.discount)) {
            resolvedDiscount = it.discount.reduce((sum: number, id: string) => {
              const discObj = getApiList(globalDiscounts).find((d: any) => String(d.id) === String(id));
              return sum + (discObj?.rate || 0);
            }, 0);
          } else {
            resolvedDiscount = it.discount || 0;
          }

          return {
            ...it,
            productName: it.product?.name || it.item_title || "Unnamed Item",
            tax: resolvedTax || it.invoice_item_taxes?.reduce((sum: number, t: any) => sum + (t.tax?.rate || 0), 0) || 0,
            discount: resolvedDiscount || it.invoice_item_discounts?.reduce((sum: number, d: any) => sum + (d.discount?.rate || 0), 0) || 0,
          };
        }),
        logo: logoUrl,
        signature: signatureUrl,
        templateId: templateId
      };

      console.log("[InvoiceModal] Transformed Data ClientID:", transformedData.clientId);
      setInvoiceData(transformedData);
      setSelectedTemplate(templateId);
    } catch (error) {
      console.error("Failed to fetch invoice detail:", error);
    } finally {
      setLoadingTemplateId(null);
    }
  };

  const [isDownloading, setIsDownloading] = useState(false);
  const downloadPDF = async () => {
    if (!invoiceData || !selectedTemplate) return;
    setIsDownloading(true);

    try {
      const templateHtml = templates.find((t) => t.id === selectedTemplate)?.html;
      if (!templateHtml) return;

      const finalHTML = replacePlaceholders(templateHtml, invoiceData);
      const { pdf, cleanup } = await generatePdfFromHtml(finalHTML);
      try {
        pdf.save(`invoice_${invoiceData.invoiceNumber || "INV-0001"}.pdf`);
        return pdf;
      } finally {
        cleanup();
      }
    } catch (err) {
      console.error("[PDF] Generation failed:", err);
      return null;
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSendEmail = async () => {
    console.log("[InvoiceModal] Attempting to send email for Invoice:", invoiceId, "Client:", (invoiceData?.client_id || invoiceData?.clientId || invoiceData?.client?.id || invoiceData?.clients?.id), "Full Data:", invoiceData);
    if (!invoiceData || !selectedTemplate) return;

    
    const foundClientId = invoiceData?.client_id || invoiceData?.clientId || invoiceData?.client?.id || invoiceData?.clients?.id || invoiceData?.client?.client_id;
    console.log("[InvoiceModal] Searching for Client ID. Found:", foundClientId);
    
    if (!foundClientId) {
      console.log("[InvoiceModal] ERROR: No Client ID found in data keys:", Object.keys(invoiceData || {}));
      toast.error("Recipient client not found. Please ensure the invoice has an assigned client.");
      return;
    }
    

    setIsSendingEmail(true);
    let removePdfIframe: (() => void) | undefined;

    try {
      const templateHtml = templates.find((t) => t.id === selectedTemplate)?.html;
      if (!templateHtml) throw new Error("Template not found");

      const finalHTML = replacePlaceholders(templateHtml, invoiceData);
      const { blob: pdfBlob, cleanup } = await generatePdfFromHtml(finalHTML);
      removePdfIframe = cleanup;
      const pdfFile = new File([pdfBlob], `invoice_${invoiceData.invoiceNumber}.pdf`, { type: 'application/pdf' });

      // 2. Upload to S3
      const s3Path = await S3UploadService.uploadFileInChunks(pdfFile, undefined, 'paybue-invoice-estimation/invoices');
      const publicUrl = S3UploadService.getPublicUrl(s3Path, 'paybue-invoice-estimation/invoices');

      // 3. Update Invoice document_url
      await updateInvoice({
        invoice_id: invoiceId,
        body: { 
          document_url: publicUrl,
          template_number: selectedTemplate
        }
      }).unwrap();

      // 4. Send Email
      await sendInvoiceEmail({
        invoice_id: invoiceId,
        clients: [invoiceData.clientId]
      }).unwrap();

      toast.success("Email sent successfully!");
    } catch (err: any) {
      console.error("Failed to send email:", err);
      toast.error(err?.data?.error || err?.message || "Failed to send email");
    } finally {
      removePdfIframe?.();
      setIsSendingEmail(false);
    }
  };

  const handleBack = () => {
    setSelectedTemplate(null);
    setInvoiceData(null);
  };

  useEffect(() => {
    if (open && templateNumber && invoiceId && !selectedTemplate) {
      handleView(templateNumber);
    }
  }, [open, templateNumber, invoiceId]);

  const renderContent = () => {
    if (selectedTemplate && invoiceData) {
      const templateHtml = templates.find((t) => t.id === selectedTemplate)?.html;
      if (templateHtml) {
        // Force standard colors and disable oklch features in Tailwind
        const safetyStyles = `
          <script>
            window.tailwind.config = {
              corePlugins: {
                preflight: true,
              },
              theme: {
                extend: {
                  colors: {
                    // Standard palette to avoid oklch
                  }
                }
              }
            };
          </script>
          <style>
             *, ::before, ::after { 
               --tw-ring-color: rgba(59, 130, 246, 0.5) !important;
               --tw-border-opacity: 1 !important;
               --tw-bg-opacity: 1 !important;
               --tw-text-opacity: 1 !important;
             }
          </style>
        `;
        const htmlWithData = replacePlaceholders(templateHtml, invoiceData).replace(
          "</body>",
          `${safetyStyles}</body>`
        );
        
        return (
          <Box>
            <TemplatePreviewToolbar
              onBack={handleBack}
              onDownload={downloadPDF}
              onSendEmail={handleSendEmail}
              isDownloading={isDownloading}
              isSendingEmail={isSendingEmail}
              documentLabel="Invoice"
            />
            <div className="rounded-xl border border-gray-200 overflow-hidden bg-gray-50">
              <iframe
                title={`Invoice Template ${selectedTemplate}`}
                srcDoc={htmlWithData}
                style={{ width: "100%", height: "min(75vh, 720px)", border: "none", display: "block" }}
              />
            </div>
          </Box>
        );
      }
    }

    return (
      <TemplatePickerGallery
        templates={templates}
        documentLabel="Invoice"
        loadingTemplateId={loadingTemplateId}
        currentTemplateId={templateNumber ?? null}
        onSelect={handleView}
      />
    );
  };


  // 🔸 otherwise, show template list as before


  const isPreview = Boolean(selectedTemplate && invoiceData);

  return (
    <TemplateModalShell
      open={open}
      onClose={onClose}
      title={isPreview ? `Invoice preview — Template ${selectedTemplate}` : "Invoice templates"}
      subtitle={
        isPreview
          ? "Download or email this document, or go back to pick another layout."
          : "Select a professional layout for your invoice."
      }
      isPreview={isPreview}
    >
      {renderContent()}
    </TemplateModalShell>
  );
};

export default InvoiceTemplateModal;

