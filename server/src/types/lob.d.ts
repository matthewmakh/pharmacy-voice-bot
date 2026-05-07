/**
 * Type declarations for the `lob` v6 Node SDK (no official types ship).
 * Covers the subset used by services/lob.ts.
 */

declare module 'lob' {
  interface LobAddress {
    name?: string;
    company?: string;
    address_line1: string;
    address_line2?: string;
    address_city: string;
    address_state: string;
    address_zip: string;
    address_country?: string;
  }

  interface LetterCreateParams {
    to: LobAddress;
    from: LobAddress;
    file: Buffer | string;
    color?: boolean;
    double_sided?: boolean;
    address_placement?: 'top_first_page' | 'insert_blank_page';
    use_type?: 'operational' | 'marketing';
    extra_service?: 'certified' | 'certified_return_receipt' | 'registered';
    description?: string;
    metadata?: Record<string, string>;
    mail_type?: 'usps_first_class' | 'usps_standard';
  }

  interface LetterTrackingEvent {
    name: string;
    time: string;
    details?: string;
  }

  interface LetterResponse {
    id: string;
    description: string | null;
    expected_delivery_date: string | null;
    tracking_number: string | null;
    tracking_events: LetterTrackingEvent[];
    metadata: Record<string, string>;
    [key: string]: unknown;
  }

  interface LobClient {
    letters: {
      create(params: LetterCreateParams): Promise<LetterResponse>;
      retrieve(id: string): Promise<LetterResponse>;
    };
  }

  function LobFactory(apiKey: string): LobClient;
  export = LobFactory;
}
