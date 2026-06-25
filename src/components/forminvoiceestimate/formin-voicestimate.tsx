// type-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  FormEvent,
} from "react";
import Select from "react-select";
import { toast } from "react-toastify";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  useCreateDiscountMutation,
  useCreateEstimateMutation,
  useCreateTaxMutation,
  useGetClientsQuery,
  useGetDiscountsQuery,
  useGetEstimateDetailQuery, 
  useGetInvoicesQuery,
  useGetProductsQuery,
  useGetTaxesQuery,
  useUpdateEstimateMutation,
  useGetUserProfileQuery,
  useGetCompanyQuery,
} from "../../services/rtkapi/invoiceApi";
import { useGetProductByIdQuery } from "../../services/rtkapi/productApi";
import FormNewClienteModal from "../formnewclient/form-new-client";
import FormNewProductModal from "../formnewproduct/new-proct-form";
import { CarTaxiFront, CircleDashed } from "lucide-react";
import { Cancel } from "@mui/icons-material";
import Spinner from "../spinner";
import { AppDispatch, RootState } from "../../redux/store";
import { useDispatch, useSelector } from "react-redux";
import { clearSelectedTemplate } from "../../redux/templateSlice";
import SelectTemplateEstimate, { templates, replacePlaceholders } from "../modal/SelectedTemplateEstimate";
import { getApiList, toFeeSelectOptions } from "../../utils/api-list";
import { feeSelectPortalProps } from "../../utils/fee-select-props";
import {
  getItemDiscountRateFromForm,
  getItemTaxRateFromForm,
} from "../template/template-item-rates";
import axios from "axios";
import { S3UploadService } from "../data/s3-data";
import { generatePdfFromHtml } from '../template/template-pdf-utils';

interface FormInvoiceEstimateProps {
  onClose: () => void;
}

type Item = {
  product: string;
  client: string;
  description: string;
  quantity: number;
  price: number;
  id: string;
  amount: number;
  tax_key: boolean;
  discount_key: boolean;
  tax: string | string[];
  discount: string | string[];
};

