import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { nylasService } from '../../services/nylasService';
import { Loader2 } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';


/** Maps raw Nylas/API error messages to friendly user-facing text */
const getFriendlyError = (raw: string): string => {
  if (raw.includes('maximum_number_of_sandbox_grants_reached') || raw.includes('26010')) {
    return 'Our email integration is currently at capacity. Please contact support and we will get you connected shortly.';
  }
  if (raw.includes('invalid_query_params') || raw.includes('not allowed') || raw.includes('RedirectURI')) {
    return 'There was a configuration issue with the email connection. Please contact support.';
  }
  if (raw.includes('grant.not_found') || raw.includes('No Grant found')) {
    return 'Your email session expired. Please try connecting your email again.';
  }
  if (raw.includes('401') || raw.includes('Unauthorized')) {
    return 'Authentication failed. Please log in again and try connecting your email.';
  }
  if (raw.includes('Failed to authenticate')) {
    return 'We could not verify your email account. Please try again.';
  }
  return 'Something went wrong while connecting your email. Please try again or contact support.';
};

export const AuthCallback: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<string>('Authenticating...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    
    if (!code) {
      setError('No authentication code found in the URL. Please try connecting your email again.');
      return;
    }

    const processAuth = async () => {
      try {
        setStatus('Securing your email connection...');
        // In a real implementation, this sends the code to the backend proxy
        const grantId = await nylasService.exchangeCodeForGrant(code);
        
        if (grantId) {
          // Save the grant ID to local storage (or your state management solution)
          localStorage.setItem('nylas_grant_id', grantId);
          setStatus('Success! Syncing your emails...');
          
          try {
            // Auto-sync process when connecting a new email
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
            const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
            const supabase = createClient(supabaseUrl, supabaseAnonKey);
            
            // Clear old data for a fresh start (specifically tasks which don't cascade)
            await supabase.from('estimate_followups').delete().not('id', 'is', null);
            await supabase.from('tasks').delete().not('id', 'is', null);
            await supabase.from('raw_emails').delete().not('id', 'is', null);

            // Fetch and process new emails automatically
            const emails = await nylasService.getEmails(grantId, 'INBOX', 5);
            for (const email of emails) {
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
                 }).catch(console.error);
               }
            }
          } catch(e) {
             console.error("Auto-sync failed:", e);
          }
          
          setStatus('Sync initiated! Redirecting back...');
          // Redirect back to the estimates/file page
          setTimeout(() => {
            navigate('/estimates/ai/file');
          }, 1500);
        } else {
          setError('Failed to retrieve grant ID from authentication server.');
        }
      } catch (err: any) {
        console.error("Nylas auth error:", err);
        const friendlyError = getFriendlyError(err.message || '');
        setError(friendlyError);
      }
    };

    processAuth();
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-100 max-w-md w-full p-8 text-center animate-in zoom-in-95 duration-300">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Connecting Email</h2>
        
        {error ? (
          <div className="mt-4">
            <div className="p-4 bg-red-50 border border-red-100 rounded-xl mb-6 text-left">
              <p className="text-red-700 font-semibold text-sm mb-1">⚠️ Connection Failed</p>
              <p className="text-red-600 text-sm leading-relaxed">{error}</p>
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => navigate('/emails')}
                className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-semibold transition-all"
              >
                Return to App
              </button>
              <button
                onClick={() => navigate('/emails')}
                className="px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-sm font-semibold transition-all"
              >
                Try Again
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-8 flex flex-col items-center">
            <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
            <p className="text-gray-600 font-medium">{status}</p>
          </div>
        )}
      </div>
    </div>
  );
};
