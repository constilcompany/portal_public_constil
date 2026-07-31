import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useSelector } from 'react-redux';
import { Check, X, Save, Clock, Mail, LayoutTemplate, RefreshCw, ArrowLeft } from 'lucide-react';
import { nylasService } from '../../services/nylasService';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export function ReviewQueue() {
  const [queue, setQueue] = useState<any[]>([]);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editFields, setEditFields] = useState<any>({});
  
  // @ts-ignore
  const user = useSelector((state: any) => state.auth?.user);

  useEffect(() => {
    fetchQueue();
  }, []);

  const fetchQueue = async () => {
    setLoading(true);
    // Fetch review_queue joined with raw_emails, email_classifications, extracted_fields
    // Since Supabase requires foreign key setup for nested joins, we will do a flat join or multiple queries if needed
    // Assuming standard postgrest relationships are set up:
    const query = supabase
      .from('review_queue')
      .select(`
        id, status,
        raw_emails!inner ( 
          id, subject, body, sender, received_at, user_id,
          extracted_fields ( id, fields )
        ),
        email_classifications!inner ( id, category, confidence_score )
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    // Temporarily disabled user_id filter because webhook inserts null user_id
    // if (user?.id) {
    //   query.eq('raw_emails.user_id', user.id);
    // }

    const { data, error } = await query;

    console.log('FETCH_ERROR:', error, 'FETCH_DATA:', data);

    if (error) {
      console.error("Error fetching queue:", error);
    } else {
      setQueue(data || []);
      if (data && data.length > 0) {
        selectItem(data[0]);
      }
    }
    setLoading(false);
  };

  const selectItem = (item: any) => {
    setSelectedItem(item);
    
    // extracted_fields is nested inside raw_emails (and returned as an array)
    const extracted = Array.isArray(item.raw_emails?.extracted_fields) 
      ? item.raw_emails.extracted_fields[0] || {}
      : item.raw_emails?.extracted_fields || {};
      
    setEditFields({
      category: item.email_classifications?.category || '',
      project_name: extracted.fields?.project_name || '',
      due_date: extracted.fields?.due_date || '',
      scope_description: extracted.fields?.scope_description || '',
      dollar_amount: extracted.fields?.dollar_amount || '',
    });
  };

  const handleFieldChange = (key: string, value: string) => {
    setEditFields({ ...editFields, [key]: value });
  };

  const handleApprove = async () => {
    if (!selectedItem) return;
    setSubmitting(true);
    try {
      const emailId = selectedItem.raw_emails.id;
      
      const extracted = Array.isArray(selectedItem.raw_emails?.extracted_fields) 
        ? selectedItem.raw_emails.extracted_fields[0] || {}
        : selectedItem.raw_emails?.extracted_fields || {};
        
      const { error: approveErr } = await supabase.rpc('approve_review_queue_item', {
        p_review_queue_id: selectedItem.id,
        p_extracted_id: extracted.id || null,
        p_classification_id: selectedItem.email_classifications?.id || null,
        p_category: editFields.category || null,
        p_project_name: editFields.project_name || null,
        p_due_date: editFields.due_date || null,
        p_scope_description: editFields.scope_description || null,
        p_dollar_amount: editFields.dollar_amount || null,
        p_email_id: emailId,
        p_user_id: user?.id || null
      });

      if (approveErr) {
        console.error("Error approving review queue item via RPC:", approveErr);
        alert(`Error approving item: ${approveErr.message}`);
        setSubmitting(false);
        return;
      }
      
      console.log("Successfully approved and created task via RPC.");

      // Refresh the queue to ensure DB state matches UI
      await fetchQueue();
      setSelectedItem(null);

    } catch (err: any) {
      console.error("Error approving item:", err);
      alert(`Unexpected error during approval: ${err.message || err}`);
    }
    setSubmitting(false);
  };

  const handleReject = async () => {
    if (!selectedItem) return;
    setSubmitting(true);
    try {
      const { error: rejectErr } = await supabase.rpc('reject_review_queue_item', { 
        p_review_queue_id: selectedItem.id 
      });

      if (rejectErr) {
        console.error("Error rejecting item:", rejectErr);
        alert(`Error rejecting item: ${rejectErr.message}`);
      } else {
        await fetchQueue();
        setSelectedItem(null);
      }
    } catch (err: any) {
      console.error("Error rejecting item:", err);
      alert(`Unexpected error during reject: ${err.message || err}`);
    }
    setSubmitting(false);
  };

  const handleManualSync = async () => {
    try {
      const grantId = localStorage.getItem('nylas_grant_id');
      if (!grantId) {
        alert("Please connect your email in the Emails tab first.");
        return;
      }
      setLoading(true);
      const emails = await nylasService.getEmails(grantId, 'INBOX', 5);
      
      let processed = 0;
      for (const email of emails) {
        const { data: existing } = await supabase.from('raw_emails').select('id').eq('nylas_message_id', email.id).maybeSingle();
        if (existing) continue;

        const { data: insertedRecord } = await supabase
          .from('raw_emails')
          .insert({
            nylas_message_id: email.id,
            subject: email.subject || '',
            body: email.body || email.snippet || '',
            sender: email.from ? JSON.stringify(email.from) : '',
            recipients: email.to || [],
            status: 'pending_ai',
            received_at: new Date(email.date * 1000).toISOString()
          })
          .select('id')
          .single();
          
        if (insertedRecord) {
          const aiFuncUrl = `${supabaseUrl}/functions/v1/process-email-ai`;
          fetch(aiFuncUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseAnonKey}` },
            body: JSON.stringify({ email_id: insertedRecord.id })
          }).catch(err => console.error(err));
          processed++;
        }
      }
      
      if (processed > 0) {
        alert(`Synced ${processed} new emails. AI is processing them. Please refresh in a few seconds.`);
      } else {
        alert("No new emails to sync or they are already processed.");
      }
      await fetchQueue();
    } catch (err: any) {
      console.error(err);
      alert("Failed to sync emails: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-64px)] bg-gray-50 text-gray-800 overflow-hidden">
      {/* Left Sidebar: Queue List */}
      <div className={`w-full md:w-1/3 bg-white border-b md:border-b-0 md:border-r border-gray-200 overflow-y-auto ${selectedItem ? 'hidden md:block h-full' : 'h-full'}`}>
        <div className="p-4 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between sticky top-0 z-10">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <LayoutTemplate className="w-5 h-5 text-blue-600" />
            Review Queue
          </h2>
          <div className="flex items-center gap-2 mt-2 sm:mt-0">
            <button 
              onClick={handleManualSync}
              disabled={loading}
              className="flex items-center gap-1 bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 text-xs px-2 py-1 rounded transition-colors disabled:opacity-50"
              title="Sync latest 5 emails"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              Sync
            </button>
            <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full font-medium">
              {queue.length} Pending
            </span>
          </div>
        </div>
        
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading queue...</div>
        ) : queue.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <div className="mx-auto w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
              <Check className="w-6 h-6 text-gray-400" />
            </div>
            <p>Queue is empty. All caught up!</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {queue.map(item => (
              <div 
                key={item.id} 
                onClick={() => selectItem(item)}
                className={`p-4 cursor-pointer hover:bg-blue-50 transition-colors ${selectedItem?.id === item.id ? 'bg-blue-50 border-l-4 border-blue-600' : 'border-l-4 border-transparent'}`}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                    {item.email_classifications.category}
                  </span>
                  <span className="text-xs text-gray-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(item.raw_emails.received_at).toLocaleDateString()}
                  </span>
                </div>
                <h3 className="font-medium text-gray-900 truncate mt-2">{item.raw_emails.subject}</h3>
                <p className="text-sm text-gray-500 truncate">{item.raw_emails.sender}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right Side: Detail & Edit View */}
      <div className={`w-full md:w-2/3 flex flex-col overflow-hidden bg-gray-50 ${selectedItem ? 'h-full' : 'hidden md:flex md:h-full'}`}>
        {selectedItem ? (
          <>
            {/* Action Bar */}
            <div className="bg-white border-b border-gray-200 px-4 md:px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-0 shadow-sm z-10">
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => selectItem(null)}
                  className="md:hidden p-1 -ml-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
                  title="Back to queue"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg md:text-xl font-bold text-gray-800">Validate AI Extraction</h2>
              </div>
              <div className="flex gap-2 md:gap-3 w-full sm:w-auto">
                <button 
                  onClick={handleReject} 
                  disabled={submitting}
                  className="px-3 md:px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 flex-1 sm:flex-none text-sm md:text-base"
                >
                  <X className="w-4 h-4" /> Reject
                </button>
                <button 
                  onClick={handleApprove} 
                  disabled={submitting}
                  className="px-3 md:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center justify-center gap-2 transition-colors shadow-sm disabled:opacity-50 flex-1 sm:flex-none text-sm md:text-base"
                >
                  <Save className="w-4 h-4" /> Save & Approve
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-6 flex flex-col xl:flex-row gap-4 md:gap-6">
              
              {/* Left Column: Original Email */}
              <div className="w-full xl:flex-1 bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-5 flex flex-col min-h-[350px] xl:min-h-0">
                <div className="flex items-center gap-2 mb-4 text-gray-500 border-b border-gray-100 pb-3">

                  <Mail className="w-5 h-5" />
                  <h3 className="font-semibold text-gray-700">Original Email</h3>
                </div>
                
                <div className="mb-4 shrink-0">
                  <p className="text-sm text-gray-500 mb-1">From</p>
                  <p className="font-medium text-gray-900">{selectedItem.raw_emails.sender}</p>
                </div>
                <div className="mb-4 shrink-0">
                  <p className="text-sm text-gray-500 mb-1">Subject</p>
                  <p className="font-medium text-gray-900">{selectedItem.raw_emails.subject}</p>
                </div>
                <div className="flex-1 overflow-y-auto bg-gray-50 rounded-lg p-4 border border-gray-100 text-sm whitespace-pre-wrap">
                  {selectedItem.raw_emails.body}
                </div>
              </div>

              {/* Right Column: Editable Extracted Fields */}
              <div className="w-full xl:flex-1 bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:p-5 shrink-0">
                <h3 className="font-semibold text-gray-700 mb-4 border-b border-gray-100 pb-3">Extracted Details</h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                    <select 
                      value={editFields.category}
                      onChange={(e) => handleFieldChange('category', e.target.value)}
                      className="w-full border border-gray-300 rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="Bid Request">Bid Request</option>
                      <option value="RFI">RFI</option>
                      <option value="Change Order">Change Order</option>
                      <option value="Submittal">Submittal</option>
                      <option value="Invoice">Invoice</option>
                      <option value="General">General</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Project Name</label>
                    <input 
                      type="text" 
                      value={editFields.project_name}
                      onChange={(e) => handleFieldChange('project_name', e.target.value)}
                      className="w-full border border-gray-300 rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                    <input 
                      type="date" 
                      value={editFields.due_date ? editFields.due_date.substring(0, 10) : ''}
                      onChange={(e) => handleFieldChange('due_date', e.target.value)}
                      className="w-full border border-gray-300 rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Dollar Amount</label>
                    <input 
                      type="number" 
                      value={editFields.dollar_amount || ''}
                      onChange={(e) => handleFieldChange('dollar_amount', e.target.value)}
                      className="w-full border border-gray-300 rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Scope Description</label>
                    <textarea 
                      rows={5}
                      value={editFields.scope_description}
                      onChange={(e) => handleFieldChange('scope_description', e.target.value)}
                      className="w-full border border-gray-300 rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                    ></textarea>
                  </div>

                  <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-sm text-gray-500">AI Confidence</span>
                    <span className="font-bold text-green-600 bg-green-50 px-2 py-1 rounded">
                      {selectedItem.email_classifications.confidence_score}%
                    </span>
                  </div>
                </div>
              </div>

            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            Select an item from the queue to review
          </div>
        )}
      </div>
    </div>
  );
}
