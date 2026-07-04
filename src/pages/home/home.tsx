/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClipboardList, FileText, Mail, Send, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import StatsCardMain from "./stats";
import TrendLineChart from "./trend-line";
import { 
  useGetInvoicesQuery, 
  useGetEstimatesQuery, 
  useAllAiEstimateQuery 
} from "../../services/rtkapi/invoiceApi";
import { useEffect, useState } from "react";
import axios from "axios";
import AlertBanner from "./alert-banner";

type AlertType = "warning" | "urgent" | "critical";

interface AlertData {
  type: AlertType;
  message: string;
}

export function Home() {
  const navigate = useNavigate();
  const { data: invoicesData, isLoading: invoicesLoading } = useGetInvoicesQuery();
  const { data: estimatesData, isLoading: estimatesLoading } = useGetEstimatesQuery();
  const { data: aiEstimatesData, isLoading: aiEstimatesLoading } = useAllAiEstimateQuery();

  const invoiceCount = invoicesData?.data?.length || 0;
  const estimateCount = estimatesData?.data?.length || 0;
  const aiEstimateCount = aiEstimatesData?.length || 0;

  // Calculate this month's stats in frontend since the dashboard view has permission issues
/*
  const getCountThisMonth = (list: any[]) => {
    if (!list) return 0;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    return list.filter((item: any) => {
      const createdAt = new Date(item.created_at);
      return createdAt >= startOfMonth;
    }).length;
  };
*/

  // const invoiceThisMonth = getCountThisMonth(invoicesData?.data);
  // const estimateThisMonth = getCountThisMonth(estimatesData?.data);

  const [packages, setPackages] = useState<any>(null);
  const [alertData, setAlertData] = useState<AlertData | null>(null);

  const getExpiryAlert = (expiryDate: string): AlertData | null => {
    if (!expiryDate) return null;

    const today = new Date();
    const expiry = new Date(expiryDate);

    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);

    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return {
        type: "critical",
        message: "Your plan has expired. Renew to regain access.",
      };
    }

    if (diffDays === 0) {
      return {
        type: "critical",
        message: "Your plan expires today.",
      };
    }

    if (diffDays === 1) {
      return {
        type: "urgent",
        message:
          "Your plan expires tomorrow. Renew now to avoid interruptions.",
      };
    }

    if (diffDays <= 3) {
      return {
        type: "warning",
        message: `Your plan expires in ${diffDays} days. Don't lose access to features.`,
      };
    }

    if (diffDays <= 7) {
      return {
        type: "warning",
        message: `Your plan expires in ${diffDays} days. Renew to continue using all features.`,
      };
    }

    return null;
  };

  // ✅ FETCH SUBSCRIPTION
  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;

    axios
      .get(
        `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/subscription?apikey=${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
          },
        }
      )
      .then((res) => {
        setPackages(res?.data?.subscription || null);
      })
      .catch((err) => console.log(err));
  }, []);

  // ✅ ALERT CALCULATION
  useEffect(() => {
    if (packages?.expiry_date) {
      const alert = getExpiryAlert(packages.expiry_date);
      setAlertData(alert);
    }
  }, [packages]);

  // ✅ OTHER APIS
  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;

    axios
      .get(
        `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/credit-config?apikey=${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
          },
        }
      )
      .then((res) => {
        localStorage.setItem(
          "credit_config",
          JSON.stringify(res?.data?.config || {})
        );
      })
      .catch((err) => console.log(err));
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;

    axios
      .get(
        `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/credits?apikey=${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
          },
        }
      )
      .then((res) => {
        localStorage.setItem("credit", res?.data?.credits || 0);
      })
      .catch((err) => console.log(err));
  }, []);

  const statsCards = [
    {
      title: "Invoices",
      value: String(invoiceCount),
      subtitle: "Total created",
      icon: FileText,
    },
    {
      title: "Estimates",
      value: String(estimateCount),
      subtitle: "Total created",
      icon: ClipboardList,
    },
    {
      title: "AI Estimates",
      value: String(aiEstimateCount),
      subtitle: "AI generated",
      icon: Sparkles,
    },
    {
      title: "Invoice emails",
      value: String(invoiceCount), // Falling back to count if specific stats missing
      subtitle: "Emails sent",
      icon: Mail,
    },
    {
      title: "Estimate emails",
      value: String(estimateCount),
      subtitle: "Emails sent",
      icon: Send,
    },
  ];

  return (
    <main className="flex flex-col lg:flex-row gap-6 md:mt-0 p-2 h-auto overflow-hidden">
      <section className="flex-1 bg-white rounded-2xl border border-gray-100 h-[calc(100vh-3rem)] px-8 py-5 overflow-y-auto thin-scrollbar">

        {alertData && (
          <div className="mb-4">
            <AlertBanner
              type={alertData.type}
              message={alertData.message}
            />
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-1">
              Overview of your invoices, estimates, and AI projects
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/estimates/ai/steps")}
            className="bg-[#448AFF] hover:bg-[#3d7ef7] text-white rounded-lg font-medium px-5 py-2 flex items-center justify-center gap-2 transition-colors shrink-0"
          >
            <Sparkles size={18} />
            Upload a Blueprint
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-6 items-stretch [&>*]:min-w-0">
          {invoicesLoading || estimatesLoading || aiEstimatesLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-24 bg-gray-100 animate-pulse rounded-xl"></div>
            ))
          ) : (
            statsCards.map((card, index) => (
              <StatsCardMain
                key={index}
                title={card.title}
                value={card.value}
                subtitle={card.subtitle}
                icon={card.icon}
              />
            ))
          )}
        </div>

        {/* <div className="mb-6">
          <Reports />
        </div> */}

        <div className="mb-6">
          <TrendLineChart
            invoices={invoicesData?.data || []}
            estimates={estimatesData?.data || []}
          />
        </div>
      </section>
    </main>
  );
}

export default Home;