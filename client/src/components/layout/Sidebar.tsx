import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Plus, Scale, X, LogOut, User, Users } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { cn } from '../../lib/utils';

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
    isActive
      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
      : 'text-sidebar-muted hover:text-sidebar-foreground hover:bg-muted',
  );

interface Props {
  onClose?: () => void;
}

export default function Sidebar({ onClose }: Props) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleNewCase = () => {
    navigate('/cases/new');
    onClose?.();
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside className="w-60 bg-sidebar border-r border-sidebar-border flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 h-16 border-b border-sidebar-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center shrink-0 shadow-sm">
            <Scale className="w-[18px] h-[18px] text-primary-foreground" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold text-sidebar-foreground text-[15px] tracking-tight">Reclaim</div>
            <div className="text-sidebar-muted text-[11px]">Collections Platform</div>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="lg:hidden text-sidebar-muted hover:text-sidebar-foreground transition-colors ml-2">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* New Case button */}
      <div className="px-3 pt-4">
        <button
          onClick={handleNewCase}
          className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium py-2.5 px-3 rounded-lg transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          New Case
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted/70">Workspace</div>
        <NavLink to="/" end onClick={onClose} className={navClass}>
          <LayoutDashboard className="w-4 h-4 shrink-0" />
          Cases
        </NavLink>
        <NavLink to="/team" onClick={onClose} className={navClass}>
          <Users className="w-4 h-4 shrink-0" />
          Team
        </NavLink>
      </nav>

      {/* User + logout */}
      <div className="px-3 py-4 border-t border-sidebar-border space-y-1">
        {user && (
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-sidebar-foreground truncate">
                {user.name || user.email}
              </div>
              {user.name && (
                <div className="text-[11px] text-sidebar-muted truncate">{user.email}</div>
              )}
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-sidebar-muted hover:text-sidebar-foreground hover:bg-muted transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
