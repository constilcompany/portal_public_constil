import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useSelector } from 'react-redux';
import { Calendar as CalendarIcon, List, AlertCircle, Clock, CheckCircle2, Settings, X, Search, Sparkles, Loader2, Paperclip } from 'lucide-react';
import { format, isToday, addDays, isBefore, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, getDay } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { nylasService } from '../../services/nylasService';
import { toast } from 'react-toastify';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

type ViewMode = 'list' | 'calendar';

export function TasksCalendar() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  
  // Reminders Config State
  const [showRemindersModal, setShowRemindersModal] = useState(false);
  const [reminderRules, setReminderRules] = useState<any[]>([]);
  const [newReminderDays, setNewReminderDays] = useState(1);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedTask, setSelectedTask] = useState<any | null>(null);
  
  // Attachments State
  const [taskAttachments, setTaskAttachments] = useState<any[]>([]);
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(false);
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<string | null>(null);
  
  // AI Summary State
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  // @ts-ignore
  const user = useSelector((state: any) => state.auth?.user);

  useEffect(() => {
    fetchTasks();
    if (user?.id) {
      fetchReminderRules();
    }
  }, [user]);

  useEffect(() => {
    if (selectedTask?.raw_emails?.nylas_message_id) {
      fetchAttachmentsForTask(selectedTask.raw_emails.nylas_message_id);
    } else {
      setTaskAttachments([]);
    }
  }, [selectedTask]);

  const fetchAttachmentsForTask = async (messageId: string) => {
    setIsLoadingAttachments(true);
    setTaskAttachments([]);
    try {
      const grantId = localStorage.getItem('nylas_grant_id');
      if (!grantId) return;
      // Search recent emails for the attachments since they aren't in supabase
      const emails = await nylasService.getEmails(grantId, 'INBOX', 100);
      const matched = emails.find((e: any) => e.id === messageId);
      if (matched && matched.attachments) {
        setTaskAttachments(matched.attachments);
      }
    } catch (err) {
      console.error("Failed to load attachments:", err);
    } finally {
      setIsLoadingAttachments(false);
    }
  };

  const fetchTasks = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('tasks')
      .select('*, raw_emails(id, subject, sender, body, nylas_message_id)')
      .order('due_date', { ascending: true, nullsFirst: false });

    if (error) {
      console.error("Error fetching tasks:", error);
    } else {
      setTasks(data || []);
    }
    setLoading(false);
  };

  const fetchReminderRules = async () => {
    const { data, error } = await supabase
      .from('reminder_rules')
      .select('*')
      .eq('user_id', user.id);
    if (!error && data) {
      setReminderRules(data);
    }
  };

  const addReminderRule = async () => {
    if (!user?.id) {
      console.error("Cannot add reminder rule: No active user_id found.");
      return;
    }
    
    const { data, error } = await supabase
      .from('reminder_rules')
      .insert({ user_id: user.id, days_before: newReminderDays, is_active: true })
      .select();
      
    if (error) {
      console.error("Error adding reminder rule:", error);
    } else if (data) {
      setReminderRules([...reminderRules, data[0]]);
      setNewReminderDays(1); // Reset input back to default
    }
  };

  const toggleTaskStatus = async (taskId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
    
    // Optimistic UI update
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    if (selectedTask && selectedTask.id === taskId) {
      setSelectedTask({ ...selectedTask, status: newStatus });
    }

    const { error: rpcErr } = await supabase
      .rpc('toggle_task_status', { task_id: taskId, new_status: newStatus });

    if (rpcErr) {
      console.error(`Error updating task status via RPC to ${newStatus}:`, rpcErr);
      alert(`Error updating task: ${rpcErr.message}`);
      // Revert on failure
      fetchTasks();
    } else {
      console.log("Successfully updated task via RPC.");
    }
  };

  const handleSummarizeEmail = async () => {
    if (!selectedTask?.raw_emails?.body) {
      toast.error("No email body found to summarize.");
      return;
    }
    setIsSummarizing(true);
    setSummaryText(null);
    try {
      const summary = await nylasService.summarizeEmail(selectedTask.raw_emails.body, 'None');
      setSummaryText(summary);
    } catch (err: any) {
      toast.error(err.message || 'Failed to summarize email');
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleDownloadAttachment = async (attachment: any, messageId: string) => {
    try {
      setDownloadingAttachmentId(attachment.id);
      const grantId = localStorage.getItem('nylas_grant_id');
      if (!grantId) return;
      const res = await nylasService.downloadAttachment(grantId, attachment.id, messageId);
      
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

  const handleCreateProject = async () => {
    if (!selectedTask?.raw_emails) return;
    setIsCreatingProject(true);
    
    try {
      const filesToUpload: File[] = [];
      const grantId = localStorage.getItem('nylas_grant_id');

      if (grantId && taskAttachments.length > 0) {
        for (const att of taskAttachments) {
          const res = await nylasService.downloadAttachment(grantId, att.id, selectedTask.raw_emails.nylas_message_id);
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

      // Automatically mark the task as completed before navigating
      if (selectedTask.status !== 'completed') {
        await toggleTaskStatus(selectedTask.id, selectedTask.status);
      }

      const projectName = selectedTask.raw_emails.subject || selectedTask.title || 'New AI Project';
      
      navigate('/estimates/ai/steps', {
        state: {
          projectName,
          description: summaryText || '',
          files: filesToUpload
        }
      });
      
    } catch (error: any) {
      toast.error('Failed to prepare project');
      console.error(error);
      setIsCreatingProject(false);
    }
  };

  // Grouping Logic
  const getPriorityGroup = (task: any) => {
    if (task.status === 'completed') return 'completed';
    if (!task.due_date) return 'low';
    
    const dueDate = new Date(task.due_date);
    const now = new Date();
    const in24h = addDays(now, 1);
    const in5days = addDays(now, 5);

    if (isBefore(dueDate, in24h) || isToday(dueDate)) return 'urgent';
    if (isBefore(dueDate, in5days)) return 'medium';
    return 'low';
  };

  const filteredTasks = tasks.filter(t => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const urgentTasks = filteredTasks.filter(t => getPriorityGroup(t) === 'urgent');
  const mediumTasks = filteredTasks.filter(t => getPriorityGroup(t) === 'medium');
  const lowTasks = filteredTasks.filter(t => getPriorityGroup(t) === 'low');
  const completedTasks = filteredTasks.filter(t => getPriorityGroup(t) === 'completed');

  const renderTaskCard = (task: any, badgeColor: string, badgeText: string) => (
    <div key={task.id} onClick={() => setSelectedTask(task)} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
      <div className="flex justify-between items-start mb-2">
        <span className={`text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${badgeColor}`}>
          {badgeText}
        </span>
        <button 
          onClick={(e) => {
            e.stopPropagation();
            toggleTaskStatus(task.id, task.status);
          }} 
          className="text-gray-400 hover:text-blue-600 transition-colors"
        >
          <CheckCircle2 className={`w-5 h-5 ${task.status === 'completed' ? 'text-green-500 fill-green-50' : ''}`} />
        </button>
      </div>
      <h3 className={`font-semibold text-gray-900 mb-1 ${task.status === 'completed' ? 'line-through text-gray-500' : ''}`}>
        {task.title}
      </h3>
      <p className="text-sm text-gray-600 line-clamp-2 mb-3">{task.description}</p>
      
      <div className="flex items-center text-xs text-gray-500 gap-4 mt-auto pt-3 border-t border-gray-100">
        <span className="flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" />
          {task.due_date ? format(new Date(task.due_date), 'MMM dd, yyyy') : 'No due date'}
        </span>
      </div>
    </div>
  );

  // Calendar Logic
  const daysInMonth = eachDayOfInterval({
    start: startOfMonth(currentDate),
    end: endOfMonth(currentDate)
  });
  const startDay = getDay(startOfMonth(currentDate));

  return (
    <div className="p-6 max-w-7xl mx-auto text-gray-800">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tasks & Calendar</h1>
          <p className="text-gray-500 text-sm mt-1">Manage AI-extracted action items and deadlines</p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowRemindersModal(true)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <Settings className="w-4 h-4" /> Reminders
          </button>
          
          <div className="flex bg-gray-100 p-1 rounded-lg">
            <button 
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'list' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
            >
              <List className="w-4 h-4" /> List
            </button>
            <button 
              onClick={() => setViewMode('calendar')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'calendar' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
            >
              <CalendarIcon className="w-4 h-4" /> Calendar
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading tasks...</div>
      ) : viewMode === 'list' ? (
        
        /* LIST VIEW */
        <div className="space-y-8">
          {/* Filters */}
          <div className="flex gap-4 mb-6">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input 
                type="text" 
                placeholder="Search tasks..." 
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <select 
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          {/* Urgent Section */}
          {urgentTasks.length > 0 && (
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold text-gray-800 mb-4">
                <AlertCircle className="w-5 h-5 text-red-500" /> 
                Urgent <span className="text-sm font-normal text-gray-500">({urgentTasks.length})</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {urgentTasks.map(t => renderTaskCard(t, 'bg-red-100 text-red-700', 'Due Soon'))}
              </div>
            </div>
          )}

          {/* Medium Section */}
          {mediumTasks.length > 0 && (
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold text-gray-800 mb-4">
                <Clock className="w-5 h-5 text-yellow-500" /> 
                Upcoming <span className="text-sm font-normal text-gray-500">({mediumTasks.length})</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {mediumTasks.map(t => renderTaskCard(t, 'bg-yellow-100 text-yellow-700', 'Upcoming'))}
              </div>
            </div>
          )}

          {/* Low Section */}
          {lowTasks.length > 0 && (
            <div>
              <h2 className="flex items-center gap-2 text-lg font-bold text-gray-800 mb-4">
                <List className="w-5 h-5 text-green-500" /> 
                Later / No Deadline <span className="text-sm font-normal text-gray-500">({lowTasks.length})</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {lowTasks.map(t => renderTaskCard(t, 'bg-green-100 text-green-700', 'Later'))}
              </div>
            </div>
          )}

          {/* Completed Section */}
          {completedTasks.length > 0 && (
            <div className="opacity-75">
              <h2 className="flex items-center gap-2 text-lg font-bold text-gray-800 mb-4">
                <CheckCircle2 className="w-5 h-5 text-gray-500" /> 
                Completed <span className="text-sm font-normal text-gray-500">({completedTasks.length})</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {completedTasks.map(t => renderTaskCard(t, 'bg-gray-100 text-gray-600', 'Done'))}
              </div>
            </div>
          )}

          {filteredTasks.length === 0 && (
            <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-300">
              No tasks found.
            </div>
          )}
        </div>

      ) : (

        /* CALENDAR VIEW */
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
            <h2 className="text-lg font-bold text-gray-800">{format(currentDate, 'MMMM yyyy')}</h2>
            <div className="flex gap-2">
              <button 
                onClick={() => setCurrentDate(addDays(currentDate, -30))}
                className="p-1 hover:bg-gray-200 rounded"
              >
                &larr;
              </button>
              <button 
                onClick={() => setCurrentDate(new Date())}
                className="px-3 py-1 bg-white border border-gray-300 rounded text-sm hover:bg-gray-50"
              >
                Today
              </button>
              <button 
                onClick={() => setCurrentDate(addDays(currentDate, 30))}
                className="p-1 hover:bg-gray-200 rounded"
              >
                &rarr;
              </button>
            </div>
          </div>
          
          <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
              <div key={d} className="p-2 text-center text-xs font-semibold text-gray-500 uppercase">{d}</div>
            ))}
          </div>
          
          <div className="grid grid-cols-7 auto-rows-fr">
            {Array.from({ length: startDay }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[100px] border-r border-b border-gray-100 bg-gray-50/50"></div>
            ))}
            
            {daysInMonth.map(day => {
              const dayTasks = tasks.filter(t => t.due_date && isSameDay(new Date(t.due_date), day));
              return (
                <div key={day.toString()} className={`min-h-[100px] border-r border-b border-gray-100 p-1 ${isToday(day) ? 'bg-blue-50/30' : ''}`}>
                  <div className={`text-xs font-medium p-1 mb-1 ${isToday(day) ? 'text-blue-600 bg-blue-100 w-6 h-6 flex items-center justify-center rounded-full' : 'text-gray-500'}`}>
                    {format(day, 'd')}
                  </div>
                  <div className="space-y-1">
                    {dayTasks.map(t => (
                      <div 
                        key={t.id} 
                        onClick={() => setSelectedTask(t)}
                        className={`text-[10px] p-1 rounded cursor-pointer truncate ${t.status === 'completed' ? 'bg-gray-100 text-gray-500 line-through' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}
                      >
                        {t.title}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Task Modal (Calendar click) */}
      {selectedTask && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl relative">
            <button onClick={() => setSelectedTask(null)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold text-gray-900 mb-1 pr-8">{selectedTask.title}</h3>
            <p className="text-sm text-blue-600 mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4" /> 
              Due {selectedTask.due_date ? format(new Date(selectedTask.due_date), 'PPP') : 'No date'}
            </p>
            <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-700 mb-4 whitespace-pre-wrap border border-gray-100">
              {selectedTask.description}
            </div>
            {selectedTask.raw_emails && (
              <div className="text-xs text-gray-500 border-t border-gray-100 pt-3">
                <p><strong>From Email:</strong> {selectedTask.raw_emails.subject}</p>
                <p><strong>Sender:</strong> {selectedTask.raw_emails.sender}</p>
              </div>
            )}
            
            {/* Task Attachments Section */}
            {isLoadingAttachments ? (
              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-center text-sm text-gray-500 gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading attachments...
              </div>
            ) : taskAttachments.length > 0 ? (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-gray-500" /> Attached Documents
                </h4>
                <div className="flex flex-wrap gap-2">
                  {taskAttachments.map((att: any) => (
                    <button 
                      key={att.id}
                      onClick={() => handleDownloadAttachment(att, selectedTask.raw_emails.nylas_message_id)}
                      disabled={downloadingAttachmentId === att.id}
                      className="flex items-center gap-2 bg-gray-50 hover:bg-blue-50 hover:border-blue-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 transition-all shadow-sm max-w-full"
                    >
                      {downloadingAttachmentId === att.id ? (
                        <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
                      ) : (
                        <Paperclip className="w-3 h-3 text-gray-400 shrink-0" />
                      )}
                      <span className="truncate max-w-[200px]">{att.filename || 'Attachment'}</span>
                      <span className="text-gray-400 font-normal shrink-0">
                        ({Math.round((att.size || 0) / 1024)}kb)
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex justify-between items-center">
              {selectedTask.raw_emails && selectedTask.raw_emails.body ? (
                <button
                  onClick={handleSummarizeEmail}
                  disabled={isSummarizing}
                  className="flex items-center justify-center gap-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                  title="Generate AI Summary"
                >
                  {isSummarizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-purple-500" />}
                  AI Summary
                </button>
              ) : <div />}
              <button 
                onClick={() => {
                  toggleTaskStatus(selectedTask.id, selectedTask.status);
                  setSelectedTask(null);
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${selectedTask.status === 'completed' ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
              >
                {selectedTask.status === 'completed' ? 'Mark Pending' : 'Mark Completed'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reminders Config Modal */}
      {showRemindersModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-6 shadow-xl relative">
            <button onClick={() => setShowRemindersModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-bold text-gray-900 mb-2">Automated Reminders</h3>
            <p className="text-sm text-gray-500 mb-4">Set up rules to get notified before tasks are due.</p>
            
            <div className="space-y-3 mb-6">
              {reminderRules.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No rules configured.</p>
              ) : (
                reminderRules.map(rule => (
                  <div key={rule.id} className="flex items-center justify-between bg-gray-50 p-2 rounded border border-gray-100">
                    <span className="text-sm font-medium text-gray-700">Remind me {rule.days_before} day(s) before</span>
                    <button 
                      onClick={async () => {
                        await supabase.from('reminder_rules').delete().eq('id', rule.id);
                        setReminderRules(reminderRules.filter(r => r.id !== rule.id));
                      }}
                      className="text-red-500 hover:bg-red-50 p-1 rounded"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-2">
              <input 
                type="number" 
                min="1" 
                value={newReminderDays}
                onChange={(e) => setNewReminderDays(parseInt(e.target.value) || 1)}
                className="w-20 border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:border-blue-500" 
              />
              <span className="text-sm text-gray-600 py-1.5 whitespace-nowrap">days before</span>
              <button 
                onClick={addReminderRule}
                className="ml-auto bg-gray-900 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-800 transition-colors"
              >
                Add Rule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Summary Modal */}
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

              {taskAttachments.length > 0 && (
                <div className="mt-8 pt-6 border-t border-gray-100">
                  <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Paperclip className="w-4 h-4 text-gray-500" /> Attached Documents
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {taskAttachments.map((att: any) => (
                      <button 
                        key={att.id}
                        onClick={() => handleDownloadAttachment(att, selectedTask.raw_emails.nylas_message_id)}
                        disabled={downloadingAttachmentId === att.id}
                        className="flex items-center gap-2 bg-gray-50 hover:bg-purple-50 hover:border-purple-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 transition-all shadow-sm"
                      >
                        {downloadingAttachmentId === att.id ? (
                          <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />
                        ) : (
                          <Paperclip className="w-4 h-4 text-purple-400" />
                        )}
                        <span className="truncate max-w-[250px]">{att.filename || 'Attachment'}</span>
                        <span className="text-gray-400 font-normal">
                          ({Math.round((att.size || 0) / 1024)}kb)
                        </span>
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
                className="px-6 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 font-medium text-sm transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
              >
                {isCreatingProject ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Create AI Project
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
