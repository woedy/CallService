import React, { useState, useEffect, useRef, useCallback } from 'react';
import api, { WS_BASE } from '../api';

const STATUS_COLORS = {
    idle: 'bg-gray-100 text-gray-600',
    dialing: 'bg-blue-100 text-blue-700',
    ringing: 'bg-yellow-100 text-yellow-700',
    answered: 'bg-green-100 text-green-700',
    busy: 'bg-orange-100 text-orange-700',
    no_answer: 'bg-orange-100 text-orange-700',
    failed: 'bg-red-100 text-red-700',
    completed: 'bg-gray-100 text-gray-600',
};

const LOG_ICONS = {
    dialing: '📞',
    ringing: '🔔',
    answered: '✅',
    busy: '🔴',
    no_answer: '⏱️',
    failed: '❌',
    completed: '📵',
    dtmf: '🔢',
    default: '📋',
};

function logIcon(message) {
    if (message.includes('DTMF') || message.includes('digit')) return LOG_ICONS.dtmf;
    if (message.includes('ringing')) return LOG_ICONS.ringing;
    if (message.includes('answered') || message.includes('Answered')) return LOG_ICONS.answered;
    if (message.includes('busy') || message.includes('BUSY')) return LOG_ICONS.busy;
    if (message.includes('ended') || message.includes('Hangup')) return LOG_ICONS.completed;
    if (message.includes('Failed') || message.includes('failed')) return LOG_ICONS.failed;
    if (message.includes('Dialing') || message.includes('initiated')) return LOG_ICONS.dialing;
    return LOG_ICONS.default;
}

