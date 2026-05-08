import axios from 'axios';
import type { Case, CaseListItem, CreateCaseInput, Strategy } from '../types';

export interface StrategyAssessment {
  strategy: 'QUICK_ESCALATION' | 'STANDARD_RECOVERY' | 'GRADUAL_APPROACH';
  reasoning: string;
  keyFactors: string[];
}

const api = axios.create({
  baseURL: '/api',
  timeout: 120000,
});

// Inject auth token from localStorage on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ─── Cases ────────────────────────────────────────────────────────────────────

export const getCases = async (): Promise<CaseListItem[]> => {
  const { data } = await api.get('/cases');
  return data;
};

export const getCase = async (id: string): Promise<Case> => {
  const { data } = await api.get(`/cases/${id}`);
  return data;
};

export const createCase = async (input: CreateCaseInput): Promise<Case> => {
  const { data } = await api.post('/cases', input);
  return data;
};

export const updateCase = async (id: string, input: Partial<CreateCaseInput>): Promise<Case> => {
  const { data } = await api.patch(`/cases/${id}`, input);
  return data;
};

export const deleteCase = async (id: string): Promise<void> => {
  await api.delete(`/cases/${id}`);
};

export const analyzeCase = async (id: string): Promise<Case> => {
  const { data } = await api.post(`/cases/${id}/analyze`);
  return data;
};

export const setStrategy = async (id: string, strategy: Strategy): Promise<Case> => {
  const { data } = await api.post(`/cases/${id}/strategy`, { strategy });
  return data;
};

export const generateLetter = async (id: string): Promise<Case> => {
  const { data } = await api.post(`/cases/${id}/generate`);
  return data;
};

export const resetAnalysis = async (id: string): Promise<Case> => {
  const { data } = await api.post(`/cases/${id}/reset-analysis`);
  return data;
};

export const generateFinalNotice = async (id: string): Promise<Case> => {
  const { data } = await api.post(`/cases/${id}/final-notice`);
  return data;
};

export const generateCourtForm = async (id: string): Promise<Case> => {
  const { data } = await api.post(`/cases/${id}/court-form`);
  return data;
};

export const generateDefaultJudgment = async (id: string): Promise<Case> => {
  const { data } = await api.post(`/cases/${id}/default-judgment`);
  return data;
};

export const logAction = async (
  id: string,
  type: string,
  notes?: string,
  metadata?: Record<string, unknown>
): Promise<void> => {
  await api.post(`/cases/${id}/actions`, { type, notes, metadata });
};

// ─── Documents ────────────────────────────────────────────────────────────────

export const uploadDocuments = async (caseId: string, files: File[]): Promise<void> => {
  const formData = new FormData();
  files.forEach((f) => formData.append('files', f));
  await api.post(`/cases/${caseId}/documents`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  });
};

export const deleteDocument = async (caseId: string, docId: string): Promise<void> => {
  await api.delete(`/cases/${caseId}/documents/${docId}`);
};

export const getDocumentViewUrl = (caseId: string, docId: string): string => {
  const token = localStorage.getItem('token');
  return `/api/cases/${caseId}/documents/${docId}/view?token=${token}`;
};

export const lookupCourtHistory = async (caseId: string): Promise<{
  found: boolean;
  totalCases: number;
  asDefendant: number;
  asPlaintiff: number;
  cases: Array<{
    caseIndex: string;
    filedDate: string | null;
    plaintiff: string;
    defendant: string;
    caseType: string;
    status: string;
    court: string;
    amount: string | null;
  }>;
  searchedName: string;
  note: string;
  error?: string;
  scraperNote?: string;
}> => {
  const { data } = await api.get(`/cases/${caseId}/court-history`);
  return data;
};

export const lookupNYSEntity = async (caseId: string): Promise<{
  found: boolean;
  totalRecords: number;
  entities: Array<{
    dosId: string;
    entityName: string;
    entityType: string;
    status: string;
    jurisdiction: string | null;
    county: string | null;
    formationDate: string | null;
    contacts: Array<{ name: string; role: string; address: string | null }>;
    registeredAgent: string | null;
    registeredAgentAddress: string | null;
    dosProcessAddress: string | null;
  }>;
  searchedName: string;
  note: string;
  error?: string;
}> => {
  const { data } = await api.get(`/cases/${caseId}/nys-entity`);
  return data;
};

