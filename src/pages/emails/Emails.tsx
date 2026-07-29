import React, { useEffect, useState, useRef } from 'react';
import { nylasService } from '../../services/nylasService';
import { Mail, Loader2, MailOpen, Paperclip, ChevronLeft, Reply, Send, Download, X, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';

export const Emails: React.FC = () => {
  const navigate = useNavigate();
  const [emails, setEmails] = useState<any[]>([]);
  const [inboxEmails, setInboxEmails] = useState<any[]>([]);
  const [sentEmails, setSentEmails] = useState<any[]>([]);
  const [hasFetchedInbox, setHasFetchedInbox] = useState(false);
  const [hasFetchedSent, setHasFetchedSent] = useState(false);
  
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const [loading, setLoading] = useState(true);
  const [folder, setFolder] = useState<'SENT' | 'INBOX'>('INBOX');
  const [selectedEmail, setSelectedEmail] = useState<any | null>(null);
  
  const [isReplying, setIsReplying] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  
  const [isComposing, setIsComposing] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');

  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  const [attachments, setAttachments] = useState<{filename: string, content: string, content_type: string}[]>([]);
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const nylasGrantId = localStorage.getItem('nylas_grant_id');

  useEffect(() => {
    if (nylasGrantId) {
      if (folder === 'INBOX') {
        if (hasFetchedInbox) {
          setEmails(inboxEmails);
        } else {
          fetchEmails();
        }
      } else {
        if (hasFetchedSent) {
          setEmails(sentEmails);
        } else {
          fetchEmails();
        }
      }
    } else {
      setLoading(false);
    }
  }, [folder]);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedEmail(null);
    setSummaryText(null);
  }, [folder]);

  const fetchEmails = async () => {
    try {
      // First, immediately load from local cache for instant UI
      const cacheKey = `nylas_emails_${folder}`;
      const cached = localStorage.getItem(cacheKey);
      let existingEmails: any[] = [];
      if (cached) {
        existingEmails = JSON.parse(cached);
        setEmails(existingEmails);
        if (folder === 'INBOX') setInboxEmails(existingEmails);
        else setSentEmails(existingEmails);
        setLoading(false); // Disable loading spinner if we have cached data
      } else {
        setLoading(true);
      }

      // Then, silently fetch ONLY the newest 20 emails to avoid Nylas 429 Rate Limits
      const fetchedEmails = await nylasService.getEmails(nylasGrantId!, folder, 20);
      
      // Merge new emails with cached emails, deduplicate by ID, and sort by date descending
      const mergedMap = new Map();
      existingEmails.forEach(e => mergedMap.set(e.id, e));
      fetchedEmails.forEach(e => mergedMap.set(e.id, e));
      
      const mergedEmails = Array.from(mergedMap.values()).sort((a, b) => b.date - a.date);
      
      // Save merged result back to cache and state
      localStorage.setItem(cacheKey, JSON.stringify(mergedEmails));
      setEmails(mergedEmails);
      
      if (folder === 'INBOX') {
        setInboxEmails(mergedEmails);
        setHasFetchedInbox(true);
      } else {
        setSentEmails(mergedEmails);
        setHasFetchedSent(true);
      }
      
    } catch (err: any) {
      console.error(err);
      if (err.message?.includes('429') || err.message?.includes('504') || err.message?.includes('503')) {
        toast.warn("Nylas is syncing in the background. Viewing cached emails.");
      } else if (err.message?.includes('grant.not_found') || err.message?.includes('No Grant found')) {
        localStorage.removeItem('nylas_grant_id');
        toast.error("Your email connection expired. Please reconnect your account.");
        setTimeout(() => window.location.reload(), 1500);
      } else {
        toast.error(err.message || "Failed to fetch emails.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConnectEmail = () => {
    nylasService.connectEmail();
  };

  const handleSummarizeEmail = async () => {
    if (!selectedEmail) return;
    setIsSummarizing(true);
    setSummaryText(null);
    try {
      const emailBody = selectedEmail.body || selectedEmail.snippet || '';
      const attachmentsInfo = selectedEmail.attachments?.map((a: any) => a.filename).join(', ') || 'None';

      const summary = await nylasService.summarizeEmail(emailBody, attachmentsInfo);

      setSummaryText(summary);
    } catch (err: any) {
      toast.error(err.message || 'Failed to summarize email');
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleCreateProject = async () => {
    if (!selectedEmail) return;
    setIsCreatingProject(true);
    
    try {
      const filesToUpload: File[] = [];

      if (selectedEmail.attachments && selectedEmail.attachments.length > 0) {
        for (const att of selectedEmail.attachments) {
          const res = await nylasService.downloadAttachment(nylasGrantId!, att.id, selectedEmail.id);
          const base64Data = res.data;
          
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: res.contentType });
          const file = new File([blob], att.filename || 'Attachment', { type: res.contentType });
          filesToUpload.push(file);
        }
      }

      const projectName = selectedEmail.subject || 'New AI Project';
      
      navigate('/estimates/ai/steps', {
        state: {
          projectName,
          description: summaryText || '',
          files: filesToUpload
        }
      });
      
    } catch (error: any) {
      toast.error('Failed to prepare project files');
      console.error(error);
      setIsCreatingProject(false);
    }
  };

  const handleSendReply = async () => {
    if (!replyText.trim() && attachments.length === 0) return;
    try {
      setSendingReply(true);
      const toEmail = folder === 'SENT' ? selectedEmail.to?.[0]?.email : selectedEmail.from?.[0]?.email;
      const subject = selectedEmail.subject || '';
      
      const { success } = await nylasService.replyToEmail(
        nylasGrantId!,
        selectedEmail.id,
        toEmail,
        subject.startsWith('Re:') ? subject : `Re: ${subject}`,
        replyText,
        attachments
      );
      
      if (success) {
        toast.success("Reply sent successfully!");
        setIsReplying(false);
        setReplyText('');
        setAttachments([]);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to send reply");
    } finally {
      setSendingReply(false);
    }
  };

  const handleSendCompose = async () => {
    if (!composeTo.trim()) return toast.error("Please enter a recipient");
    try {
      setSendingReply(true);
      
      const { success } = await nylasService.sendEmail(
        nylasGrantId!,
        composeTo,
        composeSubject,
        composeBody,
        '', 
        '',
        attachments
      );
      
      if (success) {
        toast.success("Email sent successfully!");
        setIsComposing(false);
        setComposeTo('');
        setComposeSubject('');
        setComposeBody('');
        setAttachments([]);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to send email");
    } finally {
      setSendingReply(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setAttachments(prev => [...prev, {
          filename: file.name,
          content: base64,
          content_type: file.type || 'application/octet-stream'
        }]);
      };
      reader.readAsDataURL(file);
    });
    // clear input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDownloadAttachment = async (attachment: any, messageId: string) => {
    try {
      setDownloadingAttachmentId(attachment.id);
      const res = await nylasService.downloadAttachment(nylasGrantId!, attachment.id, messageId);
      
      const link = document.createElement('a');
      link.href = `data:${res.contentType};base64,${res.data}`;
      link.download = attachment.filename || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      toast.error(err.message || "Failed to download attachment");
    } finally {
      setDownloadingAttachmentId(null);
    }
  };

  const getInitials = (name: string | undefined, email: string) => {
    if (name) {
      const parts = name.split(' ');
      if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
      return name.substring(0, 2).toUpperCase();
    }
    if (email) {
      return email.substring(0, 2).toUpperCase();
    }
    return '?';
  };

  const groupedEmails = React.useMemo(() => {
    const grouped = new Map();
    emails.forEach(email => {
      const key = email.thread_id || email.subject || email.id;
      if (!grouped.has(key)) {
        grouped.set(key, { ...email, thread_count: 1, thread_messages: [email] });
      } else {
        const existing = grouped.get(key);
        existing.thread_count += 1;
        existing.thread_messages.push(email);
        // Keep the latest email as the main display
        if (email.date > existing.date) {
          grouped.set(key, { ...email, thread_count: existing.thread_count, thread_messages: existing.thread_messages });
        }
      }
    });
    return Array.from(grouped.values()).sort((a, b) => b.date - a.date);
  }, [emails]);



  if (!nylasGrantId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] bg-gray-50 rounded-lg border border-gray-200">
        <Mail className="w-16 h-16 text-blue-500 mb-4" />
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Connect Your Email</h2>
        <p className="text-gray-600 mb-6 text-center max-w-md">
          Connect your Google or Microsoft email account to view your sent estimates and manage your inbox directly from here.
        </p>
        <button
          onClick={handleConnectEmail}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
        >
          <Mail className="w-5 h-5" />
          Connect Email Account
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] bg-gray-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-gray-800 hidden sm:block">Email Manager</h1>
          <button
            onClick={() => {
              setIsComposing(true);
              setSelectedEmail(null);
              setAttachments([]);
            }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> Compose
          </button>
          <button
            onClick={fetchEmails}
            disabled={loading}
            className="flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-gray-700 w-9 h-9 rounded-lg transition-colors"
            title="Refresh Emails"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-500' : ''}`} />
          </button>
          
        </div>
        <div className="flex bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => { setFolder('INBOX'); setIsComposing(false); }}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              folder === 'INBOX' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Inbox
          </button>
          <button
            onClick={() => { setFolder('SENT'); setIsComposing(false); }}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              folder === 'SENT' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Sent
          </button>
        </div>
      </div>

      <input 
        type="file" 
        multiple 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        className="hidden" 
      />

      {/* Main Split Content */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Pane: Email List */}
        <div className={`w-full lg:w-1/3 flex flex-col border-r border-gray-200 bg-white ${(selectedEmail || isComposing) ? 'hidden lg:flex' : 'flex'}`}>
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-4" />
                <p className="text-gray-500 text-sm">Syncing emails...</p>
              </div>
            ) : groupedEmails.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center px-4">
                <MailOpen className="w-12 h-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-1">No emails found</h3>
                <p className="text-gray-500 text-sm">
                  {`Your ${folder.toLowerCase()} is empty.`}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {groupedEmails.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE).map((email: any) => {
                  const isSent = folder === 'SENT';
                  const mainParticipant = isSent ? email.to?.[0] : email.from?.[0];
                  const emailAddress = mainParticipant?.email || 'Unknown';
                  const name = mainParticipant?.name || emailAddress.split('@')[0];
                  const isSelected = selectedEmail?.id === email.id;
                  
                  const dateObj = new Date(email.date * 1000);
                  const timeString = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const isToday = new Date().toDateString() === dateObj.toDateString();
                  const dateDisplay = isToday ? timeString : dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });

                  return (
                    <li 
                      key={email.id} 
                      onClick={() => {
                        setSelectedEmail(email);
                        setIsComposing(false);
                        setIsReplying(false);
                        setReplyText('');
                        setAttachments([]);
                        setSummaryText(null);
                      }}
                      className={`px-4 py-3 border-b border-gray-100 cursor-pointer transition-colors ${
                        isSelected ? 'bg-[#c2e7ff]/40 border-l-4 border-[#0b57d0]' : 'hover:bg-gray-50 border-l-4 border-transparent'
                      }`}
                    >
                      <div className="flex flex-col min-w-0">
                        <div className="flex justify-between items-center mb-0.5">
                          <span className={`text-sm truncate mr-2 ${isSelected ? 'font-bold text-[#041e49]' : 'font-bold text-[#202124]'}`}>
                            {name}
                            {email.thread_count > 1 && (
                              <span className="text-gray-500 font-normal ml-1">({email.thread_count})</span>
                            )}
                          </span>
                          <span className={`text-xs whitespace-nowrap ${isSelected ? 'text-[#0b57d0] font-semibold' : 'text-gray-500 font-medium'}`}>
                            {dateDisplay}
                          </span>
                        </div>
                        <div className="text-sm truncate flex items-center">
                          {email.has_attachments && <Paperclip className="w-3.5 h-3.5 text-gray-400 shrink-0 mr-1" />}
                          <span className={`mr-1 ${isSelected ? 'font-medium text-[#041e49]' : 'font-medium text-[#202124]'}`}>
                            {email.subject || '(No Subject)'}
                          </span>
                          <span className="text-gray-500">- {email.snippet}</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {/* Pagination Controls */}
          {!loading && groupedEmails.length > ITEMS_PER_PAGE && (
            <div className="border-t border-gray-200 p-3 flex items-center justify-between bg-gray-50 shrink-0">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                className="px-3 py-1.5 text-sm font-medium bg-white border border-gray-200 rounded-md disabled:opacity-50 hover:bg-gray-100 transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-xs font-medium text-gray-500">
                Page {currentPage} of {Math.ceil(groupedEmails.length / ITEMS_PER_PAGE)}
              </span>
              <button
                disabled={currentPage === Math.ceil(groupedEmails.length / ITEMS_PER_PAGE)}
                onClick={() => setCurrentPage(p => Math.min(Math.ceil(groupedEmails.length / ITEMS_PER_PAGE), p + 1))}
                className="px-3 py-1.5 text-sm font-medium bg-white border border-gray-200 rounded-md disabled:opacity-50 hover:bg-gray-100 transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Right Pane: Email Reader or Compose */}
        <div className={`w-full lg:w-2/3 flex flex-col bg-white ${!(selectedEmail || isComposing) ? 'hidden lg:flex' : 'flex'}`}>
          {isComposing ? (
            <div className="flex flex-col h-full bg-gray-50">
              <div className="px-6 py-5 border-b border-gray-200 bg-white flex justify-between items-center shrink-0">
                <h2 className="text-lg font-semibold text-gray-800">New Message</h2>
                <button onClick={() => setIsComposing(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-6">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase">To</label>
                    <input 
                      type="text" 
                      value={composeTo}
                      onChange={(e) => setComposeTo(e.target.value)}
                      placeholder="recipient@example.com"
                      className="w-full mt-1 border-b border-gray-200 py-2 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase">Subject</label>
                    <input 
                      type="text" 
                      value={composeSubject}
                      onChange={(e) => setComposeSubject(e.target.value)}
                      placeholder="Message Subject"
                      className="w-full mt-1 border-b border-gray-200 py-2 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>
                  <div className="flex-1 min-h-[300px]">
                    <textarea 
                      value={composeBody}
                      onChange={(e) => setComposeBody(e.target.value)}
                      placeholder="Type your message here..."
                      className="w-full h-full min-h-[300px] mt-2 resize-none focus:outline-none text-gray-800"
                    ></textarea>
                  </div>

                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-100">
                      {attachments.map((att, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg text-sm border border-blue-100">
                          <Paperclip className="w-3.5 h-3.5" />
                          <span className="truncate max-w-[150px]">{att.filename}</span>
                          <button onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))} className="ml-1 hover:text-blue-900">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-between items-center pt-4 border-t border-gray-100 mt-2">
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 text-gray-500 hover:text-gray-700 px-3 py-2 rounded-md hover:bg-gray-50 transition-colors"
                    >
                      <Paperclip className="w-4 h-4" /> Attach Files
                    </button>
                    <button
                      onClick={handleSendCompose}
                      disabled={!composeTo.trim() || sendingReply}
                      className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {sendingReply ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      {sendingReply ? 'Sending...' : 'Send Message'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : selectedEmail ? (
            <div className="flex flex-col h-full">
              {/* Reader Header */}
              <div className="px-8 pt-6 pb-4 shrink-0 bg-white">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={() => setSelectedEmail(null)}
                      className="lg:hidden flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100 text-gray-600 transition-colors"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <h2 className="text-[22px] font-normal text-[#1f1f1f]">{selectedEmail.subject || '(No Subject)'}</h2>
                  </div>
                  <button
                    onClick={() => { 
                      setIsReplying(true); 
                      setAttachments([]); 
                      setTimeout(() => {
                        if (scrollRef.current) {
                          scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
                        }
                      }, 100);
                    }}
                    className="hidden lg:flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-colors"
                  >
                    <Reply className="w-4 h-4" /> Reply
                  </button>
                </div>
                
                <div className="flex justify-between items-start mt-2">
                  <div className="flex items-center gap-3">
                    <div className="shrink-0 w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-base font-semibold">
                      {getInitials(selectedEmail.from?.[0]?.name, selectedEmail.from?.[0]?.email)}
                    </div>
                    <div>
                      <div className="text-sm">
                        <span className="font-bold text-[#202124]">{selectedEmail.from?.[0]?.name || selectedEmail.from?.[0]?.email.split('@')[0]}</span>
                        <span className="text-gray-500 ml-1.5 text-[13px]">&lt;{selectedEmail.from?.[0]?.email}&gt;</span>
                      </div>
                      <div className="text-[13px] text-gray-500 mt-0.5">
                        to {selectedEmail.to?.map((t: any) => t.email).join(', ')}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-gray-500 text-[13px] font-medium pt-1">
                    {new Date(selectedEmail.date * 1000).toLocaleString(undefined, { 
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
                    })}
                  </div>
                </div>

                {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {selectedEmail.attachments.map((att: any) => (
                      <button 
                        key={att.id}
                        onClick={() => handleDownloadAttachment(att, selectedEmail.id)}
                        disabled={downloadingAttachmentId === att.id}
                        className="flex items-center gap-2 bg-white hover:bg-gray-50 text-[#3c4043] px-4 py-2 rounded-full text-sm font-medium border border-gray-300 transition-colors"
                      >
                        {downloadingAttachmentId === att.id ? (
                          <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4 text-gray-500" />
                        )}
                        <span className="truncate max-w-[150px]">{att.filename || 'Attachment'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Reader Body */}
              <div ref={scrollRef} className="flex-1 overflow-auto bg-white px-8 pb-8 flex flex-col gap-6 relative">
                
                <div className="w-full">
                  <iframe 
                    title="Email Body"
                    srcDoc={selectedEmail.body || selectedEmail.snippet}
                    className="w-full min-h-[500px] h-[600px] border-none"
                    sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
                  />
                </div>

                {/* Reply Section */}
                {isReplying ? (
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                      <Reply className="w-4 h-4 text-blue-500" /> 
                      Replying to {folder === 'SENT' ? selectedEmail.to?.[0]?.name || selectedEmail.to?.[0]?.email : selectedEmail.from?.[0]?.name || selectedEmail.from?.[0]?.email}
                    </h3>
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Type your message here..."
                      className="w-full min-h-[150px] p-4 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y text-sm text-gray-800"
                    />

                    {attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {attachments.map((att, idx) => (
                          <div key={idx} className="flex items-center gap-2 bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs font-medium">
                            <Paperclip className="w-3 h-3" />
                            <span className="truncate max-w-[100px]">{att.filename}</span>
                            <button onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))} className="ml-1 hover:text-gray-900">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 flex justify-between items-center">
                      <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-2 text-gray-500 hover:text-gray-700 px-3 py-2 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium"
                      >
                        <Paperclip className="w-4 h-4" /> Attach File
                      </button>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setIsReplying(false);
                            setReplyText('');
                            setAttachments([]);
                          }}
                          className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
                          disabled={sendingReply}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSendReply}
                          disabled={(!replyText.trim() && attachments.length === 0) || sendingReply}
                          className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {sendingReply ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                          {sendingReply ? 'Sending...' : 'Send'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { 
                      setIsReplying(true); 
                      setAttachments([]); 
                      setTimeout(() => {
                        if (scrollRef.current) {
                          scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
                        }
                      }, 100);
                    }}
                    className="w-fit flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 shadow-sm text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <Reply className="w-4 h-4" /> Reply
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-gray-50/50">
              <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center mb-6">
                <Mail className="w-10 h-10 text-blue-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-800 mb-2">Select an email to read</h3>
              <p className="text-gray-500 max-w-sm">
                Click on an email from the list on the left to view its full contents here.
              </p>
            </div>
          )}
        </div>

      </div>

      {summaryText && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-purple-50/50">
              <h3 className="text-lg font-semibold text-purple-900 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-600" /> AI Summary
              </h3>
              <button 
                onClick={() => setSummaryText(null)}
                className="text-gray-400 hover:text-gray-600 p-2 rounded-full hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[70vh]">
              <div className="prose prose-sm prose-purple max-w-none text-gray-700 whitespace-pre-wrap leading-relaxed text-[15px]">
                {summaryText}
              </div>
              
              {selectedEmail?.attachments && selectedEmail.attachments.length > 0 && (
                <div className="mt-8 pt-6 border-t border-gray-100">
                  <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Paperclip className="w-4 h-4 text-gray-500" /> Attached Documents
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedEmail.attachments.map((att: any) => (
                      <button 
                        key={att.id}
                        onClick={() => handleDownloadAttachment(att, selectedEmail.id)}
                        disabled={downloadingAttachmentId === att.id}
                        className="flex items-center gap-2 bg-gray-50 hover:bg-purple-50 hover:border-purple-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 transition-all shadow-sm"
                      >
                        {downloadingAttachmentId === att.id ? (
                          <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4 text-gray-500" />
                        )}
                        <span className="truncate max-w-[200px]">{att.filename || 'Attachment'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button
                onClick={() => setSummaryText(null)}
                disabled={isCreatingProject}
                className="px-6 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 font-medium text-sm transition-colors shadow-sm disabled:opacity-50"
              >
                Close
              </button>
              <button
                onClick={handleCreateProject}
                disabled={isCreatingProject}
                className="flex items-center gap-2 px-6 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 font-medium text-sm transition-colors shadow-sm disabled:opacity-50"
              >
                {isCreatingProject && <Loader2 className="w-4 h-4 animate-spin" />}
                {isCreatingProject ? 'Preparing Project...' : 'Create new AI Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
