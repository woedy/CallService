import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';

const STATUS_COLORS = {
    draft: 'bg-gray-100 text-gray-800',
    running: 'bg-green-100 text-green-800',
    paused: 'bg-yellow-100 text-yellow-800',
    completed: 'bg-blue-100 text-blue-800',
};

export default function Dashboard() {
    const [campaigns, setCampaigns] = useState([]);
    const [name, setName] = useState('');
    const [callerId, setCallerId] = useState('');
    const [audioFile, setAudioFile] = useState(null);
    const [audioFileReprompt, setAudioFileReprompt] = useState(null);
    const [audioFileTimeout, setAudioFileTimeout] = useState(null);
    const [audioFileGoodbye, setAudioFileGoodbye] = useState(null);
    const [audioFilePress1, setAudioFilePress1] = useState(null);
    const [audioFilePress2, setAudioFilePress2] = useState(null);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => { fetchCampaigns(); }, []);

    const fetchCampaigns = async () => {
        try {
            const res = await api.get('/campaigns/');
            setCampaigns(res.data);
        } catch {
            setError('Failed to load campaigns');
        }
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!name || !audioFile) return;
        setCreating(true);
        setError('');
        const formData = new FormData();
        formData.append('name', name);
        if (callerId) formData.append('caller_id', callerId);
        formData.append('audio_file', audioFile);
        if (audioFileReprompt) formData.append('audio_file_reprompt', audioFileReprompt);
        if (audioFileTimeout) formData.append('audio_file_timeout', audioFileTimeout);
        if (audioFileGoodbye) formData.append('audio_file_goodbye', audioFileGoodbye);
        if (audioFilePress1) formData.append('audio_file_press1', audioFilePress1);
        if (audioFilePress2) formData.append('audio_file_press2', audioFilePress2);
        try {
            await api.post('/campaigns/', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            setName('');
            setCallerId('');
            setAudioFile(null);
            setAudioFileReprompt(null);
            setAudioFileTimeout(null);
            setAudioFileGoodbye(null);
            setAudioFilePress1(null);
            setAudioFilePress2(null);
            fetchCampaigns();
        } catch (err) {
            setError(err.response?.data?.detail || 'Failed to create campaign');
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Create Campaign */}
            <div className="bg-white shadow px-4 py-5 sm:rounded-lg sm:p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Create Campaign</h3>
                {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
                <form onSubmit={handleCreate} className="space-y-4">
                    <div>
                        <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                            Campaign Name
                        </label>
                        <input
                            type="text"
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            className="mt-1 block w-full sm:max-w-sm border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                        />
                    </div>
                    <div>
                        <label htmlFor="callerId" className="block text-sm font-medium text-gray-700">
                            Caller ID (optional)
                        </label>
                        <input
                            type="text"
                            id="callerId"
                            value={callerId}
                            onChange={(e) => setCallerId(e.target.value)}
                            placeholder="e.g. My Company <8001234567>"
                            className="mt-1 block w-full sm:max-w-sm border border-gray-300 rounded-md shadow-sm px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                        />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Main Greeting File</label>
                            <input
                                type="file"
                                accept=".wav,.gsm,.mp3,.ulaw,.alaw"
                                onChange={(e) => setAudioFile(e.target.files[0])}
                                required
                                className="mt-1 block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Reprompt File (optional)</label>
                            <input
                                type="file"
                                accept=".wav,.gsm,.mp3,.ulaw,.alaw"
                                onChange={(e) => setAudioFileReprompt(e.target.files[0])}
                                className="mt-1 block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Timeout File (optional)</label>
                            <input
                                type="file"
                                accept=".wav,.gsm,.mp3,.ulaw,.alaw"
                                onChange={(e) => setAudioFileTimeout(e.target.files[0])}
                                className="mt-1 block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Goodbye File (optional)</label>
                            <input
                                type="file"
                                accept=".wav,.gsm,.mp3,.ulaw,.alaw"
                                onChange={(e) => setAudioFileGoodbye(e.target.files[0])}
                                className="mt-1 block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Press 1 File (optional)</label>
                            <input
                                type="file"
                                accept=".wav,.gsm,.mp3,.ulaw,.alaw"
                                onChange={(e) => setAudioFilePress1(e.target.files[0])}
                                className="mt-1 block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Press 2 File (optional)</label>
                            <input
                                type="file"
                                accept=".wav,.gsm,.mp3,.ulaw,.alaw"
                                onChange={(e) => setAudioFilePress2(e.target.files[0])}
                                className="mt-1 block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                            />
                        </div>
                    </div>
                    <button type="submit" disabled={creating} className="btn-primary">
                        {creating ? 'Creating...' : 'Create Campaign'}
                    </button>
                </form>
            </div>

            {/* Campaign List */}
            <div className="bg-white shadow overflow-hidden sm:rounded-md">
                <div className="px-4 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-medium text-gray-900">Campaigns</h3>
                </div>
                {campaigns.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-gray-500">No campaigns yet. Create one above.</p>
                ) : (
                    <ul className="divide-y divide-gray-200">
                        {campaigns.map((campaign) => (
                            <li key={campaign.id}>
                                <Link to={`/campaigns/${campaign.id}`} className="block hover:bg-gray-50">
                                    <div className="px-4 py-4 flex items-center justify-between">
                                        <p className="text-sm font-medium text-indigo-600">{campaign.name}</p>
                                        <div className="flex items-center gap-3">
                                            <p className="text-xs text-gray-400">
                                                {new Date(campaign.created_at).toLocaleDateString()}
                                            </p>
                                            <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${STATUS_COLORS[campaign.status] || 'bg-gray-100 text-gray-800'}`}>
                                                {campaign.status}
                                            </span>
                                        </div>
                                    </div>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
