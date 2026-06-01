import { useState } from 'react';
import { useGetCompanyQuery } from '../../services/rtkapi/invoiceApi';
import LegalInfo from './legal-info';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { S3UploadService } from '../../components/data/s3-data';
import EditCompanyInfoModal from '../../components/modal/edit-company-info-modal';
import { PencilIcon } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */

const InfoField = ({ label, value }: { label: string; value?: string | null }) => (
  <div>
    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">{label}</div>
    <div className="text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 min-h-[42px]">
      {value || '—'}
    </div>
  </div>
);

const Company = () => {
  const Navigate = useNavigate();
  const { data, refetch } = useGetCompanyQuery();
  const user = useSelector((state: any) => state.auth.user);
  const [editModalOpen, setEditModalOpen] = useState(false);

  const c = data?.data?.company_info || {};
  const u = data?.data?.user_info || {};
  const fullName = (u.full_name || '').trim();
  const [firstFromFullName, ...restFromFullName] = fullName.split(' ').filter(Boolean);
  const firstName = u.first_name || firstFromFullName || '';
  const lastName = u.last_name || restFromFullName.join(' ') || '';

  const logoUrl =
    c.logo_url || c.logo
      ? S3UploadService.getPublicUrl(c.logo_url || c.logo, 'document-logos')
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="border border-gray-300 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="text-sm font-semibold text-gray-900 mb-1">Company & Personal Info</div>
            <div className="text-xs text-gray-500">
              Your business details and personal information.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditModalOpen(true)}
            className="flex items-center gap-2 text-sm font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 px-4 py-2 rounded-xl hover:bg-indigo-100 transition shrink-0">
            <PencilIcon className="w-4 h-4" />
            Edit
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-6 gap-8">
          <div className="lg:col-span-2 border border-gray-100 rounded-xl p-6 bg-gray-50/30 flex flex-col items-center gap-4">
            <div className="w-full h-48 rounded-2xl flex items-center justify-center overflow-hidden bg-white shadow-inner border border-gray-100 p-4">
              {logoUrl ? (
                <img src={logoUrl} alt="Company logo" className="w-full h-full object-contain" />
              ) : (
                <div className="text-gray-400 flex flex-col items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider">No Logo</span>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-4 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <InfoField label="First Name" value={firstName} />
              <InfoField label="Last Name" value={lastName} />
            </div>

            <div className="pt-4 border-t border-gray-100">
              <div className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-4">Business Details</div>
              <div className="space-y-5">
                <InfoField label="Company Legal Name" value={c.company_legal_name} />
                <InfoField label="Registered Address" value={c.address} />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <InfoField label="Business Email" value={c.company_email} />
                  <InfoField label="Business Phone" value={c.company_phone} />
                  <InfoField label="Website" value={c.website} />
                  <InfoField label="Industry" value={c.industry} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <EditCompanyInfoModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        data={data}
        onSuccess={refetch}
      />

      <div className="border border-gray-300 rounded-xl bg-white p-6">
        <LegalInfo />
      </div>

      {!user?.role && (
        <div className="border border-gray-300 rounded-xl bg-white p-6">
          <div className="text-sm font-semibold mb-4">Account Security</div>

          <div
            onClick={() => Navigate('/user/update_password')}
            className="border border-gray-300 rounded-lg p-4 cursor-pointer hover:bg-gray-50">
            <div className="text-sm font-medium">Password Management</div>
            <div className="text-xs text-gray-500 mt-1">Control and change your account password.</div>
            <button className="mt-3 px-4 py-2 bg-gray-100 rounded text-sm">Change Password</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Company;
