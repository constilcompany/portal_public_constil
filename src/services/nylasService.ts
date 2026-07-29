import { store } from '../redux/store';

export const nylasService = {
  /**
   * Redirects the user to the Nylas Hosted Authentication page.
   */
  connectEmail: () => {
    const clientId = import.meta.env.VITE_NYLAS_CLIENT_ID;
    const apiUri = import.meta.env.VITE_NYLAS_API_URI || 'https://api.us.nylas.com';
    const appUrl = import.meta.env.VITE_APP_URL || window.location.origin;
    
    if (!clientId) {
      console.error("VITE_NYLAS_CLIENT_ID is not defined in environment variables.");
      alert("Missing Nylas Client ID configuration. Cannot connect email.");
      return;
    }

    const redirectUri = `${appUrl}/auth/nylas/callback`;
    const authUrl = `${apiUri}/v3/connect/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&access_type=offline`;
    
    window.location.href = authUrl;
  },

  /**
   * Calls the Supabase Edge Function to exchange an OAuth code for a grant_id.
   */
  exchangeCodeForGrant: async (code: string): Promise<string> => {
    const clientId = import.meta.env.VITE_NYLAS_CLIENT_ID;
    const appUrl = import.meta.env.VITE_APP_URL || window.location.origin;
    const redirectUri = `${appUrl}/auth/nylas/callback`;

    // @ts-ignore
    const state = store.getState();
    // @ts-ignore
    const token = state.auth?.token || localStorage.getItem('access_token');
    const functionsUrl = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;

    const response = await fetch(`${functionsUrl}/ai-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'nylas-exchange-code',
        code,
        clientId,
        redirectUri
      })
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      console.error("[NYLAS ERROR] Secure edge function response:", data.error || response.statusText);
      throw new Error(data.error || "Failed to authenticate with Nylas");
    }

    return data.grant_id;
  },

  /**
   * Calls the Supabase Edge Function to send an email using the Nylas grant_id.
   */
  sendEmail: async (
    grantId: string,
    toEmail: string,
    subject: string,
    bodyText: string,
    pdfBase64: string,
    fileName: string = 'Estimate.pdf',
    attachments?: any[]
  ): Promise<{ success: boolean; message?: string }> => {
    
    // @ts-ignore
    const state = store.getState();
    // @ts-ignore
    const token = state.auth?.token || localStorage.getItem('access_token');
    const functionsUrl = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;

    const response = await fetch(`${functionsUrl}/ai-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'nylas-send-email',
        grantId,
        toEmail,
        subject,
        bodyText,
        pdfBase64,
        fileName,
        attachments
      })
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      console.error("[NYLAS ERROR] Secure edge function response:", data.error || response.statusText);
      throw new Error(data.error || "Failed to send email");
    }

    return {
      success: true,
      message: data.message || "Email sent successfully via Nylas"
    };
  },

  /**
   * Calls the Supabase Edge Function to fetch emails for the connected Nylas account.
   */
  getEmails: async (
    grantId: string,
    folder: string = 'INBOX',
    limit: number = 20
  ): Promise<any[]> => {
    // @ts-ignore
    const state = store.getState();
    // @ts-ignore
    const token = state.auth?.token || localStorage.getItem('access_token');
    const functionsUrl = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;

    const response = await fetch(`${functionsUrl}/ai-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'nylas-get-emails',
        grantId,
        folder,
        limit
      })
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      console.error("[NYLAS ERROR] Secure edge function response:", data.error || response.statusText);
      throw new Error(data.error || "Failed to fetch emails");
    }

    return data.messages || [];
  },

  /**
   * Calls the Supabase Edge Function to reply to an email.
   */
  replyToEmail: async (
    grantId: string,
    messageId: string,
    toEmail: string,
    subject: string,
    bodyText: string,
    attachments?: any[]
  ): Promise<{ success: boolean; message?: string }> => {
    // @ts-ignore
    const state = store.getState();
    // @ts-ignore
    const token = state.auth?.token || localStorage.getItem('access_token');
    const functionsUrl = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;

    const response = await fetch(`${functionsUrl}/ai-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'nylas-reply-email',
        grantId,
        messageId,
        toEmail,
        subject,
        bodyText,
        attachments
      })
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      console.error("[NYLAS ERROR] Secure edge function response:", data.error || response.statusText);
      throw new Error(data.error || "Failed to send reply");
    }

    return {
      success: true,
      message: data.message || "Reply sent successfully"
    };
  },

  /**
   * Calls the Supabase Edge Function to download an attachment from Nylas.
   */
  downloadAttachment: async (grantId: string, attachmentId: string, messageId?: string) => {
    // @ts-ignore
    const state = store.getState();
    // @ts-ignore
    const token = state.auth?.token || localStorage.getItem('access_token');
    const functionsUrl = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;

    const response = await fetch(`${functionsUrl}/ai-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'nylas-download-attachment',
        grantId,
        attachmentId,
        messageId
      })
    });

    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "Failed to download attachment");
    return data;
  },

  /**
   * Calls the Supabase Edge Function to summarize an email.
   */
  summarizeEmail: async (emailBody: string, attachmentsInfo: string): Promise<string> => {
    // @ts-ignore
    const state = store.getState();
    // @ts-ignore
    const token = state.auth?.token || localStorage.getItem('access_token');
    const functionsUrl = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;

    const response = await fetch(`${functionsUrl}/ai-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'summarize-email',
        emailBody,
        attachmentsInfo
      })
    });

    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "Failed to summarize email");
    return data.summary;
  }
};
