/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { getApiList, toFeeSelectOptions } from "../../utils/api-list";
import { feeSelectPortalProps } from "../../utils/fee-select-props";
import {
  getItemDiscountRateFromForm,
  getItemTaxRateFromForm,
} from "../template/template-item-rates";
import {
  useCreateDiscountMutation,
  useGetClientsQuery,
  useGetDiscountsQuery,
  useGetProductsQuery,
  useGetTaxesQuery,
  useCreateTaxMutation,
  useGetInvoicesQuery,
  useGetInvoiceDetailQuery,
  useUpdateInvoiceMutation,
  useSendInvoiceEmailMutation,
  useGetUserProfileQuery,
  useGetCompanyQuery,
} from "../../services/rtkapi/invoiceApi";
import { useCreateInvoiceMutation } from "../../services/rtkapi/invoiceApi";
import { useGetProductByIdQuery } from "../../services/rtkapi/productApi";
import FormNewClienteModal from "../formnewclient/form-new-client";
import FormNewProductModal from "../formnewproduct/new-proct-form";
import { CarTaxiFront, CircleDashed } from "lucide-react";
import Spinner from "../spinner";
import Select from "react-select";
import { Cancel } from "@mui/icons-material";
import { toast } from "react-toastify";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import SelectTemplate, { templates, replacePlaceholders } from "../modal/modal-invoices";
import { clearSelectedTemplate } from "../../redux/templateSlice";
import { AppDispatch, RootState } from "../../redux/store";
import axios from "axios";
import { saveAs } from 'file-saver';
import { S3UploadService } from "../../components/data/s3-data";
import { generatePdfFromHtml } from "../template/template-pdf-utils";

interface FormInvoiceProps {
  onClose: () => void;
}

