/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useMemo, useState } from "react";
import {
    Modal,
    Box,
    IconButton,
    Typography,
    Grid,
    CircularProgress,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import CheckIcon from "@mui/icons-material/Check";

import Invoice1 from "../../assets/Invoice_1.png";
import Invoice2 from "../../assets/Invoice_2.png";
import Invoice3 from "../../assets/Invoice_3.png";
import Invoice4 from "../../assets/Invoice_4.png";
import Invoice5 from "../../assets/Invoice_5.png";
import Invoice6 from "../../assets/Invoice_6.png";
import Invoice7 from "../../assets/Invoice_7.png";
import Invoice8 from "../../assets/Invoice_8.png";

import {
    useGetInvoicesQuery,
    usePostInvoiceIdQuery,
} from "../../services/rtkapi/invoiceApi";

const templates = [
    { id: 1, src: Invoice1, alt: "Template 1" },
    { id: 2, src: Invoice2, alt: "Template 2" },
    { id: 3, src: Invoice3, alt: "Template 3" },
    { id: 4, src: Invoice4, alt: "Template 4" },
    { id: 5, src: Invoice5, alt: "Template 5" },
    { id: 6, src: Invoice6, alt: "Template 6" },
    { id: 7, src: Invoice7, alt: "Template 7" },
    { id: 8, src: Invoice8, alt: "Template 8" },
];

interface SelectTemplateProps {
    open: boolean;
    onClose: () => void;
    onSelectFileUrl: (url: string) => void; // parent ko URL bhejne ke liye
}

const InvoiceShareModal: React.FC<SelectTemplateProps> = ({
    open,
    onClose,
    onSelectFileUrl,
}) => {
    const path = window.location.pathname;
    const pathCheck = path === "/invoices/support" ? "Invoice" : "Estimate";
const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null);
const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
    const { data, isLoading, isError } = useGetInvoicesQuery();

    const availableTemplates = useMemo(() => {
        if (!data?.data) return [];
        const templateIds = Array.from(new Set(data.data.map(inv => inv.template_number)));
        return templates.filter(t => templateIds.includes(t.id));
    }, [data]);

 const { data: invoiceUrlData } = usePostInvoiceIdQuery(
    { invoice_id: selectedInvoiceId! },
    { skip: !selectedInvoiceId }
);
const handleSelect = (templateId: number) => {
    setSelectedTemplate(templateId);

    const invoice = data?.data.find((inv: any) => inv.template_number === templateId);
    if (!invoice) return;

    setSelectedInvoiceId(invoice.id); 
};

useEffect(() => {
    if (invoiceUrlData?.data?.url) {
        onSelectFileUrl(invoiceUrlData.data.url);
    }
}, [invoiceUrlData]);


    return (
        <Modal open={open} onClose={onClose}>
            <Box
                sx={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: "90%",
                    maxWidth: 1000,
                    bgcolor: "#fff",
                    borderRadius: 3,
                    boxShadow: 24,
                    overflow: "hidden",
                    maxHeight: "90vh",
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                {/* HEADER */}
                <Box
                    sx={{
                        backgroundColor: "#0b0e3f",
                        color: "#fff",
                        py: 2,
                        px: 3,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        position: "relative",
                    }}
                >
                    <Typography variant="h6" fontWeight={600}>
                        Select the {pathCheck} model
                    </Typography>
                    <IconButton
                        onClick={onClose}
                        sx={{
                            position: "absolute",
                            right: 16,
                            top: "50%",
                            transform: "translateY(-50%)",
                            color: "#fff",
                        }}
                    >
                        <CloseIcon />
                    </IconButton>
                </Box>

                {/* BODY */}
                <Box sx={{ p: 4, flex: 1, overflowY: "auto" }}>
                    {isLoading ? (
                        <Box display="flex" justifyContent="center" py={5}>
                            <CircularProgress />
                        </Box>
                    ) : isError ? (
                        <Typography color="error" textAlign="center">
                            Failed to load invoices. Please try again.
                        </Typography>
                    ) : availableTemplates.length === 0 ? (
                        <Typography textAlign="center" color="text.secondary">
                            No templates available for these invoices.
                        </Typography>
                    ) : (
                        <Grid container spacing={3} justifyContent="center">
                            {availableTemplates.map((template) => (
                                <Grid item key={template.id} xs={12} sm={6} md={4}>
                                    <Box
                                        onClick={() => handleSelect(template.id)}
                                        sx={{
                                            position: "relative",
                                            border:
                                                selectedTemplate === template.id
                                                    ? "2px solid #22c55e"
                                                    : "1px solid #e5e7eb",
                                            borderRadius: 2,
                                            overflow: "hidden",
                                            cursor: "pointer",
                                            transition: "0.3s",
                                            backgroundColor: "#fff",
                                            boxShadow:
                                                selectedTemplate === template.id
                                                    ? "0 4px 12px rgba(34, 197, 94, 0.2)"
                                                    : "0 2px 8px rgba(0,0,0,0.05)",
                                            "&:hover": {
                                                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                                            },
                                        }}
                                    >
                                        {selectedTemplate === template.id && (
                                            <Box
                                                sx={{
                                                    position: "absolute",
                                                    top: 10,
                                                    right: 10,
                                                    backgroundColor: "#22c55e",
                                                    borderRadius: "50%",
                                                    padding: "4px",
                                                    zIndex: 1,
                                                }}
                                            >
                                                <CheckIcon sx={{ color: "#fff", fontSize: 16 }} />
                                            </Box>
                                        )}

                                        <img
                                            src={template.src}
                                            alt={template.alt}
                                            style={{
                                                width: "100%",
                                                height: "350px",
                                                borderBottom: "1px solid #eee",
                                            }}
                                        />
                                        <Typography
                                            variant="body2"
                                            sx={{
                                                textAlign: "center",
                                                py: 2,
                                                fontWeight: 500,
                                                color:
                                                    selectedTemplate === template.id
                                                        ? "#0b0e3f"
                                                        : "#374151",
                                            }}
                                        >
                                            {template.alt}
                                        </Typography>
                                    </Box>
                                </Grid>
                            ))}
                        </Grid>
                    )}
                </Box>
            </Box>
        </Modal>
    );
};

export default InvoiceShareModal;
