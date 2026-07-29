import React from 'react';
import { Mail, Clock, CheckCircle } from 'lucide-react';
import EstimateFollowupsList from '../../components/opcestimatedcreate/estimate-followups-list';

const AutomatedSequences: React.FC = () => {
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Automated Sequences</h1>
        <p className="text-gray-600">
          Monitor and manage your automated email follow-up sequences.
        </p>
      </div>

      {/* How it works section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">How it works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
              <Mail className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">1. Initial Email</h3>
              <p className="text-sm text-gray-600">
                When you send an estimate to a customer, a sequence automatically begins tracking their response.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="p-3 bg-yellow-50 text-yellow-600 rounded-lg">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">2. Timed Reminders</h3>
              <p className="text-sm text-gray-600">
                If the customer doesn't reply in <strong>2 days</strong>, an automated reminder is sent. A second follow-up is sent if there is no reply after <strong>7 days</strong>.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="p-3 bg-green-50 text-green-600 rounded-lg">
              <CheckCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">3. Auto-Cancellation</h3>
              <p className="text-sm text-gray-600">
                If the customer replies at any point, the sequence is automatically cancelled and no further reminders are sent.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Sequences List */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Active Sequences</h2>
        <EstimateFollowupsList />
      </div>
    </div>
  );
};

export default AutomatedSequences;
