import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api, { WS_BASE } from '../api';

const STATUS_COLORS = {
    draft: 'bg-gray-100 text-gray-800',
    running: 'bg-green-100 text-green-800',
    paused: 'bg-yellow-100 text-yellow-800',
    completed: 'bg-blue-100 text-blue-800',
};

const CONTACT_STATUS_COLORS = {
    pending: 'text-gray-500',
    dialing: 'text-blue-600',
    success: 'text-green-600',
    busy: 'text-yellow-600',
    no_answer: 'text-orange-500',
    failed: 'text-red-600',
};

export default function CampaignDetails() {
    const { id } = useParams();
    const [campaign, setCampaign] = useState(null);
    const [stats, setStats] = useState(null);
    const [contacts, setContacts] = useState([]);
    const [csvFile, setCsvFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const socketRef = useRef(null);

    const fetchCampaign = useCallback(async () => {
        const res = await api.get(`/campaigns/${id}/`);
        setCampaign(res.data);
    }, [id]);

    const fetchStats = useCallback(async () => {
        const res = await api.get(`/campaigns/${id}/stats/`);
        setStats(res.data);
    }, [id]);

    const fetchContacts = useCallback(async () => {
        const res = await api.get(`/campaigns/${id}/contacts/`);
        setContacts(res.data);
    }, [id]);

    useEffect(() => {
        fetchCampaign();
        fetchStats();
        fetchContacts();

        const socket = new WebSocket(`${WS_BASE}/ws/campaigns/`);
        socketRef.current = socket;

        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.type === 'campaign_update' && String(data.campaign_id) === String(id)) {
                setCampaign(prev => prev ? { ...prev, status: data.status } : prev);
            }

            if (data.type === 'contact_update' && String(data.campaign_id) === String(id)) {
                setContacts(prev =>
                    prev.map(c =>
                        String(c.id) === String(data.contact_id)
                            ? { ...c, status: data.status, dtmf_response: data.dtmf_response }
                            : c
                    )
                );
                // Refresh stats on any contact update
                fetchStats();
            }
        };

        socket.onerror = (e) => console.error('WebSocket error:', e);

        return () => socket.close();
    }, [id, fetchCampaign, fetchStats, fetchContacts]);

    const handleUploadCsv = async (e) => {
        e.preventDefault();
        if (!csvFile) return;
        setUploading(true);
        const formData = new FormData();
        formData.append('file', csvFile);
        try {
            const res = await api.post(`/campaigns/${id}/upload_contacts/`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            setCsvFile(null);
            alert(`Uploaded ${res.data.count} contacts`);
            fetchContacts();
            fetchStats();
        } catch (err) {
            alert('Upload failed');
        } finally {
            setUploading(false);
        }
    };

    const handleAction = async (action) => {
        try {
            await api.post(`/campaigns/${id}/${action}/`);
            fetchCampaign();
        } catch (err) {
            alert(err.response?.data?.error || `Failed to ${action} campaign`);
        }
    };

    if (!campaign) return <div className="p-6 text-gray-500">Loading...</div>;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-white shadow px-4 py-5 sm:rounded-lg sm:p-6">
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <div>
                        <Link to="/" className="text-sm text-indigo-500 hover:underline">← Back</Link>
                        <h2 className="text-2xl font-bold text-gray-900 mt-1">{campaign.name}</h2>
                        <span className={`mt-1 inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${STATUS_COLORS[campaign.status] || 'bg-gray-100 text-gray-800'}`}>
                            {campaign.status}
                        </span>
                    </div>
                    <div className="flex gap-2">
                        {campaign.status === 'draft' && (
                            <button onClick={() => handleAction('start')} className="btn-primary">
                                Start Campaign
                            </button>
                        )}
                        {campaign.status === 'running' && (
                            <>
                                <button onClick={() => handleAction('pause')} className="btn-secondary">
                                    Pause
                                </button>
                                <button onClick={() => handleAction('stop')} className="btn-danger">
                                    Stop
                                </button>
                            </>
                        )}
                        {campaign.status === 'paused' && (
                            <>
                                <button onClick={() => handleAction('resume')} className="btn-primary">
                                    Resume
                                </button>
                                <button onClick={() => handleAction('stop')} className="btn-danger">
                                    Stop
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Upload Contacts */}
            <div className="bg-white shadow px-4 py-5 sm:rounded-lg sm:p-6">
                <h3 className="text-lg font-medium text-gray-900">Upload Contacts (CSV)</h3>
                <p className="text-sm text-gray-500 mt-1">One phone number per line.</p>
                <form onSubmit={handleUploadCsv} className="mt-4 flex items-center gap-3">
                    <input
                        type="file"
                        accept=".csv"
                        onChange={(e) => setCsvFile(e.target.files[0])}
                        className="text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                    />
                    <button type="submit" disabled={uploading} className="btn-primary">
                        {uploading ? 'Uploading...' : 'Upload'}
                    </button>
                </form>
            </div>

            {/* Stats */}
            {stats && (
                <div className="bg-white shadow px-4 py-5 sm:rounded-lg sm:p-6">
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Real-time Stats</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {[
                            { label: 'Total', value: stats.total, color: 'text-gray-900' },
                            { label: 'Answered', value: stats.success, color: 'text-green-600' },
                            { label: 'Dialing', value: stats.dialing, color: 'text-blue-600' },
                            { label: 'Pending', value: stats.pending, color: 'text-gray-500' },
                            { label: 'Busy', value: stats.busy, color: 'text-yellow-600' },
                            { label: 'No Answer', value: stats.no_answer, color: 'text-orange-500' },
                            { label: 'Failed', value: stats.failed, color: 'text-red-600' },
                        ].map(({ label, value, color }) => (
                            <div key={label} className="bg-gray-50 rounded-lg p-4 text-center">
                                <p className="text-sm text-gray-500">{label}</p>
                                <p className={`text-3xl font-semibold mt-1 ${color}`}>{value}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Contacts Table */}
            {contacts.length > 0 && (
                <div className="bg-white shadow sm:rounded-lg overflow-hidden">
                    <div className="px-4 py-4 border-b border-gray-200">
                        <h3 className="text-lg font-medium text-gray-900">Contacts ({contacts.length})</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3 text-left font-medium text-gray-500">Phone</th>
                                    <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                                    <th className="px-4 py-3 text-left font-medium text-gray-500">DTMF</th>
                                    <th className="px-4 py-3 text-left font-medium text-gray-500">Attempts</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {contacts.map(contact => (
                                    <tr key={contact.id}>
                                        <td className="px-4 py-3 font-mono">{contact.phone}</td>
                                        <td className={`px-4 py-3 font-medium ${CONTACT_STATUS_COLORS[contact.status] || ''}`}>
                                            {contact.status}
                                        </td>
                                        <td className="px-4 py-3">{contact.dtmf_response || '—'}</td>
                                        <td className="px-4 py-3">{contact.attempt_count}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
