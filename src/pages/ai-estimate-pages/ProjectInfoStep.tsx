/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import FormNewClienteModal from '../../components/formnewclient/form-new-client';
import { useGetClientsQuery } from '../../services/rtkapi/invoiceApi';
import Select from 'react-select';
import UploadBluePrint from './UploadBluePrint';

const ProjectInfoStep = ({ data, setData }: any) => {
  const { data: clients, isLoading } = useGetClientsQuery();
  const [openClientModal, setOpenClientModal] = useState(false);
  const pageOptions = [
    { value: 'Overall', label: 'Overall' },
    { value: 'Finishes', label: 'Finishes' },
    { value: 'Drywall', label: 'Drywall' },
    { value: 'Flooring', label: 'Flooring' },
    { value: 'Framing', label: 'Framing' },
    { value: 'Roofing', label: 'Roofing' },
    { value: 'Insulation', label: 'Insulation' },
    { value: 'Cleaning', label: 'Cleaning' },
    { value: 'Plumbing', label: 'Plumbing' },
    { value: 'HVAC', label: 'HVAC' },
    { value: 'Electrical', label: 'Electrical' },
    { value: 'FinishCarpentry', label: 'FinishCarpentry' },
    { value: 'Windows', label: 'Windows' },
    { value: 'Doors', label: 'Doors' },
    { value: 'Siding', label: 'Siding' },
  ];

  return (
    <div className="bg-background p-4">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-lg font-bold text-foreground mb-2">Project Information</h2>
        <p className="text-sm text-muted-foreground mb-6">Enter the basic details about your construction project</p>

        <div className="space-y-4">
          {/* Project Name */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Project Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={data.projectName}
              onChange={(e) =>
                setData((prev: any) => ({
                  ...prev,
                  projectName: e.target.value,
                }))
              }
              className="w-full border border-gray-300 rounded-lg px-4 py-2"
            />
          </div>

          {/* Address */}
          <div>
            <label className="block text-sm font-medium mb-2">Project Address</label>
            <input
              type="text"
              value={data.projectAddress}
              onChange={(e) =>
                setData((prev: any) => ({
                  ...prev,
                  projectAddress: e.target.value,
                }))
              }
              className="w-full border border-gray-300 rounded-lg px-4 py-2"
            />
          </div>

          {/* Client */}
          <div>
            <div className="flex justify-between">
              <label className="block text-sm font-medium mb-2">
                Client <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => setOpenClientModal(true)}
                className="text-blue-400 hover:text-blue-600 font-semibold text-sm sm:text-base">
                New Client
              </button>
            </div>
            <select
              className="w-full h-12 px-4 rounded-lg border border-gray-300"
              value={data.client}
              onChange={(e) =>
                setData((prev: any) => ({
                  ...prev,
                  client: e.target.value,
                }))
              }
              disabled={isLoading}>
              <option value="">{isLoading ? 'Loading clients...' : 'Select Client'}</option>
              {clients?.data?.map((client: any) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>

          {/* Selected Pages */}
          <div>
            <label className="block text-sm font-medium mb-2">Select Layer</label>

            <Select
              isMulti
              options={pageOptions}
              placeholder="Select Layers..."
              value={pageOptions.filter((opt) => data.source?.includes(opt.value))}
              onChange={(selected: any) =>
                setData((prev: any) => ({
                  ...prev,
                  source: selected ? selected.map((s: any) => s.value) : [],
                }))
              }
              className="text-sm"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-2">Description</label>
            <textarea
              rows={5}
              value={data.description}
              onChange={(e) =>
                setData((prev: any) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
              className="w-full border border-gray-300 rounded-lg px-4 py-2"
            />
          </div>

          {/* Upload Blueprint */}
          <div className="pt-6 mt-6 border-t border-gray-200">
            <UploadBluePrint data={data} setData={setData} />
          </div>
        </div>
      </div>
      <FormNewClienteModal open={openClientModal} onClose={() => setOpenClientModal(false)} />
    </div>
  );
};

export default ProjectInfoStep;
