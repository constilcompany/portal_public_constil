/* eslint-disable react-refresh/only-export-components */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { S3UploadService } from "../data/s3-data";
import React, { useMemo, useState } from 'react';
import { FormTemplateSelectionModal } from './form-template-selection-modal';

// IMAGES + HTML IMPORTS (your existing code)
import logoImage from '../template/estimate 3/assets/CONSTIL.svg'
import logoWhite from '../template/estimate 3/assets/CONSTILWHite.svg'
import Invoice1 from '../../assets/Invoice_1.png';
import Invoice2 from '../../assets/Invoice_2.png';
import Invoice3 from '../../assets/Invoice_3.png';
import Invoice4 from '../../assets/Invoice_4.png';
import Invoice5 from '../../assets/Invoice_5.png';
import Invoice6 from '../../assets/Invoice_6.png';
import Invoice7 from '../../assets/Invoice_7.png';
import Invoice8 from '../../assets/Invoice_8.png';
import Invoice9 from '../../assets/Invoice_9.png';

import template1 from '../template/invoice 3/invoice1.html?raw';
import template2 from '../template/invoice 3/invoice2.html?raw';
import template3 from '../template/invoice 3/Invoice3.html?raw';
import template4 from '../template/invoice 3/invoice4.html?raw';
import template5 from '../template/invoice 3/invoice5.html?raw';
import template6 from '../template/invoice 3/invoice6.html?raw';
import template7 from '../template/invoice 3/invoice7.html?raw';
import template8 from '../template/invoice 3/invoice8.html?raw';
import template9 from '../template/invoice 3/invoice9.html?raw';

import {
  useGetClientsQuery,
  useGetPackageBuyQuery,
  useGetProductsQuery,
  useGetUserProfileQuery,
  useGetTaxesQuery,
  useGetDiscountsQuery,
} from '../../services/rtkapi/invoiceApi';
import { InvoiceData } from '../../types/invoice';
import { useDispatch } from 'react-redux';
import { setSelectedTemplate } from '../../redux/templateSlice';
import { AppDispatch } from '../../redux/store';
import { replacePlaceholders } from '../template/template-document-utils';
import { getApiList } from '../../utils/api-list';

export { replacePlaceholders };

export const templates = [
  { id: 1, src: Invoice1, alt: 'Invoice Template 1', html: template1 },
  { id: 2, src: Invoice2, alt: 'Invoice Template 2', html: template2 },
  { id: 3, src: Invoice3, alt: 'Invoice Template 3', html: template3 },
  { id: 4, src: Invoice4, alt: 'Invoice Template 4', html: template4 },
  { id: 5, src: Invoice5, alt: 'Invoice Template 5', html: template5 },
  { id: 6, src: Invoice6, alt: 'Invoice Template 6', html: template6 },
  { id: 7, src: Invoice7, alt: 'Invoice Template 7', html: template7 },
  { id: 8, src: Invoice8, alt: 'Invoice Template 8', html: template8 },
  { id: 9, src: Invoice9, alt: 'Invoice Template 9', html: template9 },
];

