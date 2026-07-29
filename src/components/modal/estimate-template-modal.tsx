/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from "axios";
import React, { useEffect, useState } from "react";
import { Box } from "@mui/material";
import { S3UploadService } from "../../components/data/s3-data";
import { TemplateModalShell } from "./template-modal-shell";
import { TemplatePickerGallery } from "./template-picker-gallery";
import { TemplatePreviewToolbar } from "./template-preview-toolbar";
import { useLazyGetEstimateDetailQuery, useUpdateEstimateMutation, useGetTaxesQuery, useGetDiscountsQuery } from "../../services/rtkapi/invoiceApi";
import { toast } from "react-toastify";
import {
  replacePlaceholders,
  mapItemsForTemplate,
  buildTemplateSender,
  buildTemplateClient,
  formatTemplateDate,
} from '../template/template-document-utils';
import { generatePdfFromHtml } from '../template/template-pdf-utils';

import Invoice1 from "../../assets/Invoice_1.png";
import Invoice2 from "../../assets/Invoice_2.png";
import Invoice3 from "../../assets/Invoice_3.png";
import Invoice4 from "../../assets/Invoice_4.png";
import Invoice5 from "../../assets/Invoice_5.png";
import Invoice6 from "../../assets/Invoice_6.png";
import Invoice7 from "../../assets/Invoice_7.png";
import Invoice8 from "../../assets/Invoice_8.png";
import Invoice9 from '../../assets/Invoice_9.png';

import template1 from "../template/estimate 2/template1.html?raw";
import template2 from "../template/estimate 2/template2.html?raw";
import template3 from "../template/estimate 2/template3.html?raw";
import template4 from "../template/estimate 2/template4.html?raw";
import template5 from "../template/estimate 2/template5.html?raw";
import template6 from "../template/estimate 2/template6.html?raw";
import template7 from "../template/estimate 2/template7.html?raw";
import template8 from "../template/estimate 2/template8.html?raw";
import template9 from "../template/estimate 2/template9.html?raw";
import templatePremium from '../template/invoice 2/invoice_premium.html?raw';

const templates = [
  { id: 1, src: Invoice1, alt: "Estimate Template 1", html: template1 },
  { id: 2, src: Invoice2, alt: "Estimate Template 2", html: template2 },
  { id: 3, src: Invoice3, alt: "Estimate Template 3", html: template3 },
  { id: 4, src: Invoice4, alt: "Estimate Template 4", html: template4 },
  { id: 5, src: Invoice5, alt: "Estimate Template 5", html: template5 },
  { id: 6, src: Invoice6, alt: "Estimate Template 6", html: template6 },
  { id: 7, src: Invoice7, alt: "Estimate Template 7", html: template7 },
  { id: 8, src: Invoice8, alt: "Estimate Template 8", html: template8 },
  { id: 9, src: Invoice9, alt: 'Estimate Template 9', html: template9 },
  { id: 10, src: Invoice1, alt: 'Premium Paybue Template', html: templatePremium },
];

interface EstimateTemplateModalProps {
  open: boolean;
  onClose: () => void;
  estimateId: string;
  templateNumber?: number;
}