const FormInvoiceEstimate = ({ onClose }: FormInvoiceEstimateProps) => {
  /** ---------------- API HOOKS ---------------- */
  const location = useLocation();
  console.log("[FormEstimate] Component Mounting - Version: 1.0.4 (Deep Sync)");
  const [searchParams] = useSearchParams();
  const urlId = searchParams.get('id');
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();

  // Robust ID detection (URL first, then multiple state keys, then localStorage)
  const isNew = location.pathname.includes('/new') && !urlId;
  const rawId = isNew ? "" : (urlId || (location?.state as any)?.estimateId || (location?.state as any)?.id || (location?.state as any)?.estimate_id || localStorage.getItem('last_edit_estimate_id') || "");
  const estimateId = String(rawId).trim();

  useEffect(() => {
    if (urlId) {
      localStorage.setItem('last_edit_estimate_id', urlId);
    }
  }, [urlId]);

  console.log("[FormEstimate] Detected ID Source:", { 
    urlId, 
    stateId: (location?.state as any)?.estimateId || (location?.state as any)?.id, 
    localId: localStorage.getItem('last_edit_estimate_id'),
    finalId: estimateId,
    skip: !estimateId
  });

  // fetch single estimate if id exists
  const { data: result, isFetching: isFetchingEstimate, error: queryError } = useGetEstimateDetailQuery(
    { estimate_id: estimateId },
    { skip: !estimateId }
  );
  
  const estimateData = result?.data || result;
  if (queryError) console.error("[FormEstimate] Query Error:", queryError);
  if (estimateData) console.log("[FormEstimate] Raw Query Result:", estimateData);
  
  const { data: clients, isLoading: loadingClients } = useGetClientsQuery();
  const { data: products, isLoading: loadingProducts } = useGetProductsQuery();
  const { data: discountsResponse } = useGetDiscountsQuery();
  const { data: taxesResponse } = useGetTaxesQuery();

  const [createEstimate, { isLoading: isCreatingEstimate }] = useCreateEstimateMutation();
  const [updateEstimate, { isLoading: isUpdatingEstimate }] = useUpdateEstimateMutation();
  const { refetch } = useGetInvoicesQuery();

  const [createDiscount] = useCreateDiscountMutation();
  const [createTax] = useCreateTaxMutation();
  const { data: getCurrentUser } = useGetUserProfileQuery();
  const { data: companyProfileResponse } = useGetCompanyQuery();

  /** ---------------- LOCAL STATE ---------------- */
  const [notes, setNotes] = useState<string>("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [signaturePreviewUrl, setSignaturePreviewUrl] = useState<string | null>(null);

  const [estimateNumber, setEstimateNumber] = useState<string>("");
  const [estimateDate, setEstimateDate] = useState<string>("");
  const [estimateDue, setEstimateDue] = useState<string>("");
  const selectedTemplate = useSelector((state: RootState) => state.template.selectedTemplate);
  const [modalOpen, setModalOpen] = useState(false);


  // Modals
  const [openClientModal, setOpenClientModal] = useState(false);
  const [isProductModalOpen, setProductModalOpen] = useState(false);

  // Client selection
  const [selectedClient, setSelectedClient] = useState<string | null>(null);

  // Product details fetch when selecting product (optional)
  const [selectedproduct, setSelectedproduct] = useState<string | null>(null);
  useGetProductByIdQuery(selectedproduct!, {
    skip: !selectedproduct,
  });

  // Payment terms
  const [paymentTerms, setPaymentTerms] = useState<string>("0");
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  // Discount/tax options
  const [discountOptions, setDiscountOptions] = useState<any[]>([]);
  const [taxOptions, setTaxOptions] = useState<any[]>([]);

  // Per-item selected multi options (each item index => array of option objects)
  const [selectedDiscountOptions, setSelectedDiscountOptions] = useState<any[][]>([[]]);
  const [selectedTaxOptions, setSelectedTaxOptions] = useState<any[][]>([[]]);

  // Per-item open forms & temp values for creating new discount/tax
  const [openDiscountForms, setOpenDiscountForms] = useState<number[]>([]);
  const [discountDate, setDiscountDate] = useState<{
    [key: number]: { discountName: string; discountRate: number | string };
  }>({});
  const [isAddingDiscount, setIsAddingDiscount] = useState<boolean[]>([]);

  const [openTaxForms, setOpenTaxForms] = useState<number[]>([]);
  const [taxDate, setTaxDate] = useState<{
    [key: number]: { taxName: string; taxRate: number | string };
  }>({});
  const [isAddingTax, setIsAddingTax] = useState<boolean[]>([]);

  // Show/hide section per item
  const [showDiscountSection, setShowDiscountSection] = useState<{ [key: number]: boolean }>({});
  const [showTaxSection, setShowTaxSection] = useState<{ [key: number]: boolean }>({});

  useEffect(() => {
    const today = new Date();
    const formattedDate = today.toISOString().split("T")[0];

    setEstimateDate((prev) => prev || formattedDate);
    setEstimateDue((prev) => prev || formattedDate);
  }, []);

  // Items
  const [items, setItems] = useState<Item[]>([
    {
      product: "",
      client: "",
      id: "",
      description: "",
      quantity: 1,
      price: 0,
      amount: 0,
      tax_key: false,
      discount_key: false,
      tax: [],
      discount: [],
    },
  ]);

  // refs for uploads
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const signatureInputRef = useRef<HTMLInputElement | null>(null);

  // username display
  const [userName, setUserName] = useState<string>("");
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
    setUserName(localStorage.getItem("username") || "");
  }, []);

  const isInitialized = useRef(false);

  /** ---------------- INITIAL DATA & PREFILL ---------------- */
  useEffect(() => {
    // 1. Handle Reset/Random Number for New Estimates
    if (!estimateId) {
      if (isInitialized.current) return;

      console.log("[FormEstimate] Initializing new estimate form.");
      setEstimateDate("");
      setEstimateDue("");
      setSelectedClient(null);
      setItems([
        {
          id: "",
          product: "",
          client: "",
          description: "",
          quantity: 1,
          price: 0,
          amount: 0,
          tax_key: false,
          discount_key: false,
          tax: [],
          discount: [],
        },
      ]);
      setNotes("");
      setLogoPreviewUrl(null);
      setSignaturePreviewUrl(null);

      if (!estimateNumber.startsWith("EST-") || estimateNumber === "EST-0001" || estimateNumber === "") {
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        setEstimateNumber(`EST-${randomNum}`);
      }
      
      isInitialized.current = true;
      return;
    }

    // 2. Handle Prefill for Update Mode
    const d = result?.data || result;
    
    console.log("[FormEstimate] Prefill Sync Check:", { 
      hasData: !!d, 
      id: estimateId,
      resultKeys: d ? Object.keys(d) : []
    });

    if (!d || Object.keys(d).length === 0) return;

    const cleanDate = (iso: any) => {
      if (!iso) return "";
      const s = String(iso);
      return s.includes("T") ? s.split("T")[0] : s;
    };

    // Prefill scalar fields
    if (d.estimate_number) setEstimateNumber(d.estimate_number);
    if (d.estimate_date) setEstimateDate(cleanDate(d.estimate_date));
    const dueDate = d.due_date || d.valid_until;
    if (dueDate) setEstimateDue(cleanDate(dueDate));
    if (d.notes) setNotes(d.notes);
    if (d.payment_terms !== undefined) setPaymentTerms(String(d.payment_terms));

    // Client - match ID exactly
    const cid = d.client_id || (typeof d?.clients === "object" ? d?.clients?.id : d.client_id);
    if (cid) setSelectedClient(String(cid));

    // Assets
    const logo = d.logo_url || d.logo || d.company_logo || d.user?.company?.logo_url;
    if (logo) setLogoPreviewUrl(logo);
    const sig = d.signature_url || d.signature;
    if (sig) setSignaturePreviewUrl(sig);

    // Items
    const rawItems = d.estimate_items || d.items;
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
          ? Array.isArray(it.estimate_item_taxes)
            ? it.estimate_item_taxes.map((t: any) => t.tax_id || t.id)
            : Array.isArray(it.tax)
              ? it.tax
              : []
          : [];

        const discountIds = discountEnabled
          ? Array.isArray(it.estimate_item_discounts)
            ? it.estimate_item_discounts.map((dis: any) => dis.discount_id || dis.id)
            : Array.isArray(it.discount)
              ? it.discount
              : []
          : [];

        return {
          id: it.id ?? null, 
          product: it.product_id || it.product?.id || it.product || "",
          client: String(cid || ""), // Fix for missing required 'client' property
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

      // Map labels
      const taxData = getApiList(taxesResponse);
      const discData = getApiList(discountsResponse);

      setSelectedTaxOptions(mapped.map((it: any) => {
        if (!Array.isArray(it.tax)) return [];
        return it.tax.map((tId: any) => {
          const found = taxData.find((t: any) => String(t.id) === String(tId));
          return found ? { id: found.id, value: found.id, label: `${found.name} (${found.rate}%)`, rate: found.rate, name: found.name }
                       : { id: tId, value: tId, label: String(tId), rate: 0, name: String(tId) };
        });
      }));

      setSelectedDiscountOptions(mapped.map((it: any) => {
        if (!Array.isArray(it.discount)) return [];
        return it.discount.map((dId: any) => {
          const found = discData.find((disc: any) => String(disc.id) === String(dId));
          return found ? { id: found.id, value: found.id, label: `${found.name} (${found.rate}%)`, rate: found.rate, name: found.name }
                       : { id: dId, value: dId, label: String(dId), rate: 0, name: String(dId) };
        });
      }));

      const newShowTax: { [key: number]: boolean } = {};
      const newShowDiscount: { [key: number]: boolean } = {};
      mapped.forEach((it: any, idx: number) => {
        newShowTax[idx] = !!it.tax_key;
        newShowDiscount[idx] = !!it.discount_key;
      });
      setShowTaxSection(newShowTax);
      setShowDiscountSection(newShowDiscount);
    }
  }, [result, clients, products, taxesResponse, discountsResponse, estimateId]);

  useEffect(() => {
    const list = getApiList(discountsResponse);
    if (list.length) {
      setDiscountOptions(toFeeSelectOptions(list));
    }
  }, [discountsResponse]);

  useEffect(() => {
    const list = getApiList(taxesResponse);
    if (list.length) {
      setTaxOptions(toFeeSelectOptions(list));
    }
  }, [taxesResponse]);

  // Legacy prefill removed in favor of unified effect above (Version 1.0.4)

  /** ---------------- MAP existing discount/tax ids to option objects for selects ---------------- */
  useEffect(() => {
    if (!discountOptions.length || !items.length) return;

    const mapped = items.map((it) => {
      // 👇 Explicitly cast discount array to string[] to fix TS warning
      const opts = ((it.discount || []) as string[])
        .map((id: string) => discountOptions.find((d) => String(d.id) === String(id)))
        .filter(Boolean);

      return opts;
    });

    setSelectedDiscountOptions(mapped.length ? mapped : [[]]);
  }, [discountOptions, items]);


  useEffect(() => {
    if (!taxOptions.length || !items.length) return;

    const mapped = items.map((it) => {
      const opts = ((it.tax || []) as string[]).map((id: string) =>
        taxOptions.find((t) => String(t.id) === String(id))
      ).filter(Boolean);
      return opts;
    });

    setSelectedTaxOptions(mapped.length ? mapped : [[]]);
  }, [taxOptions, items]);


  /** ---------------- FILE HANDLERS ---------------- */
  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "logo" | "signature"
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (type === "logo") {
      setLogoFile(file);
      setLogoPreviewUrl(URL.createObjectURL(file));
    }
    if (type === "signature") {
      setSignatureFile(file);
      setSignaturePreviewUrl(URL.createObjectURL(file));
    }
  };

  /** ---------------- ITEM HANDLERS ---------------- */
  const handleProductChange = (index: number, productId: string) => {
    setSelectedproduct(productId);
    const selected = products?.data?.find((p: any) => p.id === productId);
    setItems((prev) => {
      const updated = [...prev];
      const p = selected;
      if (!updated[index]) return updated;
      updated[index] = {
        ...updated[index],
        product: productId,
        description: p?.description || "",
        quantity: 1,
        price: Number(p?.unit_price || p?.price) || 0,
        amount: 1 * (Number(p?.unit_price || p?.price) || 0),
      };
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
      const current = { ...updated[index] } as Item;
      if (name === "quantity") {
        if (value === "") {
          current.quantity = 1;
        } else {
          const q = Math.floor(Number(value));
          current.quantity = Number.isFinite(q) && q >= 1 ? q : 1;
        }
        current.amount = current.quantity * (current.price || 0);
      } else if (name === "price") {
        const p = Number(value || 0);
        current.price = p;
        current.amount = (current.quantity || 0) * p;
      } else if (name === "description") {
        current.description = value;
      }
      updated[index] = current;
      return updated;
    });
  };

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        product: "",
        id: "",
        client: selectedClient || "",
        description: "",
        quantity: 1,
        price: 0,
        amount: 0,
        tax_key: false,
        discount_key: false,
        tax: [],
        discount: [],
      },
    ]);
    setSelectedDiscountOptions((prev) => [...prev, []]);
    setSelectedTaxOptions((prev) => [...prev, []]);
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setSelectedDiscountOptions((prev) => prev.filter((_, i) => i !== index));
    setSelectedTaxOptions((prev) => prev.filter((_, i) => i !== index));
    setOpenDiscountForms((prev) => prev.filter((i) => i !== index));
    setOpenTaxForms((prev) => prev.filter((i) => i !== index));
    setIsAddingDiscount((prev) => prev.filter((_, i) => i !== index));
    setIsAddingTax((prev) => prev.filter((_, i) => i !== index));
  };

  /** ---------------- DISCOUNT HANDLERS ---------------- */
  const handleGetDiscountSelected = (selected: any, index: number) => {
    setSelectedDiscountOptions((prev) => {
      const updated = [...prev];
      updated[index] = selected || [];
      return updated;
    });

    // also update underlying items' discount ids
    setItems((prev) => {
      const updated = [...prev];
      const optionIds = (selected || []).map((s: any) => s.id || s.value);
      if (!updated[index]) return updated;
      updated[index] = { ...updated[index], discount: optionIds, discount_key: optionIds.length > 0 };
      return updated;
    });
  };

  const handleRemoveDiscount = (index: number, optionToRemove: any) => {
    setSelectedDiscountOptions((prev) => {
      const updated = [...prev];
      updated[index] = (updated[index] || []).filter((opt: any) => opt.id !== optionToRemove.id);
      return updated;
    });

    setItems((prev) => {
      const updated = [...prev];
      if (!updated[index]) return updated;

      updated[index] = {
        ...updated[index],
        discount: ((updated[index].discount || []) as string[]).filter(
          (id: string) => id !== optionToRemove.id
        ),
      };

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
      if (!updated[index]) return updated;
      updated[index] = { ...updated[index], discount_key: !updated[index].discount_key };
      return updated;
    });
  };

  const handleAddDiscount = async (index: number) => {
    const data = discountDate[index];
    if (!data?.discountName || data?.discountRate === undefined || data?.discountRate === "") {
      toast.error("Enter discount name and rate");
      return;
    }

    try {
      setIsAddingDiscount((prev) => {
        const next = [...prev];
        next[index] = true;
        return next;
      });

      const token = localStorage.getItem('access_token');
      const decodedToken = token ? JSON.parse(atob(token.split('.')[1])) : null;
      const currentUserId = decodedToken?.sub;

      const result = await createDiscount({
        name: data.discountName,
        rate: Number(data.discountRate),
        user_id: currentUserId
      }).unwrap();

      // Safe extraction of the created record
      const createdRecord = result?.data || (Array.isArray(result) ? result[0] : result);

      if (!createdRecord) {
        throw new Error("Failed to retrieve the created discount data");
      }

      const newDiscountOption = {
        id: createdRecord.id,
        value: createdRecord.id,
        label: `${createdRecord.name} (${createdRecord.rate}%)`,
        rate: createdRecord.rate,
        name: createdRecord.name,
      };

      setDiscountOptions((prev) => [...prev, newDiscountOption]);

      setDiscountDate((prev) => ({ ...prev, [index]: { discountName: "", discountRate: "" } }));
      setOpenDiscountForms((prev) => prev.filter((i) => i !== index));
      toast.success("Discount added successfully!");
    } catch (err: any) {
      console.error("Failed to add discount:", err);
      toast.error(err?.data?.message || "Failed to add discount");
    } finally {
      setIsAddingDiscount((prev) => {
        const next = [...prev];
        next[index] = false;
        return next;
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

    setItems((prev) => {
      const updated = [...prev];
      const optionIds = (selected || []).map((s: any) => s.id || s.value);
      if (!updated[index]) return updated;
      updated[index] = { ...updated[index], tax: optionIds, tax_key: optionIds.length > 0 };
      return updated;
    });
  };

  const handleRemoveTax = (index: number, optionToRemove: any) => {
    setSelectedTaxOptions((prev) => {
      const updated = [...prev];
      updated[index] = (updated[index] || []).filter((opt: any) => opt.id !== optionToRemove.id);
      return updated;
    });

    setItems((prev) => {
      const updated = [...prev];
      if (!updated[index]) return updated;

      updated[index] = {
        ...updated[index],
        tax: ((updated[index].tax || []) as string[]).filter(
          (id: string) => id !== optionToRemove.id
        ),
      };

      return updated;
    });

  };

  const toggleTaxForm = (index: number) => {
    setOpenTaxForms((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  const handleToggleTaxSection = (index: number) => {
    setShowTaxSection((prev) => ({ ...prev, [index]: !prev[index] }));
    setItems((prev) => {
      const updated = [...prev];
      if (!updated[index]) return updated;
      updated[index] = { ...updated[index], tax_key: !updated[index].tax_key };
      return updated;
    });
  };

  const handleAddTax = async (index: number) => {
    const data = taxDate[index];
    if (!data?.taxName || data?.taxRate === undefined || data?.taxRate === "") {
      toast.error("Enter tax name and rate");
      return;
    }

    try {
      setIsAddingTax((prev) => {
        const next = [...prev];
        next[index] = true;
        return next;
      });

      const token = localStorage.getItem('access_token');
      const decodedToken = token ? JSON.parse(atob(token.split('.')[1])) : null;
      const currentUserId = decodedToken?.sub;

      const result = await createTax({
        name: data.taxName,
        rate: Number(data.taxRate),
        user_id: currentUserId
      }).unwrap();

      // Safe extraction of the created record
      const createdRecord = result?.data || (Array.isArray(result) ? result[0] : result);

      if (!createdRecord) {
        throw new Error("Failed to retrieve the created tax data");
      }

      const newTaxOption = {
        id: createdRecord.id,
        value: createdRecord.id,
        label: `${createdRecord.name} (${createdRecord.rate}%)`,
        rate: createdRecord.rate,
        name: createdRecord.name,
      };

      setTaxOptions((prev) => [...prev, newTaxOption]);

      setTaxDate((prev) => ({ ...prev, [index]: { taxName: "", taxRate: "" } }));
      setOpenTaxForms((prev) => prev.filter((i) => i !== index));
      toast.success("Tax added successfully!");
    } catch (err: any) {
      console.error("Failed to add tax:", err);
      toast.error(err?.data?.message || "Failed to add tax");
    } finally {
      setIsAddingTax((prev) => {
        const next = [...prev];
        next[index] = false;
        return next;
      });
    }
  };

  /** ---------------- CALCULATIONS ---------------- */
  // Subtotal
  const subtotal = useMemo(() => {
    return items.reduce((acc, item) => acc + (Number(item.quantity || 0) * Number(item.price || 0)), 0);
  }, [items]);

  // Total discount amount (sum across items)
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

  const grandTotal = subtotal - totalDiscountAmount + totalTaxAmount;
  const [packages, setPackages] = useState<any>({});
  useEffect(() => {
    const fetchWallet = async () => {
      const token = localStorage.getItem('access_token');
      if (!token) return;
      try {
        const res = await axios.get(
          `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/wallet`,
          { 
            headers: { 
                Authorization: `Bearer ${token}`,
                'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
            } 
          }
        );
        setPackages(res?.data?.wallet || {});
      } catch (err: any) {
        console.error("Wallet fetch failed:", err);
      }
    };

    fetchWallet();
    const interval = setInterval(fetchWallet, 30000);
    return () => clearInterval(interval);
  }, []);

  /** ---------------- FORM SUBMIT ---------------- */
  const handleSubmitEstimate = async (e?: FormEvent, confirmedTemplateId?: number, downloadChecked = false, emailChecked = false) => {
    if (e) e.preventDefault();
    const token = localStorage.getItem('access_token');

    if (!selectedClient) {
      toast.error("Please select a client.");
      return;
    }
    if (!items.length) {
      toast.error("Please add at least one item.");
      return;
    }
    if (items.some((item) => !item.quantity || Number(item.quantity) < 1)) {
      toast.error("Quantity must be at least 1 for all items.");
      return;
    }

    const templateToUse = confirmedTemplateId || selectedTemplate;

    if (!estimateId && !templateToUse) {
      toast.error("Please select a template before creating the estimate.");
      return;
    }
    
    if (!estimateId && !(packages?.estimate_remaining >= 1)) {
      toast.error("Please subscribe to a package to create Estimates");
      return;
    }

    try {
      // 1. Upload images securely with their designated bucket targets
      let finalLogo = logoPreviewUrl;
      let finalSignature = signaturePreviewUrl;

      if (logoFile) {
          finalLogo = await S3UploadService.uploadFileInChunks(logoFile, undefined, 'paybue-invoice-estimation/logos');
      }
      if (signatureFile) {
          finalSignature = await S3UploadService.uploadFileInChunks(signatureFile, undefined, 'paybue-invoice-estimation/signatures');
      }

      const decodedToken = JSON.parse(atob((token || '').split('.')[1]));

      // 2. Build the parent JSON body matching exact API Document Schema
      const parentBody: any = {
        user_id: decodedToken.sub,
        estimate_date: estimateDate || null,
        valid_until: estimateDue || null,
        payment_terms: Number(paymentTerms),
        notes: notes || null,
        estimate_number: estimateNumber || null,
        client_id: selectedClient,
        
        template_number: templateToUse ? Number(templateToUse) : null,
        total: grandTotal
      };

      if (finalLogo) parentBody.logo_url = finalLogo;
      if (finalSignature) parentBody.signature_url = finalSignature;


      // 3. Submit
      let response;
      let resolvedEstimateId = estimateId;

      // SAFETY GUARD: If we have an ID but somehow fell into a create-only pathway, Force Update
      if (resolvedEstimateId) {
          console.log("[Guard] ID exists, forcing UPDATE for estimate:", resolvedEstimateId);
          response = await updateEstimate({ estimate_id: resolvedEstimateId, body: parentBody }).unwrap();
          
          // Delete old items prior to fresh bulk insert
          await axios.delete(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/estimate_items?estimate_id=eq.${resolvedEstimateId}`, {
              headers: {
                  Authorization: `Bearer ${token}`,
                  apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
              }
          });
      } else {
          console.log("[Guard] No ID, performing CREATE");
          response = await createEstimate(parentBody).unwrap();
          resolvedEstimateId = response?.id || response?.[0]?.id || response?.data?.id;

          // 4. Consume credit for newly minted estimates
          try {
            await axios.post(
              `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/consume-credit`,
              { action_type: "estimate" },
              {
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                  'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
                },
              }
            );
          } catch (creditErr) {
            console.warn("Credit deduction failed:", creditErr);
          }
      }

      // Natively insert fresh line items
      if (resolvedEstimateId) {
        for (const [index, it] of items.entries()) {
            const nativeItemInsert = {
                estimate_id: resolvedEstimateId,
                product_id: it.product || null,
                client_id: selectedClient,
                description: it.description || "",
                quantity: Number(it.quantity) || 1,
                price: Number(it.price) || 0,
                tax_key: !!it.tax_key,
                discount_key: !!it.discount_key
            };

            const itemRes = await axios.post(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/estimate_items`, nativeItemInsert, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
                    'Prefer': 'return=representation'
                }
            });

            const insertedItem = itemRes.data?.[0];
            if (insertedItem?.id) {
                // Save Taxes
                const taxIds = Array.isArray(it.tax) ? it.tax : (selectedTaxOptions[index]?.map((t: any) => t.id ?? t.value) || []);
                if (taxIds.length > 0) {
                    for (const tId of taxIds) {
                        await axios.post(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/estimate_item_taxes`, {
                            estimate_item_id: insertedItem.id,
                            tax_id: tId
                        }, {
                            headers: {
                                Authorization: `Bearer ${token}`,
                                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
                            }
                        });
                    }
                }
                // Save Discounts
                const discIds = Array.isArray(it.discount) ? it.discount : (selectedDiscountOptions[index]?.map((d: any) => d.id ?? d.value) || []);
                if (discIds.length > 0) {
                    for (const dId of discIds) {
                        await axios.post(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/estimate_item_discounts`, {
                            estimate_item_id: insertedItem.id,
                            discount_id: dId
                        }, {
                            headers: {
                                Authorization: `Bearer ${token}`,
                                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
                            }
                        });
                    }
                }
            }
        }
      }

      dispatch(clearSelectedTemplate());

        

        toast.success(estimateId ? "Estimate updated successfully!" : "Estimate created successfully!");

        try {
          const templateObj = templates.find((t) => t.id === templateToUse);
          if (templateObj) {
            const selectedClientObj = clients?.data?.find((c: any) => String(c.id) === String(selectedClient));
            const mappedItems = items.map((item, index) => {
              const productObj = products?.data?.find((p: any) => p.id === item.product);

              return {
                ...item,
                productName: productObj?.name || 'Unknown Product',
                discount: getItemDiscountRateFromForm(
                  item,
                  index,
                  selectedDiscountOptions,
                  showDiscountSection
                ),
                tax: getItemTaxRateFromForm(item, index, selectedTaxOptions, showTaxSection),
              };
            });

            const logoUrl = finalLogo || logoPreviewUrl || "";
            const sigUrl = finalSignature || signaturePreviewUrl || "";
            
            const [logoBase64, sigBase64] = await Promise.all([
              logoUrl ? S3UploadService.fetchAndConvertToBase64(logoUrl, logoUrl.startsWith('http') || logoUrl.startsWith('blob:') ? undefined : 'paybue-invoice-estimation/logos') : Promise.resolve(""),
              sigUrl ? S3UploadService.fetchAndConvertToBase64(sigUrl, sigUrl.startsWith('http') || sigUrl.startsWith('blob:') ? undefined : 'paybue-invoice-estimation/signatures') : Promise.resolve("")
            ]);

            const transformed = {
              from: {
                register: fromRegisterData,
                company: currentUserProfile?.company || {},
              },
              billTo: selectedClientObj || {},
              invoiceNumber: estimateNumber,
              estimateNumber: estimateNumber,
              invoiceDate: estimateDate,
              estimateDate: estimateDate,
              expirationDate: estimateDue,
              terms: notes,
              logo: logoBase64,
              signature: sigBase64,
              amount: grandTotal,
              taxes: taxesResponse,
              discounts: discountsResponse,
              products: products?.data,
              items: mappedItems || [],
            };

            // ── PDF generation (mirrors the proven invoice-template-modal approach) ───
            console.log("[PDF] Transformed data:", JSON.stringify(transformed, null, 2));
            const finalHTML = replacePlaceholders(templateObj.html, transformed as any);
            console.log("[PDF] finalHTML length:", finalHTML.length);

            const { pdf, blob: pdfBlob, cleanup } = await generatePdfFromHtml(finalHTML);
            cleanup();

              if (downloadChecked) {
                pdf.save(`estimate_${estimateNumber || "EB-0001"}.pdf`);
              }

              const finalPdfFile = new File([pdfBlob], `estimate_${estimateNumber || "EB-0001"}.pdf`, { type: "application/pdf" });
              const documentUrlPath = await S3UploadService.uploadFileInChunks(finalPdfFile, undefined, "paybue-invoice-estimation/estimates");

              await axios.patch(
                `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/estimates?id=eq.${resolvedEstimateId}`,
                { document_url: S3UploadService.getPublicUrl(documentUrlPath) },
                {
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("access_token")}`,
                    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
                    "Prefer": "return=minimal",
                  },
                }
              );

              if (emailChecked) {
                console.log("[PDF] Emailing estimate:", resolvedEstimateId, "to client:", selectedClient);
                if (!selectedClient) {
                  toast.error("Estimate created but couldn't send email: no client selected.");
                } else {
                  try {
                    const clientName = selectedClientObj?.name || "Client";
                    // Fix: Use JSON payload instead of FormData to match RTK mutation
                    console.log("[PDF] Sending Estimate Email via Axios:", { estimate_id: resolvedEstimateId, template_id: templateToUse, pdf_url: documentUrlPath });
                    await axios.post(`${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/template/send-estimate`, {
                      estimate_id: resolvedEstimateId,
                      template_id: templateToUse,
                      pdf_url: documentUrlPath,
                      clients: [selectedClient]
                    }, {
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${localStorage.getItem("access_token")}`,
                        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
                      }
                    });
                    toast.success(`Estimate emailed to ${clientName}!`);
                    console.log(`[PDF] Email successfully triggered for ${clientName} (${selectedClientObj?.email || 'no email found'})`);
                  } catch (emailErr) {
                    console.error("[PDF] Email failed:", emailErr);
                    toast.error("Estimate created/updated, but email delivery failed.");
                  }
                }
              }
          }
        } catch (err) {
          console.error("Native PDF extraction/upload error:", err);
          toast.error("Failed to compile or attach the PDF document safely.");
        }

        resetForm();
        refetch();
        navigate("/estimates");
      } catch (err: any) {
        setIsSendingEmail(false);
        console.error("Error submitting estimate:", err);
        toast.error(err?.data?.message || "Failed to submit estimate");
      }
    };






  const resetForm = () => {
    setEstimateNumber("EST-0001");
    setEstimateDate("");
    setEstimateDue("");
    setPaymentTerms("0");
    setNotes("");
    setLogoFile(null);
    setSignatureFile(null);
    setLogoPreviewUrl(null);
    setSignaturePreviewUrl(null);
    setItems([
      {
        product: "",
        client: selectedClient || "",
        description: "",
        quantity: 1,
        price: 0,
        amount: 0,
        id: "",
        tax_key: false,
        discount_key: false,
        tax: [],
        discount: [],
      },
    ]);
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

  /** ---------------- RENDER ---------------- */
  if (isFetchingEstimate) {
    return <div className="p-6 text-center text-gray-500">Loading estimate...</div>;
  }

  return (
    <>
      <div className="min-h-screen">
        <div className="container mx-auto max-w-7xl md:px-3 sm:px-5 py-6 sm:py-10">
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-1">
              <form
                onSubmit={handleSubmitEstimate}
                className="bg-white p-1 sm:p-6 md:p-8 rounded-2xl shadow-lg min-h-[calc(100vh-6rem)] w-full transition-all duration-200 overflow-visible"
              >
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 w-full items-start">
                  {/* Left main */}
                  <div className="xl:col-span-2 space-y-6">
                    <label className="block text-sm sm:text-base font-semibold mb-2 text-gray-700">
                      {estimateNumber}
                    </label>
                    <hr className="border-gray-300" />

                    <div className="mb-4 sm:mb-5">
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                        <label className="text-sm sm:text-base font-semibold uppercase text-gray-700">
                          FROM
                        </label>
                        <label onClick={() => navigate("/user/myprofile")} className="text-sm sm:text-base font-semibold capitalize cursor-pointer text-blue-400 hover:text-blue-600">
                          Edit Business Profile
                        </label>
                      </div>
                      <div className="p-2">
                        <p className="text-gray-700 text-sm sm:text-base font-semibold mb-1">
                          {fromRegisterData.company_name || fromRegisterData.name || userName || "-"}
                        </p>
                        <p className="text-gray-500 text-sm sm:text-base mb-1">{fromRegisterData.email || "-"}</p>
                        <p className="text-gray-500 text-sm sm:text-base mb-1">{fromRegisterData.phone || "-"}</p>
                        <p className="text-gray-500 text-sm sm:text-base">{fromRegisterData.address || "-"}</p>
                      </div>
                    </div>

                    <hr className="border-gray-300" />

                    {/* Client */}
                    <div className="sm:p-0 py-2 px-2">
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-2">
                        <label className="text-sm sm:text-base font-semibold uppercase text-gray-700">
                          CLIENT NAME
                        </label>
                        <button
                          type="button"
                          onClick={() => setOpenClientModal(true)}
                          className="text-blue-400 hover:text-blue-600 font-semibold text-sm sm:text-base"
                        >
                          New Client
                        </button>
                      </div>

                      <select
                        className="w-full h-12 sm:h-14 px-4 rounded-lg border border-gray-300 focus:border-blue-500 outline-none transition-all"
                        value={selectedClient || ""}
                        onChange={(e) => setSelectedClient(e.target.value || null)}
                        disabled={loadingClients}
                      >
                        <option value="">
                          {loadingClients ? "Loading clients..." : "Select Client"}
                        </option>
                        {clients?.data?.map((client: any) => (
                          <option key={client.id} value={client.id}>
                            {client.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <hr className="border-gray-300 my-5" />

                    {/* Items - each item renders its discount & tax sections */}
                    {items.map((item, index) => (
                      <div
                        key={index}
                        className="bg-white border border-gray-100 rounded-[2rem] mb-10 p-2 shadow-sm hover:shadow-md transition-all group overflow-visible"
                      >
                        {/* Header: Service/Product Selection */}
                        <div className="p-6 pb-2">
                          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-4">
                            <div className="flex items-center gap-3">
                              <span className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-black text-xs">
                                {index + 1}
                              </span>
                              <label className="text-[11px] font-black uppercase text-slate-400 tracking-widest">
                                SERVICE / PRODUCT
                              </label>
                            </div>
                            <div className="flex items-center gap-4">
                              <button
                                type="button"
                                onClick={() => setProductModalOpen(true)}
                                className="text-blue-500 hover:text-blue-600 font-bold text-xs uppercase tracking-wider"
                              >
                                + New Service
                              </button>
                              {items.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItem(index)}
                                  className="text-red-400 hover:text-red-600 font-bold text-xs uppercase tracking-wider flex items-center gap-1"
                                >
                                  <Cancel style={{ fontSize: 16 }} />
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>

                          <select
                            className="w-full h-14 px-6 rounded-2xl bg-slate-50 border-none focus:ring-2 focus:ring-blue-100 transition-all font-bold text-gray-800"
                            disabled={loadingProducts}
                            value={item.product || ""}
                            onChange={(e) => handleProductChange(index, e.target.value)}
                          >
                            <option value="">
                              {loadingProducts ? "Loading..." : "Select product or service"}
                            </option>
                            {products?.data?.map((product: any) => (
                              <option key={product.id} value={product.id}>
                                {product.name}
                              </option>
                            ))}
                          </select>

                          <textarea
                            name="description"
                            placeholder="Add a detailed description for this item..."
                            className="w-full h-24 mt-4 p-5 rounded-2xl bg-slate-50 border-none focus:ring-2 focus:ring-blue-100 transition-all text-sm text-slate-600 leading-relaxed resize-none"
                            value={item.description}
                            onChange={(e) => handleItemChange(index, e)}
                          />
                        </div>

                        {/* Stats Box: Quantity, Rate, Amount */}
                        <div className="p-2">
                          <div className="bg-[#F8FAFC] rounded-[1.5rem] p-6 grid grid-cols-1 sm:grid-cols-3 gap-6">
                            <div className="space-y-2">
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">
                                QUANTITY
                              </label>
                              <div className="relative">
                                <input
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
                                  className="w-full h-12 px-4 bg-white border border-slate-100 rounded-xl text-center font-black text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                  min={1}
                                />
                              </div>
                            </div>
                            <div className="space-y-2 border-l border-slate-200/50 sm:pl-6">
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">
                                UNIT PRICE
                              </label>
                              <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                                <input
                                  type="number"
                                  name="price"
                                  value={item.price}
                                  onChange={(e) => handleItemChange(index, e)}
                                  min="0"
                                  onKeyDown={(e) => {
                                    if (e.key === "-" || e.key === "e") e.preventDefault();
                                  }}
                                  className="w-full h-12 pl-8 pr-4 bg-white border border-slate-100 rounded-xl text-center font-black text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                />
                              </div>
                            </div>
                            <div className="space-y-2 border-l border-slate-200/50 sm:pl-6 text-center">
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                TOTAL AMOUNT
                              </label>
                              <div className="h-12 flex items-center justify-center">
                                <span className="text-xl font-black text-blue-600">
                                  ${(item.quantity * item.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="flex gap-4 mx-4 mt-4">
                          {/* Discount Toggle */}
                          <button
                            type="button"
                            onClick={() => handleToggleDiscountSection(index)}
                            className="flex items-center gap-2 text-blue-500"
                          >
                            <input
                              type="checkbox"
                              readOnly
                              checked={!!showDiscountSection[index]}
                            />
                            <span>Add Discount</span>
                          </button>

                          {/* Tax Toggle */}
                          <button
                            type="button"
                            onClick={() => handleToggleTaxSection(index)}
                            className="flex items-center gap-2 text-blue-500"
                          >
                            <input
                              type="checkbox"
                              readOnly
                              checked={!!showTaxSection[index]}
                            />
                            <span>Add Tax</span>
                          </button>
                        </div>


                        {/* Discount & Tax Section */}
                        <div className="flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-4 mt-4 w-full">
                          {/* Discount Card */}
                          {showDiscountSection[index] && (
                            <div className="flex flex-col items-center border border-gray-300 rounded-lg p-4 w-full md:w-[40%] relative z-30">
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
                                      <span>{option?.label}</span>
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
                            <div className="flex flex-col items-center border border-gray-300 rounded-lg p-4 w-full md:w-[40%] relative z-30">
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
                                      <span>{option?.label}</span>
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
                            <div className="mb-2 flex justify-between items-center">
                              <div className="flex items-center">
                                <span className="w-[5rem]">Tax total</span>
                                <div className="ml-2 flex items-center border border-gray-400 rounded-md shadow-sm">
                                  <input
                                    type="text"
                                    value={totalTaxAmount.toFixed(2)}
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
                                    value={totalDiscountAmount.toFixed(2)}
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
                    <div className="mt-6">
                      <label className="block text-sm sm:text-base font-semibold uppercase mb-2 text-gray-700">
                        PAYMENT TERMS
                      </label>
                      <select
                        className="w-full h-[45px] sm:h-[50px] px-4 rounded-lg border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-200 outline-none"
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
                    <div className="mt-4">
                      <label className="block text-sm sm:text-base font-semibold uppercase mb-2 text-gray-700">
                        NOTES
                      </label>
                      <textarea
                        name="notes"
                        placeholder="Additional terms or notes..."
                        className="w-full h-[90px] sm:h-[110px] p-3 sm:p-4 rounded-lg border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-200 outline-none resize-none"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      ></textarea>
                    </div>
                  </div>

                  {/* ===== Right Sidebar Section ===== */}
                  <div className="space-y-6 p-4 sm:p-6 border-t-2 xl:border-t-0 xl:border-l-2 border-dashed border-[#2B364136] flex flex-col items-center">
                    {/* Logo Upload */}
                    <div
                      className="border-2 border-dashed border-gray-300 w-full max-w-xs rounded-lg hover:border-blue-300 transition-all duration-300 cursor-pointer bg-white h-[150px] flex flex-col items-center justify-center"
                      onClick={() => logoInputRef.current?.click()}
                    >
                      {logoPreviewUrl ? (
                        <img
                          src={logoPreviewUrl}
                          alt="Logo Preview"
                          className="h-full object-contain"
                        />
                      ) : (
                        <span className="mt-4 text-gray-600 text-center">Upload Logo</span>
                      )}
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      ref={logoInputRef}
                      onChange={(e) => handleFileChange(e, "logo")}
                      className="hidden"
                    />

                    {/* Date Fields */}
                    <div className="w-full space-y-6 mt-6">
                      <div>
                        <label className="block text-sm sm:text-base font-semibold uppercase mb-2 text-gray-700">
                          ESTIMATE DATE
                        </label>
                        <input
                          type="date"
                          className="w-full h-[45px] sm:h-[50px] px-4 rounded-lg border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-200 outline-none"
                          value={estimateDate}
                          onChange={(e) => setEstimateDate(e.target.value)}
                        />
                      </div>

                      <div>
                        <label className="block text-sm sm:text-base font-semibold uppercase mb-2 text-gray-700">
                          ESTIMATE DUE
                        </label>
                        <input
                          type="date"
                          className="w-full h-[45px] sm:h-[50px] px-4 rounded-lg border border-gray-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-200 outline-none"
                          value={estimateDue}
                          onChange={(e) => setEstimateDue(e.target.value)}
                        />
                      </div>

                      {/* Signature Upload */}
                      <div
                        className="border-2 border-dashed border-gray-300 w-full rounded-lg hover:border-blue-300 transition-all duration-300 cursor-pointer bg-white h-[100px] flex flex-col items-center justify-center"
                        onClick={() => signatureInputRef.current?.click()}
                      >
                        {signaturePreviewUrl ? (
                          <img
                            src={signaturePreviewUrl}
                            alt="Signature Preview"
                            className="h-full object-contain"
                          />
                        ) : (
                          <span className="text-gray-600 text-sm sm:text-base">Attach Signature</span>
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
                <FormNewClienteModal open={openClientModal} onClose={() => setOpenClientModal(false)} />
                <FormNewProductModal
                  open={isProductModalOpen}
                  onClose={() => setProductModalOpen(false)}
                />

                {/* ===== Footer Buttons ===== */}
                <div className="mt-8 pt-6 border-t border-gray-200">
                  <div className="flex flex-col sm:flex-row justify-end gap-4">
                    <button
                      onClick={onClose}
                      className="h-[45px] sm:h-[48px] px-6 rounded-full border border-gray-200 bg-white text-[#1A1E50] hover:bg-gray-100 transition-all"
                      type="button"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="h-[45px] sm:h-[48px] px-6 rounded-full border border-gray-300 bg-[#F9FAFB] text-gray-700 hover:bg-gray-100 transition-all"
                      onClick={() => {
                        toast.info("Saved locally (draft)"); // keep same behavior or wire real save-draft if needed
                      }}
                    >
                      Save Draft
                    </button>
                    <button
                      type="button"
                      disabled={isCreatingEstimate || isUpdatingEstimate}
                      onClick={() => {
                        if (estimateId) {
                          // Update mode
                          handleSubmitEstimate();
                        } else {
                          // Create mode
                          if (!selectedTemplate) {
                            // Open modal first if no template selected yet
                            setModalOpen(true);
                          } else {
                            // Template already selected → submit form
                            handleSubmitEstimate();
                          }
                        }
                      }}
                      className={`h-[45px] sm:h-[48px] px-8 rounded-full font-medium transition-all ${isCreatingEstimate || isUpdatingEstimate
                        ? "bg-blue-300 cursor-not-allowed text-white"
                        : "bg-blue-600 hover:bg-blue-700 text-white shadow-md"
                        }`}
                    >
                      {isCreatingEstimate
                        ? "Creating..."
                        : isSendingEmail
                          ? "Sending Email..."
                          : isUpdatingEstimate
                            ? "Updating..."
                            : estimateId
                              ? "Update Estimate"
                              : "Create Estimate"}
                    </button>

                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      <SelectTemplateEstimate
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
        }}
        onConfirmActions={async (templateId: number, dlChecked: boolean, emChecked: boolean) => {
          dispatch(clearSelectedTemplate());
          setModalOpen(false);
          await handleSubmitEstimate(undefined, templateId, dlChecked, emChecked);
        }}
        setModalOpen={setModalOpen}
        previewData={{
          client: selectedClient,
          clientObj: clients?.data?.find((c: any) => String(c.id) === String(selectedClient)),
          user: getCurrentUser?.data || getCurrentUser,
          items: items.map((item, index) => ({
            ...item,
            discount: getItemDiscountRateFromForm(
              item,
              index,
              selectedDiscountOptions,
              showDiscountSection
            ),
            tax: getItemTaxRateFromForm(item, index, selectedTaxOptions, showTaxSection),
          })),
          invoiceDate: estimateDate,
          invoiceDue: estimateDue,
          notes,
          paymentTerms,
          logo: logoFile,
          signature: signatureFile,
          number: estimateNumber,
        }}
      />


    </>
  );
};

export default FormInvoiceEstimate;