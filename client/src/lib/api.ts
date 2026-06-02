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

function triggerDownload(objectUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

