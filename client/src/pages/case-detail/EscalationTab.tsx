import { Fragment } from 'react';
import { Check, Lock } from 'lucide-react';
import type { Case } from '../../types';
import { cn } from '../../lib/utils';
import PreFilingNotice from './escalation/PreFilingNotice';
import CourtFormPanel from './escalation/CourtFormPanel';
import ProcessServerPanel from './escalation/ProcessServerPanel';
import AffidavitPanel from './escalation/AffidavitPanel';
import DefaultJudgmentPanel from './escalation/DefaultJudgmentPanel';
import SettlementPanel from './escalation/SettlementPanel';

type NodeState = 'done' | 'current' | 'available' | 'locked' | 'optional';

function Node({ state, n }: { state: NodeState; n: number }) {
  return (
    <span
      className={cn(
        'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0',
        state === 'done' && 'bg-primary text-primary-foreground',
        state === 'current' && 'bg-card border-2 border-primary text-primary ring-4 ring-primary/15',
        state === 'available' && 'bg-card border border-border text-muted-foreground',
        state === 'locked' && 'bg-muted border border-border text-muted-foreground',
        state === 'optional' && 'bg-card border border-dashed border-muted-foreground/40 text-muted-foreground',
      )}
    >
      {state === 'done' ? <Check className="w-4 h-4" strokeWidth={3} /> : state === 'locked' ? <Lock className="w-3.5 h-3.5" /> : n}
    </span>
  );
}

/**
 * Escalation as a guided mini-stepper. The six existing panels are reused untouched as
 * each step's content (all their generate / deadline / verification / PDF logic intact);
 * this only adds the numbered done/current/locked spine + lock reasons so the order is
 * obvious and you can see what's actionable now. The current step is auto-expanded.
 */
export default function EscalationTab({ caseData }: { caseData: Case }) {
  const outstanding = parseFloat(caseData.amountOwed || '0') - parseFloat(caseData.amountPaid || '0');
  const needsProcessServer = outstanding > 10000; // Civil / Supreme tracks serve via a process server
  const served = !!caseData.actions.find((a) => a.type === 'SERVICE_INITIATED');

  type Step = {
    id: string;
    title: string;
    done: boolean;
    locked: boolean;
    lockMsg?: string;
    optional?: boolean;
    render: (open?: boolean) => React.ReactNode;
  };

  const steps: Step[] = [
    { id: 'notice', title: 'Pre-filing notice', done: !!caseData.finalNoticeHtml, locked: false, render: (open) => <PreFilingNotice caseData={caseData} defaultOpen={open} /> },
    { id: 'court', title: 'Court form', done: !!caseData.filingPacketHtml, locked: false, render: (open) => <CourtFormPanel caseData={caseData} defaultOpen={open} /> },
    ...(needsProcessServer
      ? [{ id: 'service', title: 'Serve the defendant', done: served, locked: false, render: (open?: boolean) => <ProcessServerPanel caseData={caseData} defaultOpen={open} /> } as Step]
      : []),
    {
      id: 'affidavit',
      title: 'Affidavit of service',
      done: !!caseData.affidavitOfServiceHtml,
      locked: !served,
      lockMsg: 'Unlocks after service is logged',
      // AffidavitPanel renders null without a service action; the locked branch shows a placeholder.
      render: (open) => (served ? <AffidavitPanel caseData={caseData} defaultOpen={open} /> : null),
    },
    {
      id: 'judgment',
      title: 'Default judgment',
      done: !!caseData.defaultJudgmentHtml,
      locked: !served,
      lockMsg: 'Unlocks after the defendant is served',
      render: (open) => <DefaultJudgmentPanel caseData={caseData} defaultOpen={open} />,
    },
    { id: 'settlement', title: 'Settlement / payment plan', done: !!(caseData.settlementHtml || caseData.paymentPlanHtml), locked: false, optional: true, render: (open) => <SettlementPanel caseData={caseData} defaultOpen={open} /> },
  ];

  // "Current" = first required, not-done, unlocked step.
  const currentId = steps.find((s) => !s.optional && !s.done && !s.locked)?.id;

  function nodeState(s: Step): NodeState {
    if (s.done) return 'done';
    if (s.locked) return 'locked';
    if (s.optional) return 'optional';
    return s.id === currentId ? 'current' : 'available';
  }

  return (
    <div>
      {steps.map((s, i) => {
        const state = nodeState(s);
        return (
          <Fragment key={s.id}>
            <div className="flex gap-4">
              <div className="flex flex-col items-center pt-3">
                <Node state={state} n={i + 1} />
                {i < steps.length - 1 && <div className={cn('w-0.5 flex-1 my-1', s.done ? 'bg-primary' : 'bg-border')} />}
              </div>
              <div className="flex-1 min-w-0 pb-6">
                {s.locked ? (
                  <div className="flex items-center justify-between rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3.5">
                    <span className="text-sm font-medium text-muted-foreground">{s.title}</span>
                    <span className="text-xs text-muted-foreground/80">{s.lockMsg}</span>
                  </div>
                ) : (
                  s.render(state === 'current' || undefined)
                )}
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
