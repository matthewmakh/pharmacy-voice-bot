import { useState } from 'react';
import { Scale } from 'lucide-react';

const ACK_KEY = 'reclaim:disclaimerAck:v1';

/**
 * One-time "not legal advice / self-help document preparation" acknowledgment.
 * Reclaim prepares documents and surfaces public-records research; it is not a law
 * firm and does not provide legal representation. Surfacing this explicitly (and a
 * persistent footer) is a reasonable mitigation of unauthorized-practice-of-law risk.
 */
export default function DisclaimerGate() {
  const [acked, setAcked] = useState(() => localStorage.getItem(ACK_KEY) === '1');
  if (acked) return null;

  const accept = () => {
    localStorage.setItem(ACK_KEY, '1');
    setAcked(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm p-4 animate-fade-in" role="dialog" aria-modal="true" aria-label="Important notice">
      <div className="bg-card text-card-foreground border border-border rounded-2xl shadow-xl max-w-lg w-full p-6 animate-fade-in-up">
        <div className="flex items-center gap-2 mb-3">
          <Scale className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Before you start — please read</h2>
        </div>
        <div className="text-sm text-muted-foreground leading-relaxed space-y-3">
          <p>
            Reclaim is a <strong>self-help document-preparation and research tool</strong>. It is{' '}
            <strong>not a law firm</strong> and does not provide legal advice or representation, and no
            attorney–client relationship is created by using it.
          </p>
          <p>
            AI-generated documents and the strategy suggestions are starting points that{' '}
            <strong>you are responsible for reviewing</strong>. For anything significant — especially before
            filing in court — have a licensed New York attorney review your documents. Court rules, fees, and
            deadlines change; verify them independently before relying on them.
          </p>
        </div>
        <div className="flex justify-end mt-6">
          <button onClick={accept} className="btn-primary">I understand</button>
        </div>
      </div>
    </div>
  );
}
