/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Avatar } from '@mui/material';
import { PencilIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SkeletonLoader } from '../../components/common/skeleton-loader';
import { useGetUserProfileQuery } from '../../services/rtkapi/invoiceApi';
import { S3UploadService } from '../../components/data/s3-data';
import EditMyProfileModal from '../../components/modal/edit-my-profile-modal';

const InfoField = ({ label, value }: { label: string; value?: string | null }) => (
  <div>
    <label className="block font-semibold uppercase mb-2 text-[#12153A] text-xs">{label}</label>
    <div className="w-full min-h-[47px] px-4 py-3 rounded-lg bg-[#FCFCFC] border border-[#EAE8E8] text-[13px] text-gray-900">
      {value || '—'}
    </div>
  </div>
);

export function MyProfile() {
  const { data, isLoading, refetch } = useGetUserProfileQuery();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [imgSrc, setImgSrc] = useState<string | null>(null);

  const profile = data?.data;

  useEffect(() => {
    if (profile?.avatar_url) {
      setImgSrc(S3UploadService.getPublicUrl(profile.avatar_url, 'document-logos'));
    } else {
      setImgSrc(null);
    }
  }, [profile]);

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg">
        <SkeletonLoader lines={6} />
      </div>
    );
  }

  const firstName = profile?.first_name || profile?.full_name?.split(' ')[0] || '';
  const lastName = profile?.last_name || profile?.full_name?.split(' ').slice(1).join(' ') || '';

  return (
    <>
      <div className="flex flex-col gap-10 pb-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 border border-[#EBE9E9] rounded-2xl p-4 sm:p-6 bg-white shadow-sm">
          <div className="flex flex-col items-center justify-center gap-3 w-full bg-[#FCFCFC] py-7 px-6 border border-[#EBE9E9] rounded-2xl">
            <Avatar
              src={imgSrc || undefined}
              alt={firstName}
              sx={{ width: 70, height: 70 }}
            />
            <span className="font-medium text-base text-[#13173C] text-center">
              {[firstName, lastName].filter(Boolean).join(' ') || 'User Name'}
            </span>
          </div>

          <div className="flex flex-col gap-4 text-[13px] lg:col-span-2 pt-0 lg:pt-10">
            <div className="flex items-start justify-between gap-4 mb-2">
              <span className="uppercase font-semibold text-[#12153A]">Personal Information</span>
              <button
                type="button"
                onClick={() => setEditModalOpen(true)}
                className="flex items-center gap-2 text-sm font-semibold text-[#2386AF] border border-[#2386AF] px-3 py-1.5 rounded-lg hover:bg-[#2386AF]/10 transition shrink-0">
                <PencilIcon className="w-4 h-4" />
                Edit
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoField label="First Name" value={firstName} />
              <InfoField label="Last Name" value={lastName} />
            </div>

            <InfoField label="Email" value={profile?.email} />
            <InfoField label="Company Name" value={profile?.company_name} />
            <InfoField label="Phone Number" value={profile?.phone} />
          </div>
        </div>

        <div className="flex flex-col border border-[#EBE9E9] rounded-2xl py-5 px-6 bg-white shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-6">
            <span className="uppercase font-semibold text-[#12153A]">Address Information</span>
            <button
              type="button"
              onClick={() => setEditModalOpen(true)}
              className="flex items-center gap-2 text-sm font-semibold text-[#2386AF] border border-[#2386AF] px-3 py-1.5 rounded-lg hover:bg-[#2386AF]/10 transition shrink-0">
              <PencilIcon className="w-4 h-4" />
              Edit
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="md:col-span-2">
              <InfoField label="Address" value={profile?.address} />
            </div>
            <InfoField label="Country" value={profile?.country} />
            <InfoField label="State" value={profile?.state} />
            <InfoField label="City" value={profile?.city} />
            <InfoField label="Zip Code" value={profile?.zip_code} />
          </div>
        </div>
      </div>

      <EditMyProfileModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        profileData={profile}
        onSuccess={refetch}
      />
    </>
  );
}
