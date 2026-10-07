/* eslint-disable @typescript-eslint/no-explicit-any */
import './style.css';
import * as Yup from 'yup';
import { useFormik } from 'formik';
import { GoogleLogin } from '@react-oauth/google';
import Spinner from '../../components/spinner';
import { toast } from 'react-toastify';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { loginWithEmailAndPassword, loginWithGoogle } from '../../services/auth-service';
import { setToken, setUser } from '../../redux/authSlice';
import { useDispatch } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import { oauthReturnPath } from './oauth-return';
import {
  AuthPageLayout,
  AuthPageHeader,
  AuthDivider,
  AUTH_INPUT_CLASS,
  AUTH_INPUT_ICON_CLASS,
  AUTH_LABEL_CLASS,
} from './auth-layout';

type LoginFormValues = {
  email: string;
  password: string;
};

export function Login() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const togglePasswordVisibility = () => setShowPassword((prev) => !prev);

  const handleGoogleSignIn = async (credential: string) => {
    setIsLoading(true);
    try {
      const data = await loginWithGoogle(credential);

      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);

      dispatch(setToken(data.access_token));
      dispatch(setUser(data.user));

      toast.success('Google Login Successful!');
      navigate(oauthReturnPath(location.search));
    } catch (error: any) {
      toast.error(error.message || 'Google login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const { errors, touched, values, handleSubmit, handleChange, handleBlur } = useFormik<LoginFormValues>({
    initialValues: {
      email: '',
      password: '',
    },
    validationSchema: Yup.object({
      email: Yup.string().email('Invalid email').required('Email is required'),
      password: Yup.string().required('Password is required'),
    }),
    onSubmit: async (values) => {
      setIsLoading(true);
      try {
        const data = await loginWithEmailAndPassword(values.email, values.password);

        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('refresh_token', data.refresh_token);

        dispatch(setToken(data.access_token));
        dispatch(setUser(data.user));

        toast.success(data.message || 'Login successful');
        navigate(oauthReturnPath(location.search));
      } catch (err: any) {
        toast.error(err.message || 'Login failed');
      } finally {
        setIsLoading(false);
      }
    },
  });

  return (
    <AuthPageLayout>
      <AuthPageHeader
        title="Login to your account"
        subtitle="Sign in with Google or use your email and password."
      />

      <div className="w-full [&>div]:!w-full [&>div]:!max-w-full">
        <GoogleLogin
          onSuccess={async (response) => {
            if (response.credential) {
              await handleGoogleSignIn(response.credential);
            }
          }}
          onError={() => toast.error('Oops! Login with Google Failed')}
          auto_select={true}
          width="100%"
        />
      </div>

      <AuthDivider label="or continue with email" />

      <form onSubmit={handleSubmit} className="login-form flex flex-col gap-5 w-full">
        <div className="input-group">
          <label htmlFor="email" className={AUTH_LABEL_CLASS}>
            E-mail
          </label>
          <input
            type="email"
            id="email"
            name="email"
            placeholder="e-mail"
            value={values.email}
            onChange={handleChange}
            onBlur={handleBlur}
            className={AUTH_INPUT_CLASS}
          />
          {touched.email && errors.email && (
            <p className="text-[#f4777f] text-sm mt-1.5">{errors.email}</p>
          )}
        </div>

        <div className="input-group">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="password" className={AUTH_LABEL_CLASS}>
              Password
            </label>
            <button
              type="button"
              onClick={() => navigate('/forgotpassword')}
              className="text-sm text-[#88939D] underline hover:text-[#12153A] shrink-0"
            >
              Forgot password?
            </button>
          </div>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      id="password"
                      name="password"
                      placeholder="Password"
                      value={values.password}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      className={AUTH_INPUT_ICON_CLASS}
                    />
            <button
              type="button"
              onClick={togglePasswordVisibility}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          {touched.password && errors.password && (
            <p className="text-[#f4777f] text-sm mt-1.5">{errors.password}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="btn_auth text-white p-3 rounded w-full cursor-pointer flex items-center justify-center mt-1"
        >
          {isLoading ? <Spinner /> : 'Sign In'}
        </button>
      </form>

      <p className="text-center text-[#88939D] mt-6">
        Don&apos;t have an account?{' '}
        <button
          type="button"
          onClick={() => navigate('/signup')}
          className="underline hover:text-[#12153A] cursor-pointer"
        >
          Sign up
        </button>
      </p>
    </AuthPageLayout>
  );
}
