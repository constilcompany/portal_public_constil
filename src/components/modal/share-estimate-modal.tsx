/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from "react";
import {
  Modal,
  Box,
  IconButton,
  Grid,
  Card,
  CardMedia,
  Button,
  CircularProgress,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import {
  useGetEstimatesQuery,
  useLazyGetEstimateDetailQuery,
} from "../../services/rtkapi/invoiceApi";

// Import images
import Invoice1 from "../../assets/Invoice_1.png";
import Invoice2 from "../../assets/Invoice_2.png";
import Invoice3 from "../../assets/Invoice_3.png";
import Invoice4 from "../../assets/Invoice_4.png";
import Invoice5 from "../../assets/Invoice_5.png";
import Invoice6 from "../../assets/Invoice_6.png";
import Invoice7 from "../../assets/Invoice_7.png";
import Invoice8 from "../../assets/Invoice_8.png";

// Import templates
import template1 from "../template/invoice 2/invoice1.html?raw";
import template2 from "../template/invoice 2/invoice2.html?raw";
import template3 from "../template/invoice 2/Invoice3.html?raw";
import template4 from "../template/invoice 2/invoice4.html?raw";
import template5 from "../template/invoice 2/invoice5.html?raw";
import template6 from "../template/invoice 2/invoice6.html?raw";
import template7 from "../template/invoice 2/invoice7.html?raw";
import template8 from "../template/invoice 2/invoice8.html?raw";
import { BASED_URL } from "../../redux/createAPI";


const templates = [
  { id: 1, src: Invoice1, alt: "Estimate Template 1", html: template1 },
  { id: 2, src: Invoice2, alt: "Estimate Template 2", html: template2 },
  { id: 3, src: Invoice3, alt: "Estimate Template 3", html: template3 },
  { id: 4, src: Invoice4, alt: "Estimate Template 4", html: template4 },
  { id: 5, src: Invoice5, alt: "Estimate Template 5", html: template5 },
  { id: 6, src: Invoice6, alt: "Estimate Template 6", html: template6 },
  { id: 7, src: Invoice7, alt: "Estimate Template 7", html: template7 },
  { id: 8, src: Invoice8, alt: "Estimate Template 8", html: template8 },
];

interface TemplateSelectModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (file: File) => void;
}

