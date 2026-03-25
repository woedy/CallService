import React, { useEffect, useState } from 'react';
import api from '../api';

export default function TemplateManagerPage() {
  const [categories, setCategories] = useState([]);
  const [activeTab, setActiveTab] = useState('audio_only');
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');

  const [templates, setTemplates] = useState([]);
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');
  
  // Template Form State
  const [tplName, setTplName] = useState('');
  const [tplCategory, setTplCategory] = useState('');
  const [tplMode, setTplMode] = useState('audio_only');
  const [tplGreetingScript, setTplGreetingScript] = useState('');
  const [tplExpectedDigits, setTplExpectedDigits] = useState(4);
  const [tplAudio, setTplAudio] = useState(null);
  const [tplActive, setTplActive] = useState(true);

  // Category Form State
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [newCatType, setNewCatType] = useState('greeting');

  const fetchCategories = async (mode = activeTab) => {
    try {
      const res = await api.get(`/template-categories/?mode=${mode}&page_size=100`);
      setCategories(res.data.results || []);
    } catch {
      setError('Failed to load categories');
    }
  };

  const fetchTemplates = async (nextPage = page, mode = activeTab) => {
    try {
      const res = await api.get(`/audio-templates/?page=${nextPage}&mode=${mode}`);
      setTemplates(res.data.results || []);
      setCount(res.data.count || 0);
      setPage(nextPage);
    } catch {
      setError('Failed to load templates');
    }
  };

  useEffect(() => {
    fetchCategories(activeTab);
    fetchTemplates(1, activeTab);
    // Reset selections on tab change
    setTplCategory('');
    setTplMode(activeTab);
  }, [activeTab]);

  const handleCreateCategory = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/template-categories/', { 
        name: newCatName, 
        description: newCatDesc, 
        mode: activeTab,
        category_type: newCatType,
        is_active: true 
      });
      setNewCatName('');
      setNewCatDesc('');
      setNewCatType('greeting');
      await fetchCategories(activeTab);
    } catch {
      setError('Failed to create category');
    }
  };

  const handleDeleteCategory = async (id) => {
    if (!window.confirm('Delete this category?')) return;
    try {
      await api.delete(`/template-categories/${id}/`);
      await fetchCategories(activeTab);
    } catch {
      setError('Failed to delete category');
    }
  };

  const handleCreateTemplate = async (e) => {
    e.preventDefault();
    if (!tplCategory || !tplName) return;
    setError('');
    
    const formData = new FormData();
    formData.append('name', tplName);
    formData.append('mode', tplMode);
    formData.append('category', tplCategory);
    formData.append('is_active', String(tplActive));
    formData.append('expected_digits', String(tplExpectedDigits));

    // Mode-specific fields
    if (tplMode === 'tts_script' && tplGreetingScript) formData.append('greeting_script', tplGreetingScript);

    // Audio files
    if (tplAudio) formData.append('greeting_audio', tplAudio);

    try {
      await api.post('/audio-templates/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // Reset
      setTplName('');
      // setTplPromptText(''); // Removed tts_template related state reset
      setTplGreetingScript('');
      e.target.reset(); 
      setTplAudio(null);
      
      await fetchTemplates(1);
    } catch {
      setError('Failed to create template');
    }
  };

  const handleDeleteTemplate = async (id) => {
    if (!window.confirm('Delete this template?')) return;
    try {
      await api.delete(`/audio-templates/${id}/`);
      await fetchTemplates(page);
    } catch {
      setError('Failed to delete template');
    }
  };

  const totalPages = Math.max(1, Math.ceil(count / 10));

  return (
    <div className="space-y-6">
      <div className="bg-white shadow sm:rounded-lg px-4 py-5 sm:p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-1">Audio Template Manager</h2>
        <p className="text-sm text-gray-500 mb-4">Configure your call flows across Audio, TTS + Template, and Custom Script modes.</p>
        
        <div className="flex border-b mb-4">
            {[
                { id: 'audio_only', label: 'Audio Only' },
                // { id: 'tts_template', label: 'TTS Template' }, // Removed tts_template tab
                { id: 'tts_script', label: 'TTS Script' }
            ].map((tab) => (
                <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === tab.id 
                        ? 'border-indigo-600 text-indigo-600' 
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                >
                    {tab.label}
                </button>
            ))}
        </div>

        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Categories Section */}
        <div className="bg-white shadow sm:rounded-lg px-4 py-5 sm:p-6">
          <h3 className="text-md font-semibold text-gray-900 mb-3">Feature Categories</h3>
          <p className="text-xs text-gray-400 mb-4 italic">Organize templates by feature like "Single Call".</p>
          <form onSubmit={handleCreateCategory} className="space-y-3">
            <input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} placeholder={`New ${activeTab.replace('_',' ')} category name...`} required className="w-full border rounded px-3 py-2 text-sm" />
            <textarea value={newCatDesc} onChange={(e) => setNewCatDesc(e.target.value)} placeholder="Description (optional)" className="w-full border rounded px-3 py-2 text-sm" />
            <div className="flex gap-2">
                <select
                  value={newCatType}
                  onChange={(e) => setNewCatType(e.target.value)}
                  className="flex-1 border rounded px-2 py-2 text-sm"
                >
                  <option value="greeting">Main Greeting</option>
                  <option value="press1">Press 1 Prompt</option>
                </select>
                <button className="btn-primary flex-1" type="submit">Create Category</button>
            </div>
          </form>

          <div className="mt-5 space-y-2">
            {categories.map((cat) => (
              <div key={cat.id} className="border rounded p-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{cat.name}</p>
                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${cat.category_type === 'press1' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                      {cat.category_type === 'press1' ? 'Digit Prompt' : 'Greeting'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">{cat.template_count || 0} template(s)</p>
                </div>
                <button onClick={() => handleDeleteCategory(cat.id)} className="text-xs text-red-600 hover:underline">Delete</button>
              </div>
            ))}
          </div>
        </div>

        {/* Template Creation Section */}
        <div className="bg-white shadow sm:rounded-lg px-4 py-5 sm:p-6">
          <h3 className="text-md font-semibold text-gray-900 mb-3">Create New Template</h3>
          
          {/* Template mode is now driven by category selection */}
          <div className="mb-4">
            <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">
              Mode: {tplMode.replace('_', ' ').toUpperCase()}
            </span>
          </div>

          <form onSubmit={handleCreateTemplate} id="tpl-form" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Friendly Template Name" required className="col-span-1 border rounded px-3 py-2 text-sm" />
              <select value={tplCategory} onChange={(e) => setTplCategory(e.target.value)} required className="col-span-1 border rounded px-3 py-2 text-sm">
                <option value="">Select Category</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name} ({cat.category_type === 'press1' ? 'Digit Prompt' : 'Greeting'})
                  </option>
                ))}
              </select>
            </div>

            {/* Removed tts_template prompt text input */}
            {/* {tplMode === 'tts_template' && (
              <textarea
                value={tplPromptText}
                onChange={(e) => setTplPromptText(e.target.value)}
                placeholder="TTS Prompt Text (e.g., 'Please enter your {digits} digit PIN')"
                className="w-full border rounded px-3 py-2 text-sm"
                rows={2}
              />
            )} */}

            {tplMode !== 'tts_script' && (
              <div className="flex items-center gap-4 border rounded px-3 py-2 bg-gray-50">
                <label className="text-xs font-medium text-gray-500 uppercase">Expected Digits:</label>
                <input 
                  type="number" 
                  value={tplExpectedDigits} 
                  onChange={(e) => setTplExpectedDigits(parseInt(e.target.value) || 1)} 
                  min="1" max="10" 
                  className="w-16 border rounded px-2 py-1 text-sm" 
                />
              </div>
            )}

            {tplMode === 'tts_script' && (
              <textarea
                value={tplGreetingScript}
                onChange={(e) => setTplGreetingScript(e.target.value)}
                placeholder="Full custom greeting script..."
                className="w-full border rounded px-3 py-2 text-sm"
                rows={4}
              />
            )}

            <div className="grid grid-cols-2 gap-4">
              {(tplMode === 'audio_only') && (
                <div className="col-span-2">
                   <label className="text-[10px] uppercase font-bold text-gray-400">Greeting Audio (Main)</label>
                   <input type="file" accept=".wav,.gsm,.mp3" onChange={(e) => setTplAudio(e.target.files?.[0] || null)} required className="w-full text-xs mt-1" />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t pt-4">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={tplActive} onChange={(e) => setTplActive(e.target.checked)} /> Active
              </label>
              <button className="btn-primary" type="submit">Create Template</button>
            </div>
          </form>
        </div>
      </div>

      <div className="bg-white shadow sm:rounded-lg px-4 py-5 sm:p-6">
        <h3 className="text-md font-semibold text-gray-900 mb-4">Configured Templates</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map((tpl) => (
            <div key={tpl.id} className="border rounded-lg p-4 bg-gray-50 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-bold text-gray-900">{tpl.name}</p>
                    <p className="text-[10px] font-mono text-indigo-600 uppercase">{tpl.mode?.replace('_',' ')}</p>
                  </div>
                  <button onClick={() => handleDeleteTemplate(tpl.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                </div>
                <p className="text-xs text-gray-500 mb-2">Category: {tpl.category_name}</p>
                {/* Removed tts_template prompt text display */}
                {/* {tpl.mode === 'tts_template' && tpl.prompt_text && (
                  <p className="text-xs text-gray-700 bg-white p-2 border rounded italic mb-3">"{tpl.prompt_text}"</p>
                )} */}
                {tpl.mode === 'tts_script' && tpl.greeting_script && (
                  <p className="text-xs text-gray-700 bg-white p-2 border rounded italic mb-3">"{tpl.greeting_script}"</p>
                )}
                <div className="space-y-2 mt-4">
                        {tpl.greeting_audio_url && (
                            <div>
                                <p className="text-[9px] text-gray-400 font-bold uppercase">Greeting</p>
                                <audio controls className="w-full h-8 mt-1" src={tpl.greeting_audio_url} />
                            </div>
                        )}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex gap-2">
          <button disabled={page <= 1} onClick={() => fetchTemplates(page - 1)} className="btn-secondary">Previous</button>
          <button disabled={page >= totalPages} onClick={() => fetchTemplates(page + 1)} className="btn-secondary">Next</button>
        </div>
      </div>
    </div>
  );
}
