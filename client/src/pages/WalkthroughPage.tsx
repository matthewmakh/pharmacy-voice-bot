import React from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ExternalLink, Check, X, Loader2, AlertCircle, Clock } from 'lucide-react';
import {
  getCase,
  startWalkthrough,
  getWalkthrough,
  advanceWalkthrough,
  completeWalkthrough,
  abandonWalkthrough,
  type WalkthroughType,
  type WalkthroughPurpose,
  type WalkthroughStep,
} from '../lib/api';

export default function WalkthroughPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const purpose = (search.get('purpose') as WalkthroughPurpose) || 'complaint';
  const initialType = (search.get('type') as WalkthroughType | null);

  const caseQuery = useQuery({
    queryKey: ['case', id],
    queryFn: () => getCase(id),
    enabled: !!id,
  });

  const wkQuery = useQuery({
    queryKey: ['walkthrough', id],
    queryFn: () => getWalkthrough(id),
    enabled: !!id && !!caseQuery.data?.walkthroughType,
    retry: false,
  });

  const startMutation = useMutation({
    mutationFn: (type: WalkthroughType) => startWalkthrough(id, type, purpose),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', id] });
      queryClient.invalidateQueries({ queryKey: ['walkthrough', id] });
    },
  });

  const advanceMutation = useMutation({
    mutationFn: (vars: { step: number; noteKey?: string; noteValue?: string }) =>
      advanceWalkthrough(id, vars.step, vars.noteKey, vars.noteValue),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['walkthrough', id] });
    },
  });

  const completeMutation = useMutation({
    mutationFn: (indexNumber: string | undefined) => completeWalkthrough(id, indexNumber),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', id] });
      queryClient.invalidateQueries({ queryKey: ['walkthrough', id] });
    },
  });

  const abandonMutation = useMutation({
    mutationFn: () => abandonWalkthrough(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case', id] });
      navigate(`/cases/${id}`);
    },
  });

  if (caseQuery.isLoading) {
    return <Centered><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></Centered>;
  }
  if (!caseQuery.data) {
    return <Centered><AlertCircle className="w-6 h-6 text-amber-500" /> <span>Case not found</span></Centered>;
  }

  const caseData = caseQuery.data;
  const hasActiveWalkthrough = !!caseData.walkthroughType;

  // Picker — no active walkthrough yet
  if (!hasActiveWalkthrough) {
    return (
      <PickerView
        caseId={id}
        purpose={purpose}
        initialType={initialType}
        onPick={(type) => startMutation.mutate(type)}
        isPending={startMutation.isPending}
      />
    );
  }

  // Active walkthrough
  if (wkQuery.isLoading || !wkQuery.data) {
    return <Centered><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></Centered>;
  }

  return (
    <RunnerView
      caseId={id}
      walkthrough={wkQuery.data}
      onAdvance={(step, noteKey, noteValue) => advanceMutation.mutate({ step, noteKey, noteValue })}
      onComplete={(indexNumber) => completeMutation.mutate(indexNumber)}
      onAbandon={() => abandonMutation.mutate()}
      isAdvancing={advanceMutation.isPending}
      isCompleting={completeMutation.isPending}
    />
  );
}

// ─── Picker view ─────────────────────────────────────────────────────────────

