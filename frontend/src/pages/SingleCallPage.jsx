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
    const [note, setNote] = useState('');
    const [audioFile, setAudioFile] = useState(null);
    const [audioFileReprompt, setAudioFileReprompt] = useState(null);
    const [audioFileTimeout, setAudioFileTimeout] = useState(null);
    const [audioFileGoodbye, setAudioFileGoodbye] = useState(null);
    const [audioFileValidate, setAudioFileValidate] = useState(null);
    const [audioFilePress1, setAudioFilePress1] = useState(null);
    const [audioFilePress2, setAudioFilePress2] = useState(null);
    const [audioFileOnhold, setAudioFileOnhold] = useState(null);
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

    useEffect(() => {
        fetchHistory();
    }, [fetchHistory]);

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
        setDialing(true);
        setLogs([]);

        try {
            // Create the call record
            const formData = new FormData();
            formData.append('phone', phone);
            if (callerId) formData.append('caller_id', callerId);
            if (note) formData.append('note', note);
            if (audioFile) formData.append('audio_file', audioFile);
            if (audioFileReprompt) formData.append('audio_file_reprompt', audioFileReprompt);
            if (audioFileTimeout) formData.append('audio_file_timeout', audioFileTimeout);
            if (audioFileGoodbye) formData.append('audio_file_goodbye', audioFileGoodbye);
            if (audioFileValidate) formData.append('audio_file_validate', audioFileValidate);
            if (audioFilePress1) formData.append('audio_file_press1', audioFilePress1);
            if (audioFilePress2) formData.append('audio_file_press2', audioFilePress2);
            if (audioFileOnhold) formData.append('audio_file_onhold', audioFileOnhold);

            const res = await api.post('/single-calls/', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
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
        setNote(call.note || '');
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
                <div className="bg-white shadow sm:rounded-lg px-4 py-5 sm:p-6">
                    <h2 className="text-lg font-medium text-gray-900 mb-4">Place a Call</h2>
                    {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
                    <form onSubmit={handleDial} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Phone Number</label>
                                <input
                                    type="text"
                                    value={phone}
                                    onChange={e => setPhone(e.target.value)}
                                    placeholder="+1234567890 or 6001"
                                    required
                                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Caller ID (optional)</label>
                                <input
                                    type="text"
                                    value={callerId}
                                    onChange={e => setCallerId(e.target.value)}
                                    placeholder="e.g. My Company <8001234567>"
                                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Note (optional)</label>
                                <input
                                    type="text"
                                    value={note}
                                    onChange={e => setNote(e.target.value)}
                                    placeholder="e.g. Test call, Lead name..."
                                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 text-xs uppercase tracking-wider">
                                    Greeting Audio <span className="text-gray-400 font-normal lowercase">(optional)</span>
                                </label>
                                <input
                                    type="file"
                                    accept=".wav,.gsm,.mp3,.ulaw,.alaw"
                                    onChange={e => setAudioFile(e.target.files[0])}
                                    className="mt-1 block w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 text-xs uppercase tracking-wider">
                                    Reprompt Audio <span className="text-gray-400 font-normal lowercase">(optional)</span>
                                </label>
                                <input
                                    type="file"
                                    accept=".wav,.gsm,.mp3,.ulaw,.alaw"
                                    onChange={e => setAudioFileReprompt(e.target.files[0])}
                                    className="mt-1 block w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 text-xs uppercase tracking-wider">
                                    Timeout Audio <span className="text-gray-400 font-normal lowercase">(optional)</span>
                                </label>
                                <input
                                    type="file"
                                    accept=".wav,.gsm,.mp3,.ulaw,.alaw"
                                    onChange={e => setAudioFileTimeout(e.target.files[0])}
                                    className="mt-1 block w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 text-xs uppercase tracking-wider">
                                    Goodbye Audio <span className="text-gray-400 font-normal lowercase">(optional)</span>
                                </label>
                                <input
                                    type="file"
                                    accept=".wav,.gsm,.mp3,.ulaw,.alaw"
                                    onChange={e => setAudioFileGoodbye(e.target.files[0])}
                                    className="mt-1 block w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 text-xs uppercase tracking-wider">
                                    Validate Code Audio <span className="text-gray-400 font-normal lowercase">(optional)</span>
                                </label>
                                <input
                                    type="file"
                                    accept=".wav,.gsm,.mp3,.ulaw,.alaw"
                                    onChange={e => setAudioFileValidate(e.target.files[0])}
                                    className="mt-1 block w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 text-xs uppercase tracking-wider">
                                    Press 1 Audio <span className="text-gray-400 font-normal lowercase">(optional)</span>
                                </label>
                                <input
                                    type="file"
                                    accept=".wav,.gsm,.mp3,.ulaw,.alaw"
                                    onChange={e => setAudioFilePress1(e.target.files[0])}
                                    className="mt-1 block w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 text-xs uppercase tracking-wider">
                                    Press 2 Audio <span className="text-gray-400 font-normal lowercase">(optional)</span>
                                </label>
                                <input
                                    type="file"
                                    accept=".wav,.gsm,.mp3,.ulaw,.alaw"
                                    onChange={e => setAudioFilePress2(e.target.files[0])}
                                    className="mt-1 block w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 text-xs uppercase tracking-wider">
                                    OnHold Audio <span className="text-gray-400 font-normal lowercase">(optional)</span>
                                </label>
                                <input
                                    type="file"
                                    accept=".wav,.gsm,.mp3,.ulaw,.alaw"
                                    onChange={e => setAudioFileOnhold(e.target.files[0])}
                                    className="mt-1 block w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                                />
                            </div>
                        </div>
                        <p className="mt-2 text-[10px] text-gray-400 italic">
                            Leave blank to use default system voices for those events.
                        </p>
                        <div className="flex gap-3">
                            <button type="submit" disabled={dialing || isActive} className="btn-primary">
                                {dialing ? 'Placing call...' : '📞 Dial'}
                            </button>
                            {activeCall && !isActive && (
                                <button type="button" onClick={handleRedial} className="btn-secondary">
                                    🔄 Redial
                                </button>
                            )}
                        </div>
                    </form>
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
