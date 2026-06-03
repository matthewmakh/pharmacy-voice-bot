import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import DisclaimerGate from '../DisclaimerGate';
import { Menu } from 'lucide-react';

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-foreground/40 backdrop-blur-sm z-20 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-30 w-60 transform transition-transform duration-200 ease-in-out lg:relative lg:translate-x-0 lg:flex lg:flex-col ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar onClose={() => setMobileOpen(false)} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-sidebar border-b border-sidebar-border shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-foreground font-semibold text-sm tracking-tight">Reclaim</span>
        </div>

        <main className="flex-1 overflow-y-auto">
          <Outlet />
          <footer className="px-6 py-4 text-center text-[11px] text-muted-foreground border-t border-border">
            Reclaim provides self-help document preparation and public-records research — not legal advice. Have a licensed attorney review documents before filing.
          </footer>
        </main>
      </div>

      <DisclaimerGate />
    </div>
  );
}
