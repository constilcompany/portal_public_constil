/* eslint-disable react-refresh/only-export-components */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import React, { useMemo, useState } from "react";
import { FormTemplateSelectionModal } from './form-template-selection-modal';
import { useGetPackageBuyQuery } from "../../services/rtkapi/invoiceApi";
import { useDispatch } from 'react-redux';
import { setSelectedTemplate } from '../../redux/templateSlice';
import { AppDispatch } from '../../redux/store';
import { S3UploadService } from "../../components/data/s3-data";
import { 
  useGetClientsQuery, 
  useGetUserProfileQuery, 
  useGetProductsQuery,
} from "../../services/rtkapi/invoiceApi";

// Assets
import Invoice1 from "../../assets/Invoice_1.png";
import Invoice2 from "../../assets/Invoice_2.png";
import Invoice3 from "../../assets/Invoice_3.png";
import Invoice4 from "../../assets/Invoice_4.png";
import Invoice5 from "../../assets/Invoice_5.png";
import Invoice6 from "../../assets/Invoice_6.png";
import Invoice7 from "../../assets/Invoice_7.png";
import Invoice8 from "../../assets/Invoice_8.png";
import Invoice9 from '../../assets/Invoice_9.png';

// Import templates
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
import { replacePlaceholders } from '../template/template-document-utils';

export { replacePlaceholders };

export const templates: any[] = [
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

const SelectTemplateEstimate: React.FC<any> = ({ open, onClose, previewData, setModalOpen, onConfirmActions }) => {
  const [downloadChecked, setDownloadChecked] = useState(false);
  const [emailChecked, setEmailChecked] = useState(false);
  const [loadingTemplateId, setLoadingTemplateId] = useState(null);
  const [previewFullOpen, setPreviewFullOpen] = useState(false);
  const [selectedTemplateOne, setSelectedTemplateOne] = useState(null);
  const [fullPreviewHtml, setFullPreviewHtml] = useState('');

  const dispatch = useDispatch<AppDispatch>();
  const { data: allClientsRes } = useGetClientsQuery();
  const allClientsGet = allClientsRes?.data || [];
  const { data: getCurrentUserRes } = useGetUserProfileQuery();
  const user = getCurrentUserRes?.data || getCurrentUserRes;
  const { data: allProductsRes } = useGetProductsQuery();
  const { data: packageData, isLoading: isPackageLoading } = useGetPackageBuyQuery();

  const availableTemplates = useMemo(() => {
    const wallet = packageData?.wallet;
    if (!wallet) return templates;

    if (wallet.enterprise_templates || wallet.professional_templates) return templates;
    if (wallet.basic_templates) return templates.slice(0, 3);

    return templates;
  }, [packageData]);

  const handleView = async (id: number) => {
    setLoadingTemplateId(id);
    setSelectedTemplateOne(id);

    const template = templates.find((t) => t.id === id);
    if (!template) return;

    const res = previewData;
    const selectedClientObj = previewData.clientObj || allClientsGet.find((c) => String(c.id) === String(res.client));
    
    const mappedItems = res.items.map((item) => {
      const productObj = allProductsRes?.data?.find((p) => p.id === item.product);
      return {
        ...item,
        productName: productObj?.name || item.product || 'Unknown Product',
      };
    });

    const logoSource = res?.logo_url || res?.logo || res?.company_logo || "";
    const signatureSource = res?.signature_url || res?.signature || "";
    const logoUrl = await S3UploadService.getFileAsBase64(logoSource, 'paybue-invoice-estimation/logos');
    const signatureUrl = await S3UploadService.getFileAsBase64(signatureSource, 'paybue-invoice-estimation/signatures');

    const transformed = {
      from: previewData.user || user,
      billTo: selectedClientObj || {},
      invoiceNumber: res.number,
      invoiceDate: res.invoiceDate,
      expirationDate: res.invoiceDue,
      terms: res.notes,
      logo: logoUrl,
      signature: signatureUrl,
      items: mappedItems || [],
    };

    const finalHTML = replacePlaceholders(template.html, transformed as any);
    setFullPreviewHtml(finalHTML);
    onClose();
    setPreviewFullOpen(true);
    setLoadingTemplateId(null);
  };

  const handleSelectTemplate = (id) => {
    setSelectedTemplateOne(id);
  };

  return (
    <FormTemplateSelectionModal
      open={open}
      onClose={() => {
        onClose();
        setPreviewFullOpen(false);
      }}
      documentType="Estimate"
      templates={availableTemplates}
      isLoading={isPackageLoading}
      selectedTemplateId={selectedTemplateOne}
      onSelectTemplate={handleSelectTemplate}
      loadingTemplateId={loadingTemplateId}
      onViewTemplate={handleView}
      downloadChecked={downloadChecked}
      onDownloadCheckedChange={setDownloadChecked}
      emailChecked={emailChecked}
      onEmailCheckedChange={setEmailChecked}
      onConfirm={() => {
        if (onConfirmActions) {
          onConfirmActions(selectedTemplateOne, downloadChecked, emailChecked);
        } else {
          dispatch(setSelectedTemplate(selectedTemplateOne));
          onClose();
        }
      }}
      previewOpen={previewFullOpen}
      onPreviewClose={() => setPreviewFullOpen(false)}
      onPreviewBack={() => {
        setPreviewFullOpen(false);
        setModalOpen(true);
      }}
      previewHtml={fullPreviewHtml}
    />
  );
};

export default SelectTemplateEstimate;