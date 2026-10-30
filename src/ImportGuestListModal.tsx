import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import {
  X,
  UploadCloud,
  FileSpreadsheet,
  Link as LinkIcon,
  ClipboardPaste,
  CheckCircle2,
  AlertCircle,
  Users,
  Check,
  RefreshCw,
  Eye,
  FileCheck,
  Globe
} from 'lucide-react';
import type { EventItem, Guest, RSVPStatus, AttendanceStatus } from './App';

interface ImportGuestListModalProps {
  isOpen: boolean;
  onClose: () => void;
  events: EventItem[];
  currentEventId?: string | null;
  onImport: (targetEventId: string, newGuests: Guest[], mode: 'replace' | 'append') => void;
  showToast?: (msg: string) => void;
}

export function normalizeRsvpValue(val: any): RSVPStatus {
  if (!val) return 'Pending';
  const s = String(val).trim().toLowerCase();
  if (
    s.includes('confirm') ||
    s.includes('yes') ||
    s.includes('going') ||
    s.includes('attend') ||
    s.includes('pupunta') ||
    s.includes('oo') ||
    s === 'y' ||
    s === '1'
  ) {
    return 'Confirmed';
  }
  if (
    s.includes('declin') ||
    s.includes('no') ||
    s.includes('cannot') ||
    s.includes("can't") ||
    s.includes('hindi') ||
    s === 'n' ||
    s === '0' ||
    s === 'absent'
  ) {
    return 'Declined';
  }
  return 'Pending';
}

export function normalizeAttendanceValue(val: any, rsvpStatus: RSVPStatus): AttendanceStatus {
  if (!val) {
    return rsvpStatus === 'Confirmed' ? 'Attended' : 'Absent';
  }
  const s = String(val).trim().toLowerCase();
  if (
    s.includes('attend') ||
    s.includes('present') ||
    s.includes('yes') ||
    s.includes('check') ||
    s.includes('here') ||
    s === 'y'
  ) {
    return 'Attended';
  }
  return 'Absent';
}

export function parseGuestRows(rows: any[][]): Guest[] {
  if (!rows || rows.length === 0) return [];

  // 1. Locate header row
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const rowStr = rows[i].map(c => String(c || '').toLowerCase()).join(' ');
    if (rowStr.includes('name') || rowStr.includes('email') || rowStr.includes('guest') || rowStr.includes('rsvp')) {
      headerRowIdx = i;
      break;
    }
  }

  const headers = rows[headerRowIdx].map(c => String(c || '').trim().toLowerCase());

  // 2. Identify column indices
  let nameCol = headers.findIndex(h => /name|full\s*name|attendee|guest|pangalan|person/i.test(h));
  let emailCol = headers.findIndex(h => /email|e-mail|mail|contact/i.test(h));
  let invitedCol = headers.findIndex(h => /invite/i.test(h));
  let rsvpCol = headers.findIndex(h => /rsvp|status|response|confirmation|going|attend/i.test(h));
  let attendanceCol = headers.findIndex(h => /attendance|present|checked/i.test(h));
  let notesCol = headers.findIndex(h => /note|message|comment|dietary|remark|wish|plus/i.test(h));

  // Fallback defaults if headers weren't named standardly
  if (nameCol === -1) nameCol = 0;
  if (emailCol === -1) emailCol = headers.length > 1 ? 1 : -1;
  if (rsvpCol === -1) rsvpCol = headers.length > 2 ? 2 : -1;

  const guests: Guest[] = [];

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const rawName = String(row[nameCol] || '').trim();
    if (!rawName) continue; // Skip empty rows

    let rawEmail = emailCol >= 0 ? String(row[emailCol] || '').trim() : '';
    if (!rawEmail || !rawEmail.includes('@')) {
      const slug = rawName.toLowerCase().replace(/[^a-z0-9]/g, '.');
      rawEmail = `${slug}@guest.local`;
    }

    const rawInvited = invitedCol >= 0 ? String(row[invitedCol] || '').toLowerCase() : '';
    const invited = rawInvited.includes('no') || rawInvited === 'false' || rawInvited === '0' ? false : true;

    const rsvpVal = rsvpCol >= 0 ? row[rsvpCol] : '';
    const rsvp = normalizeRsvpValue(rsvpVal);

    const attVal = attendanceCol >= 0 ? row[attendanceCol] : '';
    const attendance = normalizeAttendanceValue(attVal, rsvp);

    const notes = notesCol >= 0 ? String(row[notesCol] || '').trim() : '';

    guests.push({
      id: 'g_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7) + '_' + i,
      name: rawName,
      email: rawEmail,
      invited,
      rsvp,
      attendance,
      notes
    });
  }

  return guests;
}

