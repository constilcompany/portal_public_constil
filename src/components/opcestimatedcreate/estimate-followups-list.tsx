import { useState } from 'react';
import { useGetEstimateFollowupsQuery } from '../../services/rtkapi/invoiceApi';
import { SkeletonLoader } from '../common/skeleton-loader';
import { formatDisplayDate, formatCurrency } from '../common/format-display-date';
import { Mail, CheckCircle, Clock, XCircle } from 'lucide-react';

const getStatusBadge = (status: string) => {
  switch (status) {
    case 'pending':
      return <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-md text-xs font-medium flex items-center gap-1"><Clock className="w-3 h-3" /> Pending Day 2</span>;
    case 'day_2_sent':
      return <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-xs font-medium flex items-center gap-1"><Mail className="w-3 h-3" /> Day 2 Sent</span>;
    case 'day_7_sent':
      return <span className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded-md text-xs font-medium flex items-center gap-1"><Mail className="w-3 h-3" /> Day 7 Sent</span>;
    case 'replied':
      return <span className="px-2 py-1 bg-green-100 text-green-800 rounded-md text-xs font-medium flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Replied</span>;
    case 'cancelled':
      return <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded-md text-xs font-medium flex items-center gap-1"><XCircle className="w-3 h-3" /> Cancelled</span>;
    default:
      return <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded-md text-xs font-medium">{status}</span>;
  }
};

const EstimateFollowupsList = () => {
  const { data, isLoading } = useGetEstimateFollowupsQuery();
  const [filter, setFilter] = useState<'active' | 'completed'>('active');
  const allFollowups = data?.data || [];

  const followups = allFollowups.filter((f: any) => {
    if (filter === 'active') {
      return !['replied', 'cancelled'].includes(f.status);
    }
    return ['replied', 'cancelled'].includes(f.status);
  });

  if (isLoading) {
    return (
      <div className="w-full flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonLoader key={i} lines={2} />
        ))}
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-6">
      <div className="flex bg-gray-100 p-1 rounded-lg w-fit">
        <button
          onClick={() => setFilter('active')}
          className={`px-4 py-2 text-sm font-semibold rounded-md transition-all ${filter === 'active' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Active
        </button>
        <button
          onClick={() => setFilter('completed')}
          className={`px-4 py-2 text-sm font-semibold rounded-md transition-all ${filter === 'completed' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Completed
        </button>
      </div>

      {followups.length === 0 ? (
        <div className="text-center w-full mt-10">
          <h2 className="text-xl font-semibold">No {filter === 'active' ? 'Active' : 'Completed'} Follow-ups Yet</h2>
          <p className="text-gray-600 mt-2">
            {filter === 'active' 
              ? 'When you send an estimate, an active follow-up sequence will appear here.'
              : 'Sequences that have been replied to or cancelled will appear here.'}
          </p>
        </div>
      ) : (
        <div className="w-full grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {followups.map((followup: any) => (
            <div key={followup.id} className="w-full rounded-xl border border-gray-200 bg-white p-4 hover:border-primary/40 transition-colors">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Estimate #{followup.estimates?.estimate_number || 'N/A'}</p>
                  <p className="text-base font-semibold text-gray-900 truncate max-w-[200px]">
                    {followup.estimates?.clients?.name || followup.client_email}
                  </p>
                </div>
                {getStatusBadge(followup.status)}
              </div>
              
              <div className="space-y-2 mt-4 text-sm text-gray-600">
                <div className="flex justify-between">
                  <span>Client Email:</span>
                  <span className="font-medium text-gray-900 truncate max-w-[150px]">{followup.client_email}</span>
                </div>
                <div className="flex justify-between">
                  <span>Amount:</span>
                  <span className="font-medium text-primary">
                    {formatCurrency(followup.estimates?.total || followup.estimates?.total_amount || 0)}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-gray-100">
                  <span className="text-xs text-gray-400">Last Client Message:</span>
                  <span className="text-xs font-medium">
                    {followup.last_client_message_at ? formatDisplayDate(followup.last_client_message_at) : 'None'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default EstimateFollowupsList;
