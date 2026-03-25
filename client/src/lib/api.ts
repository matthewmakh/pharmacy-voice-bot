import axios from 'axios';
import type { Case, CaseListItem, CreateCaseInput, Strategy } from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 120000, // 2 min timeout for AI operations
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
    timeout: 300000, // 5 min for upload + analysis
  });
};

export const deleteDocument = async (caseId: string, docId: string): Promise<void> => {
  await api.delete(`/cases/${caseId}/documents/${docId}`);
};