export default function SingleCallPage() {
    const [phone, setPhone] = useState('');
    const [callerId, setCallerId] = useState('');
    const [recipientName, setRecipientName] = useState('');
    const [expectedDigits, setExpectedDigits] = useState(4);
    const [mode, setMode] = useState('audio_only');
    const [note, setNote] = useState('');
    
    // Mode-specific states: Audio Only
    const [templateCategories, setTemplateCategories] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState('');
    const [templates, setTemplates] = useState([]);
    const [selectedTemplate, setSelectedTemplate] = useState('');
    const [press1Templates, setPress1Templates] = useState([]);
    const [selectedPress1Template, setSelectedPress1Template] = useState('');

    // Mode-specific states: TTS Script
    const [ttsScriptTemplates, setTtsScriptTemplates] = useState([]);
    const [selectedTtsTemplate, setSelectedTtsTemplate] = useState('');

    const [activeCall, setActiveCall] = useState(null);
    const [logs, setLogs] = useState([]);
    const [history, setHistory] = useState([]);
    const [dialing, setDialing] = useState(false);
    const [error, setError] = useState('');
    const socketRef = useRef(null);
    const logsEndRef = useRef(null);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const fetchHistory = useCallback(async () => {
        try {
            const res = await api.get('/single-calls/');
            setHistory(res.data);
        } catch { /* ignore */ }
    }, []);

    // Audio Only Logic
    const fetchCategories = useCallback(async () => {
        try {
            const res = await api.get('/template-categories/?mode=audio_only&category_type=greeting&page_size=100');
            setTemplateCategories(res.data.results || []);
        } catch { setError('Failed to load categories'); }
    }, []);

    const fetchTemplatesForCategory = useCallback(async (catId) => {
        if (!catId) { setTemplates([]); return; }
        try {
            const res = await api.get(`/audio-templates/?category=${catId}&page_size=100`);
            setTemplates(res.data.results || []);
        } catch { setError('Failed to load templates'); }
    }, []);

    const fetchPress1Templates = useCallback(async () => {
        try {
            const res = await api.get('/audio-templates/?category_type=press1&mode=audio_only&page_size=100');
            setPress1Templates(res.data.results || []);
        } catch { console.error('Failed to load press1 templates'); }
    }, []);

    // TTS Script Logic
    const fetchTtsScriptTemplates = useCallback(async () => {
        try {
            const res = await api.get(`/tts-script-templates/?page_size=500`);
            setTtsScriptTemplates(res.data.results || []);
        } catch { setError('Failed to load TTS templates'); }
    }, []);

    useEffect(() => {
        fetchHistory();
        if (mode === 'audio_only') {
            fetchCategories();
            fetchPress1Templates();
        } else {
            fetchTtsScriptTemplates();
        }
    }, [mode, fetchHistory, fetchCategories, fetchPress1Templates, fetchTtsScriptTemplates]);

    useEffect(() => {
        if (selectedCategory) fetchTemplatesForCategory(selectedCategory);
    }, [selectedCategory, fetchTemplatesForCategory]);

    const connectWebSocket = useCallback((callId) => {
        if (socketRef.current) socketRef.current.close();
        const ws = new WebSocket(`${WS_BASE}/ws/calls/${callId}/`);
        socketRef.current = ws;
        ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            setLogs(prev => [...prev, data]);
            if (data.status || data.dtmf_responses !== undefined || data.duration_seconds !== undefined) {
                setActiveCall(prev => prev ? {
                    ...prev,
                    status: data.status ?? prev.status,
                    dtmf_responses: data.dtmf_responses ?? prev.dtmf_responses,
                    duration_seconds: data.duration_seconds ?? prev.duration_seconds,
                } : prev);
            }
            if (['completed', 'failed', 'busy', 'no_answer'].includes(data.status)) {
                fetchHistory();
            }
        };
        ws.onerror = () => setError('WebSocket error');
    }, [fetchHistory]);

    const handleDial = async (e) => {
        e.preventDefault();
        setError('');
        if (!phone) { setError('Phone number is required.'); return; }
        if (mode === 'audio_only' && !selectedTemplate) { setError('Greeting template is required.'); return; }
        if (mode === 'tts_script' && !selectedTtsTemplate) { setError('TTS Script Template is required.'); return; }
        
        setDialing(true);
        setLogs([]);

        try {
            const formData = new FormData();
            formData.append('phone', phone);
            formData.append('mode', mode);
            if (callerId) formData.append('caller_id', callerId);
            if (recipientName) formData.append('recipient_name', recipientName);
            if (note) formData.append('note', note);

            if (mode === 'audio_only') {
                formData.append('greeting_template', selectedTemplate);
                if (selectedPress1Template) formData.append('press1_template', selectedPress1Template);
                
                const tpl = templates.find(t => String(t.id) === String(selectedTemplate));
                if (tpl) formData.append('expected_digits', String(tpl.expected_digits));
            } else {
                formData.append('tts_script_template', selectedTtsTemplate);
                
                const tpl = ttsScriptTemplates.find(t => String(t.id) === String(selectedTtsTemplate));
                if (tpl) formData.append('expected_digits', String(tpl.expected_digits));
            }

            const res = await api.post('/single-calls/', formData);
            const call = res.data;
            setActiveCall(call);
            connectWebSocket(call.id);
            await api.post(`/single-calls/${call.id}/dial/`);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to place call');
        } finally {
            setDialing(false);
        }
    };

    const handleAction = async (action) => {
        if (!activeCall) return;
        try {
            await api.post(`/single-calls/${activeCall.id}/${action}/`);
        } catch (err) {
            setError(`${action} failed`);
        }
    };

    const handleSelectHistory = async (call) => {
        setActiveCall(call);
        setLogs([]);
        setPhone(call.phone);
        setCallerId(call.caller_id || '');
        setRecipientName(call.recipient_name || '');
        setNote(call.note || '');
        setExpectedDigits(call.expected_digits || 4);
        setMode(call.mode || 'audio_only');
        
        try {
            const res = await api.get(`/single-calls/${call.id}/logs/`);
            setLogs(res.data.map(l => ({ message: l.message, timestamp: l.timestamp })));
        } catch { /* ignore */ }
        connectWebSocket(call.id);
    };

    const isActive = activeCall && ['dialing', 'ringing', 'answered'].includes(activeCall.status);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
                <div className="bg-white shadow sm:rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                        <h2 className="text-md font-bold text-gray-800 uppercase tracking-tight">Single Call Terminal</h2>
                        <div className="flex gap-1 bg-gray-200 p-1 rounded-lg">
                            {['audio_only', 'tts_script'].map(m => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => setMode(m)}
                                    className={`text-[9px] font-bold px-3 py-1 rounded-md transition-all uppercase ${mode === m ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    {m.replace('_', ' ')}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="px-4 py-5 sm:p-6">
                        {error && <p className="text-sm text-red-600 mb-4 bg-red-50 border border-red-100 px-3 py-2 rounded-md">{error}</p>}
                        
                        <form onSubmit={handleDial} className="space-y-6">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                {/* Destination Info */}
                                <div className="space-y-4">
                                    <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest border-b pb-1">Destination</h4>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="col-span-2">
                                            <label className="block text-xs font-semibold text-gray-600">Phone Number*</label>
                                            <input type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1234567890" required className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-600">Recipient Name</label>
                                            <input type="text" value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="e.g. John Doe" className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-600">Caller ID</label>
                                            <input type="text" value={callerId} onChange={e => setCallerId(e.target.value)} placeholder="Display Name" className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500" />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-600">Call Note</label>
                                        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm" />
                                    </div>
                                </div>

                                {/* Flow Configuration */}
                                <div className="space-y-4">
                                    <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest border-b pb-1">
                                        {mode === 'audio_only' ? 'Audio Configuration' : 'Script Configuration'}
                                    </h4>

                                    {mode === 'audio_only' ? (
                                        <div className="space-y-4 bg-gray-50 p-4 rounded-lg border">
                                            <div>
                                                <label className="block text-xs font-bold text-gray-500 uppercase">Feature Category*</label>
                                                <select
                                                    value={selectedCategory}
                                                    onChange={e => setSelectedCategory(e.target.value)}
                                                    required
                                                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                                >
                                                    <option value="">Select Category</option>
                                                    {templateCategories.map(cat => (
                                                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-gray-500 uppercase">Select Template*</label>
                                                <select
                                                    value={selectedTemplate}
                                                    onChange={e => setSelectedTemplate(e.target.value)}
                                                    required
                                                    disabled={!selectedCategory}
                                                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
                                                >
                                                    <option value="">Select Template</option>
                                                    {templates.map(tpl => (
                                                        <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-gray-500 uppercase">Digit Prompt (optional)</label>
                                                <select
                                                    value={selectedPress1Template}
                                                    onChange={e => setSelectedPress1Template(e.target.value)}
                                                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                                >
                                                    <option value="">System Default</option>
                                                    {press1Templates.map(tpl => (
                                                        <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-4 bg-indigo-50 p-4 rounded-lg border border-indigo-100">
                                            <div>
                                                <label className="block text-xs font-bold text-indigo-700 uppercase tracking-widest">Select TTS Script Template*</label>
                                                <select
                                                    value={selectedTtsTemplate}
                                                    onChange={e => setSelectedTtsTemplate(e.target.value)}
                                                    required
                                                    className="mt-2 block w-full border-indigo-200 border rounded-md shadow-sm px-3 py-3 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                                >
                                                    <option value="">-- Select Template --</option>
                                                    {ttsScriptTemplates.map(tpl => (
                                                        <option key={tpl.id} value={tpl.id}>{tpl.name} ({tpl.expected_digits} Digits)</option>
                                                    ))}
                                                </select>
                                                <p className="mt-4 text-[10px] text-gray-500 italic">
                                                    TTS templates contain scripts for all stages: Greeting, Reprompts, Timeouts, and Goodbye. Selection will synthesize audio on-demand.
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center justify-between border-t pt-5">
                                <p className="text-[10px] text-gray-400 italic">
                                    {mode === 'audio_only' ? 'Audio pulled from selected assets.' : 'TTS synthesized from script template.'}
                                </p>
                                <button type="submit" disabled={dialing || isActive} className={`btn-primary px-8 py-2.5 rounded-full shadow-lg transform transition-all active:scale-95 ${dialing || isActive ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}`}>
                                    {dialing ? 'DIALING...' : isActive ? 'CALL IN PROGRESS' : '🚀 START CALL'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                {activeCall && (
                    <div className="bg-white shadow sm:rounded-lg overflow-hidden">
                        <div className="px-4 py-4 border-b border-gray-200 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-gray-900 font-mono">{activeCall.phone}</p>
                                <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${STATUS_COLORS[activeCall.status] || 'bg-gray-100'}`}>{activeCall.status}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                {isActive && (
                                    <>
                                        <button onClick={() => handleAction('reprompt')} className="bg-red-50 text-red-700 px-3 py-1 rounded text-xs font-bold border border-red-200 hover:bg-red-100">🛑 INVALID</button>
                                        <button onClick={() => handleAction('connect_agent')} className="bg-green-50 text-green-700 px-3 py-1 rounded text-xs font-bold border border-green-200 hover:bg-green-100">🎧 AGENT</button>
                                        <button onClick={() => handleAction('hangup')} className="bg-gray-100 text-gray-700 px-3 py-1 rounded text-xs font-bold border border-gray-200 hover:bg-gray-200">❌ END</button>
                                    </>
                                )}
                                {activeCall.dtmf_responses && <span className="text-sm font-mono bg-indigo-50 px-2 py-1 rounded text-indigo-700 border border-indigo-100">DTMF: {activeCall.dtmf_responses}</span>}
                            </div>
                        </div>
                        <div className="bg-gray-950 text-gray-100 font-mono text-[11px] p-4 h-64 overflow-y-auto">
                            {logs.map((log, i) => (
                                <div key={i} className="flex gap-2 mb-1 opacity-80 hover:opacity-100">
                                    <span className="text-gray-500 shrink-0">{new Date(log.timestamp || Date.now()).toLocaleTimeString()}</span>
                                    <span>{logIcon(log.message || '')}</span>
                                    <span className={log.message?.includes('digit') ? 'text-yellow-400' : ''}>{log.message}</span>
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                )}
            </div>

            <div className="bg-white shadow sm:rounded-lg overflow-hidden h-fit max-h-[85vh] flex flex-col">
                <div className="px-4 py-4 border-b border-gray-200 bg-gray-50">
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-widest">Call History</h3>
                </div>
                <div className="overflow-y-auto divide-y divide-gray-100">
                    {history.map(call => (
                        <button key={call.id} onClick={() => handleSelectHistory(call)} className={`w-full text-left p-4 hover:bg-indigo-50/30 transition-all ${activeCall?.id === call.id ? 'bg-indigo-50 border-l-4 border-indigo-600' : ''}`}>
                            <div className="flex justify-between items-start mb-1">
                                <span className="text-sm font-bold font-mono text-gray-900">{call.phone}</span>
                                <span className="text-[10px] text-gray-400">{new Date(call.created_at).toLocaleDateString()}</span>
                            </div>
                            <div className="flex items-center gap-2 mb-1">
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase ${STATUS_COLORS[call.status] || 'bg-gray-100'}`}>{call.status}</span>
                                {call.duration_seconds > 0 && <span className="text-[9px] text-gray-400 font-bold">{call.duration_seconds}s</span>}
                            </div>
                            {call.dtmf_responses && <div className="text-[10px] font-mono text-indigo-600 font-bold">DTMF: {call.dtmf_responses}</div>}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