function PickerView({
  caseId,
  purpose,
  initialType,
  onPick,
  isPending,
}: {
  caseId: string;
  purpose: WalkthroughPurpose;
  initialType: WalkthroughType | null;
  onPick: (t: WalkthroughType) => void;
  isPending: boolean;
}) {
  const purposeLabel = purpose === 'default-judgment' ? 'default judgment motion' : 'summons & complaint';

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <Link to={`/cases/${caseId}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ChevronLeft className="w-4 h-4" /> Back to case
      </Link>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">File your {purposeLabel}</h1>
        <p className="text-sm text-slate-500 mt-1">
          Pick the right court for your claim amount. We'll walk you through every step.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PickerCard
          highlight={initialType === 'commercial-claims'}
          title="Commercial Claims"
          subtitle="Up to $10,000"
          location="In-person at NYC Civil Court"
          time="~45 min in person"
          fee="$25–$35"
          description="Walk-in filing at your borough's clerk window. We'll tell you exactly where to go and what to bring."
          onPick={() => onPick('commercial-claims')}
          isPending={isPending}
        />
        <PickerCard
          highlight={initialType === 'edds'}
          title="Civil Court (Pro Se)"
          subtitle="$10,000 – $50,000"
          location="EDDS — online filing"
          time="~15 min online"
          fee="$45–$95"
          description="Electronic Document Delivery System. Free, no login required. Court mails you the index number in 1–2 days."
          onPick={() => onPick('edds')}
          isPending={isPending}
        />
        <PickerCard
          highlight={initialType === 'nyscef'}
          title="Supreme Court"
          subtitle="$50,000+"
          location="NYSCEF — online filing"
          time="~20 min online"
          fee="$210"
          description="NY State Courts e-filing. Requires NYSCEF account. Index number assigned immediately on filing."
          onPick={() => onPick('nyscef')}
          isPending={isPending}
        />
      </div>

      <p className="text-xs text-slate-500 mt-6 leading-relaxed">
        <strong>Not sure?</strong> Pick the court that matches your claim amount. Filing in the wrong court is a common mistake — the clerk will reject your filing or transfer it, costing weeks.
      </p>
    </div>
  );
}

function PickerCard({
  highlight,
  title,
  subtitle,
  location,
  time,
  fee,
  description,
  onPick,
  isPending,
}: {
  highlight?: boolean;
  title: string;
  subtitle: string;
  location: string;
  time: string;
  fee: string;
  description: string;
  onPick: () => void;
  isPending: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-5 bg-white shadow-sm ${
        highlight ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'
      }`}
    >
      <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">{subtitle}</div>
      <h3 className="text-lg font-semibold text-slate-900 mb-2">{title}</h3>
      <p className="text-sm text-slate-600 mb-4 leading-relaxed">{description}</p>
      <div className="space-y-1 text-xs text-slate-500 mb-4">
        <div>📍 {location}</div>
        <div>⏱ {time}</div>
        <div>💵 {fee}</div>
      </div>
      <button onClick={onPick} disabled={isPending} className="btn-primary w-full">
        {isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</> : 'Walk me through it'}
      </button>
    </div>
  );
}

// ─── Runner view ─────────────────────────────────────────────────────────────

