import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FolderOpen, Plus, Scale } from 'lucide-react';

export default function Sidebar() {
  const navigate = useNavigate();

  return (
    <aside className="w-60 bg-slate-900 flex flex-col shrink-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-700/60">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
            <Scale className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="font-bold text-white text-sm tracking-tight">Reclaim</div>
            <div className="text-slate-400 text-xs">Collections Platform</div>
          </div>
        </div>
      </div>

      {/* New Case button */}
      <div className="px-4 pt-4">
        <button
          onClick={() => navigate('/cases/new')}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium py-2.5 px-3 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Case
        </button>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`
          }
        >
          <LayoutDashboard className="w-4 h-4 shrink-0" />
          Dashboard
        </NavLink>

        <NavLink
          to="/"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive && window.location.pathname.startsWith('/cases') && window.location.pathname !== '/cases/new'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`
          }
        >
          <FolderOpen className="w-4 h-4 shrink-0" />
          All Cases
        </NavLink>
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-slate-700/60">
        <div className="text-xs text-slate-500">
          New York B2B Collections
        </div>
      </div>
    </aside>
  );
}
