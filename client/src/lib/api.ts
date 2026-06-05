import axios from 'axios';
import type { Case, CaseListItem, CreateCaseInput, Document, IntakeAutofillResult, IntakeFieldName, Strategy } from '../types';

export interface ProposedFieldUpdate {
  field: IntakeFieldName;
  value: string | number | boolean | null;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}
export interface ApplyAnswersResult {
  updates: ProposedFieldUpdate[];
  notes: string;
}

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

// On an expired/invalid session, log the user out cleanly instead of surfacing a
// generic "failed to load" error. AuthContext listens for this event.
api.interceptors.response.use(
  (resp) => resp,
  (error) => {
    if (error?.response?.status === 401) {
      window.dispatchEvent(new Event('auth:unauthorized'));
    }
    return Promise.reject(error);
  },
);

/** Pull a human-readable message out of an Axios error (or anything). */
export function getErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  return e?.response?.data?.error || e?.message || fallback;
}

// ─── Cases ────────────────────────────────────────────────────────────────────

export const getCases = async (limit = 50, offset = 0): Promise<CaseListItem[]> => {
  const { data } = await api.get('/cases', { params: { limit, offset } });
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

export const createDraftCase = async (): Promise<Case> => {
  const { data } = await api.post('/cases/draft');
  return data;
};

export const autofillFromDocuments = async (caseId: string): Promise<IntakeAutofillResult> => {
  const { data } = await api.post(`/cases/${caseId}/autofill`, undefined, { timeout: 180000 });
  return data;
};

export const applyIntakeAnswers = async (
  caseId: string,
  currentFields: Record<string, unknown>,
  answers: Array<{ question: string; answer: string; field: string | null }>,
): Promise<ApplyAnswersResult> => {
  const { data } = await api.post(`/cases/${caseId}/apply-answers`, { currentFields, answers }, { timeout: 120000 });
  return data;
};

export const submitDraftCase = async (caseId: string, input: CreateCaseInput): Promise<Case> => {
  const { data } = await api.post(`/cases/${caseId}/submit-draft`, input);
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

export const reanalyzeDocument = async (caseId: string, docId: string): Promise<Document> => {
  const { data } = await api.post(`/cases/${caseId}/documents/${docId}/reanalyze`);
  return data;
};

// File access goes through the authenticated axios instance (Authorization header)
// and is handed to the browser as a short-lived blob URL — the auth token never
// appears in a URL, browser history, or referrer header.
async function fetchBlobUrl(path: string): Promise<string> {
  const { data } = await api.get(path, { responseType: 'blob' });
  return URL.createObjectURL(data as Blob);
}

/** Object URL for previewing an uploaded document inline. Caller should revoke it. */
export const getDocumentBlobUrl = (caseId: string, docId: string): Promise<string> =>
  fetchBlobUrl(`/cases/${caseId}/documents/${docId}/view`);

/** Download an uploaded document to disk. */
export const downloadDocument = async (caseId: string, docId: string, filename: string): Promise<void> => {
  const url = await fetchBlobUrl(`/cases/${caseId}/documents/${docId}/download`);
  triggerDownload(url, filename);
};

// ─── Organizations / team ─────────────────────────────────────────────────────

export type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export interface OrgSummary { id: string; name: string; role: OrgRole; memberCount: number }
export interface OrgMember { userId: string; name: string | null; email: string; role: OrgRole; joinedAt?: string }

export const getOrgs = async (): Promise<OrgSummary[]> => (await api.get('/orgs')).data;
export const getOrgMembers = async (orgId: string): Promise<OrgMember[]> => (await api.get(`/orgs/${orgId}/members`)).data;
export const inviteMember = async (orgId: string, email: string): Promise<OrgMember> => (await api.post(`/orgs/${orgId}/invite`, { email })).data;
export const removeMember = async (orgId: string, userId: string): Promise<void> => { await api.delete(`/orgs/${orgId}/members/${userId}`); };
export const renameOrg = async (orgId: string, name: string): Promise<{ id: string; name: string }> => (await api.patch(`/orgs/${orgId}`, { name })).data;

export type LookupKey = 'acris' | 'courts' | 'entity' | 'ucc' | 'ecb' | 'pacer';

/** Trigger a debtor-research lookup. It runs in the background and persists to the case. */
export const triggerLookup = async (caseId: string, key: LookupKey): Promise<{ status: string }> => {
  const { data } = await api.post(`/cases/${caseId}/lookups/${key}`);
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

export type PdfType = 'demand-letter' | 'final-notice' | 'court-form' | 'default-judgment' | 'affidavit-of-service' | 'settlement' | 'payment-plan';

/** Download a server-generated PDF (authenticated via header, not a query-string token). */
export const downloadPdf = async (caseId: string, type: PdfType, filename: string): Promise<void> => {
  const url = await fetchBlobUrl(`/cases/${caseId}/${type}-pdf`);
  triggerDownload(url, filename);
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

// ─── Phase B: InfoTrack paid e-filing ────────────────────────────────────────

export const fileViaInfoTrack = async (
  caseId: string,
  purpose: 'complaint' | 'default-judgment',
): Promise<{
  case: Case;
  filingFeeUsd: number;
  reclaimFeeUsd: number;
  totalUsd: number;
}> => {
  const { data } = await api.post(`/cases/${caseId}/file-via-infotrack`, { purpose });
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

function triggerDownload(objectUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
