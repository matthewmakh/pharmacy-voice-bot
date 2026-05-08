export type CaseStatus =
  | 'DRAFT'
  | 'ASSEMBLING'
  | 'ANALYZING'
  | 'STRATEGY_PENDING'
  | 'STRATEGY_SELECTED'
  | 'GENERATING'
  | 'READY'
  | 'SENT'
  | 'AWAITING_RESPONSE'
  | 'ESCALATING'
  | 'RESOLVED'
  | 'CLOSED';

export type Strategy = 'QUICK_ESCALATION' | 'STANDARD_RECOVERY' | 'GRADUAL_APPROACH';

export type ActionType =
  | 'CASE_CREATED'
  | 'CASE_UPDATED'
  | 'DOCUMENTS_UPLOADED'
  | 'AI_ANALYSIS_COMPLETED'
  | 'STRATEGY_SELECTED'
  | 'DEMAND_LETTER_GENERATED'
  | 'FINAL_NOTICE_GENERATED'
  | 'FILING_PACKET_GENERATED'
  | 'COURT_FORM_GENERATED'
  | 'DEFAULT_JUDGMENT_GENERATED'
  | 'EMAIL_SENT'
  | 'CERTIFIED_MAIL_SENT'
  | 'REMINDER_SENT'
  | 'FINAL_NOTICE_SENT'
  | 'LAWYER_REVIEW_REQUESTED'
  | 'FILING_PREPARED'
  | 'SERVICE_INITIATED'
  | 'PAYMENT_RECEIVED'
  | 'CASE_CLOSED'
  | 'DEMAND_LETTER_MAILED'
  | 'DEMAND_LETTER_DELIVERED'
  | 'EMAIL_OPENED'
  | 'EMAIL_CLICKED'
  | 'SETTLEMENT_SENT_FOR_SIGNATURE'
  | 'SETTLEMENT_SIGNED'
  | 'PAYMENT_PLAN_SENT_FOR_SIGNATURE'
  | 'PAYMENT_PLAN_SIGNED'
  | 'PORTAL_VIEWED'
  | 'PAYMENT_VIA_PORTAL'
  | 'DISPUTE_FILED'
  | 'PAYMENT_PLAN_PROPOSED'
  | 'FOLLOW_UP_SENT'
  | 'ATTORNEY_HANDOFF_INITIATED';

export interface Document {
  id: string;
  caseId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  classification: string | null;
  extractedText: string | null;
  extractedFacts: Record<string, unknown> | null;
  supportsTags: string[];
  confidence: number | null;
  summary: string | null;
  uploadedAt: string;
}

export interface CaseAction {
  id: string;
  caseId: string;
  type: ActionType;
  status: string;
  label: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface MissingInfoItem {
  item: string;
  consequence: string;
  impact: 'high' | 'medium' | 'low';
  workaround?: string;
}

export interface DocumentVerification {
  overallStatus: 'verified' | 'review_needed' | 'issues_found';
  checks: Array<{
    field: string;
    status: 'ok' | 'missing' | 'mismatch' | 'hallucinated';
    expected: string | null;
    found: string | null;
    note: string;
  }>;
  summary: string;
  blankFields: string[];
  verifiedAt: string;
  didRetry?: boolean;
  generationFailed?: boolean;
}

export interface CaseAssessment {
  primaryCauseOfAction: {
    theory: 'breach_of_written_contract' | 'breach_of_oral_contract' | 'account_stated' | 'quantum_meruit';
    reasoning: string;
    elements: Array<{
      element: string;
      satisfied: boolean;
      evidence: string | null;
      gap: string | null;
    }>;
  };
  alternativeCauses: string[];
  counterclaimRisk: {
    level: 'low' | 'medium' | 'high';
    reasoning: string;
    signals: string[];
  };
  debtorEntityNotes: string | null;
  recommendedStrategy: 'QUICK_ESCALATION' | 'STANDARD_RECOVERY' | 'GRADUAL_APPROACH';
  strategyReasoning: string;
}

export interface Case {
  id: string;
  status: CaseStatus;
  strategy: Strategy | null;
  title: string | null;

  claimantName: string | null;
  claimantBusiness: string | null;
  claimantAddress: string | null;
  claimantEmail: string | null;
  claimantPhone: string | null;

  debtorName: string | null;
  debtorBusiness: string | null;
  debtorAddress: string | null;
  debtorEmail: string | null;
  debtorPhone: string | null;
  debtorEntityType: string | null;

  amountOwed: string | null;
  amountPaid: string | null;
  serviceDescription: string | null;
  agreementDate: string | null;
  serviceStartDate: string | null;
  serviceEndDate: string | null;
  invoiceDate: string | null;
  paymentDueDate: string | null;
  hasWrittenContract: boolean;
  invoiceNumber: string | null;
  industry: string | null;
  notes: string | null;

  extractedFacts: Record<string, unknown> | null;
  caseTimeline: Array<{ date: string; event: string; source?: string }> | null;
  evidenceSummary: Record<string, unknown> | null;
  missingInfo: Array<MissingInfoItem | string> | null;
  caseStrength: string | null;
  caseAssessment: CaseAssessment | null;

  caseSummary: string | null;
  demandLetter: string | null;
  demandLetterHtml: string | null;
  finalNotice: string | null;
  finalNoticeHtml: string | null;
  filingPacket: string | null;
  filingPacketHtml: string | null;
  courtFormType: string | null;
  courtFormInstructions: string[] | null;
  courtFormVerification:       DocumentVerification | null;
  demandLetterVerification:    DocumentVerification | null;
  caseAnalysisVerification:    DocumentVerification | null;
  defaultJudgmentVerification: DocumentVerification | null;
  settlementVerification:      DocumentVerification | null;
  paymentPlanVerification:     DocumentVerification | null;
  defaultJudgment: string | null;
  defaultJudgmentHtml: string | null;

