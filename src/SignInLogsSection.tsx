import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  RefreshCw,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  Laptop,
  Smartphone,
  Globe,
  Filter,
  Search,
  Lock,
  UserCheck
} from 'lucide-react';

export interface SignInLog {
  id: string;
  userId?: string | number | null;
  userName?: string;
  email: string;
  ip: string;
  userAgent: string;
  status: 'SUCCESS' | 'FAILED';
  reason?: string;
  method: string;
  timestamp: string;
  formattedDate: string;
}

interface SignInLogsSectionProps {
  currentUserEmail?: string;
  showToast?: (msg: string) => void;
}

export function SignInLogsSection({ currentUserEmail, showToast }: SignInLogsSectionProps) {
  const [logs, setLogs] = useState<SignInLog[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'SUCCESS' | 'FAILED'>('ALL');
  const [filterMyAccountOnly, setFilterMyAccountOnly] = useState<boolean>(false);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/logs/signin');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setLogs(data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch sign in logs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleClearLogs = async () => {
    if (!window.confirm('Are you sure you want to clear the sign-in audit logs from the database?')) {
      return;
    }
    try {
      const res = await fetch('/api/logs/signin', { method: 'DELETE' });
      if (res.ok) {
        setLogs([]);
        if (showToast) showToast('Sign-in audit logs cleared.');
      }
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  };

  const filteredLogs = logs.filter(log => {
    if (filterMyAccountOnly && currentUserEmail) {
      if (log.email.toLowerCase() !== currentUserEmail.toLowerCase()) return false;
    }
    if (statusFilter !== 'ALL' && log.status !== statusFilter) {
      return false;
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchEmail = log.email.toLowerCase().includes(term);
      const matchName = (log.userName || '').toLowerCase().includes(term);
      const matchIp = log.ip.toLowerCase().includes(term);
      const matchDevice = log.userAgent.toLowerCase().includes(term);
      if (!matchEmail && !matchName && !matchIp && !matchDevice) return false;
    }
    return true;
  });

  const getDeviceIcon = (ua: string) => {
    const s = ua.toLowerCase();
    if (s.includes('mobile') || s.includes('android') || s.includes('iphone')) {
      return <Smartphone className="w-3.5 h-3.5 text-blue-500 shrink-0" />;
    }
    return <Laptop className="w-3.5 h-3.5 text-slate-500 shrink-0" />;
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 text-[#0b1957] flex items-center justify-center font-bold">
            <ShieldCheck className="w-5 h-5 text-[#0b1957]" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#0b1957]">
              Secure Database Sign-in Logs
            </h3>
            <p className="text-xs text-gray-500">
              Live audit trail of all authentication events saved persistently in the secure database.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchLogs}
            disabled={isLoading}
            className="px-3 py-1.5 border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh from database"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          {logs.length > 0 && (
            <button
              type="button"
              onClick={handleClearLogs}
              className="px-3 py-1.5 border border-rose-200 bg-rose-50/50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search email, name, or IP..."
            className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#0b1957]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {currentUserEmail && (
            <button
              type="button"
              onClick={() => setFilterMyAccountOnly(!filterMyAccountOnly)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1 border ${
                filterMyAccountOnly
                  ? 'bg-[#0b1957] text-white border-[#0b1957]'
                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
              }`}
            >
              <UserCheck className="w-3 h-3" />
              <span>My Logins Only</span>
            </button>
          )}

          <div className="flex bg-gray-100 p-0.5 rounded-lg text-[11px] font-medium border border-gray-200">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                statusFilter === 'ALL' ? 'bg-white text-[#0b1957] shadow-xs font-bold' : 'text-gray-500 hover:text-black'
              }`}
            >
              All ({logs.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('SUCCESS')}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                statusFilter === 'SUCCESS' ? 'bg-emerald-600 text-white shadow-xs font-bold' : 'text-emerald-700 hover:text-emerald-900'
              }`}
            >
              Success ({logs.filter(l => l.status === 'SUCCESS').length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('FAILED')}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                statusFilter === 'FAILED' ? 'bg-rose-600 text-white shadow-xs font-bold' : 'text-rose-700 hover:text-rose-900'
              }`}
            >
              Failed ({logs.filter(l => l.status === 'FAILED').length})
            </button>
          </div>
        </div>
      </div>

      {/* Logs Table / Timeline */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        {isLoading && logs.length === 0 ? (
          <div className="py-12 text-center text-xs text-gray-500 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-[#0b1957]" />
            <span>Reading secure database logs...</span>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-12 text-center text-xs text-gray-400">
            No sign-in records match the current filter. Every successful or failed login is recorded here automatically.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-gray-600 font-semibold border-b border-gray-200 text-[11px] sticky top-0">
                <tr>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">User / Email</th>
                  <th className="py-2.5 px-3">Date &amp; Time</th>
                  <th className="py-2.5 px-3">IP Address</th>
                  <th className="py-2.5 px-3">Device / Client</th>
                  <th className="py-2.5 px-3">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-[11px]">
                {filteredLogs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2 px-3 whitespace-nowrap">
                      {log.status === 'SUCCESS' ? (
                        <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold text-[10px]">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>SUCCESS</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full font-bold text-[10px]">
                          <XCircle className="w-3 h-3 text-rose-600" />
                          <span>FAILED</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <div className="font-semibold text-gray-900">
                        {log.userName || log.email.split('@')[0]}
                      </div>
                      <div className="text-[10px] text-gray-500 font-mono">
                        {log.email}
                      </div>
                      {log.reason && (
                        <div className="text-[10px] text-rose-600 italic">
                          {log.reason}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap font-mono text-[10px] text-gray-600">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-gray-400" />
                        <span>{log.formattedDate || log.timestamp}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap font-mono text-[10px] text-slate-700">
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded text-gray-700">
                        {log.ip}
                      </span>
                    </td>
                    <td className="py-2 px-3 max-w-[180px] truncate" title={log.userAgent}>
                      <div className="flex items-center gap-1.5 text-gray-600">
                        {getDeviceIcon(log.userAgent)}
                        <span className="truncate">{log.userAgent}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-gray-500 capitalize">
                      {log.method.replace(/_/g, ' ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[10px] text-gray-400 italic">
        * Sign-in logs are written to the database on each login attempt and session refresh to prevent unauthorized access and maintain security compliance.
      </p>
    </div>
  );
}
