import type React from 'react';
import {
  FileText, Upload, Zap, CheckCircle, Send, Mail, Scale, MapPin, Pencil, Shield,
} from 'lucide-react';
import type { ActionType } from '../../../types';

export const ACTION_TYPE_OPTIONS: { value: ActionType; label: string }[] = [
  { value: 'CASE_UPDATED', label: 'Case Updated' },
  { value: 'DOCUMENTS_UPLOADED', label: 'Documents Uploaded' },
  { value: 'EMAIL_SENT', label: 'Email Sent' },
  { value: 'CERTIFIED_MAIL_SENT', label: 'Certified Mail Sent' },
  { value: 'REMINDER_SENT', label: 'Reminder Sent' },
  { value: 'FINAL_NOTICE_SENT', label: 'Final Notice Sent' },
  { value: 'LAWYER_REVIEW_REQUESTED', label: 'Lawyer Review Requested' },
  { value: 'FILING_PREPARED', label: 'Filing Prepared' },
  { value: 'SERVICE_INITIATED', label: 'Service Initiated' },
  { value: 'PAYMENT_RECEIVED', label: 'Payment Received' },
  { value: 'CASE_CLOSED', label: 'Case Closed' },
];

export const ACTION_ICONS: Partial<Record<ActionType, React.ElementType>> = {
  CASE_CREATED: FileText,
  CASE_UPDATED: Pencil,
  DOCUMENTS_UPLOADED: Upload,
  AI_ANALYSIS_COMPLETED: Zap,
  STRATEGY_SELECTED: Zap,
  DEMAND_LETTER_GENERATED: FileText,
  FINAL_NOTICE_GENERATED: Shield,
  FILING_PACKET_GENERATED: FileText,
  COURT_FORM_GENERATED: Scale,
  DEFAULT_JUDGMENT_GENERATED: Scale,
  EMAIL_SENT: Mail,
  CERTIFIED_MAIL_SENT: Send,
  REMINDER_SENT: Send,
  FINAL_NOTICE_SENT: Shield,
  LAWYER_REVIEW_REQUESTED: Scale,
  FILING_PREPARED: MapPin,
  SERVICE_INITIATED: Send,
  PAYMENT_RECEIVED: CheckCircle,
  CASE_CLOSED: CheckCircle,
};
