import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, UserPlus, Loader2, Trash2 } from 'lucide-react';
import { getOrgs, getOrgMembers, inviteMember, removeMember, getErrorMessage, type OrgSummary, type OrgMember } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import Badge, { type Tone } from '../components/ui/Badge';
import Alert from '../components/ui/Alert';
import EmptyState from '../components/ui/EmptyState';

const ROLE_TONE: Record<string, Tone> = { OWNER: 'info', ADMIN: 'success', MEMBER: 'neutral' };

export default function Team() {
  const { data: orgs = [], isLoading, error } = useQuery({ queryKey: ['orgs'], queryFn: getOrgs });

  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Users className="w-6 h-6 text-muted-foreground" /> Team</h1>
        <p className="text-muted-foreground text-sm mt-1">People in your workspace can see and work on the same cases.</p>
      </div>

      {isLoading && <div className="text-muted-foreground text-sm">Loading…</div>}
      {error && <Alert tone="danger">Failed to load your organizations.</Alert>}

      <div className="space-y-6">
        {orgs.map((org) => <OrgCard key={org.id} org={org} />)}
      </div>
    </div>
  );
}

function OrgCard({ org }: { org: OrgSummary }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = org.role === 'OWNER' || org.role === 'ADMIN';
  const [email, setEmail] = useState('');

  const { data: members = [], isLoading } = useQuery({ queryKey: ['org-members', org.id], queryFn: () => getOrgMembers(org.id) });

  const inviteMut = useMutation({
    mutationFn: () => inviteMember(org.id, email.trim()),
    onSuccess: () => { setEmail(''); queryClient.invalidateQueries({ queryKey: ['org-members', org.id] }); queryClient.invalidateQueries({ queryKey: ['orgs'] }); },
  });
  const removeMut = useMutation({
    mutationFn: (userId: string) => removeMember(org.id, userId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['org-members', org.id] }); queryClient.invalidateQueries({ queryKey: ['orgs'] }); },
  });

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <div className="font-semibold text-foreground">{org.name}</div>
          <div className="text-xs text-muted-foreground">{org.memberCount} member{org.memberCount !== 1 ? 's' : ''} · you are {org.role.toLowerCase()}</div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading members…</div>
      ) : members.length === 0 ? (
        <EmptyState title="No members" description="Invite a teammate below." />
      ) : (
        <div className="divide-y divide-border border-y border-border mb-4">
          {members.map((m: OrgMember) => (
            <div key={m.userId} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-foreground truncate">{m.name || m.email}{m.userId === user?.id && <span className="text-muted-foreground"> (you)</span>}</div>
                {m.name && <div className="text-xs text-muted-foreground truncate">{m.email}</div>}
              </div>
              <Badge tone={ROLE_TONE[m.role]} size="sm">{m.role}</Badge>
              {canManage && m.role !== 'OWNER' && (
                <button onClick={() => removeMut.mutate(m.userId)} disabled={removeMut.isPending} className="p-1.5 text-muted-foreground hover:text-red-500" title="Remove member" aria-label={`Remove ${m.email}`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <form onSubmit={(e) => { e.preventDefault(); if (email.trim()) inviteMut.mutate(); }} className="flex items-center gap-2">
          <input className="input flex-1" type="email" placeholder="teammate@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" disabled={inviteMut.isPending || !email.trim()} className="btn-primary text-sm whitespace-nowrap">
            {inviteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Add member
          </button>
        </form>
      )}
      {inviteMut.isError && <p className="text-xs text-red-600 mt-2">{getErrorMessage(inviteMut.error)}</p>}
      {removeMut.isError && <p className="text-xs text-red-600 mt-2">{getErrorMessage(removeMut.error)}</p>}
      {canManage && <p className="text-[11px] text-muted-foreground mt-2">The person must already have a Reclaim account. They'll see this workspace's cases immediately.</p>}
    </div>
  );
}
