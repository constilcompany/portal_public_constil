import React, { useState } from "react";
import * as Yup from "yup";
import { useFormik } from "formik";
import { Country, State, City } from "country-state-city";
import { useSelector, useDispatch } from "react-redux";
import { RootState } from "../../redux/store";
import { toast } from "react-toastify";
import { clearAuth } from "../../redux/authSlice";
import { useNavigate } from "react-router-dom";
import { Checkbox, FormControlLabel, Typography } from '@mui/material';
import TermConditionModal from "./termConditionModal";
import PrivacyModal from "./privacyModal";
import { userRegistrationWithEmail } from "../../services/auth-service";
import { AUTH_INPUT_CLASS, AUTH_LABEL_CLASS } from "../../pages/auth/auth-layout";

interface FormValues {
  address: string;
  zipCode: string;
  state: string;
  city: string;
  country: string;
}

export const SingUpAccountStep: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
 
  const { user } = useSelector((state: RootState) => state.auth);
  const [isLoading, setIsLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [accept, setAccept] = React.useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  // Track selected country/state ISO codes for dynamic loading
  const [countryCode, setCountryCode] = useState<string>("");
  const [stateCode, setStateCode] = useState<string>("");
  const {
    errors,
    touched,
    setFieldValue,
    values,
    handleSubmit,
    handleChange,
    handleBlur,
  } = useFormik<FormValues>({
    initialValues: {
      address: "",
      zipCode: "",
      state: "",
      city: "",
      country: "",
    },
    validationSchema: Yup.object({
      address: Yup.string().required("Address is required"),
      zipCode: Yup.string().required("Zip code is required"),
      state: Yup.string().required("State is required"),
      city: Yup.string().required("City is required"),
      country: Yup.string().required("Country is required"),
    }),
    onSubmit: async () => {
      if (!accept) {
        toast.error("Please accept the terms and conditions and privacy policy.");
        setShowTerms(true);
        return;
      }
      
      setIsLoading(true);
      try {
        // user object in Redux has: email, password, full_name, company_name
        await userRegistrationWithEmail(
            user?.name, // first name from step 1
            user?.last_name, // last name from step 1
            user?.email,
            user?.password,
            undefined, // couponCode
            undefined, // phone
            values.address,
            values.zipCode,
            values.city,
            values.state,
            values.country,
            user?.company_name
        );

        // After successful registration, we also want to update the company profile
        // but for now, the documentation says 'register' is enough to create the account.
        // We'll proceed to login.
        
        toast.success("Account created successfully! Please login.");
        dispatch(clearAuth());
        localStorage.removeItem("access_token");
        navigate("/");
      } catch (err: any) {
        toast.error(err.message || "Something went wrong during registration");
      } finally {
        setIsLoading(false);
      }
    },
  });
  const countries = Country.getAllCountries();

  const states = countryCode ? State.getStatesOfCountry(countryCode) : [];

  const cities =
    countryCode && stateCode
      ? City.getCitiesOfState(countryCode, stateCode)
      : [];

  return (
    <>
      <form onSubmit={handleSubmit} className="grid grid-cols-4 gap-4">
        <div className="input-group col-span-4">
          <label htmlFor="address" className={AUTH_LABEL_CLASS}>
            ADDRESS
          </label>
          <input
            type="text"
            id="address"
            name="address"
            placeholder="Address"
            className={AUTH_INPUT_CLASS}
            value={values.address}
            onChange={handleChange}
            onBlur={handleBlur}
          />
          {touched.address && errors.address && (
            <p className="text-[#f4777f] mt-1.5">{errors.address}</p>
          )}
        </div>

        {/* ZIP CODE */}
        <div className="input-group col-span-2">
          <label htmlFor="zipCode" className={AUTH_LABEL_CLASS}>
            ZIP CODE
          </label>
          <input
            type="text"
            id="zipCode"
            name="zipCode"
            placeholder="Code"
            className={AUTH_INPUT_CLASS}
            value={values.zipCode}
            onChange={handleChange}
            onBlur={handleBlur}
          />
          {touched.zipCode && errors.zipCode && (
            <p className="text-[#f4777f] mt-1.5">{errors.zipCode}</p>
          )}
        </div>

        {/* COUNTRY */}
        {/* COUNTRY */}
        <div className="input-group col-span-2">
          <label htmlFor="country" className={AUTH_LABEL_CLASS}>
            COUNTRY
          </label>
          <select
            id="country"
            name="country"
            className={AUTH_INPUT_CLASS}
            // value should be isoCode (internal) if available
            value={countryCode}
            onChange={(e) => {
              const selectedCode = e.target.value;
              const selectedCountry = countries.find(
                (c) => c.isoCode === selectedCode
              );

              // save readable name (e.g. "Pakistan")
              setFieldValue("country", selectedCountry?.name || "");

              // save ISO for states/cities lookup
              setCountryCode(selectedCountry?.isoCode || "");

              // reset dependent dropdowns
              setFieldValue("state", "");
              setFieldValue("city", "");
              setStateCode("");
            }}
          >
            <option value="">Select Country</option>
            {countries.map((c) => (
              <option key={c.isoCode} value={c.isoCode}>
                {c.name}
              </option>
            ))}
          </select>

          {touched.country && errors.country && (
            <p className="text-[#f4777f] mt-1.5">{errors.country}</p>
          )}
        </div>


        {/* STATE */}
        <div className="input-group col-span-2">
          <label htmlFor="state" className={AUTH_LABEL_CLASS}>
            STATE
          </label>
          <select
            id="state"
            name="state"
            className={AUTH_INPUT_CLASS}
            value={stateCode}
            onChange={(e) => {
              const selectedCode = e.target.value;
              const selectedState = states.find((s) => s.isoCode === selectedCode);

              // save full state name in formik
              setFieldValue("state", selectedState?.name || "");

              // keep ISO code internally for fetching cities
              setStateCode(selectedState?.isoCode || "");

              // reset city when state changes
              setFieldValue("city", "");
            }}
            disabled={!countryCode}
          >
            <option value="">
              {countryCode ? "Select State" : "Select Country first"}
            </option>
            {states.map((s) => (
              <option key={s.isoCode} value={s.isoCode}>
                {s.name}
              </option>
            ))}
          </select>

          {touched.state && errors.state && (
            <p className="text-[#f4777f] mt-1.5">{errors.state}</p>
          )}
        </div>



        {/* CITY */}
        <div className="input-group col-span-2">
          <label htmlFor="city" className={AUTH_LABEL_CLASS}>
            CITY
          </label>
          <select
            id="city"
            name="city"
            className={AUTH_INPUT_CLASS}
            value={values.city}
            onChange={(e) => setFieldValue("city", e.target.value)}
            disabled={!stateCode}
          >
            <option value="">
              {stateCode ? "Select City" : "Select State first"}
            </option>
            {cities.map((ct) => (
              <option key={ct.name} value={ct.name}>
                {ct.name}
              </option>
            ))}
          </select>
          {touched.city && errors.city && (
            <p className="text-[#f4777f] mt-1.5">{errors.city}</p>
          )}
        </div>


        <div className="flex gap-4 col-span-4">
          <button
            type="submit"
            disabled={isLoading}
            className={`text-white bg-[#007bff] hover:bg-[#0056b3] p-3 rounded-md text-sm md:text-base w-full ${isLoading ? "cursor-not-allowed opacity-50" : ""
              }`}
          >
            {isLoading ? "Submitting..." : "Finish"}
          </button>
        </div>
      </form>
      <FormControlLabel
        control={
          <Checkbox
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            sx={{
              color: '#448AFF',
              '&.Mui-checked': {
                color: '#448AFF',
              },
            }}
          />
        }
        label={
          <Typography variant="body2" sx={{ color: '#808080' }}>
            I agree to the{' '}
            <button onClick={() => setShowTerms(true)} className="font-bold text-[#448AFF] cursor-pointer">
              Terms of Use
            </button>{' '}
            and{' '}
            <button onClick={() => setShowPrivacy(true)} className="font-bold text-[#448AFF] cursor-pointer">
              Privacy Policy
            </button>
          </Typography>
        }
      />
      <TermConditionModal open={showTerms} setAccept={setAccept} accept={accept} onClose={() => setShowTerms(false)} />
      <PrivacyModal open={showPrivacy} onClose={() => setShowPrivacy(false)} />
    </>
  );
};
