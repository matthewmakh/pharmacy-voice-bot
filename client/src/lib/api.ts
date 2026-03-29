import axios from 'axios';
import type { Case, CaseListItem, CreateCaseInput, Strategy } from '../types';

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
