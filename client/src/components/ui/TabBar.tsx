import React from 'react';

export interface TabItem<Id extends string = string> {
  id: Id;
  label: string;
  icon?: React.ElementType;
  badge?: React.ReactNode;
}

interface TabBarProps<Id extends string = string> {
  tabs: TabItem<Id>[];
  activeTab: Id;
  onChange: (id: Id) => void;
  className?: string;
}

export default function TabBar<Id extends string = string>({
  tabs,
  activeTab,
  onChange,
  className = '',
}: TabBarProps<Id>) {
  return (
    <div className={`border-b border-slate-200 ${className}`}>
      <nav className="flex gap-1 overflow-x-auto -mb-px" aria-label="Tabs">
        {tabs.map(({ id, label, icon: Icon, badge }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                active
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
              }`}
            >
              {Icon && <Icon className="w-4 h-4" />}
              {label}
              {badge}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
