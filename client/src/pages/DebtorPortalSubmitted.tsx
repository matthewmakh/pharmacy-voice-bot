import { Check } from 'lucide-react';

export default function DebtorPortalSubmitted() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 max-w-md w-full text-center">
        <Check className="w-10 h-10 text-emerald-500 mx-auto" />
        <h2 className="text-xl font-semibold text-slate-900 mt-3">Submitted</h2>
        <p className="text-sm text-slate-500 mt-1">
          Your response has been recorded. The claimant has been notified and may follow up directly.
        </p>
      </div>
    </div>
  );
}
