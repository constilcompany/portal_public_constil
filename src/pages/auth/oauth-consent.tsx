import { useEffect, useMemo, useState } from 'react';
import { createClient, type OAuthAuthorizationDetails } from '@supabase/supabase-js';
import { useDispatch, useSelector } from 'react-redux';
import { Navigate, useLocation } from 'react-router-dom';
import type { RootState } from '../../redux/store';
import { setToken } from '../../redux/authSlice';
import { AuthPageLayout, AuthPageHeader } from './auth-layout';

const CALLBACK = 'https://constil-ai-workspace.miqdadr9.chatgpt.site/constil/callback';
type Details = OAuthAuthorizationDetails;
function trustedRedirect(value: string) {
  const url = new URL(value);
  if (url.origin + url.pathname !== CALLBACK || url.username || url.password || url.hash) throw new Error('Unrecognized connection redirect.');
  window.location.assign(url.href);
}
export function OAuthConsent() {
  const token = useSelector((state: RootState) => state.auth.token);
  const location = useLocation();
  const dispatch = useDispatch();
  const authorizationId = new URLSearchParams(location.search).get('authorization_id') || '';
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const supabase = useMemo(() => createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }), []);
  const validId = /^[A-Za-z0-9_-]{1,128}$/.test(authorizationId);
  useEffect(() => {
    if (!token || !validId) return;
    let cancelled = false;
    setDetails(null); setError('');
    async function load() {
      try {
        const refreshToken = localStorage.getItem('refresh_token');
        if (!refreshToken) throw new Error('Sign in again to connect this account.');
        const sessionResult = await supabase.auth.setSession({ access_token: token, refresh_token: refreshToken });
        if (sessionResult.error || !sessionResult.data.session) throw sessionResult.error || new Error('Session unavailable.');
        if (cancelled) return;
        if (sessionResult.data.session.access_token !== token) {
          localStorage.setItem('access_token', sessionResult.data.session.access_token);
          localStorage.setItem('refresh_token', sessionResult.data.session.refresh_token);
          dispatch(setToken(sessionResult.data.session.access_token));
        }
        const result = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
        if (result.error || !result.data) throw result.error || new Error('Authorization request unavailable.');
        if (cancelled) return;
        if ('redirect_url' in result.data) { trustedRedirect(result.data.redirect_url); return; }
        const d = result.data;
        if (d.redirect_uri !== CALLBACK) throw new Error('This request does not belong to Constil AI Workspace.');
        setDetails(d);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the connection request.'); }
    }
    void load(); return () => { cancelled = true; };
  }, [token, authorizationId, validId, supabase, dispatch]);
  async function decide(approve: boolean) {
    if (!details || busy) return;
    setBusy(true); setError('');
    try {
      const result = approve ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true }) : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
      if (result.error || !result.data?.redirect_url) throw result.error || new Error('Authorization failed.');
      trustedRedirect(result.data.redirect_url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Authorization failed.'); setBusy(false); }
  }
  if (validId && !token) return <Navigate to={'/?returnTo=' + encodeURIComponent('/oauth/consent?authorization_id=' + encodeURIComponent(authorizationId))} replace />;
  return <AuthPageLayout><AuthPageHeader title="Connect Constil to ChatGPT" subtitle="Choose whether Constil AI Workspace can use your account." />
    {!validId ? <p role="alert">Invalid or missing connection request. Start again from the plugin.</p> : <>
      {error && <p role="alert" style={{ color: '#b42318', marginBottom: 16 }}>{error}</p>}
      {!details && !error && <p>Loading your connection request…</p>}
      {details && <><p className="mb-4">App: <strong>{details.client?.name || 'Constil AI Workspace'}</strong></p>
        <p className="mb-4">Identity information requested: {details.scope || 'email'}.</p>
        <p className="mb-4">Connecting allows the plugin to read your Constil clients, products, estimates, invoices, blueprint jobs and credits, create clients, edit supported record fields, revise existing AI estimates and export files. Access follows your Constil permissions.</p>
        <p className="mb-6">New blueprint estimation is not available yet. No payment or email is sent by connecting.</p>
        <div className="flex gap-3"><button type="button" disabled={busy} onClick={() => void decide(false)} className="rounded-lg border border-gray-300 px-5 py-3">Cancel</button><button type="button" disabled={busy} onClick={() => void decide(true)} className="rounded-lg bg-[#448AFF] px-5 py-3 text-white">{busy ? 'Connecting…' : 'Allow connection'}</button></div>
      </>}
    </>}
  </AuthPageLayout>;
}