  // Debtor research (persisted to DB so they survive refresh)
  acrisResult: Record<string, unknown> | null;
  courtHistory: Record<string, unknown> | null;
  entityResult: Record<string, unknown> | null;
  uccResult: Record<string, unknown> | null;
  ecbResult: Record<string, unknown> | null;
  pacerResult: Record<string, unknown> | null;

  // Additional pre-trial documents
  affidavitOfServiceHtml: string | null;
  settlementHtml: string | null;
  paymentPlanHtml: string | null;

  // Phase A — send / sign / collect tracking
  demandLetterMailedAt: string | null;
  demandLetterMailId: string | null;
  demandLetterTracking: string | null;
  demandLetterDeliveredAt: string | null;
  demandLetterEmailedAt: string | null;
  demandLetterEmailId: string | null;
  demandLetterEmailOpenedAt: string | null;
  finalNoticeMailedAt: string | null;
  finalNoticeTracking: string | null;
  finalNoticeDeliveredAt: string | null;
  finalNoticeEmailedAt: string | null;
  settlementSignatureRequestId: string | null;
  settlementSignedAt: string | null;
  settlementSignedPdfUrl: string | null;
  paymentPlanSignatureRequestId: string | null;
  paymentPlanSignedAt: string | null;
  paymentPlanSignedPdfUrl: string | null;
  amountCollectedCents: number | null;
  reclaimFeeCents: number | null;
  payoutToClaimantCents: number | null;
  payoutCompletedAt: string | null;
  portalToken: string | null;
  portalTokenExpiresAt: string | null;
  portalLastViewedAt: string | null;
  defendantDisputeText: string | null;
  defendantProposedPlan: Record<string, unknown> | null;

  // Phase B — filing tracking
  defaultJudgmentFiledAt: string | null;
  defaultJudgmentFilingMethod: 'diy' | 'infotrack' | 'attorney' | 'manual' | null;
  defaultJudgmentIndexNumber: string | null;

  // Phase B — DIY filing walkthrough state
  walkthroughType: 'nyscef' | 'edds' | 'commercial-claims' | null;
  walkthroughPurpose: 'complaint' | 'default-judgment' | null;
  walkthroughStep: number;
  walkthroughStartedAt: string | null;
  walkthroughCompletedAt: string | null;
  walkthroughNotes: Record<string, string> | null;

  // Phase B — SCRA non-military affidavit
  scraAffidavitHtml: string | null;
  scraVerifiedAt: string | null;
  scraCertificateNumber: string | null;

  // Phase B — Post-judgment doc drafts (handoff package)
  informationSubpoenaHtml: string | null;
  restrainingNoticeHtml: string | null;
  propertyExecutionHtml: string | null;
  incomeExecutionHtml: string | null;
  marshalRequestHtml: string | null;

  // Phase B — InfoTrack tracking
  infoTrackOrderId: string | null;
  infoTrackStatus: 'submitted' | 'accepted' | 'rejected' | 'filed' | null;
  infoTrackPurpose: 'complaint' | 'default-judgment' | null;
  infoTrackPlatform: 'nyscef' | 'edds' | null;
  infoTrackFilingFeeCents: number | null;
  infoTrackServiceFeeCents: number | null;
  infoTrackAcceptedAt: string | null;
  infoTrackIndexNumber: string | null;
  infoTrackRejectionReason: string | null;

  // Phase B — Proof.com tracking
  notarizationId: string | null;
  notarizationStatus: 'pending' | 'in-session' | 'completed' | 'failed' | null;
  notarizedPdfUrl: string | null;
  notarizedAt: string | null;
  processServeJobId: string | null;
  processServeStatus: 'pending' | 'attempted' | 'served' | 'unsuccessful' | null;
  processServeAffidavitUrl: string | null;
  processServedAt: string | null;

  // Phase B — Attorney handoff
  attorneyPartnerId: string | null;
  attorneyHandoffStatus: 'pending' | 'accepted' | 'declined' | 'in-progress' | 'resolved' | 'lost' | null;
  attorneyHandoffInitiatedAt: string | null;
  attorneyHandoffAcceptedAt: string | null;
  attorneyHandoffResolvedAt: string | null;
  attorneyHandoffToken: string | null;
  attorneyHandoffNotes: string | null;
  attorneyHandoffOutcome: string | null;
  attorneyHandoffSettlementCents: number | null;
  referralFeeCents: number | null;

  documents: Document[];
  actions: CaseAction[];

  createdAt: string;
  updatedAt: string;
}

export type CaseListItem = Case & {
  documents: Pick<Document, 'id' | 'originalName' | 'classification'>[];
  actions: Pick<CaseAction, 'id' | 'type' | 'label' | 'createdAt'>[];
};

export interface CreateCaseInput {
  title?: string;
  claimantName?: string;
  claimantBusiness?: string;
  claimantAddress?: string;
  claimantEmail?: string;
  claimantPhone?: string;
  debtorName?: string;
  debtorBusiness?: string;
  debtorAddress?: string;
  debtorEmail?: string;
  debtorPhone?: string;
  debtorEntityType?: string;
  amountOwed?: number;
  amountPaid?: number;
  serviceDescription?: string;
  agreementDate?: string;
  serviceStartDate?: string;
  serviceEndDate?: string;
  invoiceDate?: string;
  paymentDueDate?: string;
  hasWrittenContract?: boolean;
  invoiceNumber?: string;
  industry?: string;
  notes?: string;
}
