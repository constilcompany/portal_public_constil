/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Avatar } from '@mui/material';
import { PencilIcon } from 'lucide-react';
import { FileUploader } from 'react-drag-drop-files';
import { Country, State, City } from 'country-state-city';
import { toast } from 'react-toastify';
import { useEffect, useRef, useState } from 'react';
import { useUpdateUserProfileMutation } from '../../services/rtkapi/invoiceApi';
import { useJsApiLoader } from '@react-google-maps/api';
import PhoneInput from 'react-phone-input-2';
import 'react-phone-input-2/lib/style.css';
import { S3UploadService } from '../data/s3-data';
import Spinner from '../spinner';

const libraries: ('places')[] = ['places'];

interface ProfileFormData {
  name: string;
  last_name: string;
  company_name: string;
  email: string;
  phone: string;
  address: string;
  countryCode: string;
  stateCode: string;
  country: string;
  state: string;
  city: string;
  zipCode: string;
  picture: File | null;
}

interface EditMyProfileModalProps {
  open: boolean;
  onClose: () => void;
  profileData: any;
  onSuccess: () => void;
}

const emptyForm: ProfileFormData = {
  name: '',
  last_name: '',
  company_name: '',
  email: '',
  phone: '',
  address: '',
  countryCode: '',
  stateCode: '',
  country: '',
  state: '',
  city: '',
  zipCode: '',
  picture: null,
};