export const lookupUCCFilings = async (caseId: string): Promise<{
  found: boolean;
  totalFilings: number;
  activeFilings: number;
  filings: Array<{
    fileNumber: string;
    fileType: string;
    filingDate: string | null;
    lapseDate: string | null;
    status: 'Active' | 'Lapsed' | 'Unknown';
    debtorName: string;
    debtorAddress: string | null;
    securedParty: string;
    securedPartyAddress: string | null;
    collateral: string | null;
  }>;
  searchedName: string;
  note: string;
  error?: string;
  scraperNote?: string;
}> => {
  const { data } = await api.get(`/cases/${caseId}/ucc-filings`);
  return data;
};

export const lookupACRIS = async (caseId: string): Promise<{
  found: boolean;
  totalRecords: number;
  asGrantee: number;
  asGrantor: number;
  searchedName: string;
  note: string;
  error?: string;
}> => {
  const { data } = await api.get(`/cases/${caseId}/acris`);
  return data;
};

export const lookupPACERBankruptcy = async (caseId: string): Promise<{
  found: boolean;
  totalCases: number;
  activeCases: number;
  cases: Array<{
    caseNumber: string;
    chapter: string;
    status: string;
    court: string;
    courtCode: string;
    dateFiled: string | null;
    dateClosed: string | null;
    dateDischarge: string | null;
    debtor: string;
    trustee: string | null;
    hasAssets: boolean | null;
    meetingOfCreditors: string | null;
    proofOfClaimDeadline: string | null;
    automaticStayActive: boolean;
    actionRequired: string;
  }>;
  searchedName: string;
  note: string;
  error?: string;
  scraperNote?: string;
}> => {
  const { data } = await api.get(`/cases/${caseId}/pacer-bankruptcy`);
  return data;
};

// ─── New routes ───────────────────────────────────────────────────────────────

export const assessStrategy = async (caseId: string): Promise<StrategyAssessment> => {
  const { data } = await api.post(`/cases/${caseId}/assess-strategy`);
  return data;
};

export const generateAffidavitOfService = async (caseId: string): Promise<Case> => {
  const { data } = await api.post(`/cases/${caseId}/generate-affidavit-of-service`);
  return data;
};

export const generateSettlement = async (caseId: string): Promise<Case> => {
  const { data } = await api.post(`/cases/${caseId}/generate-settlement`);
  return data;
};

export const generatePaymentPlan = async (caseId: string): Promise<Case> => {
  const { data } = await api.post(`/cases/${caseId}/generate-payment-plan`);
  return data;
};

/** Returns the URL for a PDF download (authenticated via token in query string) */
export const getPdfDownloadUrl = (caseId: string, type: 'demand-letter' | 'final-notice' | 'court-form' | 'default-judgment' | 'affidavit-of-service' | 'settlement' | 'payment-plan'): string => {
  const token = localStorage.getItem('token');
  return `/api/cases/${caseId}/${type}-pdf?token=${token}`;
};

// ─── Phase A: Send / Sign / Collect ──────────────────────────────────────────

export type SendChannel = 'mail' | 'email';

export const sendDemandLetter = async (
  caseId: string,
  channels: SendChannel[],
): Promise<{ case: Case; results: Record<string, unknown> }> => {
  const { data } = await api.post(`/cases/${caseId}/send-demand-letter`, { channels });
  return data;
};

export const sendForSignature = async (
  caseId: string,
  kind: 'settlement' | 'payment-plan',
): Promise<{ case: Case; signatureRequestId: string }> => {
  const { data } = await api.post(`/cases/${caseId}/send-for-signature`, { kind });
  return data;
};

export const generatePortalToken = async (
  caseId: string,
): Promise<{ token: string; url: string; expiresAt: string }> => {
  const { data } = await api.post(`/cases/${caseId}/portal-token`);
  return data;
};

