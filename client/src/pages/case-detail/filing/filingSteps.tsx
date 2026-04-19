import type React from 'react';
import Alert from '../../../components/ui/Alert';

export type CourtTrack = 'commercial' | 'civil' | 'supreme';

export interface StepItem {
  label: string;
  body: React.ReactNode;
}

const p = (text: string) => <p className="text-sm text-slate-600 leading-relaxed">{text}</p>;
const sub = (text: string) => <p className="text-xs text-slate-500 leading-relaxed">{text}</p>;

export function buildSteps(track: CourtTrack, hasDemand: boolean): StepItem[] {
  if (track === 'commercial') {
    return [
      {
        label: 'Send a pre-suit demand letter (required)',
        body: <>
          {p('For Commercial Claims, New York requires you to send a demand letter at least 10 days — and no more than 180 days — before filing. This is a real precondition, not optional.')}
          {hasDemand
            ? <Alert tone="success">Demand letter generated in this case. Keep proof of delivery.</Alert>
            : <Alert tone="warning">No demand letter yet. Generate one in the Demand Letter tab before filing.</Alert>}
          {sub('Keep proof of sending: certified mail receipt, delivery confirmation, or email with read receipt.')}
        </>,
      },
      {
        label: "Verify the defendant's exact legal name and address",
        body: p('Commercial Claims must be brought in the county where the defendant lives, works, or has a place of business. If you are unsure of the correct business name, check NYS entity records or County Clerk records for assumed names.'),
      },
      {
        label: 'Go to the Commercial Claims office in the correct county',
        body: <>
          {p('Bring: your company information, the defendant\'s exact legal name and address, amount owed, a short description of the claim, and proof you sent the demand letter.')}
          {sub('Filing cap: you may begin no more than 5 Commercial Claims actions per month.')}
        </>,
      },
      {
        label: 'Fill out the Statement of Claim and pay the filing fee',
        body: p('The fee is $25 plus postage. Staff will assist with the form. The court handles notice to the defendant under the Commercial Claims process — you do not need to hire a process server.'),
      },
      {
        label: 'Attend the hearing',
        body: p('Bring originals and copies of all evidence. Present clearly and factually. If the defendant does not appear after proper notice, you can request a default judgment.'),
      },
    ];
  }

  if (track === 'civil') {
    return [
      {
        label: 'Send a demand letter and document it',
        body: <>
          {p('While not a strict statutory precondition for Civil Court (unlike Commercial Claims), courts and opposing parties expect to see a pre-suit demand. It also strengthens your position.')}
          {hasDemand
            ? <Alert tone="success">Demand letter generated. Keep proof of delivery.</Alert>
            : <Alert tone="warning">No demand letter yet — generate one in the Demand Letter tab.</Alert>}
        </>,
      },
      {
        label: 'Prepare your Summons and Complaint',
        body: <>
          {p('Draft a summons and complaint that clearly states: who the parties are, what was agreed, what you provided, how much is owed, when payment was due, and what relief you want.')}
          {p('For a B2B unpaid invoice, common causes of action include breach of contract, account stated, and unjust enrichment / quantum meruit if there is no signed contract.')}
        </>,
      },
      {
        label: 'File with the NYC Civil Court clerk',
        body: <>
          {p('File in the borough/county where the defendant is located. Bring 3 copies. Pay the ~$45 fee. The clerk stamps your copies and issues the summons.')}
          {sub('If self-represented, ask the clerk for an Application for a Pro Se Summons, or use your own summons form.')}
        </>,
      },
      {
        label: 'Serve the defendant via process server (within 120 days)',
        body: <>
          {p('Hire a licensed process server to deliver the summons and complaint. The server must physically hand it to the defendant or leave it at their place of business per NY service rules.')}
          {p('Get a notarized Affidavit of Service from the process server immediately after service.')}
        </>,
      },
      {
        label: 'File the Affidavit of Service',
        body: p('File the completed, notarized affidavit with the court clerk promptly after service. This is required — do not skip it.'),
      },
      {
        label: "Calendar the defendant's response deadline",
        body: <>
          {p('The defendant generally has 20 days to respond after personal service, or 30 days after service is completed by other authorized means. Mark this date immediately.')}
          {p('If they do not respond, you can move for a default judgment. If they respond, the case proceeds to discovery and a hearing/trial date.')}
        </>,
      },
    ];
  }

  // Supreme Court
  return [
    {
      label: 'Retain a NY-licensed attorney',
      body: p('Supreme Court filings are complex. While self-representation is technically allowed, it is not recommended for claims of this size. An attorney will draft the papers, manage deadlines, and handle discovery.'),
    },
    {
      label: 'Draft a Summons and Complaint (or Summons with Notice)',
      body: <>
        {p('Your attorney will prepare either a Summons and Complaint or a Summons with Notice. The complaint should plead: parties, the agreement, your performance, the unpaid amount, the due date, non-payment, and the relief requested.')}
        {p('Causes of action for B2B unpaid invoices typically include breach of contract, account stated, and quantum meruit / unjust enrichment.')}
      </>,
    },
    {
      label: 'Purchase an index number and e-file via NYSCEF',
      body: <>
        {p('File with the County Clerk in the county where the defendant does business. Pay the $210 index number fee.')}
        <Alert tone="warning" title="Mandatory e-filing">
          In Manhattan and all NYC Supreme Courts, e-filing via NYSCEF is mandatory for represented parties. Pro se filers are exempt unless they opt in.
        </Alert>
        {sub('NYSCEF steps: register, purchase index number, upload PDF/A-compliant document, serve via NYSCEF or traditional service, file RJI within 60 days to get a judge assigned.')}
        {sub('PDF requirements for NYSCEF: text-searchable, not password-protected, no JavaScript, flattened layers, PDF/A format preferred.')}
      </>,
    },
    {
      label: 'Serve the defendant within 120 days',
      body: p("A summons with notice or summons and complaint must be served within 120 days of filing. Use a licensed process server. Personal service on the defendant's registered agent or an officer of the entity is standard for business defendants."),
    },
    {
      label: 'File the notarized Affidavit of Service',
      body: p('File the completed affidavit promptly after service. Calendar the answer deadline (20 days after personal service, 30 days after alternative service). Set a tickler for the default date.'),
    },
    {
      label: 'Discovery phase',
      body: p('If the defendant answers, the case proceeds to discovery: document requests, interrogatories, and potentially depositions. A preliminary conference is usually scheduled by the court.'),
    },
  ];
}