const EditMyProfileModal = ({ open, onClose, profileData, onSuccess }: EditMyProfileModalProps) => {
  const [updateUserProfile, { isLoading: isUpdating }] = useUpdateUserProfileMutation();
  const [formData, setFormData] = useState<ProfileFormData>(emptyForm);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const addressRef = useRef<HTMLInputElement>(null);

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: 'AIzaSyDXJS_VZMhnp0szh92aZGg8RHszz6RMQN8',
    libraries,
  });

  useEffect(() => {
    if (!open || !profileData) return;
    const p = profileData;
    const apiCountry = p.country || '';
    const apiState = p.state || '';
    const apiCity = p.city || '';

    const countryObj = Country.getAllCountries().find(
      (c) => c.name.toLowerCase() === apiCountry.toLowerCase()
    );
    const stateObj = countryObj
      ? State.getStatesOfCountry(countryObj.isoCode).find(
          (s) => s.name.toLowerCase() === apiState.toLowerCase()
        )
      : null;

    setFormData({
      name: p.first_name || p.full_name?.split(' ')[0] || '',
      last_name: p.last_name || p.full_name?.split(' ').slice(1).join(' ') || '',
      company_name: p.company_name || '',
      email: p.email || '',
      phone: p.phone || '',
      address: p.address || '',
      countryCode: countryObj?.isoCode || '',
      stateCode: stateObj?.isoCode || '',
      city: apiCity || '',
      zipCode: p.zip_code || '',
      picture: null,
    });

    if (p.avatar_url) {
      setImgSrc(S3UploadService.getPublicUrl(p.avatar_url, 'document-logos'));
    } else {
      setImgSrc(null);
    }
    setErrors({});
  }, [open, profileData]);

  useEffect(() => {
    if (!open || !isLoaded) return;

    const initAutocomplete = () => {
      if (!addressRef.current) return;

      const autocomplete = new window.google.maps.places.Autocomplete(addressRef.current, {
        types: ['geocode'],
        fields: ['address_components', 'formatted_address'],
      });

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place.address_components) return;

        const components: Record<string, string> = {};
        for (const comp of place.address_components) {
          const types = comp.types;
          if (types.includes('locality')) components.city = comp.long_name;
          if (types.includes('administrative_area_level_1')) components.state = comp.long_name;
          if (types.includes('postal_code')) components.zipCode = comp.long_name;
          if (types.includes('country')) components.country = comp.long_name;
        }

        const countryObj = Country.getAllCountries().find((c) => c.name === components.country);
        const stateObj = countryObj
          ? State.getStatesOfCountry(countryObj.isoCode).find((s) => s.name === components.state)
          : null;

        setFormData((prev) => ({
          ...prev,
          address: place.formatted_address || '',
          city: components.city || prev.city,
          zipCode: components.zipCode || prev.zipCode,
          countryCode: countryObj?.isoCode || prev.countryCode,
          stateCode: stateObj?.isoCode || prev.stateCode,
        }));
      });
    };

    const timer = setTimeout(initAutocomplete, 300);
    return () => clearTimeout(timer);
  }, [open, isLoaded]);

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      const newErrors = { ...errors };
      delete newErrors[field];
      setErrors(newErrors);
    }
  };

  const handleFileChange = (file: File) => {
    if (imgSrc?.startsWith('blob:')) URL.revokeObjectURL(imgSrc);
    setFormData((prev) => ({ ...prev, picture: file }));
    setImgSrc(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const body: any = {
      first_name: formData.name,
      last_name: formData.last_name,
      company_name: formData.company_name,
      phone: formData.phone,
      address: formData.address,
      zip_code: formData.zipCode,
    };

    const countryObj = Country.getAllCountries().find((c) => c.isoCode === formData.countryCode);
    const stateObj = State.getStatesOfCountry(formData.countryCode).find(
      (s) => s.isoCode === formData.stateCode
    );

    body.country = countryObj?.name || '';
    body.state = stateObj?.name || '';
    body.city = formData.city || '';

    let finalAvatarPath = profileData?.avatar_url;

    try {
      if (formData.picture instanceof File) {
        finalAvatarPath = await S3UploadService.uploadFileInChunks(
          formData.picture,
          undefined,
          'document-logos/profiles'
        );
        body.avatar_url = finalAvatarPath;
      }

      const profileId = profileData?.id || profileData?.user_id;
      if (!profileId) {
        toast.error('User profile ID not found.');
        return;
      }

      await updateUserProfile({ id: profileId, body }).unwrap();
      toast.success('Profile updated successfully!');
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Update failed', err);
      setErrors(err?.data?.errors || {});
      toast.error(err?.data?.message || 'Failed to update profile.');
    }
  };

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
          <h2 className="text-xl font-bold text-gray-900">Edit Profile</h2>
          <p className="text-sm text-gray-500 mt-1">Update your personal and address information.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-6 py-5 overflow-y-auto flex-1 space-y-6">
            <div className="flex flex-col items-center gap-3 py-4 bg-[#FCFCFC] border border-[#EBE9E9] rounded-2xl">
              <Avatar
                src={imgSrc?.startsWith('blob:') ? imgSrc : imgSrc || undefined}
                alt={formData.name}
                sx={{ width: 70, height: 70 }}
              />
              <span className="font-medium text-base text-[#13173C]">{formData.name || 'User Name'}</span>
              <FileUploader
                handleChange={handleFileChange}
                name="file"
                types={['JPG', 'PNG']}
                onTypeError={() => toast.error('Format not supported!')}>
                <button
                  type="button"
                  className="flex items-center gap-2 text-sm py-2 px-2 font-semibold text-[#2386AF] border border-[#2386AF] rounded-lg hover:bg-[#2386AF]/10 transition">
                  Edit Picture
                  <PencilIcon className="w-4 h-4" />
                </button>
              </FileUploader>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold uppercase mb-2 text-[#12153A] text-xs">First Name</label>
                <input
                  type="text"
                  placeholder="Type your first name"
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  autoComplete="given-name"
                  className="w-full h-[47px] px-4 rounded-lg bg-[#FCFCFC] border border-[#EAE8E8] focus:outline-none focus:ring-2 focus:ring-[#2386AF]"
                />
                {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
              </div>
              <div>
                <label className="block font-semibold uppercase mb-2 text-[#12153A] text-xs">Last Name</label>
                <input
                  type="text"
                  placeholder="Type your last name"
                  value={formData.last_name}
                  onChange={(e) => handleInputChange('last_name', e.target.value)}
                  autoComplete="family-name"
                  className="w-full h-[47px] px-4 rounded-lg bg-[#FCFCFC] border border-[#EAE8E8] focus:outline-none focus:ring-2 focus:ring-[#2386AF]"
                />
                {errors.last_name && <p className="text-xs text-red-500 mt-1">{errors.last_name}</p>}
              </div>
            </div>

            <div>
              <label className="block font-semibold uppercase mb-2 text-[#12153A] text-xs">Email</label>
              <input
                type="email"
                disabled
                value={formData.email}
                className="w-full h-[47px] px-4 rounded-lg bg-gray-100 border border-[#EAE8E8] disabled:cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block font-semibold uppercase mb-2 text-[#12153A] text-xs">Company Name</label>
              <input
                type="text"
                placeholder="Type your company name"
                value={formData.company_name}
                onChange={(e) => handleInputChange('company_name', e.target.value)}
                autoComplete="organization"
                className="w-full h-[47px] px-4 rounded-lg bg-[#FCFCFC] border border-[#EAE8E8] focus:outline-none focus:ring-2 focus:ring-[#2386AF]"
              />
              {errors.company_name && <p className="text-xs text-red-500 mt-1">{errors.company_name}</p>}
            </div>

            <div>
              <label className="block font-semibold uppercase mb-2 text-[#12153A] text-xs">Phone Number</label>
              <PhoneInput
                value={formData.phone}
                onChange={(value) => handleInputChange('phone', value)}
                inputClass="!w-full !text-[13px] !h-[45px] !border !border-gray-300 !rounded-lg !pl-12 !pr-3 !py-2 !outline-none !focus:ring-2 !focus:ring-[#2386AF] !focus:border-[#2386AF] !bg-white"
                buttonClass="!border-none !bg-transparent !pl-3 !flex !items-center"
                dropdownClass="!text-sm"
                containerClass="!w-full !flex !flex-col"
                placeholder="Enter phone number"
                enableSearch
              />
            </div>

            <div className="pt-2 border-t border-gray-100">
              <span className="uppercase font-semibold text-[#12153A] text-sm">Address Information</span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <input
                  type="text"
                  ref={addressRef}
                  placeholder="Address"
                  value={formData.address}
                  onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                  onChange={(e) => handleInputChange('address', e.target.value)}
                  autoComplete="street-address"
                  className="h-[47px] px-4 rounded-lg bg-[#FCFCFC] border border-[#EAE8E8] md:col-span-2"
                />

                <select
                  value={formData.countryCode}
                  onChange={(e) => {
                    handleInputChange('countryCode', e.target.value);
                    handleInputChange('stateCode', '');
                    handleInputChange('city', '');
                  }}
                  className="h-[47px] px-4 rounded-lg bg-[#FCFCFC] border border-[#EAE8E8]">
                  <option value="">Select Country</option>
                  {Country.getAllCountries().map((c) => (
                    <option key={c.isoCode} value={c.isoCode}>
                      {c.name}
                    </option>
                  ))}
                </select>

                {formData.countryCode && (
                  <select
                    value={formData.stateCode}
                    onChange={(e) => handleInputChange('stateCode', e.target.value)}
                    className="h-[47px] px-4 rounded-lg bg-[#FCFCFC] border border-[#EAE8E8]">
                    <option value="">Select State</option>
                    {State.getStatesOfCountry(formData.countryCode).map((s) => (
                      <option key={s.isoCode} value={s.isoCode}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}

                {formData.stateCode && (
                  <select
                    value={formData.city}
                    onChange={(e) => handleInputChange('city', e.target.value)}
                    className="h-[47px] px-4 rounded-lg bg-[#FCFCFC] border border-[#EAE8E8]">
                    <option value="">Select City</option>
                    {City.getCitiesOfState(formData.countryCode, formData.stateCode).map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}

                <input
                  type="text"
                  placeholder="Zip Code"
                  value={formData.zipCode}
                  onChange={(e) => handleInputChange('zipCode', e.target.value)}
                  autoComplete="postal-code"
                  className="h-[47px] px-4 rounded-lg bg-[#FCFCFC] border border-[#EAE8E8]"
                />
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
              disabled={isUpdating}
              className="bg-[#2386AF] text-white px-8 py-2.5 rounded-md hover:bg-[#1d6d8e] transition disabled:opacity-50 flex items-center justify-center gap-2">
              {isUpdating ? <Spinner /> : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditMyProfileModal;
