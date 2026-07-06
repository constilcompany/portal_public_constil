/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */

import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../redux/store';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  FileText,
  Layers,
  Loader2,
  MessageCircle,
  Send,
  Sparkles,
  Table2,
  X,
  Mic,
  MicOff,
  Eye,
  Mail,
} from 'lucide-react';
import {
  useAiTableDataMutation,
  useEstimateAiUpdateMutation,
  useGetAiChatHistoryQuery,
  invoiceApi
} from '../../services/rtkapi/invoiceApi';
import { toast } from 'react-toastify';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import 'jspdf/dist/polyfills.es.js';
// @ts-ignore
import 'jspdf/dist/jspdf.es.min.js';
import { useNavigate } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

type XlsxLib = typeof import('xlsx-js-style');

interface TableRowType {
  [key: string]: string | number;
}

interface TableData {
  table_name: string;
  headers: string[];
  description?: string;
  rows: TableRowType[];
  color?: 'orange' | 'yellow' | 'green' | 'blue';
  id?: string | number;
}

const colorMap = {
  orange: 'text-orange-500',
  yellow: 'text-yellow-500',
  green: 'text-green-500',
  blue: 'text-blue-500',
};

const bgColorMap = {
  orange: 'bg-orange-50 hover:bg-orange-100',
  yellow: 'bg-yellow-50 hover:bg-yellow-100',
  green: 'bg-green-50 hover:bg-green-100',
  blue: 'bg-blue-50 hover:bg-blue-100',
};

const isNumericHeader = (header: string) => {
  const h = header.toLowerCase();
  return ['quantity', 'wastage', 'unit', 'qty', 'total', 'amount', 'cost', 'material', 'labor', 'price'].some(
    (term) => h.includes(term),
  );
};

const isEditableHeader = (header: string) => {
  const h = header.toLowerCase();
  return ['quantity', 'wastage', 'unit material', 'unit labor'].some(
    (col) => h === col || h.includes(col),
  );
};

const getTableHeaders = (table: TableData): string[] => {
  if (Array.isArray(table.headers) && table.headers.length > 0) {
    return table.headers;
  }
  const firstRow = table.rows?.[0];
  return firstRow ? Object.keys(firstRow) : [];
};

const getTableSubtotal = (table: TableData) => {
  const costKey = getTableHeaders(table).find((h) =>
    ['total cost', 'total', 'amount'].includes(h.toLowerCase()),
  );
  if (!costKey) return 0;
  return table.rows.reduce((sum, r) => {
    const c = r[costKey]?.toString().replace(/[$,]/g, '') || '0';
    return sum + (parseFloat(c) || 0);
  }, 0);
};


