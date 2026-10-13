import React, { useState } from "react";
import {
    Menu,
    MenuItem,
    Box,
    Tabs,
    Tab,
    Badge,
    Pagination,
} from "@mui/material";
import PlanLimitModal from "../../components/modal/plan-limit-modal";
import EstimateTemplateModal from "../../components/modal/estimate-template-modal";
import InvoiceTemplateModal from "../../components/modal/invoice-template-modal";
import {
    useGetInvoicesQuery,
    useDeleteInvoiceMutation,
    useDeleteEstimateMutation,
    useGetEstimatesQuery,
} from "../../services/rtkapi/invoiceApi";
import { InvoiceModel } from "../../models/invoice";
import { showConfirmToast } from "../../components/messagealert/confirm-toast";
import SidebarInvoiceCard from "../home/sidebarcard";
export function Notifiction() {

    const [planLimitModalOpen, setPlanLimitModalOpen] = useState(false);
    const [planName] = useState("");
    const [tabIndex, setTabIndex] = useState(0); // 0 => Invoices, 1 => Estimates
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [selectedInvoice, setSelectedInvoice] = useState<InvoiceModel | null>(null);
    const [templateModalOpen, setTemplateModalOpen] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);



    const { data: invoicesData } = useGetInvoicesQuery();
    const { data: estimateData } = useGetEstimatesQuery();
    const invoices: InvoiceModel[] = InvoiceModel.fromListResponse(invoicesData?.data ?? []);
    const estimates: InvoiceModel[] = InvoiceModel.fromListResponse(estimateData?.data ?? []).filter((e) => !e.estimate_number?.trim().toUpperCase().startsWith('AI-'));

    const [deleteInvoice] = useDeleteInvoiceMutation();
    const [deleteEstimate] = useDeleteEstimateMutation();
    const open = Boolean(anchorEl);
    const handleUpgrade = () => setPlanLimitModalOpen(false);
    const handleMenuClick = (event: React.MouseEvent<HTMLElement>, invoice: InvoiceModel) => {
        setAnchorEl(event.currentTarget);
        setSelectedInvoice(invoice);
    };

    const handleCloseMenu = () => setAnchorEl(null);

    const handleDelete = () => {
        if (!selectedInvoice?.id) return;
        const invoiceId = selectedInvoice.id;

        const isInvoice = !!selectedInvoice.invoice_number;
        const isEstimate = !!selectedInvoice.estimate_number;

        showConfirmToast({
            message: "You won't be able to revert this!",
            onConfirm: async () => {
                try {
                    if (isInvoice) {
                        await deleteInvoice(invoiceId).unwrap();
                    } else if (isEstimate) {
                        await deleteEstimate(invoiceId).unwrap();
                    }
                } catch (error) {
                    // logging intentionally minimal here
                    console.error("Delete error", error);
                }
            },
        });

        handleCloseMenu();
    };

    const handleView = () => {
        handleCloseMenu();
        if (selectedInvoice) {
            if (selectedInvoice.invoice_number) {
                setTemplateModalOpen(true);
            } else if (selectedInvoice.estimate_number) {
                setModalOpen(true);
            }
        }
    };


    const notifications = [
        {
            date: "Today, November 15, 2025",
            items: [
                {
                    title: "Invoices not paid",
                    description: "This invoice has not been paid for 6 days.",
                    buttonText: "Resend",
                    viewText: "View Invoices",
                },
                {
                    title: "Estimates not paid",
                    description: "This invoice has not been paid for 6 days.",
                    buttonText: "Resend",
                    viewText: "View Estimate",
                },
            ],
        },
        {
            date: "Yesterday, November 14, 2025",
            items: [
                {
                    title: "Invoices not paid",
                    description: "This invoice has not been paid for 6 days.",
                    buttonText: "Resend",
                    viewText: "View Invoices",
                },
                {
                    title: "Estimates not paid",
                    description: "This invoice has not been paid for 6 days.",
                    buttonText: "Resend",
                    viewText: "View Estimate",
                },
                {
                    title: "Estimates not paid",
                    description: "This invoice has not been paid for 6 days.",
                    buttonText: "Resend",
                    viewText: "View Estimate",
                },
            ],
        },
    ];


    return (
        <main className="flex flex-col lg:flex-row md:pt-0 gap-6 md:mt-0 min-h-[calc(100vh-4rem)] overflow-hidden">
            {/* Mobile Tabs */}
            <div className="lg:hidden bg-white rounded-2xl shadow-sm p-4">
                <Tabs
                    value={tabIndex}
                    onChange={(_, newIndex) => setTabIndex(newIndex)}
                    variant="fullWidth"
                    className="border-b-2 border-gray-200"
                    TabIndicatorProps={{ style: { display: "none" } }}
                >
                    <Tab
                        label={
                            <Box className="flex items-center gap-2 w-full justify-between">
                                <span className={`text-sm font-medium ${tabIndex === 0 ? "text-[#448AFF]" : "text-gray-400"}`}>
                                    Invoices
                                </span>
                                <Badge
                                    badgeContent={invoices.length}
                                    sx={{
                                        "& .MuiBadge-badge": {
                                            backgroundColor: "#E0E0E0",
                                            color: "#555",
                                            fontSize: "0.75rem",
                                            height: "20px",
                                            minWidth: "20px",
                                        },
                                    }}
                                />
                            </Box>
                        }
                    />
                    <Tab
                        label={
                            <Box className="flex items-center gap-2 w-full justify-between">
                                <span className={`text-sm font-medium ${tabIndex === 1 ? "text-[#448AFF]" : "text-gray-400"}`}>
                                    Estimates
                                </span>
                                <Badge
                                    badgeContent={estimates.length}
                                    sx={{
                                        "& .MuiBadge-badge": {
                                            backgroundColor: "#E0E0E0",
                                            color: "#555",
                                            fontSize: "0.75rem",
                                            height: "20px",
                                            minWidth: "20px",
                                        },
                                    }}
                                />
                            </Box>
                        }
                    />
                </Tabs>
            </div>

            {/* Main Center */}
            <section className="flex-1 bg-white rounded-2xl shadow-sm min-h-[calc(100vh-6rem)] px-8 py-12 overflow-auto">
                <h1 className="font-bold mb-5 text-lg">Notfications</h1>
                {notifications.map((group, idx) => (
                    <div key={idx} className="mb-8">
                        <p className="text-gray-400 text-sm mb-4">{group.date}</p>
                        <div className="space-y-4">
                            {group.items.map((item, index) => (
                                <div
                                    key={index}
                                    className="flex justify-between items-center  border-l-4 border-blue-500 rounded-lg p-4 hover:shadow-sm transition"
                                >
                                    <div className="flex flex-col">
                                        <span className="font-medium text-gray-800">{item.title}</span>
                                        <span className="text-gray-500 text-sm mt-1">{item.description}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <button className="text-gray-500 text-sm border border-gray-200 rounded-md px-3 py-1 hover:bg-gray-50 transition">
                                            {item.viewText}
                                        </button>
                                        <button className="text-white bg-blue-500 text-sm rounded-md px-4 py-1 hover:bg-blue-600 transition">
                                            {item.buttonText}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                ))}
                <div className="w-full flex justify-end mt-6">
                    <Pagination
                        count={123}
                        shape="rounded"
                        sx={{
                            '& .MuiPaginationItem-root': {
                                color: '#448AFF',
                                borderRadius: '4px',
                                minWidth: '32px',
                                height: '32px',
                            },
                            '& .Mui-selected': {
                                backgroundColor: '#448AFF !important',
                                color: 'white',
                            },
                        }}
                    />
                </div>
            </section>

            {/* Sidebar (desktop) */}
            <aside className="hidden lg:block lg:w-80 bg-white rounded-2xl shadow-sm p-6 h-[calc(100vh-0rem)] overflow-y-auto">
                <div className="mb-6">
                    <Tabs
                        value={tabIndex}
                        onChange={(_, newIndex) => setTabIndex(newIndex)}
                        variant="fullWidth"
                        className="border-b-2 border-gray-200"
                        TabIndicatorProps={{ style: { display: "none" } }}
                    >
                        <Tab
                            label={
                                <Box className="flex items-center gap-1 w-full justify-between">
                                    <span className={`text-sm font-medium ${tabIndex === 0 ? "text-[#448AFF]" : "text-gray-400"}`}>Invoices</span>
                                    <Badge
                                        badgeContent={invoices.length}
                                        sx={{
                                            "& .MuiBadge-badge": {
                                                backgroundColor: "white",
                                                color: "#555",
                                                fontSize: "0.75rem",
                                                height: "20px",
                                                minWidth: "20px",
                                            },
                                        }}
                                    />
                                </Box>
                            }
                        />
                        <Tab
                            label={
                                <Box className="flex items-center gap-2 w-full justify-between">
                                    <span className={`text-sm font-medium ${tabIndex === 1 ? "text-[#448AFF]" : "text-gray-400"}`}>Estimates</span>
                                    <Badge
                                        badgeContent={estimates.length}
                                        sx={{
                                            "& .MuiBadge-badge": {
                                                backgroundColor: "#E0E0E0",
                                                color: "#555",
                                                fontSize: "0.75rem",
                                                height: "20px",
                                                minWidth: "20px",
                                            },
                                        }}
                                    />
                                </Box>
                            }
                        />
                    </Tabs>
                </div>

                <div className="max-h-[calc(100vh-0rem)] overflow-y-auto">
                    {tabIndex === 0 ? (
                        invoices.length > 0 ? (
                            invoices.slice(0, 50).map((invoice, index) => (
                                <div key={invoice.id || index} className="relative mb-3">
                                    <SidebarInvoiceCard invoice={invoice} onMenuClick={handleMenuClick} />
                                </div>
                            ))
                        ) : (
                            <div className="text-center text-gray-500 py-8">
                                <p className="text-sm">No invoices yet</p>
                            </div>
                        )
                    ) : estimates.length > 0 ? (
                        estimates.slice(0, 50).map((estimate, index) => (
                            <div key={estimate.id || index} className="relative mb-3">
                                <SidebarInvoiceCard invoice={estimate} onMenuClick={handleMenuClick} />
                            </div>
                        ))
                    ) : (
                        <div className="text-center text-gray-500 py-8">
                            <p className="text-sm">No estimates yet</p>
                        </div>
                    )}
                </div>

                {/* Menu */}
                <Menu anchorEl={anchorEl} open={open} onClose={handleCloseMenu}>
                    <MenuItem onClick={handleView}>View</MenuItem>
                    <MenuItem onClick={handleView}>Download</MenuItem>
                    <MenuItem onClick={handleDelete}>Delete</MenuItem>
                </Menu>
            </aside>

            {/* Modals */}
            <PlanLimitModal isOpen={planLimitModalOpen} onClose={() => setPlanLimitModalOpen(false)} onUpgrade={handleUpgrade} planName={planName} />

            {selectedInvoice && (
                <>
                    {selectedInvoice.invoice_number && (
                        <InvoiceTemplateModal open={templateModalOpen} onClose={() => setTemplateModalOpen(false)} invoiceId={selectedInvoice.id ?? ""} templateNumber={selectedInvoice.template_number} />
                    )}

                    {selectedInvoice.estimate_number && (
                        <EstimateTemplateModal open={modalOpen} onClose={() => setModalOpen(false)} estimateId={selectedInvoice.id ?? ""} templateNumber={selectedInvoice.template_number} />
                    )}
                </>
            )}
        </main>
    );
}

export default Notifiction;
