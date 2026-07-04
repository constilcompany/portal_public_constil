/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAPI } from '../../redux/createAPI';

const invoiceApi = createAPI.injectEndpoints({
  endpoints: (build) => ({
    // ✅ Invoices
    getInvoices: build.query<any, void>({
      query: () => `/invoices?select=*,clients(name)&order=created_at.desc`,
      transformResponse: (response: any[]) => ({ data: response }),
      providesTags: ['Invoice'],
    }),

    allInvoices: build.query<any, { name: string }>({
      query: ({ name }) => `/invoices?clients.name=ilike.*${name}*&select=*,clients(name)&order=created_at.desc`,
      transformResponse: (response: any[]) => ({ data: response }),
      providesTags: ['Invoice'],
    }),

    // ✅ Clients
    getClients: build.query<any, void>({
      query: () => `/clients?select=*&order=created_at.desc`,
      transformResponse: (response: any[]) => ({ data: response }),
      providesTags: ['Client'],
    }),

    // ✅ Products
    getProducts: build.query<any, void>({
      query: () => `/products?select=*&order=created_at.desc`,
      transformResponse: (response: any[]) => ({ data: response }),
      providesTags: ['Product'],
    }),

    // ✅ Discounts
    getDiscounts: build.query<any, void>({
      query: () => `/discounts?select=*&order=created_at.desc`,
      transformResponse: (response: unknown) => ({
        data: Array.isArray(response) ? response : [],
      }),
      providesTags: ['Discount'],
    }),

    createDiscount: build.mutation<any, { name: string; rate: number; user_id?: string }>({
      query: (body) => ({
        url: `/discounts`,
        method: 'POST',
        headers: {
          'Prefer': 'return=representation',
        },
        body,
      }),
      invalidatesTags: ['Discount'],
    }),

    // ✅ Taxes
    getPackageBuy: build.query<any, void>({
      query: () => `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/wallet`,
    }),
    getTaxes: build.query<any, void>({
      query: () => `/taxes?select=*&order=created_at.desc`,
      transformResponse: (response: unknown) => ({
        data: Array.isArray(response) ? response : [],
      }),
      providesTags: ['Tax'],
    }),

    createInvoice: build.mutation({
      query: (body) => ({
        url: '/invoices?select=*,clients(name)',
        method: 'POST',
        body,
        headers: {
            'Prefer': 'return=representation'
        }
      }),
      invalidatesTags: ['Invoice'],
    }),
    sendInvoiceEmail: build.mutation({
      query: (body) => ({
        url: `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/template/send-invoice`,
        method: 'POST',
        body,
      }),
    }),
    sendEstimateEmail: build.mutation({
      query: (body) => ({
        url: `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/template/send-estimate`,
        method: 'POST',
        body,
      }),
    }),

    // ✅ Delete Invoice
    // ✅ Delete Invoice (Cascading)
    deleteInvoice: build.mutation<any, string>({
      async queryFn(invoice_id, _queryApi, _extraOptions, baseQuery) {
        try {
          // 1. Get all items associated with this invoice
          const itemsResult = await baseQuery(`/invoice_items?invoice_id=eq.${invoice_id}&select=id`);
          const items = itemsResult.data as any[];
          
          if (items && items.length > 0) {
            const itemIds = items.map(item => item.id);
            const itemIdsString = `(${itemIds.join(',')})`;

            // 2. Delete associated taxes and discounts for these items
            await baseQuery({
              url: `/invoice_item_taxes?invoice_item_id=in.${itemIdsString}`,
              method: 'DELETE',
            });
            await baseQuery({
              url: `/invoice_item_discounts?invoice_item_id=in.${itemIdsString}`,
              method: 'DELETE',
            });

            // 3. Delete the items themselves
            await baseQuery({
              url: `/invoice_items?invoice_id=eq.${invoice_id}`,
              method: 'DELETE',
            });
          }

          // 4. Finally, delete the invoice
          const deleteResult = await baseQuery({
            url: `/invoices?id=eq.${invoice_id}`,
            method: 'DELETE',
          });

          return deleteResult.error ? { error: deleteResult.error } : { data: deleteResult.data };
        } catch (error: any) {
          return { error: { status: 500, data: error.message } };
        }
      },
      invalidatesTags: ['Invoice'],
    }),

    createEstimate: build.mutation<any, any>({
      query: (body) => ({
        url: '/estimates?select=*,clients(name)',
        method: 'POST',
        body,
        headers: {
            'Prefer': 'return=representation'
        }
      }),
      invalidatesTags: ['Estimate'],
    }),

    getEstimates: build.query<any, void>({
      query: () => `/estimates?select=*,clients(name)&order=created_at.desc`,
      transformResponse: (response: any[]) => ({ data: response }),
      providesTags: ['Estimate'],
    }),

    allEstimate: build.query<any, { name: string }>({
      query: ({ name }) => `/estimates?clients.name=ilike.*${name}*&select=*,clients(name)&order=created_at.desc`,
      transformResponse: (response: any[]) => ({ data: response }),
      providesTags: ['Estimate'],
    }),

    getEstimateDetail: build.query<any, { estimate_id: string }>({
      async queryFn({ estimate_id }, _queryApi, _extraOptions, baseQuery) {
        try {
          console.log("[API] getEstimateDetail Fetching ID:", estimate_id);
          
          // Fix: Using products!product_id(*) explicitly to resolve ambiguous or missing relationship cache in PostgREST
          const result = await baseQuery(`/estimates?id=eq.${estimate_id}&select=*,clients(*),estimate_items(*,product:products!product_id(*),estimate_item_taxes(*,tax:taxes(*)),estimate_item_discounts(*,discount:discounts(*)))`);
          
          if (result.error) return { error: result.error };
          const estimate = (result.data as any[])?.[0];
          if (!estimate) return { data: null };

          const profileResult = await baseQuery(`/profiles?user_id=eq.${estimate.user_id}&select=*`);
          const profile = profileResult.data ? (profileResult.data as any[])[0] : null;

          let company = null;
          if (profile) {
            const companyResult = await baseQuery(`/company_profiles?user_id=eq.${profile.user_id}&select=*`);
            company = companyResult.data ? (companyResult.data as any[])[0] : null;
          }

          console.log("[API] getEstimateDetail Company fetched:", !!company);

          const finalData = {
            ...estimate,
            user: {
              ...profile,
              company: company || {}
            }
          };

          console.log("[API] getEstimateDetail Success. Returning direct data.");
          return { data: finalData };

        } catch (err) {
          console.error("[API] getEstimateDetail Crash:", err);
          return { error: { status: 500, data: String(err) } as any };
        }
      },
      providesTags: ['Estimate'],
      keepUnusedDataFor: 0,
    }),

    // ✅ GET Subscription Detail
    getSubscriptionDetail: build.query<any, void>({
      query: () => "/subscriptions?select=*",
      transformResponse: (response: any[]) => response[0],
    }),

    // ✅ Delete Estimate (Cascading)
    deleteEstimate: build.mutation<any, string>({
      async queryFn(estimate_id, _queryApi, _extraOptions, baseQuery) {
        try {
          // 1. Get all items associated with this estimate
          const itemsResult = await baseQuery(`/estimate_items?estimate_id=eq.${estimate_id}&select=id`);
          const items = itemsResult.data as any[];
          
          if (items && items.length > 0) {
            const itemIds = items.map(item => item.id);
            const itemIdsString = `(${itemIds.join(',')})`;

            // 2. Delete associated taxes and discounts for these items
            await baseQuery({
              url: `/estimate_item_taxes?estimate_item_id=in.${itemIdsString}`,
              method: 'DELETE',
            });
            await baseQuery({
              url: `/estimate_item_discounts?estimate_item_id=in.${itemIdsString}`,
              method: 'DELETE',
            });

            // 3. Delete the items themselves
            await baseQuery({
              url: `/estimate_items?estimate_id=eq.${estimate_id}`,
              method: 'DELETE',
            });
          }

          // 4. Finally, delete the estimate
          const deleteResult = await baseQuery({
            url: `/estimates?id=eq.${estimate_id}`,
            method: 'DELETE',
          });

          return deleteResult.error ? { error: deleteResult.error } : { data: deleteResult.data };
        } catch (error: any) {
          return { error: { status: 500, data: error.message } };
        }
      },
      invalidatesTags: ['Invoice'],
    }),

    getUserProfile: build.query<any, void>({
      query: () => "/profiles_with_stats?select=*",
      providesTags: ['Invoice'],
      transformResponse: (response: any[]) => {
        const p = response[0] || {};
        return {
          status: true,
          data: {
            ...p,
            register: {
              id: p.id,
              name: p.first_name,
              last_name: p.last_name,
              company_name: p.company_name,
              email: p.email,
              profile_image: p.avatar_url,
              is_verified: true
            }
          }
        };
      },
    }),

    getInvoiceDetail: build.query<any, { invoice_id: string }>({
      async queryFn({ invoice_id }, _queryApi, _extraOptions, baseQuery) {
        console.log("[API] getInvoiceDetail Fetching ID:", invoice_id);
        
        // 1. Get Invoice with clients and items (including taxes and discounts)
        const result = await baseQuery(`/invoices?id=eq.${invoice_id}&select=*,clients(*),invoice_items(*,product:products(*),invoice_item_taxes(*,tax:taxes(*)),invoice_item_discounts(*,discount:discounts(*)))`);
        
        if (result.error) {
          console.error("[API] getInvoiceDetail Error:", result.error);
          return { error: result.error };
        }

        const invoice = (result.data as any[])?.[0];
        if (!invoice) {
          console.warn("[API] getInvoiceDetail No record found for ID:", invoice_id);
          return { data: null };
        }

        // 2. Get User Profile separately
        const profileResult = await baseQuery(`/profiles?user_id=eq.${invoice.user_id}&select=*`);
        const profile = profileResult.data ? (profileResult.data as any[])[0] : null;

        // 3. Get Company Profile separately
        let company = null;
        if (profile) {
          const companyResult = await baseQuery(`/company_profiles?user_id=eq.${profile.user_id}&select=*`);
          company = companyResult.data ? (companyResult.data as any[])[0] : null;
        }

        const finalData = {
          ...invoice,
          user: {
            ...profile,
            company: company || {}
          }
        };

        console.log("[API] getInvoiceDetail Success. Returning direct data.");
        return { data: finalData };
      },
      providesTags: ['Invoice'],
      keepUnusedDataFor: 0,
    }),

    getInvoiceSingle: build.query<any, { invoice_id: string }>({
      query: ({ invoice_id }) => `/invoices?id=eq.${invoice_id}&select=*,clients(name)`,
      providesTags: ['Invoice'],
      transformResponse: (response: any[]) => response[0],
    }),

    updateInvoice: build.mutation<any, { invoice_id: string; body: any }>({
      query: ({ invoice_id, body }) => {
        const decodedToken = JSON.parse(atob((localStorage.getItem('access_token') || '').split('.')[1]));
        const user_id = decodedToken.sub;
        return {
          url: `/invoices?id=eq.${invoice_id}&user_id=eq.${user_id}`,
          method: 'PATCH',
          body,
          headers: {
            'Prefer': 'return=representation'
          }
        };
      },
      invalidatesTags: ['Invoice'],
    }),

    getEstimateSingle: build.query<any, { estimate_id: string }>({
      query: ({ estimate_id }) => `/estimates?id=eq.${estimate_id}&select=*,clients(name)`,
      providesTags: ['Update-estimate'],
      transformResponse: (response: any[]) => response[0],
    }),

    updateEstimate: build.mutation<any, { estimate_id: string; body: any }>({
      query: ({ estimate_id, body }) => ({
        url: `/estimates?id=eq.${estimate_id}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['Update-estimate'],
    }),

    updateUserProfile: build.mutation<any, { id: string; body: any }>({
      query: ({ id, body }) => ({
        url: `/profiles?id=eq.${id}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['Invoice'],
    }),

    loginWithGoogle: build.mutation<any, { id_token: string }>({
      query: (body) => ({
        url: `/user/user_auth/login_with_google/`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Invoice'],
    }),

    createTax: build.mutation<any, { name: string; rate: number; user_id?: string }>({
      query: (body) => ({
        url: `/taxes`,
        method: 'POST',
        headers: {
          'Prefer': 'return=representation',
        },
        body,
      }),
      invalidatesTags: ['Tax'],
    }),

    createInvoiceEmail: build.mutation({
      query: (body) => ({
        url: `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/mail/send?apikey=${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        method: 'POST',
        body,
      }),
    }),
    createEstimateEmail: build.mutation({
      query: (body) => ({
        url: `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/mail/send?apikey=${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        method: 'POST',
        body,
      }),
    }),
    contactUs: build.mutation({
      query: (body) => ({
        url: `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/contact?apikey=${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        method: 'POST',
        body,
      }),
    }),
    getSentMail: build.query<any, void>({
      query: () => `/sent_mails`,
    }),

    postInvoiceId: build.query<any, { invoice_id: string }>({
      query: ({ invoice_id }) => `/invoices?id=eq.${invoice_id}&select=*,clients(name)`,
    }),
    estimateAi: build.mutation({
      query: (body) => ({
        url: `${import.meta.env.VITE_FASTAPI_URL || 'https://paybue-quee.hnhsofttechsolutions.com'}/estimate`,
        method: 'POST',
        headers: {
          'ngrok-skip-browser-warning': 'true'
        },
        body,
      }),
    }),
    getExcelUrl: build.query<any, { page_id: string }>({
      query: ({ page_id }) => `/ai_estimate_results?id=eq.${page_id}&select=excel_url`,
      transformResponse: (response: any[]) => response[0],
    }),

    aiTableData: build.mutation<any, any>({
      query: (body) => ({
        url: `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/ai-chat`,
        method: 'POST',
        body,
      }),
      invalidatesTags: ['AiEstimateResults', 'AiChatHistory'],
    }),

    getAiChatHistory: build.query<any[], { estimate_page_id: string }>({
      query: ({ estimate_page_id }) => ({
        url: `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/ai-chat`,
        method: 'POST',
        body: { action: 'history', estimate_page_id },
      }),
      transformResponse: (response: any) => response.data || [],
      providesTags: ['AiChatHistory'],
    }),

    estimateAiUpdate: build.mutation<any, { ai_estimate_id: string; body: any }>({
      query: ({ ai_estimate_id, body }) => ({
        url: `/ai_estimate_results?id=eq.${ai_estimate_id}`,
        method: 'PATCH',
        body,
        headers: {
          'Prefer': 'return=representation'
        }
      }),
      invalidatesTags: ['AiEstimateResults', 'AiChatHistory'],
    }),

    uploadAiEstimate: build.mutation<any, any>({
      query: (body) => ({
        url: `/ai_estimates?select=*`,
        method: 'POST',
        body,
        headers: {
          'Prefer': 'return=representation'
        }
      }),
      invalidatesTags: ['AiEstimate'],
    }),
    uploadAiEstimateResults: build.mutation<any, any>({
      query: (body) => ({
        url: `/ai_estimate_results?select=*`,
        method: 'POST',
        body,
        headers: {
          'Prefer': 'return=representation'
        }
      }),
      invalidatesTags: ['AiEstimateResults'],
    }),
    getAiEstimateResults: build.query<any[], { ai_estimate_id: string }>({
      query: ({ ai_estimate_id }) => `/ai_estimate_results?ai_estimate_id=eq.${ai_estimate_id}&select=*,ai_estimates(*)`,
      providesTags: ['AiEstimateResults'],
    }),
    allAiEstimate: build.query<any, void>({
      query: () => `/ai_estimates?select=*,pdf_jobs(status,message)&order=created_at.desc`,
      providesTags: ['AiEstimate'],
    }),
    getEstimateSearch: build.query<any, { name: string }>({
      query: ({ name }) => `/estimates?name=ilike.*${name}*`,
    }),
    getEstimateFilter: build.query<any, { start_date: string; end_date: string }>({
      query: ({ start_date, end_date }) =>
        `/estimates?created_at=gte.${start_date}&created_at=lte.${end_date}`,
    }),

    getAllDashboard: build.query<any, void>({
      query: () => "/profiles_with_stats?select=*",
      transformResponse: (response: any[]) => ({
        status: true,
        data: response[0] || {}
      }),
    }),

    allSubscriptionPlan: build.query<any, void>({
      query: () => ({
        url: `${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/packages`,
        headers: {
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
        }
      }),
    }),
    getCompany: build.query<any, void>({
      async queryFn(_arg, _queryApi, _extraOptions, baseQuery) {
        // 1. Get User Profile (profiles_with_stats often has better user info)
        const userResult = await baseQuery("/profiles?select=*");
        if (userResult.error) return { error: userResult.error };
        const profile = (userResult.data as any[])[0];

        // 2. Get Company Profile (Link by user_id which is the UUID)
        const userId = profile.user_id || profile.id;
        const companyResult = await baseQuery(`/company_profiles?user_id=eq.${userId}&select=*`);
        if (companyResult.error) return { error: companyResult.error };
        const company = (companyResult.data as any[])[0];

        return {
          data: {
            status: true,
            data: {
              company_info: company || {},
              user_info: profile || {}
            }
          }
        };
      },
      providesTags: ['Company'],
    }),
    uploadCompany: build.mutation<any, Partial<any>>({
      query: (body) => ({
        url: `/company_profiles?on_conflict=user_id`,
        method: 'POST',
        body,
        headers: {
            'Prefer': 'resolution=merge-duplicates'
        }
      }),
      invalidatesTags: ['Company'],
    }),
    getLegalInfo: build.query<any, void>({
      query: () => `/company_profiles?select=*`,
      providesTags: ['LegalInfo'],
      transformResponse: (response: any[]) => {
        return { data: response[0] || {} };
      },
    }),
    uploadLegalInfo: build.mutation<any, Partial<any>>({
      query: (body) => ({
        url: `/company_profiles?on_conflict=user_id`,
        method: 'POST',
        body,
        headers: {
            'Prefer': 'resolution=merge-duplicates'
        }
      }),
      invalidatesTags: ['LegalInfo'],
    }),
  }),
  overrideExisting: true,
});

export const {
  useGetAiChatHistoryQuery,
  useGetLegalInfoQuery,
  useUploadLegalInfoMutation,
  useGetCompanyQuery,
  useUploadCompanyMutation,
  useAllSubscriptionPlanQuery,
  useAllInvoicesQuery,
  useAllEstimateQuery,
  useAiTableDataMutation,
  useGetAllDashboardQuery,
  useEstimateAiUpdateMutation,
  useLazyGetExcelUrlQuery,
  useGetEstimateFilterQuery,
  useGetEstimateSearchQuery,
  useAllAiEstimateQuery,
  useGetAiEstimateResultsQuery,
  useUploadAiEstimateMutation,
  useEstimateAiMutation,
  useSendInvoiceEmailMutation,
  useSendEstimateEmailMutation,
  usePostInvoiceIdQuery,
  useGetSentMailQuery,
  useContactUsMutation,
  useGetInvoicesQuery,
  useGetClientsQuery,
  useGetProductsQuery,
  useGetDiscountsQuery,
  useCreateDiscountMutation,
  useGetTaxesQuery,
  useGetEstimatesQuery,
  useCreateEstimateMutation,
  useGetInvoiceSingleQuery,
  useDeleteEstimateMutation,
  useCreateInvoiceMutation,
  useCreateTaxMutation,
  useCreateInvoiceEmailMutation,
  useCreateEstimateEmailMutation,
  useGetEstimateSingleQuery,
  useDeleteInvoiceMutation,
  useGetSubscriptionDetailQuery,
  useUpdateInvoiceMutation,
  useGetUserProfileQuery,
  useLoginWithGoogleMutation,
  useUpdateUserProfileMutation,
  useLazyGetEstimatesQuery,
  useLazyGetInvoicesQuery,
  useLazyGetInvoiceDetailQuery,
  useGetInvoiceDetailQuery,
  useLazyGetEstimateDetailQuery,
  useGetEstimateDetailQuery,
  useUpdateEstimateMutation,
  useGetPackageBuyQuery,
} = invoiceApi;

export { invoiceApi };
