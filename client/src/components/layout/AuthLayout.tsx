import { Scale, FileText, Landmark, Search } from 'lucide-react';

/**
 * Presentational shell for the auth screens: a branded panel on the left (desktop)
 * and the form on the right. Purely visual — no auth logic lives here.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Brand panel (desktop) */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-primary to-blue-800 text-primary-foreground relative overflow-hidden">
        <div aria-hidden className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden className="absolute -bottom-32 -left-16 w-96 h-96 rounded-full bg-white/5 blur-2xl" />

        <div className="relative flex items-center gap-2.5">
          <div className="w-9 h-9 bg-white/15 backdrop-blur rounded-lg flex items-center justify-center">
            <Scale className="w-[18px] h-[18px]" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold text-[15px] tracking-tight">Reclaim</div>
            <div className="text-white/70 text-[11px]">Collections Platform</div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold tracking-tight leading-tight">
            Turn unpaid invoices into action.
          </h2>
          <p className="mt-4 text-white/80 leading-relaxed">
            AI-assisted demand letters, New York court forms, and debtor public-records
            research — one workflow from intake to judgment.
          </p>
          <ul className="mt-8 space-y-3">
            {[
              { icon: FileText, label: 'Demand letters & pre-filing notices' },
              { icon: Landmark, label: 'NY court forms & default judgments' },
              { icon: Search, label: 'Debtor research (ACRIS, UCC, courts)' },
            ].map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 text-sm text-white/90">
                <span className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4" />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/60 max-w-md">
          Self-help document preparation and public-records research — not legal advice.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          {/* Mobile logo (brand panel is hidden on small screens) */}
          <div className="flex items-center justify-center gap-2.5 mb-8 lg:hidden">
            <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-sm">
              <Scale className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="leading-tight">
              <div className="font-semibold text-foreground text-lg tracking-tight">Reclaim</div>
              <div className="text-muted-foreground text-xs">Collections Platform</div>
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