const FormInvoice = ({ onClose }: FormInvoiceProps) => {
  /** ---------------- API HOOKS ---------------- */
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const urlId = searchParams.get('id');
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();

  // Robust ID detection from URL first, then multiple possible state keys, then localStorage as absolute fallback
  const isNew = location.pathname.includes('/new') && !urlId;
  const rawId = isNew ? "" : (urlId || location?.state?.invoiceId || location?.state?.id || location?.state?.invoice_id || localStorage.getItem('last_edit_invoice_id') || "");
  const invoiceid = String(rawId).trim();

  console.log("[FormInvoice] Detected ID Source:", { 
    urlId, 
    stateId: location?.state?.invoiceId || location?.state?.id, 
    localId: localStorage.getItem('last_edit_invoice_id'),
    finalId: invoiceid,
    skip: !invoiceid
  });

  const { data: invoiceData, isLoading: isFetchingInvoice, error: queryError } = useGetInvoiceDetailQuery(
    { invoice_id: invoiceid },
    { skip: !invoiceid }
  );

  if (queryError) console.error("[FormInvoice] Query Error:", queryError);
  if (invoiceData) console.log("[FormInvoice] Raw Query Result:", invoiceData);

  const { data: clients, isLoading: loadingClients } = useGetClientsQuery();
  const { data: products, isLoading: loadingProducts } = useGetProductsQuery();
  const { data: discountsResponse } = useGetDiscountsQuery();
  const { data: taxesResponse } = useGetTaxesQuery();
  const [createInvoice, { isLoading: isCreatingInvoice }] = useCreateInvoiceMutation();
  const [sendInvoiceEmail] = useSendInvoiceEmailMutation();
  const [updateInvoice, { isLoading: isUpdating }] = useUpdateInvoiceMutation();
  const { refetch } = useGetInvoicesQuery();
  const { data: getCurrentUser } = useGetUserProfileQuery();
  const { data: companyProfileResponse } = useGetCompanyQuery();

  /** ---------------- LOCAL STATE ---------------- */
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [invoiceDue, setInvoiceDue] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("0");
  const [notes, setNotes] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [selectedproduct, setSelectedproduct] = useState<string | null>(null);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);

  const [openClientModal, setOpenClientModal] = useState(false);
  const [isProductModalOpen, setProductModalOpen] = useState(false);

  /** ---------------- RTK QUERY HOOKS (Extra) ---------------- */
  const [createDiscount] = useCreateDiscountMutation();
  const [createTax] = useCreateTaxMutation();
  const { data: productData } = useGetProductByIdQuery(selectedproduct!, {
    skip: !selectedproduct,
  });

  const selectedTemplate = useSelector((state: RootState) => state.template.selectedTemplate);

  /** ---------------- DISCOUNT / TAX STATES ---------------- */
  const [discountOptions, setDiscountOptions] = useState<any[]>([]);
  const [selectedDiscountOptions, setSelectedDiscountOptions] = useState<any[][]>([[]]);
  const [openDiscountForms, setOpenDiscountForms] = useState<number[]>([]);
  const [discountDate, setDiscountDate] = useState<{ [key: number]: { discountName: string; discountRate: number } }>({});
  const [isAddingDiscount, setIsAddingDiscount] = useState<boolean[]>([]);
  const [showDiscountSection, setShowDiscountSection] = useState<{ [key: number]: boolean }>({});

  const [taxOptions, setTaxOptions] = useState<any[]>([]);
  const [selectedTaxOptions, setSelectedTaxOptions] = useState<any[][]>([[]]);
  const [openTaxForms, setOpenTaxForms] = useState<number[]>([]);
  const [taxDate, setTaxDate] = useState<{ [key: number]: { taxName: string; taxRate: number } }>({});
  const [isAddingTax, setIsAddingTax] = useState<boolean[]>([]);
  const [showTaxSection, setShowTaxSection] = useState<{ [key: number]: boolean }>({});

  /** ---------------- ITEMS STATE ---------------- */
  const [items, setItems] = useState<any[]>([
    {
      product: "",
      client: "",
      description: "",
      quantity: 1,
      price: 0,
      amount: 0,
      tax_key: false,
      discount_key: false,
      tax: "",
      discount: ""
    },
  ]);

  // Detect update mode
  const isUpdateMode = Boolean(invoiceid);

  useEffect(() => {
    console.log("[FormInvoice] Component mounted. Items count:", items.length);
  }, []);

  /** ---------------- INITIAL DATA ---------------- */
  useEffect(() => {
    // Generate random number ONLY for new invoices
    if (!invoiceid) {
       const randomNum = Math.floor(1000 + Math.random() * 9000);
       setInvoiceNumber(`INV-${randomNum}`);
    }
  }, [invoiceid]);

  useEffect(() => {
    const today = new Date();
    const formattedDate = today.toISOString().split("T")[0];
    setInvoiceDate((prev) => prev || formattedDate);
    setInvoiceDue((prev) => prev || formattedDate);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: "logo" | "signature") => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (type === "logo") {
      setLogoFile(file);
      setLogoPreview(null);
    }
    if (type === "signature") {
      setSignatureFile(file);
      setSignaturePreview(null);
    }
  };

  /** ---------------- PREFILL (UPDATE MODE) ---------------- */
  useEffect(() => {
    // 1. Handle Reset/Random Number for New Invoices
    // Only run if we are NOT in update mode. 
    // We remove the reset-to-default logic from here because it's already 
    // handled by the initial state of the component. 
    // Running it here on every dependency change (like new discount/tax) was causing the "refresh" effect.
    if (!invoiceid) return;

    // 2. Handle Prefill (Update Mode)
    const d = invoiceData;
    
    if (!d || Object.keys(d).length === 0) return;

    const cleanDate = (iso: any) => {
      if (!iso) return "";
      const s = String(iso);
      return s.includes("T") ? s.split("T")[0] : s;
    };

    if (d.invoice_number) setInvoiceNumber(d.invoice_number);
    if (d.invoice_date) setInvoiceDate(cleanDate(d.invoice_date));
    if (d.due_date) setInvoiceDue(cleanDate(d.due_date));
    
    // Map Client ID
    const cid = d.client_id || (typeof d?.clients === "object" ? d?.clients?.id : d?.clients);
    if (cid) setSelectedClient(String(cid));

    // Assets
    if (d.logo_url) setLogoPreview(d.logo_url);
    if (d.signature_url) setSignaturePreview(d.signature_url);

    // Items
    const rawItems = d.invoice_items || d.items;
    if (Array.isArray(rawItems)) {
      const mapped = rawItems.map((it: any) => {
        const taxEnabled =
          it.tax_key === "True" ||
          it.tax_key === true ||
          String(it.tax_key).toLowerCase() === "true";
        const discountEnabled =
          it.discount_key === "True" ||
          it.discount_key === true ||
          String(it.discount_key).toLowerCase() === "true";

        const taxIds = taxEnabled
          ? Array.isArray(it.invoice_item_taxes)
            ? it.invoice_item_taxes.map((t: any) => t.tax_id || t.id)
            : Array.isArray(it.tax)
              ? it.tax
              : []
          : [];

        const discountIds = discountEnabled
          ? Array.isArray(it.invoice_item_discounts)
            ? it.invoice_item_discounts.map((dis: any) => dis.discount_id || dis.id)
            : Array.isArray(it.discount)
              ? it.discount
              : []
          : [];

        return {
          id: it.id ?? null, 
          product: it.product_id || it.product?.id || it.product || "",
          description: it.description ?? "",
          quantity: Math.max(1, Number(it.quantity ?? 1) || 1),
          price: Number(it.price || it.unit_price || 0),
          amount: Number((it.quantity ?? 1) * (it.price || it.unit_price || 0)),
          tax_key: it.tax_key === "True" || it.tax_key === true || String(it.tax_key).toLowerCase() === "true",
          discount_key: it.discount_key === "True" || it.discount_key === true || String(it.discount_key).toLowerCase() === "true",
          tax: taxIds,
          discount: discountIds,
        };
      });
      setItems(mapped);

      // Build selected options
      const mappedSelectedTaxOptions = mapped.map((it: any) => {
        if (!it.tax || !Array.isArray(it.tax) || it.tax.length === 0) return [];
        return it.tax.map((tId: any) => {
          const found = getApiList(taxesResponse).find((t: any) => String(t.id) === String(tId));
          if (found) return { id: found.id, value: found.id, label: `${found.name} (${found.rate}%)`, rate: found.rate, name: found.name };
          return { id: tId, value: tId, label: String(tId), rate: 0, name: String(tId) };
        });
      });

      const mappedSelectedDiscountOptions = mapped.map((it: any) => {
        if (!it.discount || !Array.isArray(it.discount) || it.discount.length === 0) return [];
        return it.discount.map((dId: any) => {
          const found = getApiList(discountsResponse).find((d: any) => String(d.id) === String(dId));
          if (found) return { id: found.id, value: found.id, label: `${found.name} (${found.rate}%)`, rate: found.rate, name: found.name };
          return { id: dId, value: dId, label: String(dId), rate: 0, name: String(dId) };
        });
      });

      setSelectedTaxOptions(mappedSelectedTaxOptions);
      setSelectedDiscountOptions(mappedSelectedDiscountOptions);

      const newShowTax: { [key: number]: boolean } = {};
      const newShowDiscount: { [key: number]: boolean } = {};
      mapped.forEach((it: any, idx: number) => {
        newShowTax[idx] = !!it.tax_key;
        newShowDiscount[idx] = !!it.discount_key;
      });
      setShowTaxSection(newShowTax);
      setShowDiscountSection(newShowDiscount);
    }
  }, [invoiceData, discountsResponse, taxesResponse]);

  const [packages, setPackages] = useState<any[]>([]);
  useEffect(() => {
    const fetchWallet = () => {
      axios
        .get(`${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/wallet`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('access_token')}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
          },
        })
        .then((res) => setPackages(res?.data?.wallet || {}))
        .catch((err) => console.log(err));
    };

    fetchWallet();

    const interval = setInterval(fetchWallet, 5000);

    return () => clearInterval(interval);
  }, []);
  console.log(packages, "packages")
  const handleSubmitInvoice = async (confirmedTemplateId?: number, downloadChecked = false, emailChecked = false) => {
    // Robust detection using the correctly resolved invoiceid from the component
    const isActuallyEditing = Boolean(invoiceid);

    if (!selectedClient || items.length === 0) {
      toast.error("Please select client and add at least one item");
      return;
    }

    if (items.some((item) => !item.quantity || Number(item.quantity) < 1)) {
      toast.error("Quantity must be at least 1 for all items.");
      return;
    }

    const templateToUse = confirmedTemplateId || selectedTemplate;

    // if creating new invoice (double checked), ensure user picks template first
    if (!isActuallyEditing && !templateToUse) {
      setModalOpen(true);
      return; 
    }

    const formattedItems = items.map((item, index) => {
      const newItem: any = {
        product: item.product,
        description: item.description,
        quantity: Number(item.quantity),
        price: Number(item.price),
        tax_key: item.tax_key ? "True" : "False",
        discount_key: item.discount_key ? "True" : "False",
      };

      if (item.tax_key && selectedTaxOptions[index]?.length > 0) {
        newItem.tax = selectedTaxOptions[index].map((t: any) => t.id ?? t.value);
      } else if (item.tax && Array.isArray(item.tax)) {
        newItem.tax = item.tax;
      }

      if (item.discount_key && selectedDiscountOptions[index]?.length > 0) {
        newItem.discount = selectedDiscountOptions[index].map((d: any) => d.id ?? d.value);
      } else if (item.discount && Array.isArray(item.discount)) {
        newItem.discount = item.discount;
      }

      return newItem;
    });

    try {
      if (!isActuallyEditing) {
        console.log("[Create] Starting create flow...");
        let finalLogo = null;
        let finalSignature = null;
        if (logoFile) finalLogo = await S3UploadService.uploadFileInChunks(logoFile, undefined, 'paybue-invoice-estimation/logos');
        // fallbacks to existing string if editing or picking from gallery
        if (signatureFile) finalSignature = await S3UploadService.uploadFileInChunks(signatureFile, undefined, 'paybue-invoice-estimation/signatures');

        const decodedToken = JSON.parse(atob((localStorage.getItem('access_token') || '').split('.')[1]));

        const invoicePayload = {
          user_id: decodedToken.sub,
          client_id: selectedClient,
          payment_terms: Number(paymentTerms),
          notes: notes,
          invoice_number: invoiceNumber || undefined,
          invoice_date: invoiceDate || undefined,
          due_date: invoiceDue || undefined,
          logo_url: finalLogo || logoPreview || null,
          signature_url: finalSignature || signaturePreview || null,
          
          template_number: templateToUse,
          total: grandTotal,
          
        };

        const createRes = await createInvoice(invoicePayload).unwrap();
        console.log("[Create] Invoice basic row created:", createRes);
        
        // Handle both single object, array of objects, or wrapped data
        const invoice_id = 
          createRes?.id || 
          (Array.isArray(createRes) ? createRes[0]?.id : null) || 
          createRes?.data?.id || 
          (Array.isArray(createRes?.data) ? createRes?.data[0]?.id : null);

        if (!invoice_id) {
            console.error("[Create] Failed to extract invoice_id from response:", createRes);
            throw new Error("Invoice created but ID not returned from server");
        }

        if (invoice_id) {
            console.log("[Create] Inserting items for invoice:", invoice_id);
            for (const it of formattedItems) {
                const itemPayload = {
                    invoice_id: invoice_id,
                    product_id: it.product,
                    client_id: selectedClient,
                    description: it.description,
                    quantity: it.quantity,
                    price: it.price,
                    tax_key: String(it.tax_key).toLowerCase() === 'true',
                    discount_key: String(it.discount_key).toLowerCase() === 'true',
                    tax: it.tax || [],
                    discount: it.discount || []
                };
                
                await axios.post(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/invoice_items`, itemPayload, {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('access_token')}`,
                        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
                    }
                });
            }
        }

        // Consume credit
        await axios.post(
          `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/consume-credit`,
          { action_type: "invoice" },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("access_token")}`,
              'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
            },
          }
        );

        // Generate and Update PDF
        setIsGeneratingPDF(true);
        try {
          await generateAndUpdatePDF(invoice_id, templateToUse, downloadChecked, emailChecked);
        } finally {
          setIsGeneratingPDF(false);
        }

        toast.success("Invoice created successfully!");
        finalizeSubmission();

      } else {
        console.log("[Update] Starting update flow for ID:", invoiceid);
        let finalLogo = null;
        let finalSignature = null;
        if (logoFile) finalLogo = await S3UploadService.uploadFileInChunks(logoFile, undefined, 'paybue-invoice-estimation/logos');
        // fallbacks to existing string if editing or picking from gallery
        if (signatureFile) finalSignature = await S3UploadService.uploadFileInChunks(signatureFile, undefined, 'paybue-invoice-estimation/signatures');

        const decodedToken = JSON.parse(atob((localStorage.getItem('access_token') || '').split('.')[1]));

        const invoicePayload: any = {
          user_id: decodedToken.sub,
          client_id: selectedClient,
          payment_terms: Number(paymentTerms),
          notes: notes,
          invoice_number: invoiceNumber || undefined,
          invoice_date: invoiceDate || undefined,
          due_date: invoiceDue || undefined,
          total: grandTotal,
          
        };

        if (finalLogo) invoicePayload.logo_url = finalLogo;
        else if (logoPreview) invoicePayload.logo_url = logoPreview;
        
        if (finalSignature) invoicePayload.signature_url = finalSignature;
        else if (signaturePreview) invoicePayload.signature_url = signaturePreview;

        await updateInvoice({ invoice_id: invoiceid, body: invoicePayload }).unwrap();
        console.log("[Update] Success patching main record.");

        // Scrub old items from DB cleanly via axios
        await axios.delete(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/invoice_items?invoice_id=eq.${invoiceid}`, {
            headers: {
                Authorization: `Bearer ${localStorage.getItem('access_token')}`,
                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
            }
        });

        // Insert fresh items natively
        console.log("[Update] Re-inserting fresh items...");
        for (const it of formattedItems) {
          const itemPayload = {
              invoice_id: invoiceid,
              product_id: it.product,
              client_id: selectedClient,
              description: it.description,
              quantity: it.quantity,
              price: it.price,
              tax_key: String(it.tax_key).toLowerCase() === 'true',
              discount_key: String(it.discount_key).toLowerCase() === 'true',
              tax: it.tax || [],
              discount: it.discount || []
          };
          
          await axios.post(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/invoice_items`, itemPayload, {
              headers: {
                  Authorization: `Bearer ${localStorage.getItem('access_token')}`,
                  apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
              }
          });
        }

        // Generate and Update PDF (Ensure changes reflect in the PDF)
        const currentTemplate = templateToUse || invoiceData?.data?.data?.template_id || invoiceData?.data?.data?.template_number || 1;
        console.log("[Update] Generating PDF with template:", currentTemplate);
        setIsGeneratingPDF(true);
        try {
          await generateAndUpdatePDF(invoiceid, currentTemplate, downloadChecked, emailChecked);
        } finally {
          setIsGeneratingPDF(false);
        }

        toast.success("Invoice updated successfully!");
        finalizeSubmission();
      }
    } catch (err: any) {
      console.error("[Submit] Global error:", err);
      toast.error(err?.data?.message || err?.data?.error || "Failed to submit invoice");
    }
  };

  /** Generate PDF using the same proven approach as the invoice view modal */
  const generateAndUpdatePDF = async (
    invoice_id: string,
    templateId: number,
    download: boolean,
    sendEmail: boolean
  ) => {
    try {
      console.log("[PDF] Starting for invoice:", invoice_id, "template:", templateId);
      const templateObj = templates.find((t) => t.id === templateId) || templates[0];
      const selectedClientObj = clients?.data?.find((c: any) => String(c.id) === String(selectedClient));

      const mappedItems = items.map((item, index) => {
        const productObj = products?.data?.find((p: any) => p.id === item.product);
        return {
          ...item,
          productName: productObj?.name || "Unknown Product",
          discount: getItemDiscountRateFromForm(
            item,
            index,
            selectedDiscountOptions,
            showDiscountSection
          ),
          tax: getItemTaxRateFromForm(item, index, selectedTaxOptions, showTaxSection),
        };
      });

            // Resolve Logo and Signature to Base64 to ensure they render in PDF
      const logoUrl = await S3UploadService.getFileAsBase64(logoFile || logoPreview, 'paybue-invoice-estimation/logos');
      const signatureUrl = await S3UploadService.getFileAsBase64(signatureFile || signaturePreview, 'paybue-invoice-estimation/signatures');

      const transformed = {
        from: {
          register: fromRegisterData,
          company: currentUserProfile?.company || {},
        },
        billTo: selectedClientObj || {},
        invoiceNumber,
        invoiceDate,
        expirationDate: invoiceDue,
        terms: notes,
        logo: logoUrl,
        signature: signatureUrl,
        amount: grandTotal,
        taxes: taxesResponse,
        discounts: discountsResponse,
        products: products?.data,
        items: mappedItems || [],
      };

      console.log("[PDF] Transformed data:", JSON.stringify(transformed, null, 2));
      let finalHTML = replacePlaceholders(templateObj.html, transformed);
      console.log("[PDF] finalHTML length:", finalHTML.length);

      const { pdf, blob: pdfBlob, cleanup } = await generatePdfFromHtml(finalHTML);
      cleanup();
      console.log("[PDF] Blob size:", pdfBlob.size);

      if (download) {
        pdf.save(`invoice_${invoiceNumber}.pdf`);
        console.log("[PDF] Downloaded.");
      }

      const finalPdfFile = new File([pdfBlob], `invoice_${invoiceNumber}.pdf`, { type: "application/pdf" });
      const documentUrlPath = await S3UploadService.uploadFileInChunks(finalPdfFile, undefined, "paybue-invoice-estimation/invoices");

      await axios.patch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/invoices?id=eq.${invoice_id}`,
        { document_url: S3UploadService.getPublicUrl(documentUrlPath) },
        { headers: { Authorization: `Bearer ${localStorage.getItem("access_token")}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } }
      );

      if (sendEmail) {
        console.log("[PDF] Emailing invoice:", invoice_id, "to client:", selectedClient);
        if (!selectedClient) {
          toast.error("Invoice created but couldn't send email: no client selected.");
        } else {
          try {
            const clientName = selectedClientObj?.name || "Client";
            const emailPayload = {
              invoice_id,
              clients: [selectedClient],
            };
            console.log("[PDF] Sending email with payload:", JSON.stringify(emailPayload, null, 2));
            await sendInvoiceEmail(emailPayload).unwrap();
            toast.success(`Invoice emailed to ${clientName}!`);
            console.log(`[PDF] Email successfully triggered for ${clientName} (${selectedClientObj?.email || 'no email found'})`);
          } catch (emailErr) {
            console.error("[PDF] Email failed:", emailErr);
            toast.error("Invoice created/updated, but email delivery failed.");
          }
        }
      }
    } catch (err) {
      console.error("[PDF] Critical failure:", err);
      toast.error("PDF generation failed. Please try again.");
    }
  };

    const finalizeSubmission = () => {

    resetForm();
    refetch();
    dispatch(clearSelectedTemplate());
    navigate("/invoices");
  };

  const resetForm = () => {
    setInvoiceNumber("INV-0001");
    setInvoiceDate("");
    setInvoiceDue("");
    setPaymentTerms("0");
    setNotes("");
    setLogoFile(null);
    setLogoPreview(null);
    setSignatureFile(null);
    setSignaturePreview(null);
    setItems([{
      product: "",
      client: selectedClient || "",
      description: "",
      quantity: 1,
      price: 0,
      amount: 0,
      tax_key: false,
      discount_key: false,
      tax: "",
      discount: ""
    }]);
    setSelectedDiscountOptions([[]]);
    setSelectedTaxOptions([[]]);
    setOpenDiscountForms([]);
    setOpenTaxForms([]);
    setShowDiscountSection({});
    setShowTaxSection({});
    setDiscountDate({});
    setTaxDate({});
    setIsAddingDiscount([]);
    setIsAddingTax([]);
  };

  useEffect(() => {
    if (productData?.data && selectedproduct) {
      setItems((prev) => {
        const updated = prev.map((item) => {
          if (item.product === selectedproduct) {
            const p = productData.data;
            return {
              ...item,
              description: p.description || "",
              price: Number(p.unit_price || p.price) || 0,
              quantity: 1,
              amount: 1 * (Number(p.unit_price || p.price) || 0),
            };
          }
          return item;
        });
        return updated;
      });
    }
  }, [productData, selectedproduct]);

  // Initialize discount options
  useEffect(() => {
    const list = getApiList(discountsResponse);
    if (list.length) {
      setDiscountOptions(toFeeSelectOptions(list));
    }
  }, [discountsResponse]);

  // Initialize tax options
  useEffect(() => {
    const list = getApiList(taxesResponse);
    if (list.length) {
      setTaxOptions(toFeeSelectOptions(list));
    }
  }, [taxesResponse]);

  // Update client for all items
  useEffect(() => {
    if (selectedClient) {
      setItems((prev) =>
        prev.map((item) => ({
          ...item,
          client: selectedClient,
        }))
      );
    }
  }, [selectedClient]);

  /** ---------------- DISCOUNT HANDLERS ---------------- */
  const handleGetDiscountSelected = (selected: any, index: number) => {
    setSelectedDiscountOptions((prev) => {
      const updated = [...prev];
      updated[index] = selected || [];
      return updated;
    });

    // Ensure discount_key true if user selects any
    setShowDiscountSection((prev) => ({ ...prev, [index]: true }));
    setItems((prev) => {
      const updated = [...prev];
      updated[index].discount_key = true;
      return updated;
    });
  };

  const handleRemoveDiscount = (index: number, optionToRemove: any) => {
    setSelectedDiscountOptions((prev) => {
      const updated = [...prev];
      updated[index] = updated[index].filter((opt: any) => opt.id !== optionToRemove.id);
      return updated;
    });
  };

  const toggleDiscountForm = (index: number) => {
    setOpenDiscountForms((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  const handleToggleDiscountSection = (index: number) => {
    setShowDiscountSection((prev) => {
      const next = { ...prev, [index]: !prev[index] };
      return next;
    });
    setItems((prev) => {
      const updated = [...prev];
      updated[index].discount_key = !showDiscountSection[index];
      return updated;
    });
  };

  const handleAddDiscount = async (index: number) => {
    const data = discountDate[index];
    if (!data?.discountName || !data?.discountRate) return;

    try {
      setIsAddingDiscount((prev) => {
        const newState = [...prev];
        newState[index] = true;
        return newState;
      });

      const token = localStorage.getItem('access_token');
      const decodedToken = token ? JSON.parse(atob(token.split('.')[1])) : null;
      const result = await createDiscount({
        name: data.discountName,
        rate: Number(data.discountRate),
        user_id: decodedToken?.sub
      }).unwrap();

      // Add the new discount to options
      const createdDiscount = Array.isArray(result) ? result[0] : (result.data || result);
      const newDiscountOption = {
        id: createdDiscount.id,
        value: createdDiscount.id,
        label: `${createdDiscount.name} (${createdDiscount.rate}%)`,
        rate: createdDiscount.rate,
        name: createdDiscount.name,
      };

      setDiscountOptions(prev => [...prev, newDiscountOption]);

      // Reset form
      setDiscountDate((prev) => ({ ...prev, [index]: { discountName: "", discountRate: 0 } }));
      setOpenDiscountForms((prev) => prev.filter((i) => i !== index));

      toast.success("Discount added successfully!");
    } catch (err: any) {
      console.error(err);
      toast.error(err?.data?.error || "Failed to add discount");
    } finally {
      setIsAddingDiscount((prev) => {
        const newState = [...prev];
        newState[index] = false;
        return newState;
      });
    }
  };

  /** ---------------- TAX HANDLERS ---------------- */
  const handleGetTaxSelected = (selected: any, index: number) => {
    setSelectedTaxOptions((prev) => {
      const updated = [...prev];
      updated[index] = selected || [];
      return updated;
    });

    // Ensure tax_key true if user selects any
    setShowTaxSection((prev) => ({ ...prev, [index]: true }));
    setItems((prev) => {
      const updated = [...prev];
      updated[index].tax_key = true;
      return updated;
    });
  };

  const handleRemoveTax = (index: number, optionToRemove: any) => {
    setSelectedTaxOptions((prev) => {
      const updated = [...prev];
      updated[index] = updated[index].filter((opt) => opt.id !== optionToRemove.id);
      return updated;
    });
  };

  const toggleTaxForm = (index: number) => {
    setOpenTaxForms((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  const handleToggleTaxSection = (index: number) => {
    setShowTaxSection((prev) => {
      const next = { ...prev, [index]: !prev[index] };
      return next;
    });
    setItems((prev) => {
      const updated = [...prev];
      updated[index].tax_key = !showTaxSection[index];
      return updated;
    });
  };

  const handleAddTax = async (index: number) => {
    const taxData = taxDate[index];
    if (!taxData?.taxName || !taxData?.taxRate) return;

    try {
      setIsAddingTax((prev) => {
        const newState = [...prev];
        newState[index] = true;
        return newState;
      });

      const token = localStorage.getItem('access_token');
      const decodedToken = token ? JSON.parse(atob(token.split('.')[1])) : null;
      const result = await createTax({
        name: taxData.taxName,
        rate: Number(taxData.taxRate),
        user_id: decodedToken?.sub
      }).unwrap();

      // Add the new tax to options
      const createdTax = Array.isArray(result) ? result[0] : (result.data || result);
      const newTaxOption = {
        id: createdTax.id,
        value: createdTax.id,
        label: `${createdTax.name} (${createdTax.rate}%)`,
        rate: createdTax.rate,
        name: createdTax.name,
      };

      setTaxOptions(prev => [...prev, newTaxOption]);

      // Reset form
      setTaxDate((prev) => ({
        ...prev,
        [index]: { taxName: "", taxRate: 0 },
      }));
      setOpenTaxForms((prev) => prev.filter((i) => i !== index));

      toast.success("Tax added successfully!");
    } catch (err) {
      console.error("Failed to create tax:", err);
      toast.error("Failed to add tax");
    } finally {
      setIsAddingTax((prev) => {
        const newState = [...prev];
        newState[index] = false;
        return newState;
      });
    }
  };

  /** ---------------- ITEM HANDLERS ---------------- */
  const handleProductChange = (index: number, productId: string) => {
    setSelectedproduct(productId);

    const selected = products?.data?.find((p: any) => p.id === productId);

    setItems((prev) => {
      const updated = [...prev];
      if (selected) {
        updated[index] = {
          ...updated[index],
          product: productId,
          description: selected.description || "",
          quantity: 1,
          price: Number(selected.unit_price || selected.price) || 0,
          amount: 1 * (Number(selected.unit_price || selected.price) || 0),
        };
      }
      return updated;
    });
  };

  const handleItemChange = (
    index: number,
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[index] };

      if (name === "quantity") {
        if (value === "") {
          item.quantity = 1;
        } else {
          const q = Math.floor(Number(value));
          item.quantity = Number.isFinite(q) && q >= 1 ? q : 1;
        }
        item.amount = item.quantity * item.price;
      } else if (name === "price") {
        item.price = Number(value);
        item.amount = item.quantity * item.price;
      } else {
        item[name] = value;
      }

      updated[index] = item;
      return updated;
    });
  };

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        product: "",
        client: selectedClient || "",
        description: "",
        quantity: 1,
        price: 0,
        amount: 0,
        tax_key: false,
        discount_key: false,
        tax: "",
        discount: ""
      },
    ]);

    // Initialize empty arrays for new item
    setSelectedDiscountOptions((prev) => [...prev, []]);
    setSelectedTaxOptions((prev) => [...prev, []]);
  };

  /** ---------------- CALCULATIONS ---------------- */
  // Subtotal
  const subtotal = useMemo(() => {
    return items.reduce((acc: number, item: any) => acc + (item.quantity * item.price), 0);
  }, [items]);

  // Total discount amount
  const totalDiscountAmount = useMemo(() => {
    return items.reduce((total, item, itemIndex) => {
      const rate = getItemDiscountRateFromForm(
        item,
        itemIndex,
        selectedDiscountOptions,
        showDiscountSection
      );
      if (!rate) return total;
      const itemAmount = item.quantity * item.price;
      return total + (itemAmount * rate) / 100;
    }, 0);
  }, [items, selectedDiscountOptions, showDiscountSection]);

  // Total tax amount (applied after discount)
  const totalTaxAmount = useMemo(() => {
    return items.reduce((total, item, itemIndex) => {
      const taxRate = getItemTaxRateFromForm(
        item,
        itemIndex,
        selectedTaxOptions,
        showTaxSection
      );
      if (!taxRate) return total;
      const itemAmount = item.quantity * item.price;
      const discountRate = getItemDiscountRateFromForm(
        item,
        itemIndex,
        selectedDiscountOptions,
        showDiscountSection
      );
      const discountedAmount = itemAmount - (itemAmount * discountRate) / 100;
      return total + (discountedAmount * taxRate) / 100;
    }, 0);
  }, [items, selectedTaxOptions, selectedDiscountOptions, showTaxSection, showDiscountSection]);

  // Grand total
  const grandTotal = subtotal - totalDiscountAmount + totalTaxAmount;

  // Total discount percentage for display
  const totalDiscountPercent = useMemo(() => {
    return selectedDiscountOptions.reduce((total, discounts) => {
      return total + discounts.reduce((acc, discount) => acc + (discount.rate || 0), 0);
    }, 0);
  }, [selectedDiscountOptions]);

  // Total tax percentage for display
  const totalTaxPercent = useMemo(() => {
    return selectedTaxOptions.reduce((total, taxes) => {
      return total + taxes.reduce((acc, tax) => acc + (tax.rate || 0), 0);
    }, 0);
  }, [selectedTaxOptions]);

  const [userName, setUserName] = useState("")
  const user = useSelector((state: any) => state.auth.user);
  const currentUserProfile = useMemo(
    () => (getCurrentUser?.data || getCurrentUser || {}) as any,
    [getCurrentUser]
  );
  const companyBusinessDetails = useMemo(
    () => companyProfileResponse?.data?.company_info || {},
    [companyProfileResponse]
  );
  const fromRegisterData = useMemo(() => {
    const company = {
      ...(currentUserProfile?.company || {}),
      ...companyBusinessDetails,
    };
    const fullName = `${currentUserProfile?.first_name || ""} ${currentUserProfile?.last_name || ""}`.trim();

    return {
      name:
        company?.company_legal_name ||
        currentUserProfile?.company_name ||
        fullName ||
        currentUserProfile?.register?.name ||
        currentUserProfile?.name ||
        currentUserProfile?.businessName ||
        "",
      email:
        company?.company_email ||
        currentUserProfile?.email ||
        currentUserProfile?.register?.email ||
        "",
      phone:
        company?.company_phone ||
        currentUserProfile?.phone ||
        currentUserProfile?.register?.phone ||
        "",
      company_name:
        company?.company_legal_name ||
        currentUserProfile?.company_name ||
        currentUserProfile?.register?.company_name ||
        currentUserProfile?.businessName ||
        "",
      address:
        company?.address ||
        currentUserProfile?.address ||
        currentUserProfile?.register?.address ||
        "",
    };
  }, [currentUserProfile, companyBusinessDetails]);

  useEffect(() => {
    setUserName(localStorage.getItem("username") || "")
  }, [])
  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setSelectedDiscountOptions((prev) => prev.filter((_, i) => i !== index));
    setSelectedTaxOptions((prev) => prev.filter((_, i) => i !== index));
    setOpenDiscountForms((prev) => prev.filter((i) => i !== index));
    setOpenTaxForms((prev) => prev.filter((i) => i !== index));
    setIsAddingDiscount((prev) => prev.filter((_, i) => i !== index));
    setIsAddingTax((prev) => prev.filter((_, i) => i !== index));
  };


  /** ---------------- JSX ---------------- */
  return (
    <>

      <div className="min-h-screen absolute md:relative md:flex mt-16 md:mt-0 lg:mt-0 inset-0 ">
        <div className="  py-4 sm:py-8">
          <div className="flex flex-col lg:flex-row gap-4 sm:gap-6">
            {/* ===== MAIN FORM ===== */}
            <div className="flex-1">
              <form className="bg-white p-4 sm:p-6 rounded-2xl shadow-lg min-h-[calc(100vh-4rem)]" onSubmit={(e) => e.preventDefault()}>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8">
                  {/* ================= LEFT CONTENT ================= */}
                  <div className="lg:col-span-2 space-y-4 sm:space-y-6">
                    {/* Invoice Header */}
                    <label className="text-[25px] font-[600] text-[#110A30] mb-5 sm:mb-10 block">
                      {invoiceNumber || "New Invoice"}
                    </label>

                    <hr className="border-gray-300" />

                    {/* FROM Section */}
                    <div className="mb-4 sm:mb-5">
                      <div className="flex flex-col sm:flex-row sm:justify-between gap-2 sm:gap-0">
                        <label className="block text-sm font-semibold uppercase mb-2 text-gray-700">
                          FROM
                        </label>
                        <label onClick={() => navigate("/user/myprofile")} className="block text-sm font-semibold capitalize cursor-pointer mb-2 text-blue-400 hover:underline">
                          Edit Business Profile
                        </label>
                      </div>
                      <div className="p-2">
                        <p className="text-gray-700 text-sm font-semibold mb-1">
                          {fromRegisterData.company_name || fromRegisterData.name || user?.first_name || userName || ""}
                        </p>
                        <p className="text-gray-500 text-sm mb-1">{fromRegisterData.email || "-"}</p>
                        <p className="text-gray-500 text-sm mb-1">{fromRegisterData.phone || "-"}</p>
                        <p className="text-gray-500 text-sm">{fromRegisterData.address || "-"}</p>
                      </div>
                    </div>

                    <hr className="border-gray-300" />

                    {/* CLIENT NAME */}
                    <div className="input-group mb-6 sm:mb-10">
                      <div className="flex flex-col sm:flex-row sm:justify-between gap-2 sm:gap-0">
                        <label className="block text-sm font-semibold uppercase mb-2 text-gray-700">
                          CLIENT NAME
                        </label>
                        <button
                          type="button"
                          onClick={() => setOpenClientModal(true)}
                        >
                          <span className="text-sm font-semibold text-blue-400 hover:underline">
                            New Client
                          </span>
                        </button>
                      </div>
                      <select
                        className="w-full h-12 px-4 rounded-lg border border-gray-300"
                        value={selectedClient || ""}
                        onChange={(e) => setSelectedClient(e.target.value)}
                        disabled={loadingClients}
                      >
                        <option value="">
                          {loadingClients ? "Loading clients..." : "Select Client"}
                        </option>
                        {clients?.data?.map((client: any) => (
                          <option key={client.id} value={String(client.id)}>
                            {client.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <hr className="border-gray-300 mt-5 mb-5" />

                    {/* ==== DYNAMIC ITEMS ==== */}
                    {items.map((item, index) => (
                      <div
                        key={index}
                        className=" mb-6 "
                      >
                        {/* Product */}
                        <div className="mb-3 py-2">
                          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                            <label className="text-sm font-semibold uppercase text-gray-700">
                              SERVICE/PRODUCT
                            </label>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setProductModalOpen(true)}
                              >
                                <span className="text-sm font-semibold text-blue-400 hover:underline">
                                  New Service/Product
                                </span>
                              </button>
                              {items.length > 1 && index !== 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItem(index)}
                                  className="text-red-500 text-sm"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>

                          <select
                            className="w-full h-12 mt-2 px-4 rounded-lg border border-gray-300 focus:border-blue-500"
                            disabled={loadingProducts}
                            value={item.product || ""}
                            onChange={(e) =>
                              handleProductChange(index, e.target.value)
                            }
                          >
                            <option value="">
                              {loadingProducts ? "Loading..." : "Select Product"}
                            </option>
                            {products?.data?.map((product: any) => (
                              <option key={product.id} value={product.id}>
                                {product.name}
                              </option>
                            ))}
                          </select>

                          <textarea
                            name="description"
                            placeholder="Service/Product description"
                            className="w-full h-[80px] mt-3 p-3 rounded-lg border border-gray-300"
                            value={item.description}
                            onChange={(e) => handleItemChange(index, e)}
                          />
                        </div>

                        {/* Quantity - Rate - Amount */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 p-3 sm:p-4">
                          <div>
                            <label className="block text-sm font-semibold mb-2">
                              QUANTITY
                            </label>
                            <input
                              min={1}
                              type="number"
                              name="quantity"
                              value={item.quantity}
                              onChange={(e) => handleItemChange(index, e)}
                              onKeyDown={(e) => {
                                if (e.key === "-" || e.key === "e" || e.key === "E" || e.key === "+") {
                                  e.preventDefault();
                                }
                              }}
                              onBlur={(e) => {
                                if (!e.target.value || Number(e.target.value) < 1) {
                                  handleItemChange(index, {
                                    ...e,
                                    target: { ...e.target, name: "quantity", value: "1" },
                                  } as React.ChangeEvent<HTMLInputElement>);
                                }
                              }}
                              className="w-full h-[50px] px-4 border border-gray-200 rounded-lg"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-semibold mb-2">
                              RATE
                            </label>
                            <input
                              type="number"
                              name="price"
                              value={item.price}
                              min="0"
                              onKeyDown={(e) => {
                                if (e.key === "-" || e.key === "e") {
                                  e.preventDefault();
                                }
                              }}
                              onChange={(e) => handleItemChange(index, e)}
                              className="w-full h-[50px] px-4 border border-gray-200 rounded-lg"
                            />

                          </div>
                          <div>
                            <label className="block text-sm font-semibold mb-2">
                              AMOUNT
                            </label>
                            <input
                              type="number"
                              name="amount"
                              value={item.quantity * item.price}
                              readOnly
                              className="w-full h-[50px] px-4 border border-gray-200 rounded-lg bg-gray-100"
                            />
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mt-4">
                          <button
                            type="button"
                            onClick={() => handleToggleDiscountSection(index)}
                            className="flex items-center gap-2 text-blue-500"
                          >
                            <input type="checkbox" checked={!!showDiscountSection[index]} readOnly />
                            <span>Add Discount</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggleTaxSection(index)}
                            className="flex items-center gap-2 text-blue-500"
                          >
                            <input type="checkbox" checked={!!showTaxSection[index]} readOnly />
                            <span>Add Tax</span>
                          </button>
                        </div>

                        {/* Discount & Tax Section */}
                        <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4 mt-4 w-full">
                          {/* Discount Card */}
                          {showDiscountSection[index] && (
                            <div className="flex flex-col items-center border border-gray-300 rounded-lg p-4 w-full sm:w-[48%] md:w-[40%] relative z-30">
                              {/* Header */}
                              <div className="flex justify-between items-center border-b border-gray-200 p-2 w-full">
                                <CircleDashed className="text-gray-500" />
                                <span>DISCOUNT ({selectedDiscountOptions[index]?.length || 0})</span>
                              </div>

                              {/* Selected Discounts */}
                              <div className="flex flex-wrap gap-2 mt-2 w-full">
                                {selectedDiscountOptions[index]?.length > 0 ? (
                                  selectedDiscountOptions[index].map((option: any, idx: number) => (
                                    <div
                                      key={idx}
                                      className="flex items-center bg-gray-100 rounded px-2 py-1 text-sm"
                                    >
                                      <span>{option.label}</span>
                                      <button
                                        type="button"
                                        className="ml-2 text-gray-500 hover:text-red-500"
                                        onClick={() => handleRemoveDiscount(index, option)}
                                      >
                                        <Cancel />
                                      </button>
                                    </div>
                                  ))
                                ) : (
                                  <span className="text-gray-500 text-sm">No discounts selected</span>
                                )}
                              </div>

                              {/* Dropdown */}
                              <div className="w-full mt-2 relative z-40">
                                <Select
                                  options={discountOptions}
                                  value={selectedDiscountOptions[index] || []}
                                  onChange={(selected: any) => handleGetDiscountSelected(selected, index)}
                                  isMulti
                                  placeholder="Select Discount"
                                  controlShouldRenderValue={false}
                                  {...feeSelectPortalProps}
                                />
                              </div>

                              <hr className="border-gray-300 w-full mt-2" />

                              {/* Add New Discount */}
                              <button
                                type="button"
                                className="text-blue-500 text-sm mt-2 cursor-pointer"
                                onClick={() => toggleDiscountForm(index)}
                              >
                                Add new discount
                              </button>

                              {/* New Discount Form */}
                              {openDiscountForms.includes(index) && (
                                <div className="mt-2 p-2 w-full">
                                  <input
                                    type="text"
                                    placeholder="Discount Name"
                                    className="w-full p-1 mb-2 border border-gray-300 rounded outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                                    value={discountDate[index]?.discountName || ""}
                                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddDiscount(index); } }}
                                    onChange={(e) =>
                                      setDiscountDate((prev) => ({
                                        ...prev,
                                        [index]: {
                                          ...prev[index],
                                          discountName: e.target.value,
                                        },
                                      }))
                                    }
                                    required
                                  />
                                  <input
                                    type="number"
                                    placeholder="Rate (%)"
                                    className="w-full p-1 mb-2 border border-gray-300 rounded outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                                    value={discountDate[index]?.discountRate ?? ""}
                                    min="0"
                                    onKeyDown={(e) => {
                                      if (e.key === "-" || e.key === "e") {
                                        e.preventDefault();
                                      }
                                    }}
                                    onChange={(e) => {
                                      const value = Number(e.target.value);
                                      if (value < 0) return;

                                      setDiscountDate((prev) => ({
                                        ...prev,
                                        [index]: {
                                          ...prev[index],
                                          discountRate: value,
                                        },
                                      }));
                                    }}
                                    required
                                  />

                                  <button
                                    type="button"
                                    className={`w-full p-2 mt-2 rounded text-white ${isAddingDiscount[index] ||
                                      !discountDate[index]?.discountName ||
                                      !discountDate[index]?.discountRate
                                      ? "bg-blue-300 cursor-not-allowed"
                                      : "bg-blue-500 hover:bg-blue-600"
                                      }`}
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleAddDiscount(index); }}
                                    disabled={
                                      isAddingDiscount[index] ||
                                      !discountDate[index]?.discountName ||
                                      !discountDate[index]?.discountRate
                                    }
                                  >
                                    {isAddingDiscount[index] ? <Spinner /> : "Add"}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Tax Card */}
                          {showTaxSection[index] && (
                            <div className="flex flex-col items-center border border-gray-300 rounded-lg p-4 w-full sm:w-[48%] md:w-[40%] relative z-30">
                              <div className="flex justify-between items-center border-b border-gray-200 p-2 w-full">
                                <CarTaxiFront className="text-gray-500" />
                                <span>TAX ({selectedTaxOptions[index]?.length || 0})</span>
                              </div>

                              {/* Selected Taxes */}
                              <div className="flex flex-wrap gap-2 mt-2 w-full">
                                {selectedTaxOptions[index]?.length > 0 ? (
                                  selectedTaxOptions[index].map((option: any, idx: number) => (
                                    <div
                                      key={idx}
                                      className="flex items-center bg-gray-100 rounded px-2 py-1 text-sm"
                                    >
                                      <span>{option.label}</span>
                                      <button
                                        type="button"
                                        className="ml-2 text-gray-500 hover:text-red-500"
                                        onClick={() => handleRemoveTax(index, option)}
                                      >
                                        <Cancel />
                                      </button>
                                    </div>
                                  ))
                                ) : (
                                  <span className="text-gray-500 text-sm">No taxes selected</span>
                                )}
                              </div>

                              {/* Tax Dropdown */}
                              <div className="w-full mt-2 relative z-40">
                                <Select
                                  options={taxOptions}
                                  value={selectedTaxOptions[index] || []}
                                  onChange={(selected: any) => handleGetTaxSelected(selected, index)}
                                  isMulti
                                  isSearchable
                                  placeholder="Select Tax"
                                  controlShouldRenderValue={false}
                                  {...feeSelectPortalProps}
                                />
                              </div>

                              <hr className="border-gray-300 w-full mt-2" />

                              {/* Add New Tax */}
                              <button
                                type="button"
                                className="text-blue-500 text-sm mt-2 cursor-pointer"
                                onClick={() => toggleTaxForm(index)}
                              >
                                Add new tax
                              </button>

                              {/* Tax Form */}
                              {openTaxForms.includes(index) && (
                                <div className="mt-2 p-2 w-full">
                                  <input
                                    type="text"
                                    placeholder="Tax Name"
                                    className="w-full p-1 mb-2 border border-gray-300 rounded outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                                    value={taxDate[index]?.taxName || ""}
                                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddTax(index); } }}
                                    onChange={(e) =>
                                      setTaxDate((prev) => ({
                                        ...prev,
                                        [index]: { ...prev[index], taxName: e.target.value },
                                      }))
                                    }
                                    required
                                  />
                                  <input
                                    type="number"
                                    placeholder="Rate (%)"
                                    className="w-full p-1 border border-gray-300 rounded outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
                                    value={taxDate[index]?.taxRate ?? ""}
                                    min="0"
                                    onKeyDown={(e) => {
                                      if (e.key === "-" || e.key === "e") {
                                        e.preventDefault();
                                      }
                                    }}
                                    onChange={(e) => {
                                      const value = Number(e.target.value);
                                      if (value < 0) return;

                                      setTaxDate((prev) => ({
                                        ...prev,
                                        [index]: {
                                          ...prev[index],
                                          taxRate: value,
                                        },
                                      }));
                                    }}
                                    required
                                  />

                                  <button
                                    type="button"
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleAddTax(index); }}
                                    disabled={
                                      isAddingTax[index] ||
                                      !taxDate[index]?.taxName ||
                                      !taxDate[index]?.taxRate
                                    }
                                    className={`w-full p-2 mt-2 rounded text-white transition-colors duration-200 ${isAddingTax[index] ||
                                      !taxDate[index]?.taxName ||
                                      !taxDate[index]?.taxRate
                                      ? "bg-blue-300 cursor-not-allowed"
                                      : "bg-blue-500 hover:bg-blue-600"
                                      }`}
                                  >
                                    {isAddingTax[index] ? (
                                      <div className="flex items-center justify-center">
                                        <Spinner />
                                        <span className="ml-2">Adding...</span>
                                      </div>
                                    ) : (
                                      "Add"
                                    )}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}

                    <button onClick={handleAddItem} type="button" className="flex items-center space-x-1 text-blue-500">
                      Add new item
                    </button>

                    <div className="input-group w-full">
                      <div className="p-4 rounded-lg bg-white w-full max-w-lg">
                        <div className="flex text-gray-500 text-sm items-center">
                          <div className="flex-2 flex flex-col justify-between mt-2 w-full max-w-lg p-2">
                            {/* Subtotal */}
                            <div className="mb-2 flex justify-between">
                              <span>Subtotal</span>
                              <span>USD {subtotal.toFixed(2)}</span>
                            </div>

                            {/* Tax total */}
                            <div className="mb-2 flex justify-between items-center">
                              <div className="flex items-center">
                                <span className="w-[5rem]">Tax total</span>
                                <div className="ml-2 flex items-center border border-gray-400 rounded-md shadow-sm">
                                  <input
                                    type="text"
                                    value={totalTaxPercent.toFixed(2)}
                                    readOnly
                                    className="w-[50px] text-right pr-0.5 py-0.5 text-xs text-gray-800 bg-white rounded-l-md"
                                  />
                                  <span className="px-1 py-0.5 text-xs text-gray-800 bg-white rounded-r-md">%</span>
                                </div>
                              </div>
                              <span>USD {totalTaxAmount.toFixed(2)}</span>
                            </div>

                            {/* Discount total */}
                            <div className="mb-2 flex justify-between items-center">
                              <div className="flex items-center">
                                <span className="w-[5rem]">Discount total</span>
                                <div className="ml-2 flex items-center border border-gray-300 rounded-md shadow-sm">
                                  <input
                                    type="text"
                                    value={totalDiscountPercent.toFixed(2)}
                                    readOnly
                                    className="w-[50px] text-right pr-0.5 py-0.5 text-xs text-gray-800 bg-white rounded-l-md"
                                  />
                                  <span className="px-1 py-0.5 text-xs text-gray-800 bg-white rounded-r-md">%</span>
                                </div>
                              </div>
                              <span>USD {totalDiscountAmount.toFixed(2)}</span>
                            </div>

                            {/* Total */}
                            <div className="flex justify-between w-full items-baseline pt-1">
                              <div className="flex items-baseline">
                                <span className="font-semibold text-gray-800">TOTAL</span>
                                <span className="text-blue-500 ml-1">USD</span>
                              </div>
                              <span className="text-blue-500 border-b border-dotted border-blue-500 font-semibold">
                                USD {grandTotal.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Payment Terms */}
                    <div className="input-group">
                      <label className="block text-sm uppercase font-semibold mb-2 text-gray-700">
                        PAYMENT TERMS
                      </label>
                      <select
                        className="w-full h-[50px] px-4 rounded-lg border border-gray-300"
                        value={paymentTerms}
                        onChange={(e) => setPaymentTerms(e.target.value)}
                      >
                        <option value="0">DUE ON RECEIPT</option>
                        <option value="1">10 DAYS</option>
                        <option value="2">15 DAYS</option>
                        <option value="3">30 DAYS</option>
                        <option value="4">45 DAYS</option>
                        <option value="5">60 DAYS</option>
                        <option value="6">90 DAYS</option>
                      </select>
                    </div>

                    {/* Notes */}
                    <div className="input-group mt-3">
                      <label className="block text-sm font-semibold uppercase mb-2 text-gray-700">
                        NOTES
                      </label>
                      <textarea
                        name="notes"
                        placeholder="Additional notes or terms"
                        className="w-full h-[90px] p-4 rounded-lg border border-gray-300 resize-none"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      ></textarea>
                    </div>
                  </div>
                  {openClientModal && (

                    <FormNewClienteModal open={openClientModal} onClose={() => setOpenClientModal(false)} />
                  )

                  }
                  {isProductModalOpen && (
                    <FormNewProductModal
                      open={isProductModalOpen}
                      onClose={() => setProductModalOpen(false)}
                    />
                  )}

                  {/* ================= RIGHT PANEL ================= */}
                  <div className="space-y-4 sm:space-y-6 p-4 sm:p-6 border-t-2 lg:border-t-0 lg:border-l-2 border-dashed border-[#2B364136]">
                    <div className="flex flex-col items-center">
                      {/* Logo Upload */}
                      <div
                        className="border-2 border-dashed border-gray-300 w-full max-w-xs rounded-lg hover:border-[#9ED0FF] transition-all duration-300 cursor-pointer bg-white h-[150px] flex flex-col items-center justify-center"
                        onClick={() => logoInputRef.current?.click()}
                      >
                        {logoFile ? (
                          <img
                            src={URL.createObjectURL(logoFile)}
                            alt="Logo Preview"
                            className="h-full object-contain"
                          />
                        ) : logoPreview ? (
                          <img
                            src={S3UploadService.getPublicUrl(logoPreview, 'paybue-invoice-estimation/logos')}
                            alt="Logo Preview"
                            className="h-full object-contain"
                          />
                        ) : (
                          <span className="text-gray-600 text-sm">Upload Logo</span>
                        )}
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        ref={logoInputRef}
                        onChange={(e) => handleFileChange(e, "logo")}
                        className="hidden"
                      />

                      {/* Dates */}
                      <div className="w-full space-y-4 sm:space-y-6 mt-6">
                        <div>
                          <label className="block text-sm font-semibold mb-2 uppercase text-gray-700">
                            INVOICE DATE
                          </label>
                          <input
                            type="date"
                            className="w-full h-[50px] px-4 rounded-lg border border-gray-300"
                            value={invoiceDate}
                            onChange={(e) => setInvoiceDate(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-semibold mb-2 uppercase text-gray-700">
                            INVOICE DUE
                          </label>
                          <input
                            type="date"
                            className="w-full h-[50px] px-4 rounded-lg border border-gray-300"
                            value={invoiceDue}
                            onChange={(e) => setInvoiceDue(e.target.value)}
                          />
                        </div>

                        {/* Signature Upload */}
                        <div
                          className="border-2 border-dashed border-gray-300 w-full rounded-lg hover:border-[#9ED0FF] transition-all duration-300 cursor-pointer bg-white h-[100px] flex flex-col items-center justify-center"
                          onClick={() => signatureInputRef.current?.click()}
                        >
                          {signatureFile ? (
                            <img
                              src={URL.createObjectURL(signatureFile)}
                              alt="Signature Preview"
                              className="h-full object-contain"
                            />
                          ) : signaturePreview ? (
                            <img
                              src={S3UploadService.getPublicUrl(signaturePreview, 'paybue-invoice-estimation/signatures')}
                              alt="Signature Preview"
                              className="h-full object-contain"
                            />
                          ) : (
                            <span className="text-gray-600 text-sm">
                              Attach Signature
                            </span>
                          )}
                        </div>
                        <input
                          type="file"
                          accept="image/*"
                          ref={signatureInputRef}
                          onChange={(e) => handleFileChange(e, "signature")}
                          className="hidden"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* ================= BUTTONS ================= */}
                <div className="mt-6 sm:mt-8 pt-4 sm:pt-6 border-t border-gray-200">
                  <div className="flex flex-col sm:flex-row justify-end gap-3 sm:gap-4">
                    <button
                      onClick={onClose}
                      className="h-[48px] px-6 rounded-full bg-white border border-gray-200 hover:bg-gray-100 font-medium text-[#1A1E50] w-full sm:w-auto"
                      type="button"
                    >
                      Cancel
                    </button>

                    {/* Save Draft stays for both modes */}
                    <button
                      type="button"
                      className="h-[48px] px-6 rounded-full bg-[#F9FAFB] border border-gray-300 text-gray-700 hover:bg-gray-100 font-medium w-full sm:w-auto"
                    >
                      Save Draft
                    </button>

                    {/* Single Submit button - will be Update in update mode */}
                    <button
                      type="button"
                      onClick={() => handleSubmitInvoice()}
                      disabled={isUpdateMode ? (isUpdating || isGeneratingPDF) : (isCreatingInvoice || isGeneratingPDF)}
                      className={`h-[48px] px-8 rounded-full font-medium shadow-md transition-all duration-300 w-full sm:w-auto ${(isUpdateMode ? (isUpdating || isGeneratingPDF) : (isCreatingInvoice || isGeneratingPDF))
                        ? "bg-blue-300 cursor-not-allowed text-white"
                        : "bg-blue-600 hover:bg-blue-700 text-white"
                        }`}
                    >
                      {isGeneratingPDF ? "Finalizing PDF..." : (isUpdateMode ? (isUpdating ? "Updating..." : "Update Invoice") : (isCreatingInvoice ? "Creating..." : "Create Invoice"))}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
      <SelectTemplate
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
        }}
        onConfirmActions={async (templateId, dlChecked, emChecked) => {
          dispatch(clearSelectedTemplate()); // Let's clear and then start submit
          setModalOpen(false);
          await handleSubmitInvoice(templateId, dlChecked, emChecked);
        }}
        setModalOpen={setModalOpen}
        previewData={{
          client: selectedClient,
          items: items.map((item, idx) => ({
            ...item,
            tax: getItemTaxRateFromForm(item, idx, selectedTaxOptions, showTaxSection),
            discount: getItemDiscountRateFromForm(
              item,
              idx,
              selectedDiscountOptions,
              showDiscountSection
            ),
          })),
          invoiceDate,
          invoiceDue,
          notes,
          paymentTerms,
          logo: logoFile,
          signature: signatureFile,
          number: invoiceNumber,
        }}
      />



    </>
  );
};


export default FormInvoice;