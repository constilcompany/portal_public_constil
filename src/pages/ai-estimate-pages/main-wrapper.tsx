/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import ProjectInfoStep from './ProjectInfoStep';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import axios from 'axios';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../redux/store';
import { S3UploadService } from '../../components/data/s3-data';
import { setEstimateTables } from '../../redux/estimateSlice';
import { invoiceApi } from '../../services/rtkapi/invoiceApi';
import { usePdfJobPolling } from '../../hooks/use-pdf-job-polling';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const CreateProjectWizard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const token = useSelector((state: RootState) => state.auth.token);

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('Uploading PDF...');
  const [jobStage, setJobStage] = useState<'idle' | 'uploading' | 'polling' | 'saving'>('idle');

  const [projectData, setProjectData] = useState({
    projectName: location.state?.projectName || '',
    projectAddress: '',
    client: '',
    description: location.state?.description || '',
    source: [],
    files: location.state?.files || ([] as File[]),
  });

  const handleSubmit = async () => {
    if (!projectData.projectName || !projectData.client) {
      toast.error('Please fill all required fields');
      return;
    }
    await handleFinalSubmit();
  };

  const handleBack = () => {
    navigate('/estimates/ai');
  };

  const [packages, setPackages] = useState<any>({});
  const [aiCost, setAiCost] = useState<number>(3); // Fallback to 3

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    const fetchConfig = async () => {
      try {
        const res = await axios.get(`${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/credit-config`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
          }
        });
        const config = res.data?.config || [];
        const aiEntry = config.find((c: any) => c.action_type === 'ai_estimate');
        if (aiEntry) setAiCost(aiEntry.credit_cost);
      } catch (e) {
        console.error("Error fetching credit config", e);
      }
    };

    const fetchWallet = () => {
      axios
        .get(`${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/wallet`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
          },
        })
        .then((res) => setPackages(res?.data?.wallet || {}))
        .catch((err) => console.log(err));
    };

    fetchConfig();
    fetchWallet();
    const interval = setInterval(fetchWallet, 5000);
    return () => clearInterval(interval);
  }, []);

  const [uploadAiEstimate] = invoiceApi.useUploadAiEstimateMutation();
  const [uploadAiEstimateResults] = invoiceApi.useUploadAiEstimateResultsMutation();
  const userId = useSelector((state: RootState) => state.auth.user?.id);

  const [jobId, setJobId] = useState<string | null>(null);
  const [currentS3Key, setCurrentS3Key] = useState<string | null>(null);

  useEffect(() => {
    if (jobStage !== 'polling') return;

    setStatusText('Identifying layers...');
    setProgress(20);

    let seconds = 0;
    const interval = setInterval(() => {
      seconds += 1;
      
      if (seconds <= 6) {
        // Linearly interpolate progress from 20 to 40 over 6 seconds
        const currentProgress = 20 + Math.round((seconds / 6) * 20);
        setProgress(currentProgress);
        
        if (seconds === 6) {
          setStatusText('Analyzing...');
        }
      } else if (seconds <= 15) {
        // Linearly interpolate progress from 40 to 60 over 9 seconds (from second 6 to 15)
        const currentProgress = 40 + Math.round(((seconds - 6) / 9) * 20);
        setProgress(currentProgress);
        
        if (seconds === 15) {
          setStatusText('Estimating...');
        }
      } else {
        // Progress goes from 60 to 95 slowly (capping at 95)
        setProgress((prev) => {
          if (prev >= 95) return 95;
          return prev + 1;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [jobStage]);

  usePdfJobPolling(
    jobId,
    async (detail) => {
      console.log("✅ PDF Job Completed. Detail payload:", detail);
      setJobStage('saving');
      setStatusText('Verifying Output...');
      setProgress(95);
      try {
        const rawData = detail;
        const tablesContainer = rawData?.tables_json || rawData?.json_data || rawData;
        const tablesArray = Array.isArray(tablesContainer?.tables) 
          ? tablesContainer.tables 
          : (Array.isArray(tablesContainer) ? tablesContainer : null);

        if (!tablesArray) {
          console.error("❌ No tables found in response:", rawData);
          throw new Error("AI analysis did not return any recognized table data.");
        }

        setProgress(97);

        // 1. Create main estimate record
        const mainEstRes = await uploadAiEstimate({
          user_id: userId,
          name: projectData.projectName || 'New AI Estimate',
          address: projectData.projectAddress,
          description: projectData.description,
          input_pdf_url: currentS3Key,
          status: 'completed'
        }).unwrap();

        console.log("Main record saved:", mainEstRes);
        // Correctly handle array or object response
        const record = Array.isArray(mainEstRes) ? mainEstRes[0] : mainEstRes;
        const estimateId = record?.id;

        if (estimateId) {
          setProgress(99);
          console.log("Saving results to 'ai_estimate_results' for ID:", estimateId);

          // 2. Save JSON results - Using minimal payload to avoid 400 errors
          await uploadAiEstimateResults({
            ai_estimate_id: estimateId,
            output_json: rawData, 
            page_number: 1
          }).unwrap();
        }

        setStatusText('Analysis complete! Redirecting...');
        setProgress(100);
        
        // Store the metadata so File.tsx can fall back to it
        const newEstimate = Array.isArray(mainEstRes) ? mainEstRes[0] : mainEstRes;
        dispatch(setEstimateTables({
          ...newEstimate,
          output_json: rawData // Ensure output_json is explicitly set for File.tsx helper
        } as any));

        await sleep(1000);
        navigate('/estimates/ai/file');
        toast.success('AI Estimate generated successfully ✅');
      } catch (err: any) {
        console.error("❌ Post-processing error:", err);
        toast.error(err?.message || "Failed to save processing results");
        setStatusText('Error saving results');
      } finally {
        setJobStage('idle');
        setUploading(false);
        setJobId(null);
        setCurrentS3Key(null);
        setTimeout(() => setProgress(0), 800);
      }
    },
    (msg) => {
      setJobStage('idle');
      setStatusText('AI processing failed');
      toast.error(msg);
      setUploading(false);
      setJobId(null);
      setCurrentS3Key(null);
      setTimeout(() => setProgress(0), 800);
    }
  );

  const handleFinalSubmit = async () => {
    const file = projectData.files[0];
    if (!file) { toast.error('Please upload PDF first'); return; }
    if (!token) { toast.error('Token not found. Please login again.'); return; }
    if (!(packages?.ai_estimate_remaining >= aiCost)) {
      toast.error(`Not enough credits. AI Estimates require ${aiCost} credits.`);
      return;
    }

    setUploading(true);
    setProgress(0);
    setJobStage('uploading');
    setStatusText('Reading and Extracting Blue Print...');

    try {
      const s3Key = await S3UploadService.uploadFileInChunks(file, (pct) => {
        setProgress(Math.round((pct * 20) / 100));
      }, 'paybue-invoice-estimation/blueprints');

      setCurrentS3Key(s3Key);

      const { data: jobRes } = await axios.post(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/pdf_jobs`,
        {
          userid: userId,
          pdf_key: s3Key,
          status: "pending",
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Prefer': 'return=representation'
          }
        }
      );

      const newJobId = jobRes?.[0]?.id;
      if (!newJobId) throw new Error("Failed to create background job");

      const fastApiBase = import.meta.env.DEV 
        ? '/api-fast' 
        : (import.meta.env.VITE_FASTAPI_URL || 'https://paybue-quee.hnhsofttechsolutions.com');
      
      axios.post(
        `${fastApiBase}/estimate`,
        { 
          job_id: newJobId,
          pdf_key: s3Key,
          selected_scopes: projectData.source,
          project_name: projectData.projectName
        },
        { 
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'ngrok-skip-browser-warning': 'true'
          } 
        }
      ).catch((e) => console.warn("Background trigger failed:", e));

      // 💳 Deduct Credit Now
      try {
        await axios.post(
          `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/consume-credit`,
          {
            action_type: 'ai_estimate',
            reference_id: jobRes[0]?.id || null
          },
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
            }
          }
        );
      } catch (deductErr) {
        console.error("Credit deduction failed", deductErr);
      }

      setJobId(jobRes[0]?.id);
      setJobStage('polling');

    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Something went wrong');
      setJobStage('idle');
      setUploading(false);
      setTimeout(() => setProgress(0), 800);
    }
  };

  return (
    <div className="min-h-screen bg-transparent p-2 h-auto">
      <div className="max-w-4xl mx-auto">
        <button onClick={handleBack} className="flex items-center gap-1 text-sm mb-8 text-gray-500 hover:text-gray-900 transition-colors">
          <ChevronLeft className="w-4 h-4" />
          Back to Projects
        </button>

        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-8 mb-8 shadow-sm">
          <ProjectInfoStep data={projectData} setData={setProjectData} />
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSubmit}
            className="bg-[#448AFF] hover:bg-blue-600 text-white px-10 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-blue-100 transition-all active:scale-95"
          >
            Submit →
          </button>
        </div>

        {uploading && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white w-[350px] p-8 rounded-3xl shadow-2xl border border-gray-100">
              <div className="relative w-16 h-16 mx-auto mb-6">
                <div className="absolute inset-0 border-4 border-blue-50 rounded-full"></div>
                <div 
                  className="absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"
                ></div>
              </div>
              <p className="text-center text-sm font-black text-gray-900 mb-2 italic">
                {statusText}
              </p>
              <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-center text-[10px] font-bold text-blue-600 italic">{progress}% Complete</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CreateProjectWizard;