export interface PayoutStatus {
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

export const getPayoutStatus = async (): Promise<PayoutStatus> => {
  const { data } = await api.get(`/payouts/status`);
  return data;
};

export const startStripeOnboarding = async (): Promise<{
  accountId: string;
  onboardingUrl: string;
}> => {
  const { data } = await api.post(`/payouts/onboarding`);
  return data;
};

export const sendFinalNotice = async (
  caseId: string,
  channels: SendChannel[],
): Promise<{ case: Case; results: Record<string, unknown> }> => {
  const { data } = await api.post(`/cases/${caseId}/send-final-notice`, { channels });
  return data;
};

export const releasePayout = async (caseId: string): Promise<{
  case: Case;
  transferId: string;
  feeCents: number;
  payoutCents: number;
}> => {
  const { data } = await api.post(`/cases/${caseId}/release-payout`);
  return data;
};

export type FilingMethod = 'diy' | 'infotrack' | 'attorney' | 'manual';

export const markDefaultJudgmentFiled = async (
  caseId: string,
  payload: { method: FilingMethod; indexNumber?: string; filedAt?: string },
): Promise<{ case: Case }> => {
  const { data } = await api.post(`/cases/${caseId}/default-judgment/mark-filed`, payload);
  return data;
};

// ─── Phase B: DIY filing walkthrough ─────────────────────────────────────────

export type WalkthroughType = 'nyscef' | 'edds' | 'commercial-claims';
export type WalkthroughPurpose = 'complaint' | 'default-judgment';

export interface WalkthroughStep {
  title: string;
  body: string;
  link?: { label: string; url: string };
  needsInput?: { field: string; label: string; placeholder?: string };
  estimatedMinutes?: number;
}

export interface WalkthroughState {
  type: WalkthroughType;
  purpose: WalkthroughPurpose;
  step: number;
  notes: Record<string, string> | null;
  completedAt: string | null;
  steps: WalkthroughStep[];
}

export const startWalkthrough = async (
  caseId: string,
  type: WalkthroughType,
  purpose: WalkthroughPurpose,
): Promise<{ steps: WalkthroughStep[]; step: number }> => {
  const { data } = await api.post(`/cases/${caseId}/walkthrough/start`, { type, purpose });
  return data;
};

export const getWalkthrough = async (caseId: string): Promise<WalkthroughState> => {
  const { data } = await api.get(`/cases/${caseId}/walkthrough/steps`);
  return data;
};

export const advanceWalkthrough = async (
  caseId: string,
  step: number,
  noteKey?: string,
  noteValue?: string,
): Promise<void> => {
  await api.post(`/cases/${caseId}/walkthrough/advance`, { step, noteKey, noteValue });
};

export const completeWalkthrough = async (
  caseId: string,
  indexNumber?: string,
): Promise<{ case: Case }> => {
  const { data } = await api.post(`/cases/${caseId}/walkthrough/complete`, { indexNumber });
  return data;
};

export const abandonWalkthrough = async (caseId: string): Promise<void> => {
  await api.post(`/cases/${caseId}/walkthrough/abandon`);
};

export const generateSCRAAffidavit = async (caseId: string): Promise<Case> => {
  const { data } = await api.post(`/cases/${caseId}/scra-affidavit/generate`);
  return data;
};

export const markSCRAVerified = async (
  caseId: string,
  certificateNumber?: string,
): Promise<{ case: Case }> => {
  const { data } = await api.post(`/cases/${caseId}/scra-affidavit/mark-verified`, { certificateNumber });
  return data;
};

// ─── Phase B: Attorney handoff (creditor side) ───────────────────────────────

export interface AttorneyPartner {
  id: string;
  userId: string;
  name: string;
  firmName: string | null;
  email: string;
  phone: string | null;
  barNumber: string | null;
  state: string;
  notes: string | null;
  referralFeePercent: string;
  createdAt: string;
}

export const listAttorneyPartners = async (): Promise<AttorneyPartner[]> => {
  const { data } = await api.get(`/handoff/partners`);
  return data;
};

export const createAttorneyPartner = async (input: {
  name: string;
  firmName?: string;
  email: string;
  phone?: string;
  barNumber?: string;
  state?: string;
  notes?: string;
  referralFeePercent?: number;
}): Promise<AttorneyPartner> => {
  const { data } = await api.post(`/handoff/partners`, input);
  return data;
};

export type PostJudgmentDocKind =
  | 'information-subpoena'
  | 'restraining-notice'
  | 'property-execution'
  | 'income-execution'
  | 'marshal-request';

export const generatePostJudgmentDocs = async (
  caseId: string,
  docs: PostJudgmentDocKind[],
): Promise<{ case: Case }> => {
  const { data } = await api.post(`/handoff/cases/${caseId}/handoff/generate-docs`, { docs });
  return data;
};

export interface HandoffPackagePreview {
  caseId: string;
  summary: Record<string, unknown>;
  preTrial: Record<string, boolean>;
  postJudgmentDrafts: Record<string, boolean>;
  investigation: Record<string, boolean>;
  timeline: Array<{ type: string; label: string | null; notes: string | null; createdAt: string }>;
  documents: Array<{ id: string; name: string; classification: string | null }>;
  handoff: { status: string | null; partnerId: string | null; initiatedAt: string | null; token: string | null; notes: string | null };
}

export const getHandoffPackage = async (caseId: string): Promise<HandoffPackagePreview> => {
  const { data } = await api.get(`/handoff/cases/${caseId}/handoff/package`);
  return data;
};

export const initiateHandoff = async (
  caseId: string,
  attorneyPartnerId: string,
  notes?: string,
): Promise<{ case: Case; portalUrl: string }> => {
  const { data } = await api.post(`/handoff/cases/${caseId}/handoff/initiate`, { attorneyPartnerId, notes });
  return data;
};

// ─── Public partner-attorney portal (no auth) ───────────────────────────────

const attorneyApi = axios.create({ baseURL: '/api', timeout: 30000 });

export const getAttorneyHandoffCase = async (token: string): Promise<unknown> => {
  const { data } = await attorneyApi.get(`/attorney/${token}`);
  return data;
};

export const acceptAttorneyHandoff = async (token: string): Promise<void> => {
  await attorneyApi.post(`/attorney/${token}/accept`);
};

export const declineAttorneyHandoff = async (token: string, reason?: string): Promise<void> => {
  await attorneyApi.post(`/attorney/${token}/decline`, { reason });
};

export const reportAttorneyOutcome = async (
  token: string,
  status: 'in-progress' | 'resolved' | 'lost',
  settlementAmount?: number,
  notes?: string,
): Promise<void> => {
  await attorneyApi.post(`/attorney/${token}/report-outcome`, { status, settlementAmount, notes });
};

export const getAttorneyDocUrl = (token: string, kind: string): string =>
  `/api/attorney/${token}/doc/${kind}`;

// ─── Phase B: Proof.com (notary + process serve) ─────────────────────────────

export const requestNotarization = async (
  caseId: string,
  kind: 'scra-affidavit' | 'affidavit-of-service' | 'default-judgment',
): Promise<{ case: Case; signerUrl: string }> => {
  const { data } = await api.post(`/cases/${caseId}/notarize`, { kind });
  return data;
};

export const dispatchProcessServer = async (
  caseId: string,
  rush?: 'standard' | 'rush' | 'same-day',
  notes?: string,
): Promise<{ case: Case }> => {
  const { data } = await api.post(`/cases/${caseId}/serve-process`, { rush, notes });
  return data;
};

// ─── Public debtor portal (no auth) ──────────────────────────────────────────

const publicApi = axios.create({ baseURL: '/api', timeout: 30000 });

export interface PortalCaseView {
  id: string;
  status: string;
  claimantName: string;
  claimantBusiness: string | null;
  amountOwed: string | null;
  serviceDescription: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  paymentDueDate: string | null;
  hasWrittenContract: boolean;
  alreadyPaid: boolean;
  disputed: boolean;
  proposedPlan: unknown;
}

export const getPortalCase = async (token: string): Promise<PortalCaseView> => {
  const { data } = await publicApi.get(`/portal/${token}`);
  return data;
};

export const filePortalDispute = async (token: string, reason: string): Promise<void> => {
  await publicApi.post(`/portal/${token}/dispute`, { reason });
};

export const proposePortalPlan = async (
  token: string,
  plan: { monthlyAmount: number; numberOfPayments: number; startDate?: string; notes?: string },
): Promise<void> => {
  await publicApi.post(`/portal/${token}/propose-plan`, plan);
};

export const startPortalCheckout = async (
  token: string,
): Promise<{ sessionId: string; url: string }> => {
  const { data } = await publicApi.post(`/portal/${token}/checkout`);
  return data;
};

export const lookupECBViolations = async (caseId: string): Promise<{
  found: boolean;
  totalViolations: number;
  totalImposed: number;
  totalOutstanding: number;
  unpaidViolations: number;
  violations: Array<{
    respondentName: string;
    issueDate: string | null;
    violationType: string;
    hearingStatus: string;
    imposedAmount: number | null;
    outstandingAmount: number | null;
    borough: string | null;
  }>;
  searchedName: string;
  note: string;
  error?: string;
}> => {
  const { data } = await api.get(`/cases/${caseId}/ecb-violations`);
  return data;
};