const SelectTemplate = ({ open, onClose, previewData, setModalOpen, onConfirmActions }) => {
  const [downloadChecked, setDownloadChecked] = useState(false);
  const [emailChecked, setEmailChecked] = useState(false);

  const [loadingTemplateId, setLoadingTemplateId] = useState(null);
  const dispatch = useDispatch<AppDispatch>();
  const [previewFullOpen, setPreviewFullOpen] = useState(false);
  const [selectedTemplateOne, setSelectedTemplateOne] = useState(null);
  const [fullPreviewHtml, setFullPreviewHtml] = useState('');
  const { data: allClients } = useGetClientsQuery();
  const allClientsGet = allClients?.data || [];
  const { data: getCurrentUser } = useGetUserProfileQuery();
  const { data: allproducts } = useGetProductsQuery();
  const { data: allTaxes } = useGetTaxesQuery();
  const { data: allDiscounts } = useGetDiscountsQuery();
  const { data, isLoading } = useGetPackageBuyQuery();

  const availableTemplates = useMemo(() => {
    const wallet = data?.wallet;
    // Match estimate flow: show templates while wallet loads or if API omits wallet
    if (!wallet) return templates;

    if (wallet.enterprise_templates || wallet.professional_templates) return templates;
    if (wallet.basic_templates) return templates.slice(0, 3);

    return templates;
  }, [data]);
  const handleView = async (id: number) => {
    setLoadingTemplateId(id);
    setSelectedTemplateOne(id); // Automatically select when viewing to avoid mismatched downloads

    const template = templates.find((t) => t.id === id);
    if (!template) return;

    const res = previewData;
    const clientId = res.client;
    const selectedClientObj = allClientsGet.find((c) => c.id === clientId);
    
    // Enrich items with their calculated total rates for specific preview
    console.log("[Preview] Processing items for preview. Taxes available:", !!allTaxes, "Discounts available:", !!allDiscounts);
    const mappedItems = res.items.map((item, idx) => {
      const productObj = allproducts?.data?.find((p) => p.id === item.product);
      
      // Resolve discount rates
      let dRate = 0;
      if (Array.isArray(item.discount)) {
        item.discount.forEach(d => {
          if (typeof d === 'object' && d.rate !== undefined) {
            dRate += (parseFloat(d.rate) || 0);
          } else {
            const found = getApiList(allDiscounts).find(x => String(x.id) === String(d));
            console.log(`[Preview] Item ${idx} discount lookup for ${d}:`, found ? found.rate : "NOT FOUND");
            if (found) dRate += (parseFloat(found.rate) || 0);
          }
        });
      } else if (typeof item.discount === 'number') {
        dRate = item.discount;
      }

      // Resolve tax rates
      let tRate = 0;
      if (Array.isArray(item.tax)) {
        item.tax.forEach(t => {
          if (typeof t === 'object' && t.rate !== undefined) {
            tRate += (parseFloat(t.rate) || 0);
          } else {
            const found = getApiList(allTaxes).find(x => String(x.id) === String(t));
            if (found) tRate += (parseFloat(found.rate) || 0);
          }
        });
      } else if (typeof item.tax === 'number') {
        tRate = item.tax;
      }

      return {
        ...item,
        productName: productObj?.name || item.product || 'Unknown Product',
        discount: dRate,
        tax: tRate,
      };
    });

            const logoSource = res?.logo_url || res?.logo || res?.company_logo || res?.company?.logo_url || "";
    const signatureSource = res?.signature_url || res?.signature || res?.user?.signature_url || res?.user?.signature || "";
    
    const logoUrl = await S3UploadService.getFileAsBase64(logoSource, 'paybue-invoice-estimation/logos');
    const signatureUrl = await S3UploadService.getFileAsBase64(signatureSource, 'paybue-invoice-estimation/signatures');

    const transformed = {
      from: getCurrentUser?.data || getCurrentUser,
      billTo: selectedClientObj || {},
      invoiceNumber: res.number,
      invoiceDate: res.invoiceDate,
      expirationDate: res.invoiceDue,
      terms: res.notes,
      logo: logoUrl,
      signature: signatureUrl,
      amount: mappedItems.reduce((acc, item) => {
        const sub = item.price * item.quantity;
        const disc = (sub * item.discount) / 100;
        const tax = ((sub - disc) * item.tax) / 100;
        return acc + (sub - disc + tax);
      }, 0),
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

  const pathCheck = window.location.pathname === '/invoices/new' ? 'Invoice' : 'Estimate';

  return (
    <FormTemplateSelectionModal
      open={open}
      onClose={() => {
        onClose();
        setPreviewFullOpen(false);
      }}
      documentType={pathCheck}
      templates={availableTemplates}
      isLoading={isLoading}
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

export default SelectTemplate;
