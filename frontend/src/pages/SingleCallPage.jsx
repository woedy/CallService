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

function FileUploadField({ label, onChange }) {
    return (
        <div>
            <label className="block text-sm font-medium text-gray-700 text-xs uppercase tracking-wider">
                {label} <span className="text-gray-400 font-normal lowercase">(optional)</span>
            </label>
            <input
                type="file"
                accept=".wav,.gsm,.mp3,.ulaw,.alaw"
                onChange={e => onChange(e.target.files?.[0] || null)}
                className="mt-1 block w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
            />
        </div>
    );
}

export default function SingleCallPage() {
    const [phone, setPhone] = useState('');
    const [callerId, setCallerId] = useState('');
    const [recipientName, setRecipientName] = useState('');
    const [note, setNote] = useState('');
    
    // Template selection
    const [templateCategories, setTemplateCategories] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState('');
    const [templates, setTemplates] = useState([]);
    const [selectedTemplate, setSelectedTemplate] = useState('');
    const [press1Templates, setPress1Templates] = useState([]);
    const [selectedPress1Template, setSelectedPress1Template] = useState('');
    const [activeTab, setActiveTab] = useState('audio_only');

    const [activeCall, setActiveCall] = useState(null);   // current call object
    const [logs, setLogs] = useState([]);
    const [history, setHistory] = useState([]);
    const [dialing, setDialing] = useState(false);
    const [error, setError] = useState('');
    const socketRef = useRef(null);
    const logsEndRef = useRef(null);

    // Auto-scroll log panel
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const fetchHistory = useCallback(async () => {
        try {
            const res = await api.get('/single-calls/');
            setHistory(res.data);
        } catch {
            // silently fail
        }
    }, []);

    const fetchCategories = useCallback(async (mode) => {
        try {
            const res = await api.get(`/template-categories/?mode=${mode}&page_size=100`);
            setTemplateCategories(res.data.results || []);
        } catch {
            setError('Failed to load categories');
        }
    }, []);

    const fetchTemplates = useCallback(async (catId, mode) => {
        if (!catId) {
            setTemplates([]);
            return;
        }
        try {
            const res = await api.get(`/audio-templates/?category=${catId}&mode=${mode}&page_size=100`);
            setTemplates(res.data.results || []);
        } catch {
            setError('Failed to load templates');
        }
    }, []);

    const fetchPress1Templates = useCallback(async () => {
        try {
            // Use the new backend filter for category_type
            const res = await api.get('/audio-templates/?category_type=press1&page_size=100');
            setPress1Templates(res.data.results || []);
        } catch {
            console.error('Failed to load press1 templates');
        }
    }, []);

    useEffect(() => {
        fetchHistory();
    }, [fetchHistory]);

    useEffect(() => {
        fetchCategories(activeTab);
        fetchPress1Templates();
        setSelectedCategory('');
        setTemplates([]);
        setSelectedTemplate('');
        setSelectedPress1Template('');
    }, [activeTab, fetchCategories, fetchPress1Templates]);

    useEffect(() => {
        fetchTemplates(selectedCategory, activeTab);
    }, [selectedCategory, activeTab, fetchTemplates]);

    // Auto-select Press 1 template matching expected_digits
    useEffect(() => {
        if (selectedTemplate && press1Templates.length > 0) {
            const tpl = templates.find(t => String(t.id) === String(selectedTemplate));
            if (tpl) {
                const match = press1Templates.find(p => p.expected_digits === tpl.expected_digits);
                if (match) setSelectedPress1Template(match.id);
            }
        }
    }, [selectedTemplate, templates, press1Templates]);

    const connectWebSocket = useCallback((callId) => {
        if (socketRef.current) socketRef.current.close();

        const ws = new WebSocket(`${WS_BASE}/ws/calls/${callId}/`);
        socketRef.current = ws;

        ws.onmessage = (e) => {
            const data = JSON.parse(e.data);
            setLogs(prev => [...prev, data]);
            // Update active call status from WS
            if (data.status || data.dtmf_responses !== undefined || data.duration_seconds !== undefined) {
                setActiveCall(prev => prev ? {
                    ...prev,
                    status: data.status ?? prev.status,
                    dtmf_responses: data.dtmf_responses ?? prev.dtmf_responses,
                    duration_seconds: data.duration_seconds ?? prev.duration_seconds,
                } : prev);
            }
            // Refresh history when call ends
            if (['completed', 'failed', 'busy', 'no_answer'].includes(data.status)) {
                fetchHistory();
            }
        };

        ws.onerror = () => setError('WebSocket error — live logs may not update');
    }, [fetchHistory]);

    const handleDial = async (e) => {
        e.preventDefault();
        setError('');
        if (!phone || !selectedTemplate) {
            setError('Phone number and Template are required.');
            return;
        }
        setDialing(true);
        setLogs([]);

        try {
            // Create the call record
            const formData = new FormData();
            formData.append('phone', phone);
            if (callerId) formData.append('caller_id', callerId);
            if (recipientName) formData.append('recipient_name', recipientName);
            if (note) formData.append('note', note);
            formData.append('selected_template', selectedTemplate);
            if (selectedPress1Template) formData.append('press1_template', selectedPress1Template);

            const res = await api.post('/single-calls/', formData);
            const call = res.data;
            setActiveCall(call);

            // Connect WS before dialing so we don't miss early events
            connectWebSocket(call.id);

            // Trigger the dial
            await api.post(`/single-calls/${call.id}/dial/`);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to place call');
        } finally {
            setDialing(false);
        }
    };

    const handleRedial = async () => {
        if (!activeCall) return;
        setError('');
        setLogs([]);
        try {
            connectWebSocket(activeCall.id);
            await api.post(`/single-calls/${activeCall.id}/dial/`);
        } catch (err) {
            setError(err.response?.data?.error || 'Redial failed');
        }
    };

    const handleReprompt = async () => {
        if (!activeCall) return;
        try {
            await api.post(`/single-calls/${activeCall.id}/reprompt/`);
        } catch (err) {
            setError(err.response?.data?.error || 'Reprompt failed');
        }
    };

    const handleHangup = async () => {
        if (!activeCall) return;
        try {
            await api.post(`/single-calls/${activeCall.id}/hangup/`);
        } catch (err) {
            setError(err.response?.data?.error || 'Hangup failed');
        }
    };

    const handleConnectAgent = async () => {
        if (!activeCall) return;
        try {
            await api.post(`/single-calls/${activeCall.id}/connect_agent/`);
        } catch (err) {
            setError(err.response?.data?.error || 'Connect agent failed');
        }
    };

    const handleSelectHistory = async (call) => {
        setActiveCall(call);
        setLogs([]);
        setPhone(call.phone);
        setCallerId(call.caller_id || '');
        setRecipientName(call.recipient_name || '');
        setNote(call.note || '');
        // Note: selected_template might need to be resolved if we want to show it in the dropdown
        if (call.selected_template) {
           // We might need to fetch categories/templates if not present
           setSelectedTemplate(call.selected_template);
        }
        
        try {
            const res = await api.get(`/single-calls/${call.id}/logs/`);
            // Convert stored logs to display format
            setLogs(res.data.map(l => ({
                message: l.message,
                timestamp: l.timestamp,
                status: null,
                raw_event: l.raw_event,
            })));
        } catch {
            // ignore
        }
        connectWebSocket(call.id);
    };

    const isActive = activeCall && ['dialing', 'ringing', 'answered'].includes(activeCall.status);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Left — Dial form + active call */}
            <div className="lg:col-span-2 space-y-6">

                {/* Dial form */}
                <div className="bg-white shadow sm:rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                        <h2 className="text-md font-bold text-gray-800 uppercase tracking-tight">Single Call Terminal</h2>
                        <div className="flex gap-1 bg-gray-200 p-1 rounded-lg">
                            {['audio_only', 'tts_script'].map(m => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => setActiveTab(m)}
                                    className={`text-[9px] font-bold px-3 py-1 rounded-md transition-all uppercase ${activeTab === m ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    {m.replace('_', ' ')}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="px-4 py-5 sm:p-6">
                        {/* Mode Instruction Bar */}
                        <div className="mb-6 p-3 bg-indigo-50 border-l-4 border-indigo-400 rounded-r-md">
                            <p className="text-xs text-indigo-700 leading-relaxed font-medium">
                                {activeTab === 'audio_only' && "📂 AUDIO ONLY: Standard IVR. Select a template with pre-recorded audio assets and digit logic."}
                                {activeTab === 'tts_script' && "📜 TTS SCRIPT: Full Script mode. Plays the entire script as TTS and hangs up immediately (no digits)."}
                            </p>
                        </div>

                        {error && <p className="text-sm text-red-600 mb-4 bg-red-50 border border-red-100 px-3 py-2 rounded-md">{error}</p>}
                        
                        <form onSubmit={handleDial} className="space-y-6">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                {/* Left Side: Destination */}
                                <div className="space-y-4">
                                    <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest border-b pb-1">Destination</h4>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-600">Phone Number*</label>
                                        <input
                                            type="text"
                                            value={phone}
                                            onChange={e => setPhone(e.target.value)}
                                            placeholder="+1234567890"
                                            required
                                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-600">Recipient Name</label>
                                        <input
                                            type="text"
                                            value={recipientName}
                                            onChange={e => setRecipientName(e.target.value)}
                                            placeholder="e.g. Cynthia Morgan"
                                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-600">Caller ID / Company Name</label>
                                        <input
                                            type="text"
                                            value={callerId}
                                            onChange={e => setCallerId(e.target.value)}
                                            placeholder="e.g. QuiQuesh Company"
                                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                        />
                                    </div>
                                </div>

                                {/* Right Side: Template Selection */}
                                <div className="space-y-4">
                                    <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest border-b pb-1">Flow Configuration</h4>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-600">Feature Category*</label>
                                        <select
                                            value={selectedCategory}
                                            onChange={e => setSelectedCategory(e.target.value)}
                                            required
                                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                        >
                                            <option value="">Select a Category</option>
                                            {templateCategories.filter(cat => cat.category_type === 'greeting').map(cat => (
                                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-600">Select Template*</label>
                                        <select
                                            value={selectedTemplate}
                                            onChange={e => setSelectedTemplate(e.target.value)}
                                            required
                                            disabled={!selectedCategory}
                                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-50"
                                        >
                                            <option value="">Select a Template</option>
                                            {templates.map(tpl => (
                                                <option key={tpl.id} value={tpl.id}>
                                                    {tpl.name} ({tpl.mode.replace('_',' ').toUpperCase()})
                                                </option>
                                            ))}
                                        </select>
                                        {selectedTemplate && (
                                            <p className="mt-1 text-[10px] text-indigo-500 font-bold uppercase">
                                                Expected Digits: {templates.find(t => String(t.id) === String(selectedTemplate))?.expected_digits}
                                            </p>
                                        )}
                                    </div>
                                    {activeTab === 'audio_only' && (
                                        <div>
                                            <label className="block text-xs font-semibold text-gray-600">Digit Prompt (Press 1)*</label>
                                            <select
                                                value={selectedPress1Template}
                                                onChange={e => setSelectedPress1Template(e.target.value)}
                                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                            >
                                                <option value="">System Default (TTS)</option>
                                                {press1Templates.map(tpl => (
                                                    <option key={tpl.id} value={tpl.id}>
                                                        {tpl.name} ({tpl.expected_digits} Digits)
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-600">Call Note</label>
                                        <input
                                            type="text"
                                            value={note}
                                            onChange={e => setNote(e.target.value)}
                                            placeholder="e.g. Lead verification"
                                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between border-t pt-5">
                                <p className="text-[10px] text-gray-400 italic">
                                    System will automatically pull audio assets and logic from the selected template.
                                </p>
                                <button type="submit" disabled={dialing || isActive} className={`btn-primary px-8 py-2.5 rounded-full shadow-lg transform transition-all active:scale-95 ${dialing || isActive ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105'}`}>
                                    {dialing ? 'DIALING...' : isActive ? 'CALL IN PROGRESS' : '🚀 START CALL'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                {/* Active call status + live log */}
                {activeCall && (
                    <div className="bg-white shadow sm:rounded-lg overflow-hidden">
                        <div className="px-4 py-4 border-b border-gray-200 flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-gray-900 font-mono">{activeCall.phone}</p>
                                {activeCall.note && <p className="text-xs text-gray-400">{activeCall.note}</p>}
                            </div>
                            <div className="flex items-center gap-3">
                                {isActive && (
                                    <>
                                        <button
                                            onClick={handleReprompt}
                                            className="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1 rounded-md font-medium transition-colors border border-red-200"
                                            title="Force caller to re-enter DTMF code"
                                        >
                                            🛑 Invalid Code
                                        </button>
                                        <button
                                            onClick={handleConnectAgent}
                                            className="text-xs bg-green-100 hover:bg-green-200 text-green-700 px-3 py-1 rounded-md font-medium transition-colors border border-green-200"
                                            title="Connect caller to agent (dials 6002)"
                                        >
                                            🎧 Connect Agent
                                        </button>
                                        <button
                                            onClick={handleHangup}
                                            className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded-md font-medium transition-colors border border-gray-300"
                                            title="End active call"
                                        >
                                            📞 End Call
                                        </button>
                                    </>
                                )}
                                {activeCall.dtmf_responses && (
                                    <span className="text-sm text-gray-600">
                                        DTMF: <span className="font-mono font-semibold">{activeCall.dtmf_responses}</span>
                                    </span>
                                )}
                                <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${STATUS_COLORS[activeCall.status] || 'bg-gray-100 text-gray-600'}`}>
                                    {activeCall.status}
                                </span>
                            </div>
                        </div>

                        {/* Live log */}
                        <div className="bg-gray-950 text-gray-100 font-mono text-xs p-4 h-72 overflow-y-auto">
                            {logs.length === 0 ? (
                                <p className="text-gray-500">Waiting for events...</p>
                            ) : (
                                logs.map((log, i) => (
                                    <div key={i} className="flex gap-2 mb-1.5">
                                        <span className="text-gray-500 shrink-0">
                                            {log.timestamp
                                                ? new Date(log.timestamp).toLocaleTimeString()
                                                : new Date().toLocaleTimeString()}
                                        </span>
                                        <span className="shrink-0">{logIcon(log.message || '')}</span>
                                        <span className={
                                            log.message?.includes('DTMF') ? 'text-yellow-300' :
                                            log.message?.includes('answered') ? 'text-green-400' :
                                            log.message?.includes('ended') ? 'text-gray-400' :
                                            'text-gray-100'
                                        }>
                                            {log.message}
                                        </span>
                                    </div>
                                ))
                            )}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                )}
            </div>

            {/* Right — Call history */}
            <div className="bg-white shadow sm:rounded-lg overflow-hidden h-fit">
                <div className="px-4 py-4 border-b border-gray-200">
                    <h3 className="text-sm font-medium text-gray-900">Call History</h3>
                </div>
                {history.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-gray-400">No calls yet.</p>
                ) : (
                    <ul className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
                        {history.map(call => (
                            <li key={call.id}>
                                <button
                                    onClick={() => handleSelectHistory(call)}
                                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${activeCall?.id === call.id ? 'bg-indigo-50' : ''}`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-mono font-medium text-gray-900">{call.phone}</span>
                                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[call.status] || 'bg-gray-100 text-gray-600'}`}>
                                            {call.status}
                                        </span>
                                    </div>
                                    {call.note && <p className="text-xs text-gray-400 mt-0.5 truncate">{call.note}</p>}
                                    <div className="flex items-center gap-2 mt-1">
                                        <p className="text-xs text-gray-400">
                                            {new Date(call.created_at).toLocaleString()}
                                        </p>
                                        {call.dtmf_responses && (
                                            <span className="text-xs text-indigo-500 font-mono">
                                                DTMF: {call.dtmf_responses}
                                            </span>
                                        )}
                                        {call.duration_seconds && (
                                            <span className="text-xs text-gray-400">{call.duration_seconds}s</span>
                                        )}
                                    </div>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

        </div>
    );
}
