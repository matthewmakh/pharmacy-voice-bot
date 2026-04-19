import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';

const LOADING_FACTS = [
  'In New York, Commercial Claims Court caps recovery at $10,000 — but costs just $25 to file.',
  'A demand letter sent via certified mail creates a paper trail courts take seriously.',
  'Defendants have 20 days to respond after personal service in NY Civil Court — mark it immediately.',
  'Account stated is a powerful cause of action: if you sent an invoice and they didn\'t dispute it, the debt may be legally acknowledged.',
  'NYC City Marshals collect roughly 5% of the judgment amount as their fee — recoverable from the debtor.',
  'Quantum meruit means "as much as deserved" — it lets you collect even without a signed contract.',
  'Filing in the wrong county is one of the most common pro se mistakes. Always file where the defendant does business.',
  'Winning a judgment is step one. Enforcing it — bank levy, property lien, income execution — is step two.',
  'The 120-day service window starts the day you file, not the day you serve. Calendar it immediately.',
  'An Affidavit of Service must be notarized and filed with the court promptly — don\'t sit on it.',
  'In NY Supreme Court, e-filing is mandatory for represented parties on NYSCEF. Pro se filers are exempt unless they opt in.',
  'Partial payment by a debtor is powerful evidence — it shows they acknowledged the debt.',
  'Interest runs at 9% per year on NY judgments under CPLR § 5004.',
  'A default judgment can be entered if the defendant fails to appear or answer by the deadline.',
  'The RJI (Request for Judicial Intervention) must be filed within 60 days to get a judge assigned in Supreme Court.',
  'New York\'s "account stated" doctrine means an unpaid invoice that went undisputed can be treated as an accepted debt.',
  'For businesses suing in Commercial Claims, you can file up to 5 claims per month per claimant.',
  'A process server must be licensed in New York State — using an unlicensed server can invalidate service.',
  'Breach of contract, account stated, and quantum meruit are the three workhorses of B2B collections in New York.',
  'You can garnish up to 10% of gross wages in New York — but only for individual defendants, not business entities.',
  'A property lien prevents the debtor from selling or refinancing until your judgment is satisfied.',
  'Post-judgment discovery (a court-ordered deposition) lets you compel the debtor to disclose their bank accounts and assets.',
  'New York\'s statute of limitations for breach of written contract is 6 years; for oral contracts, also 6 years.',
  'If a corporate defendant is a shell or alter ego, you may be able to pierce the corporate veil and pursue personal assets.',
  'Certified mail with return receipt is the gold standard for proving a demand letter was delivered.',
  'The NYC Civil Court handles claims up to $50,000 — more than most people realize.',
  'A well-organized case file — chronological, labeled, with a one-page summary — makes a judge\'s job easier and your case stronger.',
  'Emails and text messages acknowledging the debt or promising payment are admissible as evidence in NY courts.',
  'Service by "nail and mail" (leaving at the address and mailing a copy) is allowed after two failed personal attempts.',
  'A judgment lien on real property in New York lasts 10 years and can be renewed for another 10.',
  'If the debtor files for bankruptcy, an automatic stay immediately halts all collection efforts — consult an attorney.',
  'Invoices with clear payment terms and due dates are significantly easier to collect on than vague billing statements.',
  'The longer you wait to pursue a debt, the harder it becomes — witnesses forget, documents get lost, businesses dissolve.',
  'Sending a final notice via both email and certified mail doubles your documentation of pre-filing efforts.',
  'A signed scope of work or proposal can substitute for a formal written contract in many NY court actions.',
];

export function RotatingFact({
  label,
  sublabel,
  startedAt,
  estimatedSeconds,
}: {
  label: string;
  sublabel?: string;
  startedAt?: Date;
  estimatedSeconds?: number;
}) {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * LOADING_FACTS.length));
  const [visible, setVisible] = useState(true);
  const [elapsed, setElapsed] = useState(() =>
    startedAt ? Math.floor((Date.now() - startedAt.getTime()) / 1000) : 0
  );

  React.useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx(i => {
          let next = Math.floor(Math.random() * LOADING_FACTS.length);
          if (next === i) next = (i + 1) % LOADING_FACTS.length;
          return next;
        });
        setVisible(true);
      }, 500);
    }, 5500);
    return () => clearInterval(interval);
  }, []);

  React.useEffect(() => {
    if (!startedAt) return;
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const fmtElapsed = (s: number) =>
    s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;

  const progress = estimatedSeconds ? Math.min(95, (elapsed / estimatedSeconds) * 100) : null;

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 mb-4">
        <Loader2 className="w-5 h-5 text-blue-500 animate-spin shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800">{label}</div>
          {startedAt && (
            <div className="text-xs text-slate-400 mt-0.5 tabular-nums">
              {fmtElapsed(elapsed)} elapsed
              {estimatedSeconds && elapsed < estimatedSeconds
                ? ` · ~${Math.max(0, estimatedSeconds - elapsed)}s remaining`
                : estimatedSeconds && elapsed >= estimatedSeconds
                ? ' · almost done…'
                : ''}
            </div>
          )}
          {!startedAt && sublabel && <div className="text-xs text-slate-400 mt-0.5">{sublabel}</div>}
        </div>
      </div>
      {progress !== null && (
        <div className="w-full bg-slate-100 rounded-full h-1 mb-4">
          <div
            className="bg-blue-500 h-1 rounded-full transition-all duration-1000"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      <p
        className="text-xs text-slate-400 italic leading-relaxed transition-opacity duration-500 pt-2 border-t border-slate-100"
        style={{ opacity: visible ? 1 : 0 }}
      >
        Did you know? {LOADING_FACTS[idx]}
      </p>
    </div>
  );
}