function RunnerView({
  caseId,
  walkthrough,
  onAdvance,
  onComplete,
  onAbandon,
  isAdvancing,
  isCompleting,
}: {
  caseId: string;
  walkthrough: { type: string; purpose: string; step: number; steps: WalkthroughStep[]; notes: Record<string, string> | null; completedAt: string | null };
  onAdvance: (step: number, noteKey?: string, noteValue?: string) => void;
  onComplete: (indexNumber: string | undefined) => void;
  onAbandon: () => void;
  isAdvancing: boolean;
  isCompleting: boolean;
}) {
  const [inputValue, setInputValue] = React.useState('');
  const [completionInput, setCompletionInput] = React.useState('');
  const idx = Math.min(walkthrough.step, walkthrough.steps.length - 1);
  const step = walkthrough.steps[idx];
  const isLast = idx === walkthrough.steps.length - 1;
  const completed = !!walkthrough.completedAt;

  React.useEffect(() => {
    // Hydrate input from saved notes
    if (step?.needsInput && walkthrough.notes?.[step.needsInput.field]) {
      setInputValue(walkthrough.notes[step.needsInput.field]);
    } else {
      setInputValue('');
    }
  }, [idx, step, walkthrough.notes]);

  if (completed) {
    return (
      <Centered>
        <div className="text-center max-w-md">
          <Check className="w-10 h-10 text-emerald-500 mx-auto" />
          <h2 className="text-xl font-semibold text-slate-900 mt-3">Filing complete</h2>
          <p className="text-sm text-slate-500 mt-1">
            We've recorded the filing on this case. You'll see it in the case timeline.
          </p>
          <Link to={`/cases/${caseId}`} className="btn-primary mt-6">Back to case</Link>
        </div>
      </Centered>
    );
  }

  const next = () => {
    if (step.needsInput && inputValue) {
      onAdvance(idx + 1, step.needsInput.field, inputValue);
    } else {
      onAdvance(idx + 1);
    }
  };

  const prev = () => {
    if (idx > 0) onAdvance(idx - 1);
  };

  const platformLabel = {
    nyscef: 'NYSCEF',
    edds: 'EDDS',
    'commercial-claims': 'Commercial Claims (in person)',
  }[walkthrough.type as 'nyscef' | 'edds' | 'commercial-claims'];

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <Link to={`/cases/${caseId}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ChevronLeft className="w-4 h-4" /> Back to case
        </Link>
        <button
          onClick={() => {
            if (confirm('Abandon this walkthrough? Progress will be lost.')) onAbandon();
          }}
          className="text-sm text-slate-400 hover:text-red-600 inline-flex items-center gap-1"
        >
          <X className="w-4 h-4" /> Abandon
        </button>
      </div>

      <header className="mb-2">
        <p className="text-xs uppercase tracking-wider text-slate-400">Filing via {platformLabel}</p>
        <h1 className="text-xl font-semibold text-slate-900 mt-0.5">
          Step {idx + 1} of {walkthrough.steps.length}: {step.title}
        </h1>
      </header>

      <div className="w-full bg-slate-100 rounded-full h-1 mb-6 overflow-hidden">
        <div
          className="bg-blue-500 h-full transition-all"
          style={{ width: `${((idx + 1) / walkthrough.steps.length) * 100}%` }}
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6">
        <div className="prose prose-sm max-w-none prose-slate">
          {step.body.split('\n\n').map((para, i) => (
            <p key={i} className="text-sm text-slate-700 leading-relaxed mb-3 last:mb-0 whitespace-pre-line">
              {renderMarkdownLite(para)}
            </p>
          ))}
        </div>

        {step.link && (
          <a
            href={step.link.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 mt-4 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            <ExternalLink className="w-4 h-4" /> {step.link.label}
          </a>
        )}

        {step.needsInput && (
          <div className="mt-4">
            <label className="label">{step.needsInput.label}</label>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={step.needsInput.placeholder}
              className="input"
            />
          </div>
        )}

        {step.estimatedMinutes && (
          <div className="flex items-center gap-1.5 mt-4 text-xs text-slate-400">
            <Clock className="w-3 h-3" /> ~{step.estimatedMinutes} min
          </div>
        )}
      </div>

      {isLast ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6">
          <h3 className="text-base font-semibold text-emerald-900 mb-2">Done? Mark as filed</h3>
          <p className="text-sm text-emerald-800 mb-4">
            Enter the index number the court assigned (if you have one) and click below to record this filing on your case.
          </p>
          <div className="space-y-3">
            <input
              type="text"
              value={completionInput}
              onChange={(e) => setCompletionInput(e.target.value)}
              placeholder="Index Number (e.g. 156789/2025)"
              className="input"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => onComplete(completionInput || undefined)}
                disabled={isCompleting}
                className="btn-primary"
              >
                {isCompleting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                ) : (
                  <><Check className="w-4 h-4" /> Mark as filed</>
                )}
              </button>
              <button onClick={prev} className="btn-ghost">
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <button onClick={prev} disabled={idx === 0} className="btn-ghost">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <button
            onClick={next}
            disabled={isAdvancing || (!!step.needsInput && !inputValue)}
            className="btn-primary"
          >
            {isAdvancing ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
            ) : (
              <>I've done this <ChevronRight className="w-4 h-4" /></>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] gap-2 text-slate-500">
      {children}
    </div>
  );
}

/** Renders **bold** segments and inline markdown-ish formatting. */
function renderMarkdownLite(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={i}>{p.slice(2, -2)}</strong>;
    }
    if (p.startsWith('`') && p.endsWith('`')) {
      return <code key={i} className="px-1 py-0.5 rounded bg-slate-100 text-xs">{p.slice(1, -1)}</code>;
    }
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}
