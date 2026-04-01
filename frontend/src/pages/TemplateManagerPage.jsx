import React, { useEffect, useState, useCallback } from 'react';
import api from '../api';

export default function TemplateManagerPage() {
  const [categories, setCategories] = useState([]);
  const [activeTab, setActiveTab] = useState('audio_only');
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');

  const [templates, setTemplates] = useState([]);
  const [ttsTemplates, setTtsTemplates] = useState([]);
  
  // Audio Template Form State
  const [tplName, setTplName] = useState('');
  const [tplCategory, setTplCategory] = useState('');
  const [tplExpectedDigits, setTplExpectedDigits] = useState(4);
  const [tplAudio, setTplAudio] = useState(null);

  // Category Form State
  const [newCatName, setNewCatName] = useState('');
  const [newCatType, setNewCatType] = useState('greeting');

  // TTS Script Template Form State
  const [editingTtsId, setEditingTtsId] = useState(null);
  const [ttsTplName, setTtsTplName] = useState('');
  const [ttsStages, setTtsStages] = useState({
      greeting_script: '',
      press1_script: '',
      press2_script: '',
      reprompt_script: '',
      timeout_script: '',
      validate_script: '',
      goodbye_script: '',
  });
  const [ttsOnholdAudio, setTtsOnholdAudio] = useState(null);
  const [ttsExpectedDigits, setTtsExpectedDigits] = useState(4);
  const [previewTtsId, setPreviewTtsId] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(null); // stores stage id or template id

  const fetchCategories = useCallback(async () => {
    try {
      const res = await api.get('/template-categories/?mode=audio_only&category_type=greeting&page_size=100');
      setCategories(res.data.results || []);
    } catch { setError('Failed to load categories'); }
  }, []);

  const fetchTemplates = useCallback(async (nextPage = page, mode = activeTab) => {
    try {
      if (mode === 'audio_only') {
          const res = await api.get(`/audio-templates/?page=${nextPage}&mode=${mode}`);
          setTemplates(res.data.results || []);
          setCount(res.data.count || 0);
      } else {
          const res = await api.get(`/tts-script-templates/?page=${nextPage}`);
          setTtsTemplates(res.data.results || []);
          setCount(res.data.count || 0);
      }
      setPage(nextPage);
    } catch { setError('Failed to load templates'); }
  }, [page, activeTab]);

  useEffect(() => {
    if (activeTab === 'audio_only') fetchCategories();
    fetchTemplates(1, activeTab);
  }, [activeTab, fetchCategories, fetchTemplates]);

  const handlePreviewTts = async (script, identifier) => {
    if (!script) return;
    setPreviewLoading(identifier);
    try {
        const res = await api.post('/tts-preview/', { script });
        const audio = new Audio(res.data.url);
        audio.play();
    } catch { 
        setError('Synthesis preview failed'); 
    } finally {
        setPreviewLoading(null);
    }
  };

  const handleCreateCategory = async (e) => {
    e.preventDefault();
    try {
      await api.post('/template-categories/', { name: newCatName, mode: 'audio_only', category_type: newCatType });
      setNewCatName('');
      fetchCategories();
    } catch { setError('Failed to create category'); }
  };

  const handleCreateTemplate = async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('name', tplName);
    formData.append('mode', 'audio_only');
    formData.append('category', tplCategory);
    formData.append('expected_digits', String(tplExpectedDigits));
    if (tplAudio) formData.append('greeting_audio', tplAudio);

    try {
      await api.post('/audio-templates/', formData);
      setTplName('');
      setTplAudio(null);
      fetchTemplates(1);
    } catch { setError('Failed to create template'); }
  };

  const handleSaveTtsTemplate = async (e) => {
    e.preventDefault();
    if (!ttsTplName) return;
    
    const formData = new FormData();
    formData.append('name', ttsTplName);
    formData.append('expected_digits', String(ttsExpectedDigits));
    Object.keys(ttsStages).forEach(key => {
        formData.append(key, ttsStages[key]);
    });
    if (ttsOnholdAudio) formData.append('onhold_audio', ttsOnholdAudio);

    try {
        if (editingTtsId) {
            await api.patch(`/tts-script-templates/${editingTtsId}/`, formData);
        } else {
            await api.post('/tts-script-templates/', formData);
        }
        resetTtsForm();
        fetchTemplates(1);
    } catch { setError('Failed to save TTS template'); }
  };

  const resetTtsForm = () => {
    setEditingTtsId(null);
    setTtsTplName('');
    setTtsStages({
        greeting_script: '',
        press1_script: '',
        press2_script: '',
        reprompt_script: '',
        timeout_script: '',
        validate_script: '',
        goodbye_script: '',
    });
    setTtsOnholdAudio(null);
    setTtsExpectedDigits(4);
  };

  const startEditTts = (tpl) => {
    setEditingTtsId(tpl.id);
    setTtsTplName(tpl.name);
    setTtsStages({
        greeting_script: tpl.greeting_script || '',
        press1_script: tpl.press1_script || '',
        press2_script: tpl.press2_script || '',
        reprompt_script: tpl.reprompt_script || '',
        timeout_script: tpl.timeout_script || '',
        validate_script: tpl.validate_script || '',
        goodbye_script: tpl.goodbye_script || '',
    });
    setTtsExpectedDigits(tpl.expected_digits || 4);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteTemplate = async (id, mode = activeTab) => {
    if (!window.confirm('Delete this template?')) return;
    try {
      const endpoint = mode === 'audio_only' ? '/audio-templates/' : '/tts-script-templates/';
      await api.delete(`${endpoint}${id}/`);
      fetchTemplates(page);
    } catch { setError('Failed to delete template'); }
  };

  const totalPages = Math.max(1, Math.ceil(count / 10));

  return (
    <div className="space-y-6">
      <div className="bg-white shadow sm:rounded-lg px-4 py-5 sm:p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-1">Audio & TTS Template Manager</h2>
        
        <div className="flex border-b mb-4">
            {[
                { id: 'audio_only', label: 'Audio Only' },
                { id: 'tts_script', label: 'TTS Script Templates' }
            ].map((tab) => (
                <button
                    key={tab.id}
                    onClick={() => { setActiveTab(tab.id); resetTtsForm(); }}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === tab.id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                >
                    {tab.label}
                </button>
            ))}
        </div>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </div>

      {activeTab === 'audio_only' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white shadow sm:rounded-lg px-4 py-5 sm:p-6">
                <h3 className="text-md font-semibold text-gray-900 mb-3">Audio Categories</h3>
                <form onSubmit={handleCreateCategory} className="space-y-3">
                    <input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder="Category name..." required className="w-full border rounded px-3 py-2 text-sm" />
                    <div className="flex gap-2">
                        <select value={newCatType} onChange={(e) => setNewCatType(e.target.value)} className="flex-1 border rounded px-2 py-2 text-sm">
                            <option value="greeting">Main Greeting</option>
                            <option value="press1">Press 1 Prompt</option>
                            <option value="press2">Press 2 Prompt</option>
                        </select>
                        <button className="btn-primary flex-1" type="submit">Create</button>
                    </div>
                </form>
                <div className="mt-5 space-y-2">
                    {categories.map((cat) => (
                        <div key={cat.id} className="border rounded p-3 flex items-center justify-between">
                            <span className="text-sm font-medium">{cat.name} ({cat.category_type.toUpperCase()})</span>
                            <button onClick={() => api.delete(`/template-categories/${cat.id}/`).then(() => fetchCategories())} className="text-xs text-red-600">Delete</button>
                        </div>
                    ))}
                </div>
            </div>

            <div className="bg-white shadow sm:rounded-lg px-4 py-5 sm:p-6">
                <h3 className="text-md font-semibold text-gray-900 mb-3">Create Audio Template</h3>
                <form onSubmit={handleCreateTemplate} className="space-y-4">
                    <input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Template Name" required className="w-full border rounded px-3 py-2 text-sm" />
                    <select value={tplCategory} onChange={(e) => setTplCategory(e.target.value)} required className="w-full border rounded px-3 py-2 text-sm">
                        <option value="">Select Category</option>
                        {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                    </select>
                    <input type="file" accept=".wav,.gsm,.mp3" onChange={(e) => setTplAudio(e.target.files?.[0] || null)} required className="text-xs" />
                    <button className="btn-primary w-full" type="submit">Create Template</button>
                </form>
            </div>
        </div>
      ) : (
        <div className="bg-white shadow sm:rounded-lg px-4 py-5 sm:p-6">
            <h3 className="text-md font-semibold text-gray-900 mb-3 text-indigo-700">{editingTtsId ? 'Edit' : 'Create'} TTS Script Template</h3>
            <form onSubmit={handleSaveTtsTemplate} className="space-y-4">
                <div className="flex gap-4">
                    <input value={ttsTplName} onChange={(e) => setTtsTplName(e.target.value)} placeholder="Script Template Name" required className="flex-1 border rounded px-3 py-2 text-sm font-bold border-indigo-200" />
                    <div className="flex items-center gap-2 border rounded px-3 py-2 bg-indigo-50 border-indigo-200">
                        <label className="text-xs font-bold text-gray-500 uppercase">Digits:</label>
                        <input type="number" value={ttsExpectedDigits} onChange={(e) => setTtsExpectedDigits(parseInt(e.target.value))} min="1" max="10" className="w-16 border rounded px-2 py-1 text-sm font-bold text-indigo-600" />
                    </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                        { id: 'greeting_script', label: '1. Greeting' },
                        { id: 'press1_script', label: '2. Press 1 (Digits)' },
                        { id: 'press2_script', label: '2. Press 2 (Agent)' },
                        { id: 'reprompt_script', label: '3. Reprompt' },
                        { id: 'timeout_script', label: '3. Timeout' },
                        { id: 'validate_script', label: '4. Validate/Wait' },
                        { id: 'goodbye_script', label: '5. Goodbye' },
                    ].map(stage => (
                        <div key={stage.id} className="relative">
                            <div className="flex justify-between items-center mb-1">
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{stage.label}</label>
                                <button
                                    type="button"
                                    disabled={!ttsStages[stage.id] || previewLoading === stage.id}
                                    onClick={() => handlePreviewTts(ttsStages[stage.id], stage.id)}
                                    className="text-[9px] font-bold text-indigo-600 hover:text-indigo-800 disabled:opacity-30 flex items-center gap-1"
                                >
                                    {previewLoading === stage.id ? 'Synthesizing...' : '🔊 Preview Voice'}
                                </button>
                            </div>
                            <textarea 
                                value={ttsStages[stage.id]} 
                                onChange={(e) => setTtsStages({...ttsStages, [stage.id]: e.target.value})} 
                                placeholder={`Script for ${stage.label}...`}
                                className="w-full border rounded px-3 py-2 text-sm focus:ring-1 focus:ring-indigo-500"
                                rows={2}
                            />
                        </div>
                    ))}
                    <div>
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">6. On Hold Music (.wav)</label>
                        <input type="file" accept=".wav" onChange={(e) => setTtsOnholdAudio(e.target.files?.[0] || null)} className="w-full text-xs mt-1 border rounded px-2 py-2 h-[52px]" />
                        <p className="text-[9px] text-gray-400 mt-1 italic">Optional. Replaces the default on-hold music.</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    {editingTtsId && <button type="button" onClick={resetTtsForm} className="btn-secondary flex-1 py-3 font-bold border-2">Cancel Edit</button>}
                    <button className="btn-primary flex-2 py-3 font-bold shadow-md hover:shadow-lg transform transition-all active:scale-95" type="submit">
                        {editingTtsId ? 'Update Template' : 'Save New Template'}
                    </button>
                </div>
            </form>
        </div>
      )}

      <div className="bg-white shadow sm:rounded-lg px-4 py-5 sm:p-6">
        <h3 className="text-md font-semibold text-gray-900 mb-4 border-b pb-2">Configured Templates</h3>
        <div className="grid grid-cols-1 gap-4">
          {activeTab === 'audio_only' ? (
              templates.map((tpl) => (
                <div key={tpl.id} className="border rounded-lg p-4 bg-gray-50 flex justify-between items-center">
                  <div>
                    <p className="font-bold text-gray-900">{tpl.name}</p>
                    <p className="text-[10px] font-mono text-indigo-600 uppercase italic">{tpl.category_name}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    {tpl.greeting_audio_url && <audio controls className="h-8 w-48" src={tpl.greeting_audio_url} />}
                    <button onClick={() => handleDeleteTemplate(tpl.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                  </div>
                </div>
              ))
          ) : (
              ttsTemplates.map((tpl) => (
                <div key={tpl.id} className="border rounded-lg bg-gray-50 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                  <div className="p-4 border-b bg-white flex justify-between items-center">
                    <div>
                      <p className="font-bold text-gray-900">{tpl.name}</p>
                      <p className="text-[9px] text-gray-500 font-mono">ID: {tpl.id} | Digits: {tpl.expected_digits}</p>
                    </div>
                    <div className="flex gap-3">
                      <button onClick={() => setPreviewTtsId(previewTtsId === tpl.id ? null : tpl.id)} className="text-xs text-indigo-600 font-bold hover:underline">
                        {previewTtsId === tpl.id ? 'Hide Preview' : 'Show Preview'}
                      </button>
                      <button onClick={() => startEditTts(tpl)} className="text-xs text-blue-600 font-bold hover:underline">Edit</button>
                      <button onClick={() => handleDeleteTemplate(tpl.id)} className="text-xs text-red-600 font-bold hover:underline">Delete</button>
                    </div>
                  </div>
                  
                  {previewTtsId === tpl.id && (
                    <div className="p-4 bg-indigo-50/50 grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-indigo-100">
                      {[
                        { id: `${tpl.id}_greeting`, label: 'Greeting', val: tpl.greeting_script },
                        { id: `${tpl.id}_press1`, label: 'Press 1', val: tpl.press1_script },
                        { id: `${tpl.id}_press2`, label: 'Press 2', val: tpl.press2_script },
                        { id: `${tpl.id}_reprompt`, label: 'Reprompt', val: tpl.reprompt_script },
                        { id: `${tpl.id}_timeout`, label: 'Timeout', val: tpl.timeout_script },
                        { id: `${tpl.id}_validate`, label: 'Validate', val: tpl.validate_script },
                        { id: `${tpl.id}_goodbye`, label: 'Goodbye', val: tpl.goodbye_script },
                      ].map(s => (
                        <div key={s.label} className="bg-white p-2 rounded border shadow-sm">
                          <div className="flex justify-between items-center mb-1">
                                <p className="text-[9px] font-bold text-gray-400 uppercase">{s.label}</p>
                                <button
                                    onClick={() => handlePreviewTts(s.val, s.id)}
                                    disabled={!s.val || previewLoading === s.id}
                                    className="text-[9px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                                >
                                    {previewLoading === s.id ? 'Synthesizing...' : '🔊 Play'}
                                </button>
                          </div>
                          <p className="text-xs text-gray-700 italic leading-relaxed">"{s.val || <span className="text-gray-300">Default script used</span>}"</p>
                        </div>
                      ))}
                      <div className="bg-white p-2 rounded border shadow-sm">
                        <p className="text-[9px] font-bold text-gray-400 uppercase mb-1">On Hold Music</p>
                        {tpl.onhold_audio_url ? (
                            <audio controls className="h-6 w-full mt-1" src={tpl.onhold_audio_url} />
                        ) : (
                            <p className="text-xs text-gray-300">System default music</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))
          )}
        </div>
        <div className="mt-6 flex justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn-secondary text-xs px-4">Previous</button>
          <span className="text-xs text-gray-500 py-1 font-bold">Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="btn-secondary text-xs px-4">Next</button>
        </div>
      </div>
    </div>
  );
}
