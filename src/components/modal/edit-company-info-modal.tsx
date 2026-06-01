import { useEffect, useState } from 'react';
import { useUploadCompanyMutation, useUpdateUserProfileMutation } from '../../services/rtkapi/invoiceApi';
import { toast } from 'react-toastify';
import { useSelector } from 'react-redux';
import { S3UploadService } from '../data/s3-data';
import Spinner from '../spinner';

/* eslint-disable @typescript-eslint/no-explicit-any */

const inputStyle =
  'w-full mt-1 px-3 py-2 text-sm text-gray-900 bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

interface EditCompanyInfoModalProps {
  open: boolean;
  onClose: () => void;
  data: any;
  onSuccess: () => void;
}

const EditCompanyInfoModal = ({ open, onClose, data, onSuccess }: EditCompanyInfoModalProps) => {
  const [uploadCompany, { isLoading: isCompanyUpdating }] = useUploadCompanyMutation();
  const [updateUserProfile, { isLoading: isProfileUpdating }] = useUpdateUserProfileMutation();
  const user = useSelector((state: any) => state.auth.user);

  const [form, setForm] = useState<any>({
    first_name: '',
    last_name: '',
    company_legal_name: '',
    address: '',
    company_email: '',
    company_phone: '',
    website: '',
    industry: '',
    logo: null,
  });

  const isLoading = isCompanyUpdating || isProfileUpdating;

  useEffect(() => {
    if (!open || !data?.data) return;
    const c = data.data.company_info || {};
    const u = data.data.user_info || {};
    const fullName = (u.full_name || '').trim();
    const [firstFromFullName, ...restFromFullName] = fullName.split(' ').filter(Boolean);
    setForm({
      first_name: u.first_name || firstFromFullName || '',
      last_name: u.last_name || restFromFullName.join(' ') || '',
      company_legal_name: c.company_legal_name || '',
      address: c.address || '',
      company_email: c.company_email || '',
      company_phone: c.company_phone || '',
      website: c.website || '',
      industry: c.industry || '',
      logo: null,
    });
  }, [open, data]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, files, value } = e.target;
    if (name === 'logo' && files && files[0]) {
      setForm((prev: any) => ({ ...prev, logo: files[0] }));
    } else {
      setForm((prev: any) => ({ ...prev, [name]: value }));
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const u = data?.data?.user_info || {};
      const c = data?.data?.company_info || {};

      let finalLogo = c.logo_url || c.logo;

      if (form.logo instanceof File) {
        finalLogo = await S3UploadService.uploadFileInChunks(form.logo, undefined, 'document-logos');
      }

      const targetUserId = u.user_id || u.id;
      if (targetUserId) {
        await updateUserProfile({
          id: targetUserId,
          body: {
            first_name: form.first_name,
            last_name: form.last_name,
          },
        }).unwrap();
      }

      const companyPayload: any = {
        company_legal_name: form.company_legal_name,
        address: form.address,
        company_email: form.company_email,
        company_phone: form.company_phone,
        website: form.website,
        industry: form.industry,
        logo_url: finalLogo,
      };

      if (user?.id) {
        companyPayload.user_id = user.id;
      }

      await uploadCompany(companyPayload).unwrap();
      toast.success('Information updated successfully');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.data?.message || 'Failed to update information');
      console.error(err);
    }
  };

  const logoPreview =
    form.logo instanceof File
      ? URL.createObjectURL(form.logo)
      : data?.data?.company_info?.logo_url || data?.data?.company_info?.logo
        ? S3UploadService.getPublicUrl(
            data?.data?.company_info?.logo_url || data?.data?.company_info?.logo,
            'document-logos'
          )
        : null;

  return (
    <div
      className={`fixed inset-0 flex z-50 items-center justify-center transition-opacity ${
        open ? 'opacity-100 visible' : 'opacity-0 invisible'
      } p-4 sm:p-0`}
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="bg-white w-full sm:w-[760px] rounded-lg shadow-lg relative flex flex-col max-h-[90vh] overflow-hidden">
        <div className="px-6 pt-6 pb-4 relative border-b border-gray-100">
          <button
            type="button"
            className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 text-xl cursor-pointer z-10"
            onClick={onClose}>
            ×
          </button>
          <h2 className="text-xl font-bold text-gray-900">Edit Company & Personal Info</h2>
          <p className="text-sm text-gray-500 mt-1">Update your business details and personal information.</p>
        </div>

        <form onSubmit={handleUpdate} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-6 py-5 overflow-y-auto flex-1 space-y-6">
            <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start">
              <div className="w-36 h-36 rounded-2xl flex items-center justify-center overflow-hidden bg-gray-50 border border-gray-100 p-3 shrink-0">
                {logoPreview ? (
                  <img src={logoPreview} alt="Company logo" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-400">No Logo</span>
                )}
              </div>
              <label className="text-sm font-semibold text-indigo-600 bg-white border border-indigo-100 px-6 py-2 rounded-xl hover:bg-indigo-50 hover:border-indigo-200 cursor-pointer transition shadow-sm">
                Upload New Logo
                <input type="file" accept="image/*" name="logo" onChange={handleChange} hidden />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">First Name</div>
                <input
                  name="first_name"
                  placeholder="Your first name"
                  value={form.first_name}
                  onChange={handleChange}
                  className={inputStyle}
                />
              </div>
              <div>
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Last Name</div>
                <input
                  name="last_name"
                  placeholder="Your last name"
                  value={form.last_name}
                  onChange={handleChange}
                  className={inputStyle}
                />
              </div>
            </div>

            <div className="pt-2 border-t border-gray-100">
              <div className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-4">Business Details</div>
              <div className="space-y-5">
                <div>
                  <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Company Legal Name</div>
                  <input
                    name="company_legal_name"
                    placeholder="Legal business name"
                    value={form.company_legal_name}
                    onChange={handleChange}
                    className={inputStyle}
                  />
                </div>
                <div>
                  <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Registered Address</div>
                  <input
                    name="address"
                    placeholder="Full business address"
                    value={form.address}
                    onChange={handleChange}
                    className={inputStyle}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Business Email</div>
                    <input name="company_email" value={form.company_email} onChange={handleChange} className={inputStyle} />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Business Phone</div>
                    <input name="company_phone" value={form.company_phone} onChange={handleChange} className={inputStyle} />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Website</div>
                    <input name="website" placeholder="https://..." value={form.website} onChange={handleChange} className={inputStyle} />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Industry</div>
                    <input name="industry" placeholder="e.g. Construction" value={form.industry} onChange={handleChange} className={inputStyle} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-gray-200 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 text-sm text-gray-600 hover:text-gray-800 transition">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="text-sm font-bold text-white bg-indigo-600 px-8 py-2.5 rounded-xl hover:bg-indigo-700 transition disabled:opacity-50 flex items-center justify-center gap-2">
              {isLoading ? <Spinner /> : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditCompanyInfoModal;
