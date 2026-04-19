import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Building2, User, DollarSign, FileText, Check } from 'lucide-react';
import { createCase } from '../lib/api';
import Alert from '../components/ui/Alert';
import type { CreateCaseInput } from '../types';

type Step = 1 | 2 | 3 | 4;

const STEPS = [
  { id: 1, label: 'Your Business', icon: Building2 },
  { id: 2, label: 'Debtor Info', icon: User },
  { id: 3, label: 'Claim Details', icon: DollarSign },
  { id: 4, label: 'Agreement', icon: FileText },
];

function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((step, i) => {
        const done = step.id < current;
        const active = step.id === current;
        const Icon = step.icon;
        return (
          <div key={step.id} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  done
                    ? 'bg-blue-600 text-white'
                    : active
                    ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                    : 'bg-slate-200 text-slate-500'
                }`}
              >
                {done ? <Check className="w-4 h-4" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <span
                className={`text-sm font-medium hidden sm:block ${
                  active ? 'text-blue-600' : done ? 'text-slate-700' : 'text-slate-400'
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-12 h-0.5 mx-2 ${done ? 'bg-blue-600' : 'bg-slate-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function NewCase() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(1);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<CreateCaseInput>({
    defaultValues: { hasWrittenContract: false },
  });

  const mutation = useMutation({
    mutationFn: createCase,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      navigate(`/cases/${data.id}`);
    },
  });

  const onSubmit = (data: CreateCaseInput) => {
    const cleaned: CreateCaseInput = {};
    (Object.keys(data) as (keyof CreateCaseInput)[]).forEach((key) => {
      const val = data[key];
      if (val !== '' && val !== undefined && val !== null) {
        (cleaned as Record<string, unknown>)[key] = val;
      }
    });
    if (cleaned.amountOwed) cleaned.amountOwed = parseFloat(cleaned.amountOwed as unknown as string);
    if (cleaned.amountPaid) cleaned.amountPaid = parseFloat(cleaned.amountPaid as unknown as string);
    mutation.mutate(cleaned);
  };

  const next = () => setStep((s) => Math.min(4, s + 1) as Step);
  const prev = () => setStep((s) => Math.max(1, s - 1) as Step);

  return (
    <div className="min-h-screen p-4 lg:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Back */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">New Collections Case</h1>
          <p className="text-slate-500 text-sm mt-1">
            Provide basic information about your matter. You'll upload documents next.
          </p>
        </div>

        {/* Steps */}
        <div className="mb-8">
          <StepIndicator current={step} />
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          {/* Step 1: Your Business */}
          {step === 1 && (
            <div className="card p-6 space-y-5">
              <h2 className="section-title">Your Business (Claimant)</h2>
              <p className="text-sm text-slate-500 -mt-2">The business that is owed money.</p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Your Name</label>
                  <input className="input" placeholder="John Smith" {...register('claimantName')} />
                </div>
                <div>
                  <label className="label">Business Name</label>
                  <input className="input" placeholder="Acme Services LLC" {...register('claimantBusiness')} />
                </div>
              </div>

              <div>
                <label className="label">Business Address</label>
                <input className="input" placeholder="123 Main St, New York, NY 10001" {...register('claimantAddress')} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Email</label>
                  <input className="input" type="email" placeholder="you@yourbusiness.com" {...register('claimantEmail')} />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input className="input" placeholder="(212) 555-1234" {...register('claimantPhone')} />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Debtor */}
          {step === 2 && (
            <div className="card p-6 space-y-5">
              <h2 className="section-title">Debtor (Who Owes You)</h2>
              <p className="text-sm text-slate-500 -mt-2">The business or individual that has not paid.</p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Contact Name</label>
                  <input className="input" placeholder="Jane Doe" {...register('debtorName')} />
                </div>
                <div>
                  <label className="label">Business Name <span className="text-slate-400 font-normal">(if applicable)</span></label>
                  <input className="input" placeholder="Client Corp Inc." {...register('debtorBusiness')} />
                </div>
              </div>

              <div>
                <label className="label">Entity Type</label>
                <select className="input" {...register('debtorEntityType')}>
                  <option value="">Select...</option>
                  <option value="LLC">LLC</option>
                  <option value="Corporation">Corporation</option>
                  <option value="Sole Proprietor">Sole Proprietor</option>
                  <option value="Partnership">Partnership</option>
                  <option value="Individual">Individual</option>
                  <option value="Unknown">Unknown</option>
                </select>
              </div>

              <div>
                <label className="label">Known Address</label>
                <input className="input" placeholder="456 Client Ave, New York, NY 10002" {...register('debtorAddress')} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Email <span className="text-slate-400 font-normal">(if known)</span></label>
                  <input className="input" type="email" placeholder="contact@theircorp.com" {...register('debtorEmail')} />
                </div>
                <div>
                  <label className="label">Phone <span className="text-slate-400 font-normal">(if known)</span></label>
                  <input className="input" placeholder="(212) 555-9876" {...register('debtorPhone')} />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Claim */}
          {step === 3 && (
            <div className="card p-6 space-y-5">
              <h2 className="section-title">Claim Details</h2>
              <p className="text-sm text-slate-500 -mt-2">Tell us about the money owed and the work performed.</p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Amount Owed ($) <span className="text-red-500">*</span></label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="5000.00"
                    {...register('amountOwed', { required: 'Required' })}
                  />
                  {errors.amountOwed && <p className="text-red-500 text-xs mt-1">{errors.amountOwed.message}</p>}
                </div>
                <div>
                  <label className="label">Amount Already Paid ($)</label>
                  <input className="input" type="number" step="0.01" min="0" placeholder="0.00" {...register('amountPaid')} />
                </div>
              </div>

              <div>
                <label className="label">Invoice / Reference Number</label>
                <input className="input" placeholder="INV-2024-001" {...register('invoiceNumber')} />
              </div>

              <div>
                <label className="label">Description of Services / Work Performed</label>
                <textarea
                  className="input min-h-[100px] resize-y"
                  placeholder="E.g. Website redesign and development completed per the agreed scope of work..."
                  {...register('serviceDescription')}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Service Start Date</label>
                  <input className="input" type="date" {...register('serviceStartDate')} />
                </div>
                <div>
                  <label className="label">Service End / Completion Date</label>
                  <input className="input" type="date" {...register('serviceEndDate')} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Invoice Date</label>
                  <input className="input" type="date" {...register('invoiceDate')} />
                </div>
                <div>
                  <label className="label">Payment Due Date</label>
                  <input className="input" type="date" {...register('paymentDueDate')} />
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Agreement */}
          {step === 4 && (
            <div className="card p-6 space-y-5">
              <h2 className="section-title">Agreement & Additional Notes</h2>

              <div>
                <label className="label">Agreement Date</label>
                <input className="input" type="date" {...register('agreementDate')} />
                <p className="text-xs text-slate-400 mt-1">When was the work agreement or contract established?</p>
              </div>

              <div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    style={{ display: 'inline-block' }}
                    {...register('hasWrittenContract')}
                  />
                  <span className="text-sm text-slate-700 font-medium">There is a written contract or formal agreement</span>
                </label>
                <p className="text-xs text-slate-400 mt-2 ml-7">You'll be able to upload the contract in the next step.</p>
              </div>

              <div>
                <label className="label">Additional Notes</label>
                <textarea
                  className="input min-h-[120px] resize-y"
                  placeholder="Any other relevant context about this dispute, prior communication attempts, or important background..."
                  {...register('notes')}
                />
              </div>

              {mutation.isError && (
                <Alert tone="danger">Failed to create case. Please try again.</Alert>
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6">
            <button
              type="button"
              onClick={prev}
              disabled={step === 1}
              className="btn-secondary disabled:opacity-0"
            >
              <ArrowLeft className="w-4 h-4" />
              Previous
            </button>

            {step < 4 ? (
              <button type="button" onClick={next} className="btn-primary">
                Next
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={mutation.isPending}
                className="btn-primary btn-lg"
              >
                {mutation.isPending ? 'Creating Case...' : 'Create Case & Upload Documents'}
                {!mutation.isPending && <ArrowRight className="w-4 h-4" />}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