export function ImportGuestListModal({
  isOpen,
  onClose,
  events,
  currentEventId,
  onImport,
  showToast
}: ImportGuestListModalProps) {
  const [activeTab, setActiveTab] = useState<'file' | 'googlesheet' | 'paste'>('file');
  const [targetEventId, setTargetEventId] = useState<string>(
    currentEventId || events[0]?.id || ''
  );
  const importMode: 'append' | 'replace' = 'replace';

  // Parsed guests preview
  const [parsedGuests, setParsedGuests] = useState<Guest[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Google Sheet Link state
  const [sheetUrl, setSheetUrl] = useState<string>('');
  // Paste text state
  const [pastedText, setPastedText] = useState<string>('');

  if (!isOpen) return null;

  const currentSelectedEvent = events.find(e => e.id === targetEventId) || events[0];

  // Process File (Excel or CSV)
  const handleFileUpload = async (file: File) => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      setFileName(file.name);

      const isCsv = file.name.endsWith('.csv') || file.name.endsWith('.tsv') || file.type.includes('csv');
      const buffer = await file.arrayBuffer();

      let wb: XLSX.WorkBook;
      if (isCsv) {
        // Read text or buffer as CSV
        const textDecoder = new TextDecoder('utf-8');
        const text = textDecoder.decode(buffer);
        wb = XLSX.read(text, { type: 'string' });
      } else {
        // Excel binary (.xlsx, .xls)
        wb = XLSX.read(buffer, { type: 'array' });
      }

      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });

      const guests = parseGuestRows(rows);
      if (guests.length === 0) {
        setErrorMessage('No valid guest records found in this file. Please check column headers.');
      } else {
        setParsedGuests(guests);
      }
    } catch (err: any) {
      console.error('File parsing error:', err);
      setErrorMessage(`Failed to read file: ${err.message || 'Invalid Excel/CSV format'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Process Google Sheets Link
  const handleFetchGoogleSheet = async () => {
    const url = sheetUrl.trim();
    if (!url) {
      setErrorMessage('Please paste your Google Sheet URL');
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/import/google-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch Google Sheet data');
      }

      const wb = XLSX.read(data.csvData, { type: 'string' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
      const guests = parseGuestRows(rows);

      if (guests.length === 0) {
        setErrorMessage('Connected to Google Sheet, but no guest rows with headers were detected.');
      } else {
        setFileName('Google Sheet Live Sync');
        setParsedGuests(guests);
        if (showToast) showToast(`Loaded ${guests.length} guests from Google Sheet!`);
      }
    } catch (err: any) {
      console.error('Google Sheet import error:', err);
      setErrorMessage(err.message || 'Could not fetch Google Sheet. Make sure sharing is set to "Anyone with the link can view".');
    } finally {
      setIsLoading(false);
    }
  };

  // Process Pasted Text (TSV / CSV)
  const handleParsePastedText = () => {
    const raw = pastedText.trim();
    if (!raw) {
      setErrorMessage('Please paste rows into the text area');
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage(null);

      // SheetJS handles tab-delimited or comma-delimited strings smoothly
      const wb = XLSX.read(raw, { type: 'string' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
      const guests = parseGuestRows(rows);

      if (guests.length === 0) {
        setErrorMessage('No valid guest rows found. Ensure each line has a Name and Email/Status.');
      } else {
        setFileName('Pasted Spreadsheet Data');
        setParsedGuests(guests);
      }
    } catch (err: any) {
      setErrorMessage(`Could not parse pasted data: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Confirm Import
  const handleConfirmImport = () => {
    if (!targetEventId) {
      setErrorMessage('Please select a target event for this guest list.');
      return;
    }
    if (parsedGuests.length === 0) {
      setErrorMessage('No guests to import yet.');
      return;
    }

    onImport(targetEventId, parsedGuests, importMode);
    if (showToast) {
      const modeText = importMode === 'replace' ? 'replaced with' : 'added';
      showToast(`Success! ${parsedGuests.length} guests ${modeText} "${currentSelectedEvent?.title || 'Event'}".`);
    }
    onClose();
  };

  // Statistics of parsed guests
  const confirmedCount = parsedGuests.filter(g => g.rsvp === 'Confirmed').length;
  const pendingCount = parsedGuests.filter(g => g.rsvp === 'Pending').length;
  const declinedCount = parsedGuests.filter(g => g.rsvp === 'Declined').length;
  const attendedCount = parsedGuests.filter(g => g.attendance === 'Attended').length;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 z-50 animate-in fade-in overflow-y-auto">
      <div className="bg-white rounded-3xl w-full max-w-3xl shadow-2xl border border-gray-100 flex flex-col max-h-[92vh] overflow-hidden my-auto">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-[#0b1957] to-[#182978] text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-amber-300">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold font-serif text-white tracking-wide">
                Import Guest List
              </h2>
              <p className="text-[11px] text-white/80">
                Excel (.xlsx, .xls), Google Sheets, or CSV / TSV spreadsheet format
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {/* Target Event & Import Mode Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
            <div>
              <label className="block text-[11px] font-bold text-[#0b1957] uppercase tracking-wider mb-1">
                Import into Event:
              </label>
              <select
                value={targetEventId}
                onChange={e => setTargetEventId(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold text-[#0b1957] focus:outline-none focus:ring-1 focus:ring-[#0b1957] cursor-pointer"
              >
                {events.map(ev => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title} ({ev.date}) - {ev.guests?.length || 0} guests
                  </option>
                ))}
              </select>
            </div>

          </div>

          {/* Source Tabs */}
          <div>
            <div className="flex border-b border-gray-200 gap-4 mb-4">
              <button
                type="button"
                onClick={() => { setActiveTab('file'); setErrorMessage(null); }}
                className={`pb-2.5 text-xs font-bold flex items-center gap-2 cursor-pointer transition-colors border-b-2 ${
                  activeTab === 'file'
                    ? 'border-[#0b1957] text-[#0b1957]'
                    : 'border-transparent text-gray-400 hover:text-gray-700'
                }`}
              >
                <UploadCloud className="w-4 h-4" />
                <span>Upload Excel / CSV</span>
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab('googlesheet'); setErrorMessage(null); }}
                className={`pb-2.5 text-xs font-bold flex items-center gap-2 cursor-pointer transition-colors border-b-2 ${
                  activeTab === 'googlesheet'
                    ? 'border-[#0b1957] text-[#0b1957]'
                    : 'border-transparent text-gray-400 hover:text-gray-700'
                }`}
              >
                <Globe className="w-4 h-4 text-emerald-600" />
                <span>Google Sheets URL</span>
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab('paste'); setErrorMessage(null); }}
                className={`pb-2.5 text-xs font-bold flex items-center gap-2 cursor-pointer transition-colors border-b-2 ${
                  activeTab === 'paste'
                    ? 'border-[#0b1957] text-[#0b1957]'
                    : 'border-transparent text-gray-400 hover:text-gray-700'
                }`}
              >
                <ClipboardPaste className="w-4 h-4" />
                <span>Paste Table Cells</span>
              </button>
            </div>

            {/* TAB 1: FILE UPLOAD (EXCEL & CSV) */}
            {activeTab === 'file' && (
              <div className="space-y-4">
                <div
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                  className="border-2 border-dashed border-indigo-200 hover:border-[#0b1957] rounded-2xl p-8 text-center bg-indigo-50/20 hover:bg-indigo-50/40 transition-colors cursor-pointer group"
                  onClick={() => document.getElementById('excelFileInput')?.click()}
                >
                  <input
                    type="file"
                    id="excelFileInput"
                    accept=".xlsx,.xls,.csv,.tsv"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                    }}
                  />
                  <div className="w-14 h-14 rounded-2xl bg-indigo-100 text-[#0b1957] group-hover:scale-105 transition-transform flex items-center justify-center mx-auto mb-3 shadow-xs">
                    <FileSpreadsheet className="w-7 h-7" />
                  </div>
                  <div className="text-sm font-bold text-[#0b1957] mb-1">
                    Click to browse or drag &amp; drop your file here
                  </div>
                  <p className="text-gray-500 text-[11px] max-w-sm mx-auto">
                    Supports Microsoft Excel (<code className="font-mono text-[#0b1957]">.xlsx</code>, <code className="font-mono text-[#0b1957]">.xls</code>), Google Sheet export files, and CSV (<code className="font-mono text-[#0b1957]">.csv</code>)
                  </p>
                </div>
              </div>
            )}

            {/* TAB 2: GOOGLE SHEETS LIVE IMPORT */}
            {activeTab === 'googlesheet' && (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-2xl space-y-2">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs">
                    <Globe className="w-4 h-4 text-emerald-600" />
                    <span>Direct Google Sheet Import via URL</span>
                  </div>
                  <p className="text-[11px] text-emerald-700 leading-relaxed">
                    Paste the web link to your Google Sheet. Ensure your sheet sharing is set to{' '}
                    <strong>&quot;Anyone with the link can view&quot;</strong> (in Google Sheets: Share &rarr; General access &rarr; Anyone with the link).
                  </p>
                </div>

                <div>
                  <label className="block font-semibold text-gray-700 mb-1.5">
                    Google Sheets Shareable URL:
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <LinkIcon className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="url"
                        value={sheetUrl}
                        onChange={e => setSheetUrl(e.target.value)}
                        placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0"
                        className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#0b1957] font-mono"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleFetchGoogleSheet}
                      disabled={isLoading}
                      className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-medium text-xs flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                    >
                      {isLoading ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Fetching...</span>
                        </>
                      ) : (
                        <>
                          <FileCheck className="w-3.5 h-3.5" />
                          <span>Load Sheet</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="text-[11px] text-gray-500">
                  Tip: You can also download your Google Sheet as an Excel file (<span className="font-mono text-gray-700">File &rarr; Download &rarr; Microsoft Excel .xlsx</span>) and drop it in the Upload tab.
                </div>
              </div>
            )}

            {/* TAB 3: PASTE TEXT OR SPREADSHEET CELLS */}
            {activeTab === 'paste' && (
              <div className="space-y-4">
                <p className="text-gray-500 text-[11px]">
                  Copy cells from Excel or Google Sheets (Ctrl+C) and paste below. The system automatically detects tab-separated or comma-separated columns.
                </p>

                <div>
                  <textarea
                    rows={6}
                    value={pastedText}
                    onChange={e => setPastedText(e.target.value)}
                    placeholder={`Name\tEmail\tInvited\tRSVP\tAttendance\tNotes\nAlexander Wright\talex@example.com\tYes\tConfirmed\tAttended\tVIP Table\nBeatrice Miller\tbeatrice@example.com\tYes\tDeclined\tAbsent\t`}
                    className="w-full border border-gray-300 rounded-xl p-3 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-[#0b1957] bg-white leading-relaxed"
                  />
                </div>

                <div className="flex justify-between items-center">
                  <button
                    type="button"
                    onClick={() => {
                      setPastedText(
                        `Name\tEmail\tInvited\tRSVP\tAttendance\tNotes\nLucas Kane\tlucas@example.com\tYes\tConfirmed\tAttended\tTable 1\nSophia Perez\tsophia@example.com\tYes\tPending\tAbsent\tWaiting for confirmation\nMateo Rossi\tmateo@example.com\tYes\tDeclined\tAbsent\tOut of town\nIsabella Diaz\tisabella@example.com\tYes\tConfirmed\tAttended\tVegetarian`
                      );
                    }}
                    className="text-[#0b1957] font-semibold text-[11px] hover:underline cursor-pointer"
                  >
                    Paste Sample Rows
                  </button>

                  <button
                    type="button"
                    onClick={handleParsePastedText}
                    disabled={isLoading}
                    className="px-5 py-2 bg-[#0b1957] hover:bg-[#101d6b] text-white rounded-xl text-xs font-medium shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    Parse Rows
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded-xl flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="text-xs leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {/* Parsed Preview Section */}
          {parsedGuests.length > 0 && (
            <div className="border border-indigo-100 bg-indigo-50/20 rounded-2xl p-4 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 pb-3">
                <div className="flex items-center gap-2 text-[#0b1957] font-bold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>
                    Ready to Import: {parsedGuests.length} Guests
                  </span>
                  {fileName && (
                    <span className="text-[11px] font-normal text-gray-500">
                      ({fileName})
                    </span>
                  )}
                </div>

                {/* Quick breakdown badges */}
                <div className="flex flex-wrap gap-1.5 text-[10px]">
                  <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-semibold">
                    {confirmedCount} Confirmed
                  </span>
                  <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-semibold">
                    {pendingCount} Pending
                  </span>
                  <span className="bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full font-semibold">
                    {declinedCount} Declined
                  </span>
                  <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-semibold">
                    {attendedCount} Attended
                  </span>
                </div>
              </div>

              {/* Preview Table */}
              <div className="overflow-x-auto max-h-48 border border-gray-200 rounded-xl bg-white shadow-inner">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-gray-100 sticky top-0 text-gray-600 font-semibold border-b border-gray-200">
                    <tr>
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">Guest Name</th>
                      <th className="py-2 px-3">Email Address</th>
                      <th className="py-2 px-3 text-center">RSVP</th>
                      <th className="py-2 px-3 text-center">Attendance</th>
                      <th className="py-2 px-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {parsedGuests.slice(0, 15).map((g, idx) => (
                      <tr key={g.id || idx} className="hover:bg-slate-50">
                        <td className="py-1.5 px-3 text-gray-400 font-mono text-[10px]">{idx + 1}</td>
                        <td className="py-1.5 px-3 font-semibold text-gray-900">{g.name}</td>
                        <td className="py-1.5 px-3 font-mono text-gray-500 text-[10px]">{g.email}</td>
                        <td className="py-1.5 px-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              g.rsvp === 'Confirmed'
                                ? 'bg-emerald-100 text-emerald-700'
                                : g.rsvp === 'Declined'
                                ? 'bg-rose-100 text-rose-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {g.rsvp}
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              g.attendance === 'Attended'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {g.attendance}
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-gray-500 truncate max-w-[140px] text-[10px]">
                          {g.notes || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsedGuests.length > 15 && (
                <p className="text-[10px] text-gray-400 text-center italic">
                  Showing first 15 of {parsedGuests.length} guests. All {parsedGuests.length} will be imported into {currentSelectedEvent?.title}.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <div className="text-[11px] text-gray-500">
            {parsedGuests.length > 0 ? (
              <span>Target: <strong className="text-[#0b1957]">{currentSelectedEvent?.title}</strong> ({importMode === 'replace' ? 'Replace Mode' : 'Merge Mode'})</span>
            ) : (
              <span>Upload or link a file to preview before importing</span>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-100 font-medium text-xs cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={parsedGuests.length === 0}
              onClick={handleConfirmImport}
              className="px-6 py-2 bg-[#0b1957] hover:bg-[#101d6b] disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-semibold shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Import to Guest List</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
