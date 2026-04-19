export interface AcrisResult {
  found: boolean; totalRecords: number; asGrantee: number; asGrantor: number;
  searchedName: string; note: string; error?: string;
}

export interface CourtHistoryResult {
  found: boolean; totalCases: number; asDefendant: number; asPlaintiff: number;
  cases: Array<{ caseIndex: string; filedDate: string | null; plaintiff: string; defendant: string; caseType: string; status: string; court: string; amount: string | null }>;
  searchedName: string; note: string; error?: string; scraperNote?: string;
}

export interface NysEntityResult {
  found: boolean;
  totalRecords: number;
  entities: Array<{
    dosId: string; entityName: string; entityType: string; status: string;
    jurisdiction: string | null; county: string | null; formationDate: string | null;
    contacts: Array<{ name: string; role: string; address: string | null }>;
    registeredAgent: string | null; registeredAgentAddress: string | null;
    dosProcessAddress: string | null;
  }>;
  searchedName: string; note: string; error?: string;
}

export interface UccResult {
  found: boolean; totalFilings: number; activeFilings: number;
  filings: Array<{
    fileNumber: string; fileType: string; filingDate: string | null; lapseDate: string | null;
    status: 'Active' | 'Lapsed' | 'Unknown'; debtorName: string; debtorAddress: string | null;
    securedParty: string; securedPartyAddress: string | null; collateral: string | null;
  }>;
  searchedName: string; note: string; error?: string; scraperNote?: string;
}

export interface EcbResult {
  found: boolean; totalViolations: number; totalImposed: number; totalOutstanding: number;
  unpaidViolations: number;
  violations: Array<{
    respondentName: string; issueDate: string | null; violationType: string;
    hearingStatus: string; imposedAmount: number | null; outstandingAmount: number | null;
    borough: string | null;
  }>;
  searchedName: string; note: string; error?: string;
}

export interface PacerResult {
  found: boolean; totalCases: number; activeCases: number;
  cases: Array<{
    caseNumber: string; chapter: string; status: string; court: string; courtCode: string;
    dateFiled: string | null; dateClosed: string | null; dateDischarge: string | null;
    debtor: string; trustee: string | null; hasAssets: boolean | null;
    meetingOfCreditors: string | null; proofOfClaimDeadline: string | null;
    automaticStayActive: boolean; actionRequired: string;
  }>;
  searchedName: string; note: string; error?: string; scraperNote?: string;
}