const EstimateTemplateModal: React.FC<EstimateTemplateModalProps> = ({
  open,
  onClose,
  estimateId,
  templateNumber,
}) => {
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null);
  const [transformedData, setTransformedData] = useState<any>(null);
  const [loadingTemplateId, setLoadingTemplateId] = useState<number | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  const [getEstimateDetail] = useLazyGetEstimateDetailQuery();
  const [updateEstimate] = useUpdateEstimateMutation();
  const { data: globalTaxes } = useGetTaxesQuery();
  const { data: globalDiscounts } = useGetDiscountsQuery();

  const handleViewTemplate = async (templateId: number) => {
    setLoadingTemplateId(templateId);
    try {
      const result = await getEstimateDetail({ estimate_id: estimateId }).unwrap();
      const data = result.data || result;
      console.log(data, "datadata")
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


      const rawItems = data?.estimate_items || data?.invoice_items || [];
      const mappedItems = mapItemsForTemplate(rawItems, {
        taxes: globalTaxes,
        discounts: globalDiscounts,
      });

      const transformed: any = {
        from: buildTemplateSender(data?.user || {}),
        billTo: buildTemplateClient(data?.clients || data?.client || {}),
        estimateNumber: data?.estimate_number ?? "",
        invoiceNumber: data?.estimate_number ?? "",
        estimateDate: formatTemplateDate(data?.estimate_date ?? ""),
        invoiceDate: formatTemplateDate(data?.estimate_date ?? ""),
        expirationDate: formatTemplateDate(data?.valid_until ?? data?.due_date ?? ""),
        terms: data?.notes ?? "",
        amount: String(data?.total || data?.total_amount || data?.amount || "0"),
        items: mappedItems,
        taxes: globalTaxes,
        discounts: globalDiscounts,
        logo: logoUrl,
        signature: signatureUrl,
        clientId: data?.client_id || data?.client?.id || data?.clients?.id || (Array.isArray(data?.clients) ? data?.clients[0]?.id : data?.clients?.id),
      };

      setTransformedData(transformed);
      setSelectedTemplate(templateId);
    } catch (error) {
      console.error("Failed to fetch estimate detail:", error);
    } finally {
      setLoadingTemplateId(null);
    }
  };

  // ✅ Auto-select when templateNumber provided
  useEffect(() => {
    if (open && templateNumber && estimateId && !selectedTemplate) {
      handleViewTemplate(templateNumber);
    }
  }, [open, templateNumber, estimateId]);

  const filteredTemplates = templates;

  const handleBack = () => {
    setSelectedTemplate(null);
    setTransformedData(null);
  };

  const [isDownloading, setIsDownloading] = useState(false);

  const downloadPDF = async () => {
    if (!transformedData || !selectedTemplate) return;
    setIsDownloading(true);

    try {
      const templateHtml = templates.find((t) => t.id === selectedTemplate)?.html;
      if (!templateHtml) return;

      const finalHTML = replacePlaceholders(templateHtml, transformedData);
      const { pdf, cleanup } = await generatePdfFromHtml(finalHTML);
      try {
        pdf.save(`estimate_${transformedData.estimateNumber || "EST-0001"}.pdf`);
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
    console.log("[EstimateModal] Attempting to send email for Estimate:", estimateId, "Client:", transformedData?.clientId);
    if (!transformedData || !selectedTemplate) return;
    
        const foundClientId = transformedData?.client_id || transformedData?.clientId || transformedData?.client?.id || transformedData?.clients?.id;
    if (!foundClientId) {
      console.log("[EstimateModal] ERROR: No Client ID found in data keys:", Object.keys(transformedData || {}));
      toast.error("Recipient client not found. Please ensure the estimate has an assigned client.");
      return;
    }
    
    setIsSendingEmail(true);
    let removePdfIframe: (() => void) | undefined;

    try {
      const templateHtml = templates.find((t) => t.id === selectedTemplate)?.html;
      if (!templateHtml) throw new Error("Template not found");

      const finalHTML = replacePlaceholders(templateHtml, transformedData);
      const { blob: pdfBlob, cleanup } = await generatePdfFromHtml(finalHTML);
      removePdfIframe = cleanup;
      const pdfFile = new File([pdfBlob], `estimate_${transformedData.estimateNumber}.pdf`, { type: 'application/pdf' });

      // 2. Upload to S3
      const s3Path = await S3UploadService.uploadFileInChunks(pdfFile, undefined, 'paybue-invoice-estimation/estimates');
      const publicUrl = S3UploadService.getPublicUrl(s3Path, 'paybue-invoice-estimation/estimates');

      // 3. Update Estimate document_url and nylas_grant_id
      await updateEstimate({
        estimate_id: estimateId,
        body: { 
          document_url: publicUrl,
          template_number: selectedTemplate,
          nylas_grant_id: localStorage.getItem("nylas_grant_id"),
          status: 'sent'
        }
      }).unwrap();

      // 4. Send Email
      
      const emailPayload = {
        estimate_id: estimateId,
        template_id: selectedTemplate,
        pdf_url: s3Path,
        clients: [transformedData.clientId]
      };
      console.log("[EstimateModal] Sending Email via Axios:", emailPayload);
      await axios.post(`${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/template/send-estimate`, emailPayload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("access_token")}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
        }
      });

      toast.success("Email sent successfully!");
    } catch (err: any) {
      console.error("Failed to send email:", err);
      toast.error(err?.data?.error || err?.message || "Failed to send email");
    } finally {
      removePdfIframe?.();
      setIsSendingEmail(false);
    }
  };

  const renderContent = () => {
    if (selectedTemplate && transformedData) {
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
        const htmlWithData = replacePlaceholders(templateHtml, transformedData).replace(
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
              documentLabel="Estimate"
            />
            <div className="rounded-xl border border-gray-200 overflow-hidden bg-gray-50">
              <iframe
                title={`Estimate Template ${selectedTemplate}`}
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
        templates={filteredTemplates}
        documentLabel="Estimate"
        loadingTemplateId={loadingTemplateId}
        currentTemplateId={templateNumber ?? null}
        onSelect={handleViewTemplate}
      />
    );
  };

  const isPreview = Boolean(selectedTemplate && transformedData);

  return (
    <TemplateModalShell
      open={open}
      onClose={onClose}
      title={isPreview ? `Estimate preview — Template ${selectedTemplate}` : "Estimate templates"}
      subtitle={
        isPreview
          ? "Download or email this document, or go back to pick another layout."
          : "Select a professional layout for your estimate."
      }
      isPreview={isPreview}
    >
      {renderContent()}
    </TemplateModalShell>
  );
};

export default EstimateTemplateModal;
