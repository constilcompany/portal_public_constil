/* eslint-disable react-hooks/exhaustive-deps */
import { Tabs, Tab, Badge, Box, useMediaQuery, useTheme } from "@mui/material";
import { InvoiceModel } from "../../models/invoice";
import {
  useGetInvoicesQuery,
  useGetEstimatesQuery,
} from "../../services/rtkapi/invoiceApi";

interface InvoiceTabsProps {
  tabIndex: number;
  onTabChange: (index: number) => void;
}

export default function InvoiceTabs({ tabIndex, onTabChange }: InvoiceTabsProps) {
  const theme = useTheme();
  const isNonDesktop = useMediaQuery(theme.breakpoints.down("lg"));

  const { data: invoicesData } = useGetInvoicesQuery();
  const { data: estimatesData } = useGetEstimatesQuery();

  const invoices: InvoiceModel[] =
    InvoiceModel.fromListResponse(invoicesData?.results ?? []);
  const estimations: InvoiceModel[] =
    InvoiceModel.fromListResponse(estimatesData?.results ?? []).filter((e) => !e.estimate_number?.trim().toUpperCase().startsWith('AI-'));

  return (
    <div className={`${isNonDesktop ? "w-full" : "max-w-lg mx-auto p-2 ml-4"}`}>
      <Tabs
        value={tabIndex}
        onChange={(_, newIndex) => onTabChange(newIndex)}
        variant="fullWidth"
        className={`pb-1 flex items-center border-b-4 border-gray-200`}
        TabIndicatorProps={{ style: { display: "none" } }}
      >
        {/* Invoices Tab */}
        <Tab
          label={
            <Box
              className={`flex items-center justify-between w-full transition-all duration-0`}
            >
              <span
                className={`text-xs font-medium ${
                  tabIndex === 0 ? "text-[#448AFF]" : "text-gray-500"
                }`}
              >
                {isNonDesktop ? "Invoices" : "Invoices Sent"}
              </span>
              <Badge
                badgeContent={invoices.length}
                sx={{
                  "& .MuiBadge-badge": {
                    backgroundColor: "#E0E0E0",
                    color: "#555",
                    fontSize: isNonDesktop ? "0.6rem" : "0.75rem",
                    height: isNonDesktop ? "16px" : "20px",
                    minWidth: isNonDesktop ? "16px" : "20px",
                  },
                }}
              />
            </Box>
          }
          disableRipple
          disableFocusRipple
          sx={{
            minHeight: "40px",
            padding: "0",
            textTransform: "none",
            "&.Mui-selected": {
              backgroundColor: "transparent",
            },
          }}
        />

        <div className="border-l border-gray-300 h-9 mx-2"></div>

        {/* Estimates Tab */}
        <Tab
          label={
            <Box
              className={`flex items-center justify-between w-full transition-all duration-0`}
            >
              <span
                className={`text-xs font-medium ${
                  tabIndex === 1 ? "text-[#448AFF]" : "text-gray-500"
                }`}
              >
                Estimates
              </span>
              <Badge
                badgeContent={estimations.length}
                sx={{
                  "& .MuiBadge-badge": {
                    backgroundColor: "#E0E0E0",
                    color: "#555",
                    fontSize: isNonDesktop ? "0.6rem" : "0.75rem",
                    height: isNonDesktop ? "16px" : "20px",
                    minWidth: isNonDesktop ? "16px" : "20px",
                  },
                }}
              />
            </Box>
          }
          disableRipple
          disableFocusRipple
          sx={{
            minHeight: "40px",
            padding: "0",
            textTransform: "none",
            "&.Mui-selected": {
              backgroundColor: "transparent",
            },
          }}
        />
      </Tabs>
    </div>
  );
}