// helper to export markdown description as PDF
const exportDescriptionPDF = (table: any) => {
  if (!table?.description) return;

  const doc = new jsPDF('p', 'mm', 'a4');
  const PAGE_MARGIN = 20;
  const PAGE_WIDTH = doc.internal.pageSize.getWidth();
  const PAGE_HEIGHT = doc.internal.pageSize.getHeight();
  const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

  let currentY = PAGE_MARGIN;

  // ===== TITLE =====
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(table.table_name, PAGE_MARGIN, currentY);
  currentY += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);

  const textLines = doc.splitTextToSize(
    table.description.replace(/[#_*`]/g, ''),
    CONTENT_WIDTH
  );

  textLines.forEach((line: any) => {
    if (currentY > PAGE_HEIGHT - PAGE_MARGIN) {
      doc.addPage();
      currentY = PAGE_MARGIN;
    }
    doc.text(line, PAGE_MARGIN, currentY, { align: 'justify' });
    currentY += 6; // line height
  });

  doc.save(`${table.table_name}-description.pdf`);
};

/** Excel sheet names cannot contain * ? : / \ [ ] */
const sanitizeExcelSheetName = (name: string) =>
  name.substring(0, 31).replace(/[*?:/\\[\]]/g, '');

const EXCEL_HEADER_FILL_RGB = '0088FF';
const EXCEL_HEADER_FONT_RGB = 'FFFFFF';

const createStyledHeaderCell = (value: string) => ({
  v: value,
  t: 's' as const,
  s: {
    fill: {
      patternType: 'solid' as const,
      fgColor: { rgb: EXCEL_HEADER_FILL_RGB },
      bgColor: { rgb: EXCEL_HEADER_FILL_RGB },
    },
    font: {
      bold: true,
      color: { rgb: EXCEL_HEADER_FONT_RGB },
    },
    alignment: {
      horizontal: 'center' as const,
      vertical: 'center' as const,
      wrapText: false,
    },
  },
});

/** Column width in characters — sized to fit header + data without wrapping */
const applyWorksheetColumnWidths = (
  ws: import('xlsx-js-style').WorkSheet,
  headers: string[],
  rows: TableRowType[],
) => {
  ws['!cols'] = headers.map((header) => {
    let maxLen = String(header).length;
    for (const row of rows) {
      const cellLen = String(row[header] ?? '').length;
      if (cellLen > maxLen) maxLen = cellLen;
    }
    const wch = Math.min(Math.max(Math.ceil(maxLen * 1.2) + 4, 14), 60);
    return { wch };
  });
};

const ensureCell = (ws: import('xlsx-js-style').WorkSheet, ref: string) => {
  if (!ws[ref]) {
    ws[ref] = { t: 'n', v: 0 };
  }
  return ws[ref];
};

const createWorksheetFromTable = (XLSX: XlsxLib, table: TableData) => {
  const headers = getTableHeaders(table);
  const rows = table.rows ?? [];
  const headerRow = headers.map(createStyledHeaderCell);
  const dataRows = rows.map((row) =>
    headers.map((h) => row[h] ?? '')
  );
  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  applyWorksheetColumnWidths(ws, headers, rows);
  return ws;
};

const loadXlsxLib = async (): Promise<XlsxLib> => {
  const mod = await import('xlsx-js-style');
  const lib = (mod as { default?: XlsxLib }).default ?? mod;
  if (!lib?.utils?.book_new) {
    throw new Error('Excel library failed to load');
  }
  return lib;
};

const File = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [selectedPage, setSelectedPage] = useState<any | null>(null);
  const [expandedTables, setExpandedTables] = useState<string[]>([]);
  const [rawChatHistory, setRawChatHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [triggerAiUpdate, { isLoading }] = useEstimateAiUpdateMutation();
  const [aiTableData] = useAiTableDataMutation();
  const estimate = useSelector((state: RootState) => state.estimate.tables as any);
  const estimateId = estimate?.id || (Array.isArray(estimate) ? estimate[0]?.id : null);

  // Fetch results from DB if they aren't already in the Redux state
  const { data: dbResults, isLoading: dbLoading, refetch: refetchDbResults } = invoiceApi.useGetAiEstimateResultsQuery(
    { ai_estimate_id: estimateId },
    { skip: !estimateId }
  );

  const [chatOpen, setChatOpen] = useState(false);
  const [selectedEstimateId, setSelectedEstimateId] = useState<string | null>(null);

  // Fetch chat history via RTK Query
  const { data: historyData, refetch: refetchHistory } = useGetAiChatHistoryQuery(
    { estimate_page_id: selectedEstimateId || '' },
    { skip: !selectedEstimateId || !chatOpen }
  );

  useEffect(() => {
    if (historyData) {
      setRawChatHistory(historyData);
      const formatted: { from: 'user' | 'bot'; text: string }[] = historyData
        .map((item: any) => [
          { from: 'user' as const, text: item.query },
          { from: 'bot' as const, text: item?.response?.text || '' },
        ])
        .flat();
      setChatMessages(formatted);
    }
  }, [historyData]);

  // estimate can be:
  //   (a) the full estimate object: { id, name, results: [{ output_json, ... }] }
  //   (b) a single result page directly: { output_json, ... } (legacy)
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);

  useEffect(() => {
    if (!estimate) return;

    // Use DB results if available and Redux state is just the shell
    const resultsSource = (estimate?.results && Array.isArray(estimate.results)) 
      ? estimate.results 
      : (dbResults || []);

    if (resultsSource.length > 0) {
      setSelectedPage(resultsSource[selectedPageIndex] || null);
    } else if (estimate.output_json) {
       // Single page direct object (e.g. from creation flow)
       setSelectedPage(estimate);
    }
  }, [dispatch, estimate, dbResults, selectedPageIndex]);

  const resultPages: any[] = (estimate?.results && Array.isArray(estimate.results)) 
    ? estimate.results 
    : (dbResults || []);

  // Robustly extract tables from the selected page
  const getTables = () => {
    if (!selectedPage?.output_json) return [];
    
    // Check various common nesting patterns
    const data = selectedPage.output_json;
    const tablesList = data.tables || data.tables_json?.tables || data.json_data?.tables || [];
    
    return Array.isArray(tablesList) ? tablesList : [];
  };

  const tables: TableData[] = getTables().map((t: any) => ({
    ...t,
    id: selectedPage?.id || t?.id,
  }));

  const estimateName = estimate?.name || 'AI Estimate';
  const lineItemCount = tables.reduce((acc, t) => acc + t.rows.length, 0);
  const allExpanded = tables.length > 0 && expandedTables.length === tables.length;

  useEffect(() => {
    if (tables.length > 0) {
      setExpandedTables(tables.map((t) => t.table_name));
    }
  }, [selectedPage?.id, selectedPageIndex]);

  const toggleTable = (name: string) => {
    setExpandedTables((prev) => (prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]));
  };

  const toggleAllTables = () => {
    if (allExpanded) {
      setExpandedTables([]);
    } else {
      setExpandedTables(tables.map((t) => t.table_name));
    }
  };

  const [showFinalResultModal, setShowFinalResultModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [customerEmail, setCustomerEmail] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [templateMetadata, setTemplateMetadata] = useState({
    date: '',
    projectId: '',
    address: '',
    scope: '',
    drawingRef: '',
    scale: ''
  });

  const [activeTab, setActiveTab] = useState<'cover' | 'summary' | 'scope' | 'timeline' | 'warranty' | 'pricing' | 'signature'>('cover');
  const [proposalPreparedFor, setProposalPreparedFor] = useState('');
  const [proposalPreparedBy, setProposalPreparedBy] = useState('CONSTIL Team');
  const [proposalSummary, setProposalSummary] = useState('');
  const [proposalScope, setProposalScope] = useState('');
  const [proposalTimelineDuration, setProposalTimelineDuration] = useState('4 Weeks');
  const [proposalTimelineStart, setProposalTimelineStart] = useState('Upon Agreement');
  const [proposalTimelineNotes, setProposalTimelineNotes] = useState('Milestones:\n- Week 1: Mobilization & Surface Prep\n- Week 2-3: Core Execution\n- Week 4: Final Inspection & Clean-up');
  const [proposalWarrantyPeriod, setProposalWarrantyPeriod] = useState('1 Year Workmanship Warranty');
  const [proposalWarrantyTerms, setProposalWarrantyTerms] = useState('CONSTIL guarantees all installation workmanship and labor against defects for a period of one (1) year following project completion.');
  const [proposalPricingSubtotal, setProposalPricingSubtotal] = useState(0);
  const [proposalPricingTax, setProposalPricingTax] = useState(0);
  const [proposalPricingContingency, setProposalPricingContingency] = useState(0);
  const [proposalPricingOverhead, setProposalPricingOverhead] = useState(0);
  const [proposalPricingTotal, setProposalPricingTotal] = useState(0);

  const [isGeneratingProposal, setIsGeneratingProposal] = useState(false);
  const [proposalPricingText, setProposalPricingText] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [contractorSignatureUrl, setContractorSignatureUrl] = useState<string | null>(null);
  const [clientSignatureUrl, setClientSignatureUrl] = useState<string | null>(null);
  const [proposalSignatureDate, setProposalSignatureDate] = useState('');
  useEffect(() => {
    const sub = Number(proposalPricingSubtotal) || 0;
    const tax = Number(proposalPricingTax) || 0;
    const cont = Number(proposalPricingContingency) || 0;
    const oh = Number(proposalPricingOverhead) || 0;
    setProposalPricingTotal(sub + tax + cont + oh);
  }, [proposalPricingSubtotal, proposalPricingTax, proposalPricingContingency, proposalPricingOverhead]);

  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<{ from: 'user' | 'bot'; text: string }[]>([]);
  const [chatPosition, setChatPosition] = useState<{ top: number; left: number } | null>(null);
  const [chatSending, setChatSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  const startSpeechToText = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (e) {
        console.error(e);
      }
      recognitionRef.current = null;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Speech recognition is not supported in this browser. Please try Chrome or Safari.");
      return;
    }

    const startRecognitionEngine = () => {
      try {
        const rec = new SpeechRecognition();
        rec.continuous = false; // continuous = false is highly stable and automatically endpoints
        rec.interimResults = false;
        rec.lang = 'en-US';

        rec.onstart = () => {
          setIsRecording(true);
        };

        rec.onresult = (event: any) => {
          let transcript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              transcript += event.results[i][0].transcript;
            }
          }
          if (transcript) {
            setChatInput(prev => (prev + ' ' + transcript).trim());
          }
        };

        rec.onerror = (e: any) => {
          console.error("Speech error:", e);
          setIsRecording(false);
          recognitionRef.current = null;
          toast.error(`Speech recognition error: ${e.error}`);
        };

        rec.onend = () => {
          setIsRecording(false);
          recognitionRef.current = null;
        };

        recognitionRef.current = rec;
        rec.start();
      } catch (recErr: any) {
        console.error("Failed to start SpeechRecognition:", recErr);
        setIsRecording(false);
        recognitionRef.current = null;
      }
    };

    // Optimize: query browser permissions status first to avoid double start/stop mic stutters
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'microphone' as any })
        .then((permissionStatus) => {
          if (permissionStatus.state === 'granted') {
            startRecognitionEngine();
          } else {
            // Permission is not yet granted, trigger getUserMedia to prompt
            navigator.mediaDevices.getUserMedia({ audio: true })
              .then((stream) => {
                stream.getTracks().forEach(track => track.stop());
                startRecognitionEngine();
              })
              .catch((err) => {
                console.error("Microphone access denied:", err);
                toast.error("Microphone permission denied or device is busy.");
                setIsRecording(false);
                recognitionRef.current = null;
              });
          }
        })
        .catch(() => {
          startRecognitionEngine();
        });
    } else {
      startRecognitionEngine();
    }
  };

  const stopSpeechToText = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (err) {
        console.error("Error aborting speech recognition:", err);
      }
      setIsRecording(false);
      recognitionRef.current = null;
      toast.success("Voice note captured!");
    }
  };

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          console.error(e);
        }
        recognitionRef.current = null;
      }
      setIsRecording(false);
    };
  }, [chatOpen]);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatSending]);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.min(textareaRef.current.scrollHeight, 96);
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [chatInput]);

  const buildConversationHistory = () => {
    return {
      messages: rawChatHistory.map((item: any) => ({
        human: item.query,
        ai: item?.response?.text || '',
      })),
    };
  };
  const startProgress = () => {
    setProgress(1);
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 50);

    return interval;
  };

  const fetchChatHistory = async (estimatePageId: string) => {
    setSelectedEstimateId(estimatePageId);
  };
  const sendConversationToAI = async () => {
    if (!selectedPage?.id || rawChatHistory.length === 0) {
      toast.error('No conversation found');
      return;
    }

    setLoading(true);
    const interval = startProgress();

    try {
      const response = await aiTableData({
        action: 'apply',
        estimate_page_id: selectedPage?.id,
        conversation_history: buildConversationHistory(),
      }).unwrap();

      clearInterval(interval);
      setProgress(100);

      if (response?.status === true) {
        setSelectedPage(response?.ai_response);
        toast.success('Conversation applied successfully');
      } else {
        toast.error(response?.message || 'Something went wrong');
      }
    } catch (err: any) {
      clearInterval(interval);
      toast.error(err?.data?.error_log || 'AI processing failed');
    } finally {
      setTimeout(() => {
        setLoading(false);
        setProgress(0);
      }, 400);
    }
  };

  const generateProposalPDF = () => {
    const doc = new jsPDF({
      orientation: 'p',
      unit: 'mm',
      format: 'a4',
      compress: true
    }); // Portrait A4: 210mm wide x 297mm high with compression
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);

    // Helper: Draw header on content pages
    const drawContentHeader = () => {
      doc.setFont("Times", "bold");
      doc.setFontSize(12);
      doc.setTextColor(150, 150, 150);
      doc.text("CONSTIL Takeoff Proposal", margin, 15);
      
      doc.setFontSize(12);
      const textVal = templateMetadata.projectId || 'Construction Proposal';
      doc.text(textVal, pageWidth - margin - doc.getTextWidth(textVal), 15);
      
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.5);
      doc.line(margin, 17, pageWidth - margin, 17);
    };

    // Helper: Draw footer on all pages
    const drawContentFooter = (pageNum: number) => {
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.5);
      doc.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15);
      
      doc.setFont("Times", "normal");
      doc.setFontSize(12);
      doc.setTextColor(150, 150, 150);
      doc.text("Confidential & Proprietary", margin, pageHeight - 10);
      doc.text(`Page ${pageNum}`, pageWidth - margin - doc.getTextWidth(`Page ${pageNum}`), pageHeight - 10);
    };

    // PAGE 1: COVER PAGE
    // Draw Logo if uploaded
    if (logoUrl) {
      try {
        doc.addImage(logoUrl, 'PNG', margin, 25, 45, 15);
      } catch (err) {
        console.error("Error drawing logo in PDF:", err);
      }
    } else {
      // Draw a default text logo
      doc.setFont("Times", "bold");
      doc.setFontSize(18);
      doc.setTextColor(68, 138, 255); // #448AFF
      doc.text("CONSTIL", margin, 32);
      doc.setFontSize(12);
      doc.setTextColor(100, 100, 100);
      doc.text("Takeoffs & Estimation", margin, 37);
    }

    doc.setFont("Times", "bold");
    doc.setFontSize(28);
    doc.setTextColor(30, 41, 59); // Slate-800
    doc.text("CONSTRUCTION PROPOSAL", margin, 70);
    doc.text("& BUDGET ESTIMATE", margin, 82);

    doc.setDrawColor(68, 138, 255); // #448AFF
    doc.setLineWidth(2);
    doc.line(margin, 90, 80, 90);

    doc.setFont("Times", "normal");
    doc.setFontSize(12);
    doc.setTextColor(100, 116, 139); // Slate-500
    const subtitleText = "Detailed material quantification, pricing breakdown, and execution scope details.";
    const splitSubtitle = doc.splitTextToSize(subtitleText, contentWidth);
    doc.text(splitSubtitle, margin, 100, { lineHeightFactor: 1.5 });

    // Draw Metadata box
    const tableData = [
      ["Project ID:", templateMetadata.projectId || 'N/A', "Prepared For:", proposalPreparedFor || 'N/A'],
      ["Date:", templateMetadata.date || new Date().toLocaleDateString(), "Prepared By:", proposalPreparedBy || 'N/A'],
      ["Address:", templateMetadata.address || 'N/A', "Drawing Scale:", templateMetadata.scale || 'N/A']
    ];

    autoTable(doc, {
      startY: 120,
      body: tableData,
      theme: 'plain',
      styles: { fontSize: 12, cellPadding: 3, textColor: [71, 85, 105], font: 'Times' },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 25 },
        1: { cellWidth: 60 },
        2: { fontStyle: 'bold', cellWidth: 25 },
        3: { cellWidth: 60 }
      }
    });

    drawContentFooter(1);

    // PAGE 2: PROJECT SUMMARY & SCOPE OF WORK
    doc.addPage();
    drawContentHeader();
    
    doc.setFont("Times", "bold");
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text("1. PROJECT SUMMARY", margin, 30);
    
    doc.setFont("Times", "normal");
    doc.setFontSize(12);
    doc.setTextColor(71, 85, 105);
    const splitSummary = doc.splitTextToSize(proposalSummary, contentWidth);
    doc.text(splitSummary, margin, 36, { lineHeightFactor: 1.5 });

    // Calculate Y for next section (with 1.5 spacing, 12pt is ~6.35mm per line)
    const summaryHeight = splitSummary.length * 6.35;
    let scopeY = 36 + summaryHeight + 15;

    doc.setFont("Times", "bold");
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text("2. SCOPE OF WORK", margin, scopeY);

    doc.setFont("Times", "normal");
    doc.setFontSize(12);
    doc.setTextColor(71, 85, 105);
    const splitScope = doc.splitTextToSize(proposalScope, contentWidth);
    doc.text(splitScope, margin, scopeY + 6, { lineHeightFactor: 1.5 });

    drawContentFooter(2);

    // PAGE 3: TIMELINE & WARRANTY
    doc.addPage();
    drawContentHeader();

    doc.setFont("Times", "bold");
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text("3. PROJECT TIMELINE & MILESTONES", margin, 30);

    doc.setFont("Times", "bold");
    doc.setFontSize(12);
    doc.setTextColor(71, 85, 105);
    doc.text(`Target Duration: `, margin, 38);
    doc.setFont("Times", "normal");
    doc.text(proposalTimelineDuration, margin + doc.getTextWidth("Target Duration: "), 38);

    doc.setFont("Times", "bold");
    doc.text(`Estimated Start: `, margin, 45);
    doc.setFont("Times", "normal");
    doc.text(proposalTimelineStart, margin + doc.getTextWidth("Estimated Start: "), 45);

    doc.setFont("Times", "normal");
    doc.setFontSize(12);
    const splitTimeline = doc.splitTextToSize(proposalTimelineNotes, contentWidth);
    doc.text(splitTimeline, margin, 52, { lineHeightFactor: 1.5 });

    const timelineHeight = splitTimeline.length * 6.35;
    let warrantyY = 52 + timelineHeight + 15;

    doc.setFont("Times", "bold");
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text("4. WARRANTY TERMS & CONDITIONS", margin, warrantyY);

    doc.setFont("Times", "bold");
    doc.setFontSize(12);
    doc.setTextColor(71, 85, 105);
    doc.text(`Warranty Period: `, margin, warrantyY + 8);
    doc.setFont("Times", "normal");
    doc.text(proposalWarrantyPeriod, margin + doc.getTextWidth("Warranty Period: "), warrantyY + 8);

    doc.setFont("Times", "normal");
    doc.setFontSize(12);
    const splitWarranty = doc.splitTextToSize(proposalWarrantyTerms, contentWidth);
    doc.text(splitWarranty, margin, warrantyY + 16, { lineHeightFactor: 1.5 });

    drawContentFooter(3);

    // PAGE 4: BUDGET SUMMARY & SIGNATURES
    doc.addPage();
    drawContentHeader();

    doc.setFont("Times", "bold");
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text("5. FINANCIAL BUDGET BREAKDOWN", margin, 30);

    doc.setFont("Times", "normal");
    doc.setFontSize(12);
    doc.setTextColor(71, 85, 105);
    const splitPricingText = doc.splitTextToSize(proposalPricingText, contentWidth);
    doc.text(splitPricingText, margin, 36, { lineHeightFactor: 1.5 });

    const pricingTextHeight = splitPricingText.length * 6.35;
    let pricingTableY = 36 + pricingTextHeight + 6;

    // Draw Budget summary grid
    const pricingRows = [
      ["Subtotal (Takeoff Base Cost):", `$${proposalPricingSubtotal.toLocaleString()}`],
      ["Overhead & Profit (20%):", `$${proposalPricingOverhead.toLocaleString()}`],
      ["Contingency (5%):", `$${proposalPricingContingency.toLocaleString()}`],
      ["Insurance / Taxes (5%):", `$${proposalPricingTax.toLocaleString()}`],
      ["TOTAL CONTRACT VALUE:", `$${proposalPricingTotal.toLocaleString()}`]
    ];

    autoTable(doc, {
      startY: pricingTableY,
      body: pricingRows,
      theme: 'grid',
      styles: { fontSize: 12, cellPadding: 2.5, font: 'Times' },
      columnStyles: {
        0: { cellWidth: 100 },
        1: { halign: 'right', cellWidth: 40 }
      },
      didParseCell: (data) => {
        if (data.row.index === 4) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = [68, 138, 255];
        }
      }
    });

    // @ts-ignore
    let sigY = doc.lastAutoTable.finalY + 15;

    doc.setFont("Times", "bold");
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text("6. CLIENT ACCEPTANCE SIGNATURE", margin, sigY);
    
    doc.setFont("Times", "normal");
    doc.setFontSize(12);
    doc.text("By signing below, both parties confirm authorization and acceptance of the takeoff requirements.", margin, sigY + 5);

    let blocksY = sigY + 10;

    // Left Signature Block (Contractor)
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.line(margin, blocksY + 30, margin + 70, blocksY + 30);
    
    doc.setFont("Times", "bold");
    doc.setFontSize(12);
    doc.setTextColor(71, 85, 105);
    doc.text(proposalPreparedBy, margin, blocksY + 35);
    doc.setFont("Times", "normal");
    doc.text("Contractor Representative", margin, blocksY + 41);

    if (contractorSignatureUrl) {
      try {
        doc.addImage(contractorSignatureUrl, 'PNG', margin + 5, blocksY + 2, 50, 25);
      } catch (err) {
        console.error(err);
      }
    }

    // Right Signature Block (Client)
    doc.line(pageWidth - margin - 70, blocksY + 30, pageWidth - margin, blocksY + 30);
    
    doc.setFont("Times", "bold");
    doc.setFontSize(12);
    doc.setTextColor(71, 85, 105);
    doc.text(proposalPreparedFor || "Authorized Client Signature", pageWidth - margin - 70, blocksY + 35);
    doc.setFont("Times", "normal");
    doc.text(`Date of Signature: ${proposalSignatureDate || '__________________'}`, pageWidth - margin - 70, blocksY + 41);

    if (clientSignatureUrl) {
      try {
        doc.addImage(clientSignatureUrl, 'PNG', pageWidth - margin - 65, blocksY + 2, 50, 25);
      } catch (err) {
        console.error(err);
      }
    }

    drawContentFooter(4);
    return doc;
  };

  const handleOpenPreview = () => {
    const doc = generateProposalPDF();
    const blobUrl = doc.output('bloburl');
    setPreviewPdfUrl(blobUrl.toString());
    setShowPreviewModal(true);
  };

  const handleClosePreview = () => {
    if (previewPdfUrl) {
      URL.revokeObjectURL(previewPdfUrl);
    }
    setPreviewPdfUrl(null);
    setShowPreviewModal(false);
  };

  const handleSendQuote = async () => {
    if (!customerEmail.trim()) {
      toast.error("Please enter a valid email address.");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail.trim())) {
      toast.error("Please enter a valid email address.");
      return;
    }

    setIsSendingEmail(true);
    const loadingToast = toast.info("Sending PDF to email... Please wait.", { autoClose: false });
    try {
      let tablesJsonObj = selectedPage?.output_json;
      if (typeof tablesJsonObj === 'string') {
        try {
          tablesJsonObj = JSON.parse(tablesJsonObj);
        } catch {
          tablesJsonObj = {};
        }
      }

      let finalTablesJson = tablesJsonObj;
      if (tablesJsonObj && !tablesJsonObj.tables) {
        finalTablesJson = {
          tables: tablesJsonObj.tables_json?.tables || tablesJsonObj.json_data?.tables || tablesJsonObj || []
        };
      }

      // Recompile markdown text dynamically from template proposal fields
      const compiledMarkdown = `# CONSTRUCTION PROPOSAL & BUDGET ESTIMATE

## COVER PAGE
- **Date:** ${templateMetadata.date}
- **Project ID:** ${templateMetadata.projectId}
- **Address:** ${templateMetadata.address}
- **Prepared For:** ${proposalPreparedFor}
- **Prepared By:** ${proposalPreparedBy}
- **Drawing Reference:** ${templateMetadata.drawingRef}
- **Scale:** ${templateMetadata.scale}

---

## 1. PROJECT SUMMARY
${proposalSummary}

---

## 2. SCOPE OF WORK
${proposalScope}

---

## 3. PROJECT TIMELINE & MILESTONES
- **Target Duration:** ${proposalTimelineDuration}
- **Estimated Start:** ${proposalTimelineStart}

${proposalTimelineNotes}

---

## 4. WARRANTY TERMS & CONDITIONS
- **Warranty Period:** ${proposalWarrantyPeriod}

${proposalWarrantyTerms}

---

## 5. FINANCIAL BUDGET BREAKDOWN
${proposalPricingText}

- **Subtotal (Takeoff Base Cost):** $${proposalPricingSubtotal.toLocaleString()}
- **Overhead & Profit:** $${proposalPricingOverhead.toLocaleString()}
- **Contingency:** $${proposalPricingContingency.toLocaleString()}
- **Insurance / Taxes:** $${proposalPricingTax.toLocaleString()}
- **TOTAL CONTRACT VALUE: $${proposalPricingTotal.toLocaleString()}**

---

## 6. CLIENT ACCEPTANCE SIGNATURE
*By signing below, the client representative accepts this proposal.*

**Contractor Signature:** __________________________ (Prepared By: ${proposalPreparedBy})
**Client Signature:** __________________________ (Prepared For: ${proposalPreparedFor})
**Date of Signature:** ${proposalSignatureDate || '__________________________'}`;

      const payload = {
        email: customerEmail.trim(),
        status: true,
        estimate_text: compiledMarkdown,
        tables_json: finalTablesJson,
        logo: logoUrl,
        contractor_signature: contractorSignatureUrl,
        client_signature: clientSignatureUrl
      };

      // 1. Send to audit quote API
      const response = await fetch('https://paybue-quee.hnhsofttechsolutions.com/quote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // @ts-ignore
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: { toEmail: customerEmail.trim() },
        headers: {
          // @ts-ignore
          'apikey': supabase.supabaseKey || supabase.auth.session?.()?.access_token,
          // @ts-ignore
          'Authorization': `Bearer ${supabase.supabaseKey}`
        }
      });

      if (error) {
        console.error("[SENDGRID ERROR] Secure edge function response:", error);
        throw new Error(error.message || "Failed to send email");
      }

      toast.dismiss(loadingToast);
      toast.success("Proposal PDF emailed to customer successfully!");
      setShowEmailModal(false);
      setShowPreviewModal(false);
      if (previewPdfUrl) {
        URL.revokeObjectURL(previewPdfUrl);
        setPreviewPdfUrl(null);
      }
      setShowFinalResultModal(false);
      setCustomerEmail('');
    } catch (err: any) {
      console.error("[SEND QUOTE] Error:", err);
      toast.dismiss(loadingToast);
      toast.error(err.message || "Failed to email quote. Please try again.");
    } finally {
      setIsSendingEmail(false);
    }
  };

  const openChatbot = (estimateId: string, event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const CHAT_WIDTH = 400;
    const CHAT_HEIGHT = 520;
    const GAP = 12;
    let left = rect.right + GAP;
    let top = rect.top + window.scrollY;
    if (left + CHAT_WIDTH > window.innerWidth) {
      left = rect.left - CHAT_WIDTH - GAP;
    }
    if (top + CHAT_HEIGHT > window.scrollY + window.innerHeight) {
      top = window.scrollY + window.innerHeight - CHAT_HEIGHT - 12;
    }

    if (top < window.scrollY + 10) {
      top = window.scrollY + 10;
    }

    setChatPosition({ top, left });
    setSelectedEstimateId(estimateId);
    setChatOpen(true);
    setChatMessages([]);
    fetchChatHistory(estimateId);
  };

  const sendMessage = async () => {
    if (!chatInput.trim() || !selectedEstimateId || chatSending) return;

    const userMsg = chatInput.trim();

    setChatMessages((prev) => [...prev, { from: 'user', text: userMsg }]);
    setChatInput('');
    setChatSending(true);

    try {
      const result = await aiTableData({
        action: 'chat',
        estimate_page_id: selectedEstimateId,
        query: userMsg
      }).unwrap();
      
      if (result.status === true && result.ai_response) {
        setSelectedPage(result.ai_response);
        setChatMessages((prev) => [...prev, { from: 'bot', text: 'Estimate updated successfully!' }]);
        refetchDbResults(); // Force refresh the main data
      }
      
      if (result.error) {
        setChatMessages((prev) => [...prev, { from: 'bot', text: result.error }]);
      }
      refetchHistory();
    } catch {
      setChatMessages((prev) => [...prev, { from: 'bot', text: 'Something went wrong. Please try again.' }]);
    } finally {
      setChatSending(false);
    }
  };

  const totalEstimate = tables.reduce(
    (sum, table) => {
      // Skip summary tables to avoid double counting
      if (!table.table_name || table.table_name.toUpperCase().includes('SUMMARY')) return sum;
      
      return sum + table.rows.reduce((rowSum, row) => {
        const cost = row['Total Cost']?.toString().replace('$', '').replace(',', '') || '0';
        return rowSum + parseFloat(cost);
      }, 0);
    },
    0
  );

  const exportPDF = () => {
    try {
    const doc = new jsPDF({
      orientation: 'l',
      unit: 'mm',
      format: 'a4',
      compress: true
    });
    let currentY = 20;

    tables.forEach((table) => {
      const headers = getTableHeaders(table);
      doc.setFontSize(14);
      doc.text(table.table_name, 14, currentY);
      currentY += 6;

      autoTable(doc, {
        startY: currentY,
        head: [headers],
        body: table.rows.map((row) => headers.map((h) => row[h] || '')),
        theme: 'grid',
        styles: { fontSize: 10 },
        headStyles: { 
          fillColor: [0, 136, 255], // #0088FF
          textColor: [255, 255, 255]
        },
      });

      // @ts-ignore
      currentY = doc.lastAutoTable.finalY + 10;
    });

    doc.save('estimate.pdf');
    } catch (err) {
      console.error('PDF export failed:', err);
      toast.error('PDF download failed');
    }
  };
  const exportExcel = async (filterName?: string) => {
    try {
      const XLSX = await loadXlsxLib();

      const tablesToExport = filterName ? tables.filter(t => t.table_name === filterName) : tables;
      if (tablesToExport.length === 0) {
        toast.error('No tables available to export');
        return;
      }

      const wb = XLSX.utils.book_new();
      const tableMeta: Record<string, { sheetName: string, tcCol: string, lastRow: number }> = {};

      const getColLetter = (n: number) => {
        let letter = '';
        while (n >= 0) {
          letter = String.fromCharCode((n % 26) + 65) + letter;
          n = Math.floor(n / 26) - 1;
        }
        return letter;
      };

      const findColInWs = (ws: any, terms: string[]) => {
        const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
        if (!range.e.c) return null;
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cell = ws[XLSX.utils.encode_cell({ r: 0, c: C })];
          if (cell && cell.v && terms.some(t => String(cell.v).toLowerCase().includes(t.toLowerCase()))) {
            return getColLetter(C);
          }
        }
        return null;
      };

      // Create all worksheets first
      const worksheets = tablesToExport.map(table => {
        const ws = createWorksheetFromTable(XLSX, table);
        const sheetName = sanitizeExcelSheetName(table.table_name);
        return { table, ws, sheetName };
      });

      // Pass 1: Process detailed line-item tables
      worksheets.forEach(({ table, ws, sheetName }) => {
        const isSummary = table.table_name.toLowerCase().includes('summary');
        if (isSummary) return;

        const tcCol = findColInWs(ws, ['total cost', 'amount', 'total']);
        const qCol = findColInWs(ws, ['quantity']);
        const wCol = findColInWs(ws, ['wastage']);
        const umCol = findColInWs(ws, ['unit material']);
        const ulCol = findColInWs(ws, ['unit labor']);
        const qwCol = findColInWs(ws, ['qty w/', 'qty with']);
        const tmCol = findColInWs(ws, ['total material']);
        const tlCol = findColInWs(ws, ['total labor']);

        for (let i = 0; i < table.rows.length; i++) {
          const R = i + 2;
          const cleanCell = (col: string | null) => {
            if (!col) return;
            const ref = col + R;
            if (ws[ref]) {
              const val = String(ws[ref].v).replace(/[$,%]/g, '').trim();
              const num = parseFloat(val);
              if (!isNaN(num)) {
                ws[ref].t = 'n';
                ws[ref].v = num;
              }
            }
          };
          [qCol, wCol, umCol, ulCol, qwCol, tmCol, tlCol, tcCol].forEach(cleanCell);

          if (qwCol && qCol && wCol) {
            ensureCell(ws, qwCol + R).f = `${qCol}${R}*(1+${wCol}${R}/100)`;
          }
          if (tmCol && qwCol && umCol) {
            const cell = ensureCell(ws, tmCol + R);
            cell.f = `${qwCol}${R}*${umCol}${R}`;
            cell.z = '"$"#,##0.00';
          }
          if (tlCol && qwCol && ulCol) {
            const cell = ensureCell(ws, tlCol + R);
            cell.f = `${qwCol}${R}*${ulCol}${R}`;
            cell.z = '"$"#,##0.00';
          }
          if (tcCol) {
            const cell = ensureCell(ws, tcCol + R);
            if (tmCol && tlCol) cell.f = `${tmCol}${R}+${tlCol}${R}`;
            else if (qwCol && umCol && ulCol) cell.f = `${qwCol}${R}*(${umCol}${R}+${ulCol}${R})`;
            cell.z = '"$"#,##0.00';
          }
        }

        if (tcCol) {
          tableMeta[table.table_name.toLowerCase()] = { sheetName, tcCol, lastRow: table.rows.length + 1 };
        }
      });

      // Pass 2: Process summary tables
      worksheets.forEach(({ table, ws }) => {
        const isSummary = table.table_name.toLowerCase().includes('summary');
        if (!isSummary) return;

        const tcCol = findColInWs(ws, ['amount', 'total cost', 'total']);
        const descCol = findColInWs(ws, ['description', 'item', 'name']);

        if (tcCol && descCol) {
          let subtotalRow = 0;
          for (let i = 0; i < table.rows.length; i++) {
            const R = i + 2;
            const amountRef = tcCol + R;
            const desc = String(ws[descCol + R]?.v || '').trim();
            const descLower = desc.toLowerCase();

            // Force numeric type for all amount cells in summary
            if (ws[amountRef]) {
              const val = String(ws[amountRef].v).replace(/[$,%]/g, '').trim();
              const num = parseFloat(val);
              ws[amountRef].t = 'n';
              ws[amountRef].v = isNaN(num) ? 0 : num;
            } else {
              ws[amountRef] = { t: 'n', v: 0 };
            }

            // Link to category sheets using SUM of their range
            const matchedKey = Object.keys(tableMeta).find(name => {
              const cleanN = name.replace(/division \d+ - /g, '').toLowerCase();
              const cleanD = descLower.replace(/division \d+ - /g, '').toLowerCase();
              return cleanD.includes(cleanN) || cleanN.includes(cleanD);
            });

            const amountCell = ensureCell(ws, amountRef);

            if (matchedKey) {
              const meta = tableMeta[matchedKey];
              amountCell.f = `SUM('${meta.sheetName}'!${meta.tcCol}2:${meta.tcCol}${meta.lastRow})`;
            } else if (descLower.includes('subtotal')) {
              subtotalRow = R;
              amountCell.f = `SUM(${tcCol}2:${tcCol}${R - 1})`;
            } else if (descLower.includes('total') && !descLower.includes('subtotal')) {
              if (subtotalRow) amountCell.f = `SUM(${tcCol}${subtotalRow}:${tcCol}${R - 1})`;
            } else if (desc.includes('%')) {
              const match = desc.match(/(\d+\.?\d*)%/);
              if (match && subtotalRow) {
                const percent = parseFloat(match[1]) / 100;
                amountCell.f = `${tcCol}${subtotalRow}*${percent}`;
              }
            }
            amountCell.z = '"$"#,##0.00';
          }
        }
      });

      worksheets.forEach(({ ws, sheetName }) => {
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      });

      const filename = `${filterName || 'Estimate'}-${Date.now()}.xlsx`;
      XLSX.writeFile(wb, filename);
      toast.success('Excel exported successfully with live formulas');
    } catch (err) {
      console.error('Excel export failed:', err);
      toast.error('Excel download failed');
    }
  };



  const updateCellValue = (tableIndex: number, rowIndex: number, key: string, value: string) => {
    setSelectedPage((prev: any) => {
      if (!prev?.output_json) return prev;
      const updated = structuredClone(prev);
      const data = updated.output_json;

      // Find where the tables array actually lives
      let targetTables = null;
      if (Array.isArray(data.tables)) targetTables = data.tables;
      else if (Array.isArray(data.tables_json?.tables)) targetTables = data.tables_json.tables;
      else if (Array.isArray(data.json_data?.tables)) targetTables = data.json_data.tables;

      if (targetTables && targetTables[tableIndex]) {
        const row = targetTables[tableIndex].rows[rowIndex];
        row[key] = value;

        // --- Real-time Recalculation Logic ---
        const parseNum = (v: any) => parseFloat(v?.toString().replace(/[$,% ]/g, '') || '0');
        
        const normKey = key.toLowerCase();
        if (
          normKey.includes('quantity') || 
          normKey.includes('wastage') || 
          normKey.includes('unit material') || 
          normKey.includes('unit labor')
        ) {
          const qty = parseNum(row['Quantity'] || row['QUANTITY']);
          const wastage = parseNum(row['Wastage %'] || row['WASTAGE %']) / 100;
          const unitMat = parseNum(row['Unit Material'] || row['UNIT MATERIAL']);
          const unitLab = parseNum(row['Unit Labor'] || row['UNIT LABOR']);

          const qtyWithWastage = qty * (1 + wastage);
          
          // Update Qty w/ Wastage if the column exists
          const qtyWastageKey = Object.keys(row).find(k => k.toLowerCase().includes('qty w/') || k.toLowerCase().includes('qty with'));
          if (qtyWastageKey) row[qtyWastageKey] = Math.round(qtyWithWastage);

          // Update Total Material
          const totalMatKey = Object.keys(row).find(k => k.toLowerCase() === 'total material');
          if (totalMatKey) row[totalMatKey] = `$${(qtyWithWastage * unitMat).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

          // Update Total Labor
          const totalLabKey = Object.keys(row).find(k => k.toLowerCase() === 'total labor');
          if (totalLabKey) row[totalLabKey] = `$${(qtyWithWastage * unitLab).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

          // Update Total Cost
          const totalCostKey = Object.keys(row).find(k => ['Total Cost', 'TOTAL COST', 'Amount', 'Total'].includes(k));
          if (totalCostKey) {
            const finalTotal = (qtyWithWastage * unitMat) + (qtyWithWastage * unitLab);
            row[totalCostKey] = `$${finalTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
          }
        }
      }

      return updated;
    });
  };

  const applyBulkWastage = (tableIndex: number, value: string) => {
    if (!value.trim()) return;
    
    const parsedVal = value.replace(/%/g, '').trim();
    if (isNaN(Number(parsedVal))) {
      toast.error("Please enter a valid number for wastage (e.g. 6 or 6%)");
      return;
    }
    
    setSelectedPage((prev: any) => {
      if (!prev?.output_json) return prev;
      const updated = structuredClone(prev);
      const data = updated.output_json;

      let targetTables = null;
      if (Array.isArray(data.tables)) targetTables = data.tables;
      else if (Array.isArray(data.tables_json?.tables)) targetTables = data.tables_json.tables;
      else if (Array.isArray(data.json_data?.tables)) targetTables = data.json_data.tables;

      if (targetTables && targetTables[tableIndex]) {
        const rows = targetTables[tableIndex].rows;
        
        rows.forEach((row: any) => {
          const wastageKey = Object.keys(row).find(k => k.toLowerCase().includes('wastage'));
          if (wastageKey) {
            row[wastageKey] = `${parsedVal}%`;
            
            const parseNum = (v: any) => parseFloat(v?.toString().replace(/[$,% ]/g, '') || '0');
            const qty = parseNum(row['Quantity'] || row['QUANTITY']);
            const wastage = parseNum(parsedVal) / 100;
            const unitMat = parseNum(row['Unit Material'] || row['UNIT MATERIAL']);
            const unitLab = parseNum(row['Unit Labor'] || row['UNIT LABOR']);
            
            const qtyWithWastage = qty * (1 + wastage);
            
            const qtyWastageKey = Object.keys(row).find(k => k.toLowerCase().includes('qty w/') || k.toLowerCase().includes('qty with'));
            if (qtyWastageKey) row[qtyWastageKey] = Math.round(qtyWithWastage);

            const totalMatKey = Object.keys(row).find(k => k.toLowerCase() === 'total material');
            if (totalMatKey) row[totalMatKey] = `$${(qtyWithWastage * unitMat).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

            const totalLabKey = Object.keys(row).find(k => k.toLowerCase() === 'total labor');
            if (totalLabKey) row[totalLabKey] = `$${(qtyWithWastage * unitLab).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

            const totalCostKey = Object.keys(row).find(k => ['Total Cost', 'TOTAL COST', 'Amount', 'Total'].includes(k));
            if (totalCostKey) {
              const finalTotal = (qtyWithWastage * unitMat) + (qtyWithWastage * unitLab);
              row[totalCostKey] = `$${finalTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
            }
          }
        });
      }
      
      return updated;
    });
    toast.success(`Updated wastage to ${parsedVal}% for all rows in this table`);
  };

  const getFormulaHint = (header: string, tableName: string) => {
    const h = header.toLowerCase();
    const isSummary = tableName.toLowerCase().includes('summary');
    
    // Summary tables don't follow the per-row line item calculation logic
    if (isSummary) return undefined;

    if (h.includes('qty w/') || h.includes('qty with')) return 'Quantity * (1 + Wastage %)';
    if (h === 'total material') return 'Qty w/ Wastage * Unit Material';
    if (h === 'total labor') return 'Qty w/ Wastage * Unit Labor';
    if (['total cost', 'total', 'amount'].includes(h)) return 'Total Material + Total Labor';
    return undefined;
  };
  const saveUpdatedEstimate = async () => {
    if (!selectedPage?.id) return;
    try {
      await triggerAiUpdate({
        ai_estimate_id: String(selectedPage.id),
        body: {
          output_json: selectedPage.output_json,
        },
      }).unwrap();
      
      toast.success('Estimate updated successfully');
    } catch (err) {
      toast.error('Failed to update estimate');
    }
  };

  if (dbLoading && !selectedPage) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-4" />
        <p className="text-sm font-bold text-gray-400 uppercase tracking-widest italic">Fetching Project Data...</p>
      </div>
    );
  }

  return (
    <section className="w-full min-h-full bg-white">
      <div className="w-full max-w-[1600px] mx-auto px-3 sm:px-5 lg:px-8 py-4 pb-28">
        {selectedPage ? (
          <>
            {/* Header */}
            <div className="pb-6 mb-6 border-b border-gray-200">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <button
                    onClick={() => navigate('/estimates/ai')}
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline mb-2"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back to AI Estimates
                  </button>
                  <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">{estimateName}</h1>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 text-xs font-semibold rounded-full">
                      Reviewed
                    </span>
                    {resultPages.length > 1 && (
                      <span className="text-xs text-gray-500">
                        Page {selectedPage.page_number || selectedPageIndex + 1} of {resultPages.length}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 shrink-0">
                  <button
                    disabled={isGeneratingProposal}
                    onClick={async () => {
                      setIsGeneratingProposal(true);
                      const loadingToast = toast.info("Generating your proposal... Please wait.", { autoClose: false });
                      try {
                        const markdown = selectedPage?.output_markdown || '';
                        
                        let tablesJsonObj = selectedPage?.output_json;
                        if (typeof tablesJsonObj === 'string') {
                          try {
                            tablesJsonObj = JSON.parse(tablesJsonObj);
                          } catch {
                            tablesJsonObj = {};
                          }
                        }

                        let finalTablesJson = tablesJsonObj;
                        if (tablesJsonObj && !tablesJsonObj.tables) {
                          finalTablesJson = {
                            tables: tablesJsonObj.tables_json?.tables || tablesJsonObj.json_data?.tables || tablesJsonObj || []
                          };
                        }

                        // Make API call to fetch proposal template data
                        const response = await fetch('https://paybue-quee.hnhsofttechsolutions.com/quote', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json'
                          },
                          body: JSON.stringify({
                            status: true,
                            estimate_text: markdown,
                            tables_json: finalTablesJson
                          })
                        });

                        if (!response.ok) {
                          throw new Error(`API returned status ${response.status}`);
                        }

                        const resData = await response.json();
                        const proposalData = resData?.proposal?.data;

                        if (!proposalData) {
                          throw new Error("No proposal data returned from API.");
                        }

                        // Parse metadata
                        const lines = markdown.split('\n');
                        const metadata = {
                          date: '',
                          projectId: '',
                          address: '',
                          scope: '',
                          drawingRef: '',
                          scale: ''
                        };

                        for (const line of lines) {
                          const cleanLine = line.trim();
                          
                          const dateMatch = cleanLine.match(/^\*\*Date\s*:\*\*(.*)$/i);
                          const projectMatch = cleanLine.match(/^\*\*Project ID\s*:\*\*(.*)$/i);
                          const addressMatch = cleanLine.match(/^\*\*Address\s*:\*\*(.*)$/i);
                          const scopeMatch = cleanLine.match(/^\*\*Scope\s*:\*\*(.*)$/i);
                          const drawingMatch = cleanLine.match(/^\*\*Drawing Reference\s*:\*\*(.*)$/i);
                          const scaleMatch = cleanLine.match(/^\*\*Scale\s*:\*\*(.*)$/i);

                          if (dateMatch) {
                            metadata.date = dateMatch[1].trim();
                          } else if (projectMatch) {
                            metadata.projectId = projectMatch[1].trim();
                          } else if (addressMatch) {
                            metadata.address = addressMatch[1].trim();
                          } else if (scopeMatch) {
                            metadata.scope = scopeMatch[1].trim();
                          } else if (drawingMatch) {
                            metadata.drawingRef = drawingMatch[1].trim();
                          } else if (scaleMatch) {
                            metadata.scale = scaleMatch[1].trim();
                          }
                        }

                        setTemplateMetadata(metadata);
                        setProposalSummary(proposalData.project_summary || '');
                        setProposalScope(proposalData.scope_of_work || '');
                        setProposalTimelineNotes(proposalData.timeline || '');
                        setProposalWarrantyTerms(proposalData.warranty || '');
                        setProposalPricingText(proposalData.pricing || '');
                        setProposalSignatureDate(metadata.date || new Date().toLocaleDateString());

                        const sub = totalEstimate || 0;
                        setProposalPricingSubtotal(sub);
                        setProposalPricingTax(Math.round(sub * 0.05));
                        setProposalPricingContingency(Math.round(sub * 0.05));
                        setProposalPricingOverhead(Math.round(sub * 0.20));
                        setProposalPricingTotal(sub + Math.round(sub * 0.05) * 2 + Math.round(sub * 0.20));

                        toast.dismiss(loadingToast);
                        toast.success("Proposal layout generated!");

                        setActiveTab('cover');
                        setShowFinalResultModal(true);
                      } catch (err: any) {
                        console.error("[GENERATE PROPOSAL] Error:", err);
                        toast.dismiss(loadingToast);
                        toast.error(err.message || "Failed to generate proposal layout from API.");
                      } finally {
                        setIsGeneratingProposal(false);
                      }
                    }}
                    className="px-4 py-2 text-sm border border-[#448AFF] text-[#448AFF] rounded-lg bg-white hover:bg-blue-50 font-semibold cursor-pointer disabled:opacity-60"
                  >
                    {isGeneratingProposal ? "Generating..." : "Final Result"}
                  </button>
                  <button
                    onClick={toggleAllTables}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50 cursor-pointer"
                  >
                    {allExpanded ? 'Collapse all' : 'Expand all'}
                  </button>
                  <button
                    onClick={exportPDF}
                    className="px-4 py-2 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50"
                  >
                    Export PDF
                  </button>
                  <button
                    onClick={() => exportExcel()}
                    className="px-4 py-2 text-sm border border-gray-200 rounded-lg bg-white text-green-700 hover:bg-green-50"
                  >
                    Export Excel
                  </button>
                  <button
                    disabled={isLoading}
                    onClick={saveUpdatedEstimate}
                    className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60"
                  >
                    {isLoading ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </div>
            </div>

            {/* Page tabs */}
            {resultPages.length > 1 && (
              <div className="flex gap-2 mb-6 flex-wrap">
                {resultPages.map((page: any, idx: number) => (
                  <button
                    key={page.id || idx}
                    onClick={() => setSelectedPageIndex(idx)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      selectedPageIndex === idx
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-primary/40'
                    }`}
                  >
                    Page {page.page_number || idx + 1}
                  </button>
                ))}
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
              <div className="border border-gray-200 p-4 rounded-xl bg-white">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total estimate</p>
                <p className="text-2xl font-bold text-gray-900 mt-1 font-mono tabular-nums">
                  ${totalEstimate.toLocaleString()}
                </p>
              </div>
              <div className="border border-gray-200 p-4 rounded-xl bg-white">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Line items</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{lineItemCount}</p>
              </div>
              <div className="border border-gray-200 p-4 rounded-xl bg-white">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Tables</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{tables.length}</p>
              </div>
              <div className="border border-gray-200 p-4 rounded-xl bg-white">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Source page</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {selectedPage.page_number || selectedPageIndex + 1}
                </p>
              </div>
            </div>

            <div className="w-full space-y-5">
                {tables.map((table, idx) => {
                  const isExpanded = expandedTables.includes(table.table_name);
                  const subtotal = getTableSubtotal(table);

                  return (
                    <div
                      key={`${table.table_name}-${idx}`}
                      className="border border-gray-200 rounded-xl overflow-hidden bg-white"
                    >
                      <button
                        type="button"
                        onClick={() => toggleTable(table.table_name)}
                        className={`w-full flex flex-wrap justify-between items-center gap-3 px-5 py-4 ${bgColorMap[table.color || 'blue']}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <ChevronDown
                            className={`w-5 h-5 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          />
                          <div className="text-left min-w-0">
                            <span className={`font-semibold block truncate ${colorMap[table.color || 'blue']}`}>
                              {table.table_name}
                            </span>
                            <span className="text-xs text-gray-500 mt-0.5 block">
                              {table.rows.length} rows · {getTableHeaders(table).length} columns
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {subtotal > 0 && (
                            <span className="font-bold text-gray-900 font-mono tabular-nums">
                              ${subtotal.toLocaleString()}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              exportExcel(table.table_name);
                            }}
                            className="p-2 rounded-lg bg-green-600 text-white hover:bg-green-700"
                            title="Export this table to Excel"
                          >
                            <Download size={16} />
                          </button>
                          {table.description && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                exportDescriptionPDF(table);
                              }}
                              className="p-2 rounded-lg bg-primary text-white hover:opacity-90"
                              title="Download description PDF"
                            >
                              <FileText size={16} />
                            </button>
                          )}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-gray-100">
                          {!table.table_name.toLowerCase().includes('summary') && (
                            <div className="bg-gray-50/50 px-5 py-2.5 border-b border-gray-100 flex flex-wrap items-center gap-3 justify-end">
                              <span className="text-xs font-semibold text-gray-500">Bulk Update:</span>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  placeholder="Wastage (e.g. 6%)"
                                  id={`bulk-wastage-${idx}`}
                                  className="border border-gray-200 rounded-md px-2.5 py-1.5 text-xs bg-white w-32 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      const val = (e.target as HTMLInputElement).value;
                                      applyBulkWastage(idx, val);
                                      (e.target as HTMLInputElement).value = '';
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const input = document.getElementById(`bulk-wastage-${idx}`) as HTMLInputElement;
                                    if (input) {
                                      applyBulkWastage(idx, input.value);
                                      input.value = '';
                                    }
                                  }}
                                  className="px-3 py-1.5 bg-[#448AFF] hover:bg-[#3d7ef7] text-white text-xs font-semibold rounded-md shadow-sm active:scale-95 transition-all cursor-pointer"
                                >
                                  Apply to Table
                                </button>
                              </div>
                            </div>
                          )}
                          <div className="overflow-x-auto max-h-[min(70vh,720px)] overflow-y-auto thin-scrollbar">
                            <table className="w-full min-w-[900px] border-collapse text-sm">
                              <thead className="sticky top-0 z-10">
                                <tr className="bg-gray-100 border-b border-gray-200">
                                  {table.headers.map((header, i) => (
                                    <th
                                      key={i}
                                      className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-600 whitespace-nowrap ${
                                        isNumericHeader(header) ? 'text-right' : 'text-left'
                                      }`}
                                    >
                                      {header}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {table.rows.map((row, rowIdx) => (
                                  <tr
                                    key={rowIdx}
                                    className={`border-b border-gray-100 hover:bg-blue-50/40 ${
                                      rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                                    }`}
                                  >
                                    {table.headers.map((h, colIdx) => {
                                      const formulaHint = getFormulaHint(h, table.table_name);
                                      const numeric = isNumericHeader(h);
                                      const editable = isEditableHeader(h);

                                      return (
                                        <td
                                          key={colIdx}
                                          className={`px-4 py-2.5 align-middle ${
                                            numeric ? 'text-right font-mono tabular-nums' : 'text-left'
                                          } ${formulaHint ? 'bg-blue-50/30' : ''}`}
                                          title={formulaHint}
                                        >
                                          {editable ? (
                                            <input
                                              type="text"
                                              value={String(row[h] ?? '')}
                                              onChange={(e) => updateCellValue(idx, rowIdx, h, e.target.value)}
                                              className={`border border-gray-200 rounded-md px-2 py-1.5 text-sm bg-white focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none ${
                                                numeric ? 'w-28 ml-auto text-right' : 'w-full min-w-[140px]'
                                              }`}
                                            />
                                          ) : (
                                            <span className="block max-w-[320px] truncate" title={String(row[h] ?? '')}>
                                              {row[h] ?? '—'}
                                            </span>
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                              {subtotal > 0 && (
                                <tfoot>
                                  <tr className="bg-gray-100 font-semibold">
                                    <td
                                      colSpan={Math.max(1, table.headers.length - 1)}
                                      className="px-4 py-3 text-right text-gray-700"
                                    >
                                      Subtotal
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono tabular-nums text-gray-900">
                                      ${subtotal.toLocaleString()}
                                    </td>
                                  </tr>
                                </tfoot>
                              )}
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {tables.length === 0 && (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
                    <Table2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 font-medium">No extracted tables found for this page.</p>
                  </div>
                )}
            </div>

            {/* Floating actions */}
            <div className="fixed bottom-6 right-6 z-40 flex gap-3">
              <button
                type="button"
                onClick={(e) => openChatbot(String(selectedPage.id), e)}
                className="w-14 h-14 rounded-full bg-primary text-white shadow-lg hover:opacity-90 flex items-center justify-center"
                title="Open chat assistant"
              >
                <MessageCircle size={22} />
              </button>
              <button
                type="button"
                onClick={sendConversationToAI}
                className="w-14 h-14 rounded-full bg-purple-600 text-white shadow-lg hover:bg-purple-700 flex items-center justify-center"
                title="Apply AI changes from conversation"
              >
                <Check size={22} />
              </button>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-16 text-center">
            <Layers className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600 font-medium mb-2">No estimate data loaded</p>
            <button
              onClick={() => navigate('/estimates/ai')}
              className="text-sm text-primary hover:underline"
            >
              Go to AI Estimates
            </button>
          </div>
        )}
      </div>

      {chatOpen && (
        <>
          <button
            type="button"
            aria-label="Close chat"
            className="fixed inset-0 z-40 bg-gray-900/20 backdrop-blur-[2px]"
            onClick={() => setChatOpen(false)}
          />

          <div
            className="fixed z-50 flex w-[min(100vw-1.5rem,400px)] h-[min(520px,calc(100vh-5rem))] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white"
            style={{
              top: chatPosition?.top,
              left: chatPosition?.left,
            }}
            role="dialog"
            aria-labelledby="estimate-assistant-title"
          >
            <header className="flex items-center gap-3 border-b border-gray-100 px-4 py-3.5 bg-white">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Sparkles className="h-5 w-5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <p id="estimate-assistant-title" className="text-sm font-semibold text-gray-900">
                  Estimate Assistant
                </p>
                <p className="text-xs text-gray-500 truncate">Edit quantities, costs & line items</p>
              </div>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {rawChatHistory.length > 0 && (
              <div className="bg-purple-50 border-b border-purple-100/80 px-4 py-2.5 flex items-center justify-between shadow-sm animate-in fade-in slide-in-from-top-2 duration-200 shrink-0">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-purple-900">Unapplied Changes</p>
                  <p className="text-[10px] text-purple-700 mt-0.5">Apply conversation changes to the sheet</p>
                </div>
                <button
                  onClick={sendConversationToAI}
                  className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold flex items-center gap-1 transition-all active:scale-95 shadow-md shrink-0 cursor-pointer"
                >
                  <Check size={12} />
                  Apply to Sheet
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto thin-scrollbar bg-slate-50/80 px-4 py-4 space-y-4">
              {chatMessages.length === 0 ? (
                <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center px-2">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white border border-gray-100 shadow-sm">
                    <MessageCircle className="h-6 w-6 text-primary/70" />
                  </div>
                  <p className="text-sm font-medium text-gray-800">How can I help?</p>
                  <p className="mt-1 text-xs text-gray-500 max-w-[260px] leading-relaxed">
                    Ask to adjust quantities, update costs, or explain any row in your estimate.
                  </p>
                </div>
              ) : (
                chatMessages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.from === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[88%] px-3.5 py-2.5 text-sm leading-relaxed ${
                        m.from === 'user'
                          ? 'rounded-2xl rounded-br-md bg-primary text-white shadow-sm'
                          : 'rounded-2xl rounded-bl-md border border-gray-200 bg-white text-gray-800 shadow-sm'
                      }`}
                    >
                      {m.from === 'bot' ? (
                        <div className="prose prose-sm prose-gray max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              table: ({ node, ...props }: any) => (
                                <div className="w-full overflow-x-auto my-2 border border-gray-200 rounded-lg max-w-full thin-scrollbar">
                                  <table className="min-w-full divide-y divide-gray-200 text-xs border-collapse" {...props} />
                                </div>
                              ),
                              thead: ({ node, ...props }: any) => (
                                <thead className="bg-gray-50" {...props} />
                              ),
                              th: ({ node, ...props }: any) => (
                                <th className="px-3 py-2 text-left font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap border-b border-gray-200" {...props} />
                              ),
                              td: ({ node, ...props }: any) => (
                                <td className="px-3 py-2 text-gray-700 whitespace-nowrap border-b border-gray-100 align-middle" {...props} />
                              ),
                              tr: ({ node, ...props }: any) => (
                                <tr className="hover:bg-gray-50 transition-colors" {...props} />
                              )
                            }}
                          >
                            {m.text}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap break-words">{m.text}</p>
                      )}
                    </div>
                  </div>
                ))
              )}

              {chatSending && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-500 shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    Thinking…
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            <footer className="border-t border-gray-100 bg-white p-3">
              <div className={`flex items-end gap-2 rounded-xl border px-3 py-2 ${
                isRecording 
                  ? 'border-red-500 ring-2 ring-red-500/20 bg-red-50/30' 
                  : 'border-gray-200 bg-gray-50/80 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15'
              }`}>
                <button
                  type="button"
                  onClick={isRecording ? stopSpeechToText : startSpeechToText}
                  disabled={chatSending}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg cursor-pointer ${
                    isRecording 
                      ? 'bg-red-500 text-white' 
                      : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-40'
                  }`}
                  title={isRecording ? "Stop recording" : "Record voice note"}
                >
                  {isRecording ? (
                    <MicOff className="h-4 w-4" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </button>
                <textarea
                  ref={textareaRef}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={isRecording ? "Listening... Speak now" : "Message the assistant…"}
                  rows={1}
                  disabled={chatSending}
                  className="flex-1 max-h-24 resize-none bg-transparent text-sm text-gray-900 placeholder:text-gray-400 outline-none disabled:opacity-60 py-1 overflow-y-auto thin-scrollbar"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={sendMessage}
                  disabled={!chatInput.trim() || chatSending || isRecording}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity cursor-pointer"
                  aria-label="Send message"
                >
                  {chatSending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="mt-2 text-center text-[10px] text-gray-400">
                {isRecording ? "Click the microphone again to stop and review" : "Enter to send · Shift+Enter for new line"}
              </p>
            </footer>
          </div>
        </>
      )}
      {loading && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white w-[320px] p-6 rounded-xl">
            <p className="text-center text-sm font-semibold mb-3">Processing AI…</p>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div className="bg-blue-600 h-3 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-center text-xs mt-2">{progress}%</p>
          </div>
        </div>
      )}

      {showFinalResultModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 overflow-y-auto thin-scrollbar animate-in fade-in duration-100">
          <div className="bg-slate-100 rounded-2xl shadow-2xl border border-slate-200 max-w-5xl w-full max-h-[95vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-100">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-white border-b border-gray-100 flex items-center justify-between shadow-sm z-10">
              <div>
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  Proposal Document Editor
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">Prepare, customize, and edit the final proposal before sending to your client.</p>
              </div>
              <button
                onClick={() => setShowFinalResultModal(false)}
                className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body - Split Layout */}
            <div className="flex-1 flex overflow-hidden bg-slate-100 min-h-[500px]">
              {/* Left Sidebar - Pages List */}
              <div className="w-56 bg-white border-r border-slate-200 p-4 flex flex-col gap-1.5 shrink-0 overflow-y-auto thin-scrollbar">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 mb-2">Proposal Sections</span>
                {[
                  { id: 'cover', label: 'Cover Page' },
                  { id: 'summary', label: 'Project Summary' },
                  { id: 'scope', label: 'Scope of Work' },
                  { id: 'timeline', label: 'Timeline' },
                  { id: 'warranty', label: 'Warranty' },
                  { id: 'pricing', label: 'Pricing Summary' },
                  { id: 'signature', label: 'Signature Page' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`flex items-center px-3 py-2 text-xs font-semibold rounded-lg transition-all text-left cursor-pointer ${
                      activeTab === tab.id
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Right Side - Paper Sheet Layout */}
              <div className="flex-1 p-6 overflow-y-auto thin-scrollbar flex justify-center items-start">
                <div className="bg-white shadow-lg border border-slate-200/60 rounded-xl p-8 max-w-3xl w-full min-h-[600px] flex flex-col justify-between">
                  
                  {/* TAB 1: COVER PAGE */}
                  {activeTab === 'cover' && (
                    <div className="flex-1 flex flex-col justify-between">
                      {/* Top Header */}
                      <div className="flex justify-between items-center border-b border-slate-100 pb-6">
                        <div className="flex items-center gap-3">
                          {logoUrl ? (
                            <img src={logoUrl} alt="Company Logo" className="max-h-12 max-w-[120px] object-contain rounded-lg border border-slate-150 p-1" />
                          ) : (
                            <div className="h-12 w-12 rounded-lg bg-slate-50 border border-slate-200 border-dashed flex flex-col items-center justify-center text-[10px] text-slate-400">
                              <span>No Logo</span>
                            </div>
                          )}
                          <div>
                            <h3 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-1.5">
                              <Sparkles className="w-5 h-5 text-primary animate-pulse" />
                              CONSTIL <span className="text-primary font-light">PROPOSAL</span>
                            </h3>
                            <p className="text-[9px] text-slate-400 uppercase tracking-widest mt-0.5">Professional Takeoff Document</p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <label className="cursor-pointer text-[10px] px-2 py-1 bg-slate-50 border border-slate-200 rounded hover:bg-slate-100 text-slate-600 transition-colors font-semibold shadow-sm">
                            Upload Logo
                            <input 
                              type="file" 
                              accept="image/*" 
                              className="hidden" 
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  const reader = new FileReader();
                                  reader.onloadend = () => {
                                    if (typeof reader.result === 'string') {
                                      setLogoUrl(reader.result);
                                    }
                                  };
                                  reader.readAsDataURL(file);
                                }
                              }}
                            />
                          </label>
                        </div>
                      </div>

                      {/* Main Cover Title Block */}
                      <div className="my-12 text-center space-y-6">
                        <div className="inline-block px-3 py-1 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-full uppercase tracking-wider">
                          Official Proposal
                        </div>
                        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight leading-tight">
                          Construction Takeoff &amp; Budget Estimate
                        </h1>
                        <p className="text-sm text-slate-500 max-w-md mx-auto">
                          Detailed material quantification, pricing breakdown, and execution scope details.
                        </p>
                      </div>

                      {/* Metadata Grid (Editable Inputs) */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl text-xs border border-slate-100">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 font-medium w-24 shrink-0">Project ID:</span>
                            <input 
                              type="text" 
                              value={templateMetadata.projectId} 
                              onChange={(e) => {
                                const val = e.target.value;
                                setTemplateMetadata(prev => ({ ...prev, projectId: val }));
                              }}
                              className="flex-1 bg-white border border-slate-200 rounded px-2.5 py-1.5 outline-none focus:border-primary"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 font-medium w-24 shrink-0">Date:</span>
                            <input 
                              type="text" 
                              value={templateMetadata.date} 
                              onChange={(e) => {
                                const val = e.target.value;
                                setTemplateMetadata(prev => ({ ...prev, date: val }));
                              }}
                              className="flex-1 bg-white border border-slate-200 rounded px-2.5 py-1.5 outline-none focus:border-primary"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 font-medium w-24 shrink-0">Address:</span>
                            <input 
                              type="text" 
                              value={templateMetadata.address} 
                              onChange={(e) => {
                                const val = e.target.value;
                                setTemplateMetadata(prev => ({ ...prev, address: val }));
                              }}
                              className="flex-1 bg-white border border-slate-200 rounded px-2.5 py-1.5 outline-none focus:border-primary"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 font-medium w-24 shrink-0">Prepared For:</span>
                            <input 
                              type="text" 
                              value={proposalPreparedFor} 
                              onChange={(e) => setProposalPreparedFor(e.target.value)}
                              placeholder="e.g. John Doe / Client Co"
                              className="flex-1 bg-white border border-slate-200 rounded px-2.5 py-1.5 outline-none focus:border-primary"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 font-medium w-24 shrink-0">Prepared By:</span>
                            <input 
                              type="text" 
                              value={proposalPreparedBy} 
                              onChange={(e) => setProposalPreparedBy(e.target.value)}
                              className="flex-1 bg-white border border-slate-200 rounded px-2.5 py-1.5 outline-none focus:border-primary"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 font-medium w-24 shrink-0">Scale / Ref:</span>
                            <input 
                              type="text" 
                              value={templateMetadata.scale} 
                              onChange={(e) => {
                                const val = e.target.value;
                                setTemplateMetadata(prev => ({ ...prev, scale: val }));
                              }}
                              className="flex-1 bg-white border border-slate-200 rounded px-2.5 py-1.5 outline-none focus:border-primary"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 2: PROJECT SUMMARY */}
                  {activeTab === 'summary' && (
                    <div className="flex-1 flex flex-col justify-between">
                      <div className="border-b border-slate-100 pb-4 mb-4">
                        <h3 className="text-base font-bold text-slate-900">Project Summary</h3>
                        <p className="text-xs text-slate-500">Provide an overview description of the takeoff project.</p>
                      </div>
                      <textarea
                        value={proposalSummary}
                        onChange={(e) => setProposalSummary(e.target.value)}
                        className="flex-1 w-full border border-slate-200 rounded-xl p-4 text-xs text-slate-800 focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none resize-none thin-scrollbar min-h-[350px] bg-slate-50/20"
                        placeholder="Detailed project summary..."
                      />
                    </div>
                  )}

                  {/* TAB 3: SCOPE OF WORK */}
                  {activeTab === 'scope' && (
                    <div className="flex-1 flex flex-col justify-between">
                      <div className="border-b border-slate-100 pb-4 mb-4">
                        <h3 className="text-base font-bold text-slate-900">Scope of Work</h3>
                        <p className="text-xs text-slate-500">Outline specifications, drawings and material scopes covered.</p>
                      </div>
                      <textarea
                        value={proposalScope}
                        onChange={(e) => setProposalScope(e.target.value)}
                        className="flex-1 w-full border border-slate-200 rounded-xl p-4 text-xs text-slate-800 focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none resize-none thin-scrollbar min-h-[350px] bg-slate-50/20"
                        placeholder="Define work boundaries and specs..."
                      />
                    </div>
                  )}

                  {/* TAB 4: TIMELINE */}
                  {activeTab === 'timeline' && (
                    <div className="flex-1 flex flex-col justify-between gap-4">
                      <div className="border-b border-slate-100 pb-4">
                        <h3 className="text-base font-bold text-slate-900">Timeline &amp; Schedule</h3>
                        <p className="text-xs text-slate-500">Specify expected execution dates, project duration and milestones.</p>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-semibold text-slate-400 uppercase">Target Duration</label>
                          <input
                            type="text"
                            value={proposalTimelineDuration}
                            onChange={(e) => setProposalTimelineDuration(e.target.value)}
                            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:bg-white focus:border-primary"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-semibold text-slate-400 uppercase">Estimated Start</label>
                          <input
                            type="text"
                            value={proposalTimelineStart}
                            onChange={(e) => setProposalTimelineStart(e.target.value)}
                            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:bg-white focus:border-primary"
                          />
                        </div>
                      </div>

                      <div className="flex-1 flex flex-col gap-1.5">
                        <label className="text-[10px] font-semibold text-slate-400 uppercase">Milestones / Schedule Notes</label>
                        <textarea
                          value={proposalTimelineNotes}
                          onChange={(e) => setProposalTimelineNotes(e.target.value)}
                          className="flex-1 w-full border border-slate-200 rounded-xl p-4 text-xs text-slate-800 focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none resize-none thin-scrollbar min-h-[200px] bg-slate-50/20"
                          placeholder="Project phases, milestones..."
                        />
                      </div>
                    </div>
                  )}

                  {/* TAB 5: WARRANTY */}
                  {activeTab === 'warranty' && (
                    <div className="flex-1 flex flex-col justify-between gap-4">
                      <div className="border-b border-slate-100 pb-4">
                        <h3 className="text-base font-bold text-slate-900">Warranty Coverage</h3>
                        <p className="text-xs text-slate-500">Provide details about labor/workmanship guarantees or product warranties.</p>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-semibold text-slate-400 uppercase">Warranty Period</label>
                        <input
                          type="text"
                          value={proposalWarrantyPeriod}
                          onChange={(e) => setProposalWarrantyPeriod(e.target.value)}
                          className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:bg-white focus:border-primary"
                        />
                      </div>

                      <div className="flex-1 flex flex-col gap-1.5">
                        <label className="text-[10px] font-semibold text-slate-400 uppercase">Warranty Terms</label>
                        <textarea
                          value={proposalWarrantyTerms}
                          onChange={(e) => setProposalWarrantyTerms(e.target.value)}
                          className="flex-1 w-full border border-slate-200 rounded-xl p-4 text-xs text-slate-800 focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none resize-none thin-scrollbar min-h-[220px] bg-slate-50/20"
                          placeholder="Warranty terms and exclusions..."
                        />
                      </div>
                    </div>
                  )}

                  {/* TAB 6: PRICING */}
                  {activeTab === 'pricing' && (
                    <div className="flex-1 flex flex-col justify-between gap-4">
                      <div className="border-b border-slate-100 pb-4">
                        <h3 className="text-base font-bold text-slate-900">Proposal Budget Summary</h3>
                        <p className="text-xs text-slate-500">Live financial values from estimate. Edit fields as necessary.</p>
                      </div>

                      <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-500 font-medium">Subtotal (Takeoff Base Cost):</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 font-semibold">$</span>
                            <input
                              type="number"
                              value={proposalPricingSubtotal}
                              onChange={(e) => setProposalPricingSubtotal(Number(e.target.value))}
                              className="w-28 bg-white border border-slate-200 rounded px-2.5 py-1 text-right font-mono"
                            />
                          </div>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-500 font-medium">Overhead &amp; Profit (20% default):</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 font-semibold">$</span>
                            <input
                              type="number"
                              value={proposalPricingOverhead}
                              onChange={(e) => setProposalPricingOverhead(Number(e.target.value))}
                              className="w-28 bg-white border border-slate-200 rounded px-2.5 py-1 text-right font-mono"
                            />
                          </div>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-500 font-medium">Contingency (5% default):</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 font-semibold">$</span>
                            <input
                              type="number"
                              value={proposalPricingContingency}
                              onChange={(e) => setProposalPricingContingency(Number(e.target.value))}
                              className="w-28 bg-white border border-slate-200 rounded px-2.5 py-1 text-right font-mono"
                            />
                          </div>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-500 font-medium">Insurance / Taxes (5% default):</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 font-semibold">$</span>
                            <input
                              type="number"
                              value={proposalPricingTax}
                              onChange={(e) => setProposalPricingTax(Number(e.target.value))}
                              className="w-28 bg-white border border-slate-200 rounded px-2.5 py-1 text-right font-mono"
                            />
                          </div>
                        </div>
                        <div className="border-t border-slate-200 pt-3 flex justify-between items-center font-bold text-slate-900">
                          <span>Total Proposal Budget:</span>
                          <span className="font-mono text-primary">${proposalPricingTotal.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5 mt-2">
                        <label className="text-[10px] font-semibold text-slate-400 uppercase">Pricing Description / Terms</label>
                        <textarea
                          value={proposalPricingText}
                          onChange={(e) => setProposalPricingText(e.target.value)}
                          className="w-full border border-slate-200 rounded-xl p-4 text-xs text-slate-800 focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none resize-none thin-scrollbar min-h-[150px] bg-slate-50/20"
                          placeholder="Detailed pricing notes and conditions..."
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 text-center italic mt-2">
                        Values represent a synthesized summary of material and labor takeoff lines.
                      </p>
                    </div>
                  )}

                  {/* TAB 7: SIGNATURE PAGE */}
                  {activeTab === 'signature' && (
                    <div className="flex-1 flex flex-col justify-between">
                      <div className="border-b border-slate-100 pb-4 mb-4">
                        <h3 className="text-base font-bold text-slate-900">Authorization &amp; Signatures</h3>
                        <p className="text-xs text-slate-500">Sign-off sheets for both client and contractor acceptance.</p>
                      </div>

                      <div className="my-6 text-xs text-slate-600 leading-relaxed space-y-4">
                        <p>
                          This proposal, containing the detailed pricing of <strong>${proposalPricingTotal.toLocaleString()}</strong>, 
                          scope of work, schedule duration, and warranty commitments, constitutes the complete agreement 
                          between the parties upon execution.
                        </p>
                        <p className="italic">
                          By signing below, both parties confirm authorization and acceptance of the takeoff requirements.
                        </p>
                      </div>

                      {/* Side by side signature blocks */}
                      <div className="grid grid-cols-2 gap-8 mt-6">
                        <div className="space-y-4">
                          <div className="border-t border-slate-300 pt-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Contractor Signature</p>
                            
                            {/* Signature preview / upload area */}
                            <div className="h-24 bg-slate-50 border border-slate-200 border-dashed rounded-xl flex flex-col items-center justify-center overflow-hidden relative group mb-2">
                              {contractorSignatureUrl ? (
                                <img src={contractorSignatureUrl} alt="Contractor Signature" className="h-full w-full object-contain p-2" />
                              ) : (
                                <div className="text-center p-2 text-slate-400">
                                  <span className="text-[10px] block">No contractor signature</span>
                                </div>
                              )}
                              <label className="absolute inset-0 bg-black/40 text-white text-[10px] font-semibold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                                Upload Signature
                                <input 
                                  type="file" 
                                  accept="image/*" 
                                  className="hidden" 
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      const reader = new FileReader();
                                      reader.onloadend = () => {
                                        if (typeof reader.result === 'string') {
                                          setContractorSignatureUrl(reader.result);
                                        }
                                      };
                                      reader.readAsDataURL(file);
                                    }
                                  }}
                                />
                              </label>
                            </div>
                            
                            <p className="text-xs font-semibold text-slate-700 mt-2 h-6 border-b border-slate-200 border-dashed">{proposalPreparedBy}</p>
                            <p className="text-[10px] text-slate-500 mt-1">Authorized Representative</p>
                          </div>
                        </div>
                        <div className="space-y-4">
                          <div className="border-t border-slate-300 pt-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Client Acceptance Signature</p>
                            
                            {/* Signature preview / upload area */}
                            <div className="h-24 bg-slate-50 border border-slate-200 border-dashed rounded-xl flex flex-col items-center justify-center overflow-hidden relative group mb-2">
                              {clientSignatureUrl ? (
                                <img src={clientSignatureUrl} alt="Client Signature" className="h-full w-full object-contain p-2" />
                              ) : (
                                <div className="text-center p-2 text-slate-400">
                                  <span className="text-[10px] block">No client signature</span>
                                </div>
                              )}
                              <label className="absolute inset-0 bg-black/40 text-white text-[10px] font-semibold flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                                Upload Signature
                                <input 
                                  type="file" 
                                  accept="image/*" 
                                  className="hidden" 
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      const reader = new FileReader();
                                      reader.onloadend = () => {
                                        if (typeof reader.result === 'string') {
                                          setClientSignatureUrl(reader.result);
                                        }
                                      };
                                      reader.readAsDataURL(file);
                                    }
                                  }}
                                />
                              </label>
                            </div>

                            <p className="text-xs font-semibold text-slate-700 mt-2 h-6 border-b border-slate-200 border-dashed">{proposalPreparedFor || "Authorized Client Signature"}</p>
                            <div className="flex items-center gap-1.5 mt-2">
                              <span className="text-[10px] text-slate-500 shrink-0">Date:</span>
                              <input 
                                type="text"
                                placeholder="e.g. June 13, 2024"
                                value={proposalSignatureDate}
                                onChange={(e) => setProposalSignatureDate(e.target.value)}
                                className="flex-1 bg-white border border-slate-200 rounded px-2 py-0.5 text-[10px] outline-none focus:border-primary"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-white border-t border-gray-100 flex items-center justify-between shadow-sm z-10">
              <button
                onClick={() => setShowFinalResultModal(false)}
                className="px-4 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 text-sm font-semibold text-gray-600 cursor-pointer"
              >
                Close
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleOpenPreview}
                  className="px-5 py-2.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-semibold shadow-sm active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Eye className="w-4 h-4 text-slate-500" />
                  Preview PDF
                </button>
                <button
                  onClick={() => setShowEmailModal(true)}
                  className="px-5 py-2.5 bg-primary hover:bg-[#3d7ef7] text-white rounded-xl text-sm font-semibold shadow-md active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  Send to Customer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEmailModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 max-w-md w-full overflow-hidden transform transition-all duration-300 scale-100 animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-slate-50/50">
              <div>
                <h3 className="text-base font-bold text-gray-900">Send Estimate</h3>
                <p className="text-xs text-gray-500 mt-1">Enter the customer's email address below.</p>
              </div>
              <button
                onClick={() => setShowEmailModal(false)}
                className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6">
              <div className="space-y-4">
                <div>
                  <label htmlFor="customer-email-input" className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Customer Email Address
                  </label>
                  <input
                    id="customer-email-input"
                    type="email"
                    required
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="e.g. customer@example.com"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                    disabled={isSendingEmail}
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 bg-slate-50/50">
              <button
                onClick={() => setShowEmailModal(false)}
                disabled={isSendingEmail}
                className="px-4 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 text-sm font-semibold text-gray-600 disabled:opacity-55 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSendQuote}
                disabled={isSendingEmail || !customerEmail.trim()}
                className="px-5 py-2.5 bg-primary hover:bg-[#3d7ef7] text-white rounded-xl text-sm font-semibold shadow-md active:scale-95 transition-all flex items-center gap-1.5 disabled:opacity-55 disabled:cursor-not-allowed cursor-pointer"
              >
                {isSendingEmail ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Send
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPreviewModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 md:p-6 overflow-y-auto thin-scrollbar animate-in fade-in duration-200">
          <div className="bg-slate-100 rounded-2xl shadow-2xl border border-slate-200/80 max-w-6xl w-full h-[90vh] flex flex-col md:flex-row overflow-hidden transform transition-all duration-300 scale-100 animate-in zoom-in-95 duration-200">
            {/* Left Side: PDF Viewer */}
            <div className="flex-1 bg-slate-200 relative min-h-[300px] md:min-h-0">
              {previewPdfUrl ? (
                <iframe
                  src={previewPdfUrl}
                  title="PDF Preview"
                  className="w-full h-full border-none bg-slate-200"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <span className="text-sm">Preparing PDF Preview...</span>
                </div>
              )}
            </div>

            {/* Right Side: Sending Panel */}
            <div className="w-full md:w-96 bg-white p-6 md:p-8 flex flex-col justify-between shrink-0 border-t md:border-t-0 md:border-l border-slate-200/60">
              <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                      <Mail className="w-5 h-5 text-primary" />
                      Send Proposal
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Review the generated professional PDF proposal on the left and specify your customer's email address below to deliver it securely.
                    </p>
                  </div>
                  <button
                    onClick={handleClosePreview}
                    className="md:hidden p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <hr className="border-slate-100" />

                {/* Email Input */}
                <div className="space-y-2">
                  <label htmlFor="preview-customer-email" className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Customer Email Address
                  </label>
                  <div className="relative">
                    <input
                      id="preview-customer-email"
                      type="email"
                      required
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder="e.g. customer@example.com"
                      disabled={isSendingEmail}
                      className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    />
                    <Mail className="absolute left-3.5 top-[14px] w-4 h-4 text-slate-400" />
                  </div>
                </div>
              </div>

              {/* Buttons */}
              <div className="mt-8 flex flex-col sm:flex-row md:flex-col gap-3">
                <button
                  onClick={handleSendQuote}
                  disabled={isSendingEmail || !customerEmail.trim()}
                  className="w-full order-1 sm:order-2 md:order-1 px-5 py-3 bg-primary hover:bg-[#3d7ef7] text-white rounded-xl text-sm font-semibold shadow-md active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-55 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isSendingEmail ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Sending Proposal...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Send Proposal
                    </>
                  )}
                </button>
                <button
                  onClick={handleClosePreview}
                  disabled={isSendingEmail}
                  className="w-full order-2 sm:order-1 md:order-2 px-5 py-3 border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 active:scale-95 transition-all disabled:opacity-55 cursor-pointer text-center"
                >
                  Cancel &amp; Edit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default File;
