/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useState } from 'react';
import { Pagination, Tabs, Tab } from '@mui/material';
import { SkeletonLoader } from '../common/skeleton-loader';
import EstimateCard from '../itemetimated/item-estimate';
import imageBlur from '../../assets/logo/notificacao.svg';
import PlanLimitModal from '../modal/plan-limit-modal';
import { useAllEstimateQuery, useGetEstimatesQuery } from '../../services/rtkapi/invoiceApi';
import { InvoiceModel } from '../../models/invoice';
import FormInvoiceEstimate from '../../components/forminvoiceestimate/formin-voicestimate';
import { useNavigate, useSearchParams } from 'react-router-dom';
// import EstimateFollowupsList from './estimate-followups-list';

const OptionEstimateCreated = () => {
  const [, setSearchParams] = useSearchParams();
  const initialTab = 0; // searchParams.get('tab') === 'automated-sequences' ? 1 : 0;
  const [selectedTab, setSelectedTab] = useState<number>(initialTab);
  const [page, setPage] = useState<number>(1);
  const itemsPerPage = 9;
  const [search, setSearch] = useState<string>('');
  const [planName, setPlanName] = useState<string>('');
  const [planLimitModalOpen, setPlanLimitModalOpen] = useState<boolean>(false);
  const [showNewInvoiceForm, setShowNewInvoiceForm] = useState(false);
  const { data: searchData, isLoading: searchLoading } = useAllEstimateQuery({ name: search }, { skip: !search });
  const { data, isLoading, refetch } = useGetEstimatesQuery();
  
  React.useEffect(() => {
    refetch();
  }, [refetch]);

  const estimations: InvoiceModel[] = InvoiceModel.fromListResponse(search ? searchData?.data || [] : data?.data || []);
  const filteredEstimates = estimations.filter((inv: InvoiceModel) =>
    search ? inv.client_name?.toLowerCase().includes(search.toLowerCase()) : true
  );
  const totalEstimations = filteredEstimates.length;
  const totalPagesEstimations = Math.ceil(totalEstimations / itemsPerPage);

  const navigate = useNavigate();

  const handlePageChange = (_: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
  };
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setPage(1);
  };
  const newEstimate = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_FUNCTIONS_URL}/user-api/wallet`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('access_token')}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
        }
      });
      const data = await res.json();
      const wallet = data?.wallet || data;

      if (wallet?.estimate_remaining > 0) {
        navigate('/estimates/new');
      } else {
        setPlanName('estimate');
        setPlanLimitModalOpen(true);
      }
    } catch (e) {
      console.error('Error fetching wallet api:', e);
      // Fallback
      navigate('/estimates/new');
    }
  };

  const handleUpgrade = () => {
    setPlanLimitModalOpen(false);
  };

  if (showNewInvoiceForm) {
    return (
      <div className="w-full flex -mt-8 justify-center">
        <section className="flex-1 flex justify-center h-full w-full">
          <FormInvoiceEstimate onClose={() => setShowNewInvoiceForm(false)} />
        </section>
      </div>
    );
  }

  const renderTabContent = () => {
    // if (selectedTab === 1) {
    //   return <EstimateFollowupsList />;
    // }

    if (!search && totalEstimations === 0 && !isLoading) {
      return (
        <div className="text-center w-full">
          <div className="flex items-center justify-center mt-10">
            <img
              src={imageBlur}
              alt="No estimates"
              width={150}
              draggable="false"
              className="pointer-events-none mb-4"
            />
          </div>
          <h2 className="text-2xl font-semibold">No Estimates Yet</h2>
          <p className="text-gray-600 mt-2">
            Start by creating your first estimate and <br /> keep your billing organized.
          </p>
          <button
            onClick={newEstimate}
            className="mt-4 bg-[#448AFF] hover:bg-[#3d7ef7] text-white p-3 rounded-full cursor-pointer transition duration-300">
            Create new estimate
          </button>
        </div>
      );
    }

    return (
      <>
        <div className="w-full flex justify-center mb-6">
          <div className="relative w-full ">
            <input
              type="text"
              placeholder="Search by client name"
              value={search}
              onChange={handleSearchChange}
              className="w-full border border-gray-300 rounded-full px-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            {/* Search loading */}
            {search && searchLoading && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 w-full">
          {isLoading || searchLoading
            ? Array.from({ length: itemsPerPage }).map((_, index) => <SkeletonLoader key={index} lines={3} />)
            : filteredEstimates.length > 0
              ? filteredEstimates
                  .slice((page - 1) * itemsPerPage, page * itemsPerPage)
                  .map((estimate: any) => (
                    <EstimateCard key={estimate.id} estimateData={estimate} onDeleted={refetch} />
                  ))
              : search && (
                  <div className="col-span-full text-center mt-10">
                    <p className="text-gray-500 text-sm">
                      No estimates found for <strong>"{search}"</strong>
                    </p>
                  </div>
                )}
        </div>

        {totalPagesEstimations > 0 && !isLoading && (
          <div className="w-full flex justify-end mt-6 ">
            <Pagination
              key={`pagination-${page}`}
              count={totalPagesEstimations}
              page={page}
              onChange={handlePageChange}
              shape="rounded"
              sx={{
                '& .MuiPaginationItem-root': {
                  color: '#448AFF',
                  borderRadius: '4px',
                  minWidth: '32px',
                  height: '32px',
                },
                '& .Mui-selected': {
                  backgroundColor: '#448AFF !important',
                  color: 'white',
                },
              }}
            />
          </div>
        )}
      </>
    );
  };

  return (
    <div className="flex w-full md:min-h-[83vh] md:px-2 md:py-2">
      <div className="w-full rounded-2xl border border-gray-100 overflow-x-hidden p-3 sm:p-4 md:p-6 bg-white">
        {/* ===== Header (Tabs + Create Button) ===== */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
          {/* Tabs */}
          <div className="flex-1">
            <Tabs
              value={selectedTab}
              onChange={(_, newValue) => {
                setSelectedTab(newValue);
                if (newValue === 1) {
                  setSearchParams({ tab: 'automated-sequences' });
                } else {
                  setSearchParams({});
                }
              }}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              sx={{
                '& .MuiTabs-indicator': { backgroundColor: '#448AFF' },
              }}>
              <Tab
                label={
                  <div className="flex items-center gap-2">
                    <span>Estimates</span>
                    <span className="bg-blue-100 text-[#448AFF] px-2 py-0.5 rounded-md text-sm">
                      {totalEstimations}
                    </span>
                  </div>
                }
                className="!text-[#448AFF]"
                sx={{
                  padding: { xs: '6px 10px', sm: '6px 14px' },
                  minWidth: 'auto',
                }}
              />
              {/* <Tab
                label="Automated Sequences"
                className="!text-gray-500 hover:!text-[#448AFF]"
                sx={{
                  padding: { xs: '6px 10px', sm: '6px 14px' },
                  minWidth: 'auto',
                }}
              /> */}
            </Tabs>
          </div>

          {/* Create Button */}
          <div className="flex justify-end -mt-14  md:mt-0 lg:mt-0 w-full sm:w-auto">
            <button
              className="bg-[#448AFF] hover:bg-[#3c7ef7] text-white rounded-full font-semibold px-5 py-2.5 transition-all duration-300"
              onClick={newEstimate}>
              Create
            </button>
          </div>
        </div>

        {/* ===== Content Section ===== */}
        <div className="flex flex-col items-center justify-center py-10">{renderTabContent()}</div>
      </div>

      {/* ===== Modal for Plan Limit ===== */}
      <PlanLimitModal
        isOpen={planLimitModalOpen}
        onClose={() => setPlanLimitModalOpen(false)}
        onUpgrade={handleUpgrade}
        planName={planName}
      />
    </div>
  );
};

export default OptionEstimateCreated;
