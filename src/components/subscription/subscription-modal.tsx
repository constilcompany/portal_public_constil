/* eslint-disable @typescript-eslint/no-explicit-any */
import { Dialog, Box, IconButton, DialogContent } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useEffect, useState } from 'react';
import Spinner from '../spinner';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL + '/user-api';

interface SubscriptionModalProps {
  open: boolean;
  onClose: () => void;
}

const SubscriptionModal = ({ open, onClose }: SubscriptionModalProps) => {
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<any>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [isFreeTrial, setIsFreeTrial] = useState(true);

  // Coupon state
  const [coupon, setCoupon] = useState('');
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [couponResult, setCouponResult] = useState<any>(null);

  // Purchase state
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accessToken = localStorage.getItem('access_token');

  useEffect(() => {
    if (open) {
      fetchPackages();
    }
  }, [open]);

  // Reset coupon when package changes
  useEffect(() => {
    setCouponResult(null);
    setCoupon('');
    setError(null);
  }, [selectedPackage?.id]);

  // ───────── API: Fetch Packages ─────────
  const fetchPackages = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/packages`);
      setPackages(res?.data?.packages || []);
      setError(null);
    } catch (err) {
      console.error('Error fetching packages:', err);
      setError('Failed to load packages');
    } finally {
      setLoading(false);
    }
  };

  // ───────── API: Validate Coupon (POST /validate-coupon) ─────────
  const validateCoupon = async () => {
    if (!coupon.trim() || !selectedPackage) return;
    setValidatingCoupon(true);
    setCouponResult(null);
    try {
      const res = await axios.post(
        `${API_BASE}/validate-coupon`,
        {
          coupon_code: coupon.trim(),
          package_id: selectedPackage.id,
        },
        { 
          headers: { 
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          } 
        }
      );

      if (res.data.valid) {
        setCouponResult(res.data);
        setError(null);
      } else {
        setError(res.data.error || 'Invalid coupon code');
        setCouponResult(null);
      }
    } catch (err: any) {
      console.error('Coupon validation error:', err);
      setError(err?.response?.data?.error || 'Invalid coupon code');
      setCouponResult(null);
    } finally {
      setValidatingCoupon(false);
    }
  };

  // ───────── API: Create Checkout → Redirect to Stripe (POST /create-checkout) ─────────
  const handleCheckout = async () => {
    if (!selectedPackage) return;

    try {
      setPurchasing(true);
      setError(null);

      const isTrialCheckout = isFreeTrial && selectedPackage.trial_enabled;
      const endpoint = isTrialCheckout ? '/start-trial' : '/create-checkout';

      const payload: any = {
        package_id: selectedPackage.id,
        success_url: `${window.location.origin}/payment-success?session_id={CHECKOUT_SESSION_ID}${isTrialCheckout ? '&flow=trial' : ''}`,
        cancel_url: `${window.location.origin}/home`,
      };

      if (!isTrialCheckout) {
        payload.billing_type = selectedPackage.billing_type || 'subscription';
        payload.coupon_code = coupon.trim() || undefined;
      }

      const res = await axios.post(
        `${API_BASE}${endpoint}`,
        payload,
        { 
          headers: { 
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          } 
        }
      );

      const checkoutUrl = res.data.url || res.data.checkout_url || res.data.data?.url || res.data.data?.checkout_url;

      if (checkoutUrl) {
        // Redirect to Stripe Checkout page
        window.location.href = checkoutUrl;
      } else {
        setError('Failed to create checkout session. Please try again.');
      }
    } catch (err: any) {
      console.error('Checkout error:', err);
      const errorMessage = err?.response?.data?.message || err?.response?.data?.error || 'Checkout failed. Please ensure Stripe keys are configured in Supabase.';
      setError(errorMessage);
    } finally {
      setPurchasing(false);
    }
  };

  // ───────── Filter & Sort Packages ─────────
  const normalizePlanName = (name: string) => (name || '').toLowerCase().trim();

  const getPlanOrder = (name: string): number => {
    const tier = normalizePlanName(name);
    const order: { [key: string]: number } = {
      'free trial': 0,
      starter: 1,
      pro: 2,
      team: 3,
      basic: 4,
      standard: 5,
      professional: 6,
      enterprise: 7,
    };
    return order[tier] ?? 99;
  };

  const isFreeTrialPlan = (name: string) => normalizePlanName(name) === 'free trial';

  const filteredPackages = packages
    .filter((pkg) => {
      if (pkg.billing_type && pkg.billing_type !== 'subscription') return false;
      if (isFreeTrialPlan(pkg.name)) return true;
      return pkg.billing_interval === billingCycle;
    })
    .sort((a, b) => getPlanOrder(a.name) - getPlanOrder(b.name))
    .filter((pkg, index, arr) => {
      const name = normalizePlanName(pkg.name);
      return arr.findIndex((p) => normalizePlanName(p.name) === name) === index;
    });

  // ───────── Price Display ─────────
  const displayPrice = couponResult?.discounted_price ?? selectedPackage?.price;
  const hasDiscount = couponResult?.valid && couponResult?.discount_percent > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      scroll="body"
      PaperProps={{
        sx: {
          borderRadius: '16px',
          overflow: 'hidden',
          maxWidth: '1200px',
          m: 2
        }
      }}
    >
      {/* Header */}
      <Box className="flex items-center justify-between px-6 py-4 bg-[#1A1F3D] text-white">
        <h2 className="text-xl font-semibold">Subscription Plan (Upgrade to Pro)</h2>
        <IconButton onClick={onClose} sx={{ color: '#FFFFFF' }}>
          <CloseIcon />
        </IconButton>
      </Box>

      <DialogContent sx={{ p: 0, bgcolor: '#F9FAFB' }}>
        <Box className="p-6">
          {/* Sub-header with Toggle */}
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4 px-2">
            <p className="text-gray-600 font-medium">Save 20% when you choose the Yearly Plan.</p>

            <div className="flex flex-col sm:flex-row items-center gap-6">
              {/* Free Trial Toggle */}
              <div className="flex items-center gap-3 bg-[#F0F6FF] px-4 py-2 rounded-full border border-blue-100">
                <span className={`text-sm font-bold transition-colors ${isFreeTrial ? 'text-blue-600' : 'text-gray-500'}`}>
                  7-Day Free Trial
                </span>
                <button
                  onClick={() => setIsFreeTrial(!isFreeTrial)}
                  className={`relative w-12 h-6 rounded-full p-1 transition-all duration-300 focus:outline-none ${isFreeTrial ? 'bg-blue-600' : 'bg-gray-300'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full transition-transform duration-300 transform ${isFreeTrial ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Monthly/Yearly Toggle */}
              <div className="flex items-center gap-3">
                <span className={`text-sm font-semibold transition-colors ${billingCycle === 'monthly' ? 'text-[#1A1F3D]' : 'text-gray-400'}`}>Monthly</span>
                <button
                  onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'yearly' : 'monthly')}
                  className="relative w-12 h-6 bg-[#1A1F3D] rounded-full p-1 transition-all duration-300 focus:outline-none"
                >
                  <div className={`w-4 h-4 bg-white rounded-full transition-transform duration-300 transform ${billingCycle === 'yearly' ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
                <span className={`text-sm font-semibold transition-colors ${billingCycle === 'yearly' ? 'text-[#1A1F3D]' : 'text-gray-400'}`}>Yearly</span>
              </div>
            </div>
          </div>

          {/* Package Cards */}
          {loading ? (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
              <Spinner className="w-12 h-12 text-[#448AFF]" />
              <span className="mt-4 text-gray-500 animate-pulse">Fetching plans...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {filteredPackages.map((pkg) => {
                const isPremium = ['premium', 'professional', 'pro'].includes(normalizePlanName(pkg.name));
                const isSelected = selectedPackage?.id === pkg.id;

                return (
                  <div
                    key={pkg.id}
                    className={`relative flex flex-col bg-white rounded-xl border-2 transition-all duration-300 overflow-hidden ${isSelected ? 'border-[#448AFF] shadow-lg scale-[1.02]' : 'border-gray-100 hover:border-gray-300 shadow-sm'
                      }`}
                  >
                    {/* Most Popular Badge */}
                    {isPremium && (
                      <div className="absolute top-[108px] right-2 z-10">
                        <span className="bg-[#448AFF] text-white text-[10px] font-bold px-3 py-1 rounded-md shadow-sm">
                          Most Popular
                        </span>
                      </div>
                    )}

                    {/* Card Header */}
                    <div className="bg-[#1A1F3D] p-5 text-white relative">
                      {isFreeTrial && pkg.trial_enabled && (
                        <div className="absolute top-3 right-3 bg-green-500 text-[10px] font-bold px-2 py-1 rounded shadow text-white tracking-widest">
                          TRIAL AVAILABLE
                        </div>
                      )}
                      <div className="text-sm font-bold tracking-widest uppercase mb-2">
                        {pkg.name || 'PLAN'}
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold">
                          {isFreeTrial && pkg.trial_enabled ? '$0.00' : `${pkg.price} USD`}
                        </span>
                        <span className="text-gray-400 text-sm">
                          {isFreeTrial && pkg.trial_enabled ? '/ 7 days' : `/ ${pkg.billing_interval || 'mo'}`}
                        </span>
                      </div>
                    </div>

                    {/* Features List */}
                    <div className="flex-1 p-0 overflow-y-auto max-h-[300px] custom-scrollbar">
                      {[
                        { label: `Blueprints`, value: isFreeTrial && pkg.trial_enabled ? pkg.trial_ai_estimate_credits : pkg.ai_estimate_credits, healthy: !(isFreeTrial && pkg.trial_enabled) && pkg.ai_estimate_unlimited },
                        { label: `Invoices`, value: isFreeTrial && pkg.trial_enabled ? pkg.trial_invoice_credits : pkg.invoice_credits, healthy: !(isFreeTrial && pkg.trial_enabled) && pkg.invoice_unlimited },
                        { label: `Estimates`, value: isFreeTrial && pkg.trial_enabled ? pkg.trial_estimate_credits : pkg.estimate_credits, healthy: !(isFreeTrial && pkg.trial_enabled) && pkg.estimate_unlimited },
                        { label: `${(pkg.name || '').toLowerCase() === 'enterprise' ? 'Unlimited' : isPremium ? '8' : '3'} Invoice & Estimate Templates`, simple: true }
                      ].map((feature, idx) => (
                        <div key={idx} className={`flex items-start gap-3 p-4 border-b border-gray-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                          <CheckCircleOutlineIcon className="text-green-500 w-5 h-5 mt-0.5 flex-shrink-0" sx={{ fontSize: 18 }} />
                          <div className="text-sm text-gray-700">
                            {feature.simple ? (
                              feature.label
                            ) : (
                              <>
                                <span className="font-medium">- {feature.healthy ? 'Unlimited' : feature.value} {feature.label}</span>
                                {!feature.healthy && <span className="text-gray-400 ml-1">({feature.value} Credits)</span>}
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Select Button */}
                    <div className="p-5 mt-auto bg-gray-50/30">
                      <button
                        onClick={() => setSelectedPackage(pkg)}
                        className={`w-full py-3 rounded-lg font-bold text-sm transition-all duration-300 ${isSelected
                          ? 'bg-[#448AFF] text-white shadow-md'
                          : 'bg-[#1A1F3D] text-white hover:bg-[#2A2F4D]'
                          }`}
                      >
                        {isSelected ? '✓ SELECTED' : isFreeTrial && pkg.trial_enabled ? 'START FREE TRIAL' : 'SELECT PLAN'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ✅ Coupon Section — shows when package is selected */}
          {selectedPackage && !(isFreeTrial && selectedPackage.trial_enabled) && (
            <div className="mt-8 p-5 bg-white rounded-xl border-2 border-dashed border-gray-200">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-bold text-[#1A1F3D]">Have a discount code?</h4>
                  <p className="text-xs text-gray-500">Enter your coupon code to see the discounted price.</p>
                </div>
                <div className="flex-1 max-w-sm">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={coupon}
                      onChange={(e) => setCoupon(e.target.value)}
                      placeholder="Enter coupon code..."
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#448AFF] focus:border-transparent"
                    />
                    <button
                      onClick={validateCoupon}
                      disabled={!coupon.trim() || validatingCoupon}
                      className="bg-[#1A1F3D] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#2A2F4D] disabled:opacity-50 transition-all"
                    >
                      {validatingCoupon ? '...' : 'Apply'}
                    </button>
                  </div>

                  {/* Coupon Result */}
                  {couponResult && (
                    <div className="mt-3 p-3 bg-green-50 rounded-lg border border-green-200">
                      <p className="text-sm text-green-700 font-semibold">
                        ✓ Coupon applied! {couponResult.discount_percent}% off
                      </p>
                      <div className="flex justify-between text-xs mt-1">
                        <span className="text-gray-500">Original: <span className="line-through">${couponResult.original_price}</span></span>
                        <span className="text-green-700 font-bold">Now: ${couponResult.discounted_price}</span>
                      </div>
                      {couponResult.influencer_name && (
                        <p className="text-xs text-gray-400 mt-1">via {couponResult.influencer_name}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ✅ Order Summary — shows when package is selected */}
          {selectedPackage && (
            <div className="mt-6 p-5 bg-white rounded-xl border border-gray-200 shadow-sm">
              <h4 className="text-sm font-bold text-[#1A1F3D] mb-4">Order Summary</h4>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Plan:</span>
                  <span className="font-bold text-[#1A1F3D] uppercase">{selectedPackage.name || selectedPackage.name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Billing:</span>
                  <span className="font-medium text-gray-700 capitalize">
                    {isFreeTrial && selectedPackage.trial_enabled ? '7 Days Free Trial' : selectedPackage.billing_interval}
                  </span>
                </div>
                {hasDiscount && !(isFreeTrial && selectedPackage.trial_enabled) ? (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Original Price:</span>
                      <span className="text-gray-400 line-through">${couponResult.original_price} USD</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Discount:</span>
                      <span className="text-green-600 font-bold">-{couponResult.discount_percent}%</span>
                    </div>
                    <div className="flex justify-between text-base pt-3 border-t border-gray-100">
                      <span className="font-bold text-[#1A1F3D]">Total:</span>
                      <span className="font-bold text-[#448AFF]">${displayPrice} USD</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between text-base pt-3 border-t border-gray-100">
                    <span className="font-bold text-[#1A1F3D]">Total:</span>
                    <span className="font-bold text-[#448AFF]">
                      {isFreeTrial && selectedPackage.trial_enabled ? '$0.00 USD' : `${selectedPackage.price} USD`}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </Box>
      </DialogContent>

      {/* Footer */}
      <Box className="flex items-center justify-between px-8 py-5 bg-white border-t border-gray-100 flex-wrap gap-4">
        <button
          onClick={onClose}
          className="text-gray-600 font-semibold hover:text-gray-900 transition-colors"
        >
          Back to home
        </button>

        <div className="flex items-center gap-4">
          {error && <span className="text-red-500 text-sm font-medium">{error}</span>}
          <button
            disabled={!selectedPackage || purchasing}
            onClick={handleCheckout}
            className="bg-[#1A1F3D] hover:bg-[#2A2F4D] text-white px-10 py-3.5 rounded-full font-bold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-xl transform active:scale-95"
          >
            {purchasing && <Spinner className="w-5 h-5 text-white" />}
            {purchasing
              ? 'Redirecting to Stripe...'
              : isFreeTrial && selectedPackage?.trial_enabled
                ? 'Start Free Trial →'
                : 'Pay with Stripe →'}
          </button>
        </div>
      </Box>

      <style dangerouslySetInnerHTML={{
        __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f1f1f1;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #ccc;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #aaa;
        }
      `}} />
    </Dialog>
  );
};

export default SubscriptionModal;