const ShareEstimateModal: React.FC<TemplateSelectModalProps> = ({
  open,
  onClose,
}) => {
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null);
  const [transformedData, setTransformedData] = useState<any>(null);
  const [loadingTemplateId, setLoadingTemplateId] = useState<number | null>(
    null
  );

  const [getEstimateDetail] = useLazyGetEstimateDetailQuery();
  const { data: allestimates, isLoading } = useGetEstimatesQuery();

  // ✅ Filter only estimates with template_number
  const allTemplateEstimates =
    allestimates?.data?.filter((item: any) => item.template_number) || [];

  const availableTemplateNumbers = allTemplateEstimates.map(
    (item: any) => item.template_number
  );

  const filteredTemplates = templates.filter((t) =>
    availableTemplateNumbers.includes(t.id)
  );


  const handleViewTemplate = async (templateId: number) => {
    setLoadingTemplateId(templateId);
    try {
      // You need to decide which estimate ID you want to preview.
      // Here, just pick the first one that has this template_number.
      const selectedEstimate = allTemplateEstimates.find(
        (item: any) => item.template_number === templateId
      );
      if (!selectedEstimate) return;

      const estimateId = selectedEstimate.id;
      const result = await getEstimateDetail({ estimate_id: estimateId }).unwrap();
      const data = result.data;

      const transformed: any = {
        from: data.user?.register?.name ?? "",
        fromAddress: [
          data.user?.register?.email,
          data.user?.phone,
          data.user?.address,
          data.user?.city,
          data.user?.state,
          data.user?.zip_code,
          data.user?.country,
        ]
          .filter(Boolean)
          .join(", "),
        billTo: data.client?.name ?? "",
        billToAddress: [
          data.client?.email,
          data.client?.phone,
          data.client?.address,
          data.client?.city,
          data.client?.state,
          data.client?.zip_code,
          data.client?.country,
        ]
          .filter(Boolean)
          .join(", "),
        shipTo: data.client?.name ?? "",
        shipToAddress: [
          data.client?.email,
          data.client?.phone,
          data.client?.address,
          data.client?.city,
          data.client?.state,
          data.client?.zip_code,
          data.client?.country,
        ]
          .filter(Boolean)
          .join(", "),
        estimateNumber: data.estimate_number ?? "",
        estimateDate: data.estimate_date ?? "",
        expirationDate: data.due_date ?? "",
        terms: data.notes ?? "",
        amount: data.total_amount ?? "",
        items: data.items ?? [],
        logo: data.logo ?? "",
        signature: data.signature ?? "",
      };

      setTransformedData(transformed);
      setSelectedTemplate(templateId);
    } catch (error) {
      console.error("Failed to fetch estimate detail:", error);
    } finally {
      setLoadingTemplateId(null);
    }
  };

  const handleBack = () => {
    setSelectedTemplate(null);
    setTransformedData(null);
  };

  const replacePlaceholders = (template: string, data: any) => {
    const generateItemRows = (items: any[] = []) =>
      items
        .map((item) => {
          const quantity = item.quantity ?? 1;
          const price = parseFloat(item.product?.price ?? "0");
          const discountRate = item.discount?.[0]?.rate ?? 0;
          const taxRate = item.tax?.[0]?.rate ?? 0;
          const discount = (price * discountRate) / 100;
          const tax = (price * taxRate) / 100;
          const total = (price - discount + tax).toFixed(2);
          const name = item.product?.name || "Unnamed Item";
          const rawDescription = item.product?.description || "";
          const description = rawDescription
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

          return `
          <tr style="border-bottom:1px solid #eee;">
            <td style="padding:12px 15px; vertical-align:top;">
              <div style="font-weight:600; color:#333;">${name}</div>
              ${
                description
                  ? `<div style="color:#555; font-size:12px; margin-top:4px; line-height:1.4; white-space:pre-wrap;">${description}</div>`
                  : ""
              }
            </td>
            <td style="text-align:right; padding:12px 15px;">${quantity}</td>
            <td style="text-align:right; padding:12px 15px;">$${price.toFixed(
              2
            )}</td>
            <td style="text-align:right; padding:12px 15px;">$${discount.toFixed(
              2
            )}</td>
            <td style="text-align:right; padding:12px 15px;">$${tax.toFixed(
              2
            )}</td>
            <td style="text-align:right; padding:12px 15px;">$${total}</td>
          </tr>
        `;
        })
        .join("");

    const subtotal = data.items
      ?.reduce((sum: number, item: any) => {
        const quantity = item.quantity ?? 1;
        const unitPrice = parseFloat(item.product?.price ?? "0");
        return sum + quantity * unitPrice;
      }, 0)
      .toFixed(2);

    const totalDiscount = data.items
      ?.reduce((sum: number, item: any) => {
        const quantity = item.quantity ?? 1;
        const unitPrice = parseFloat(item.product?.price ?? "0");
        const discountRate = item.discount?.[0]?.rate ?? 0;
        return sum + (unitPrice * discountRate * quantity) / 100;
      }, 0)
      .toFixed(2);

    const totalTax = data.items
      ?.reduce((sum: number, item: any) => {
        const quantity = item.quantity ?? 1;
        const unitPrice = parseFloat(item.product?.price ?? "0");
        const taxRate = item.tax?.[0]?.rate ?? 0;
        return sum + (unitPrice * taxRate * quantity) / 100;
      }, 0)
      .toFixed(2);

    const totalAmount = (
      parseFloat(subtotal) - parseFloat(totalDiscount) + parseFloat(totalTax)
    ).toFixed(2);

    const taxRate = data.items?.[0]?.tax?.[0]?.rate ?? 0;
    const resolveUrl = (url: string) =>
      url?.startsWith("http") ? url : `${BASED_URL}${url}`;

    let htmlWithData = template
      .replace(/{{from}}/g, data.from ?? "")
      .replace(
        /{{fromAddress}}/g,
        (data.fromAddress ?? "").replace(/, /g, "<br/>")
      )
      .replace(/{{billTo}}/g, data.billTo ?? "")
      .replace(
        /{{billToAddress}}/g,
        (data.billToAddress ?? "").replace(/, /g, "<br/>")
      )
      .replace(/{{shipTo}}/g, data.shipTo ?? "")
      .replace(
        /{{shipToAddress}}/g,
        (data.shipToAddress ?? "").replace(/, /g, "<br/>")
      )
      .replace(/{{amount}}/g, totalAmount)
      .replace(/{{estimateNumber}}/g, data.estimateNumber ?? "")
      .replace(/{{estimateDate}}/g, data.estimateDate ?? "")
      .replace(/{{expirationDate}}/g, data.expirationDate ?? "")
      .replace(/{{terms}}/g, data.terms ?? "")
      .replace(/{{itemsTable}}/g, generateItemRows(data.items ?? []))
      .replace(/{{subtotal}}/g, subtotal)
      .replace(/{{taxRate}}/g, taxRate.toString())
      .replace(/{{totalTax}}/g, totalTax)
      .replace(/{{totalAmount}}/g, totalAmount)
      .replace(/{{totalDiscount}}/g, totalDiscount);

    if (data.logo)
      htmlWithData = htmlWithData.replace(
        "{{logo}}",
        `<img src="${resolveUrl(
          data.logo
        )}" alt="Logo" style="max-height:60px;">`
      );
    else htmlWithData = htmlWithData.replace("{{logo}}", "");

    if (data.signature)
      htmlWithData = htmlWithData.replace(
        "{{signature}}",
        `<img src="${resolveUrl(
          data.signature
        )}" alt="Signature" style="max-height:50px;">`
      );
    else htmlWithData = htmlWithData.replace("{{signature}}", "");

    return htmlWithData;
  };

  const renderContent = () => {
    if (selectedTemplate && transformedData) {
      const templateHtml = templates.find((t) => t.id === selectedTemplate)?.html;
      if (templateHtml) {
        const htmlWithData = replacePlaceholders(templateHtml, transformedData);
        return (
          <Box>
            <Button onClick={handleBack} variant="outlined" sx={{ mb: 2 }}>
              Back
            </Button>
            <iframe
              title={`Estimate Template ${selectedTemplate}`}
              srcDoc={htmlWithData}
              style={{ width: "100%", height: "80vh", border: "none" }}
            />
          </Box>
        );
      }
    }

    if (isLoading)
      return (
        <Box className="flex justify-center py-10">
          <CircularProgress />
        </Box>
      );

    if (!filteredTemplates.length)
      return (
        <p className="text-center text-gray-600 py-10">
          No templates found with matching template_number.
        </p>
      );

    return (
      <Grid container spacing={2}>
        {filteredTemplates.map((template) => (
          <Grid item xs={12} sm={6} md={4} key={template.id}>
            <Card>
              <CardMedia
                component="img"
                image={template.src}
                alt={template.alt}
                sx={{ height: 200, objectFit: "contain" }}
              />
              <Box sx={{ p: 2 }}>
                <Button
                  variant="contained"
                  fullWidth
                  onClick={() => handleViewTemplate(template.id)}
                  disabled={loadingTemplateId === template.id}
                >
                  {loadingTemplateId === template.id ? (
                    <CircularProgress size={20} />
                  ) : (
                    "Select"
                  )}
                </Button>
              </Box>
            </Card>
          </Grid>
        ))}
      </Grid>
    );
  };

  return (
    <Modal open={open} onClose={onClose}>
      <Box
        sx={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "90%",
          maxWidth: selectedTemplate ? 1000 : 800,
          bgcolor: "background.paper",
          boxShadow: 24,
          p: 4,
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <IconButton
          onClick={onClose}
          sx={{ position: "absolute", top: 8, right: 8 }}
        >
          <CloseIcon />
        </IconButton>
        {renderContent()}
      </Box>
    </Modal>
  );
};

export default ShareEstimateModal;
