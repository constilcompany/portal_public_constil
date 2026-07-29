// src/store/createAPI.ts
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { clearAuth } from './authSlice';

interface MinimalAuthState {
  token: string;
}
interface MinimalRootState {
  auth: MinimalAuthState;
}

export const BASED_URL = import.meta.env.VITE_APP_API_URL ?? "";

const rawBaseQuery = fetchBaseQuery({
  baseUrl: BASED_URL,
  prepareHeaders: (headers, { getState }) => {
    const state = getState() as unknown as MinimalRootState;
    const token = state?.auth?.token || localStorage.getItem('access_token');
    
    headers.set('apikey', import.meta.env.VITE_SUPABASE_ANON_KEY);
    
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return headers;
  },
});

const baseQueryWithReauth: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extraOptions
) => {
  const result = await rawBaseQuery(args, api, extraOptions);

  if (result.error && result.error.status === 401) {
    // 401 means session expired or invalid in Supabase
    api.dispatch(clearAuth());
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    if (window.location.pathname !== '/') {
        window.location.href = '/';
    }
  }
  
  if (result.error && (result.error.status === 501 || result.error.status === 500)) {
    window.location.href = '/server-error';
  }

  return result;
};

export const createAPI = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  endpoints: () => ({}),
  tagTypes: ['Client', 'Product', 'Invoice', 'Estimate', 'Update-estimate', 'Company', 'LegalInfo', 'AiEstimate', 'AiEstimateResults', 'Tax', 'Discount', 'AiChatHistory', 'Followup'],
});
