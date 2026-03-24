import React, { useEffect, useState } from 'react';
import api from '../api';

export default function TemplateManagerPage() {
  const [categories, setCategories] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [tplName, setTplName] = useState('');
  const [tplCategory, setTplCategory] = useState('');
  const [tplAudio, setTplAudio] = useState(null);
  const [tplActive, setTplActive] = useState(true);
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');

  const fetchCategories = async () => {
    const res = await api.get('/template-categories/?page_size=100');
    setCategories(res.data.results || []);
  };

  const fetchTemplates = async (nextPage = page) => {
    const res = await api.get(`/audio-templates/?page=${nextPage}`);
    setTemplates(res.data.results || []);
    setCount(res.data.count || 0);
    setPage(nextPage);
  };

  useEffect(() => {
    fetchCategories().catch(() => setError('Failed to load categories'));
    fetchTemplates(1).catch(() => setError('Failed to load templates'));
  }, []);

  const handleCreateCategory = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/template-categories/', { name: catName, description: catDesc, is_active: true });
      setCatName('');
      setCatDesc('');
      await fetchCategories();
    } catch {
      setError('Failed to create category');
    }
  };

  const handleDeleteCategory = async (id) => {
    if (!window.confirm('Delete this category?')) return;
    try {
      await api.delete(`/template-categories/${id}/`);
      await fetchCategories();
    } catch {
      setError('Failed to delete category');
    }
  };

  const handleCreateTemplate = async (e) => {
    e.preventDefault();
    if (!tplCategory || !tplAudio || !tplName) return;
    setError('');
    const formData = new FormData();
    formData.append('name', tplName);
    formData.append('category', tplCategory);
    formData.append('greeting_audio', tplAudio);
    formData.append('is_active', String(tplActive));

    try {
      await api.post('/audio-templates/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setTplName('');
      setTplCategory('');
      setTplAudio(null);
      setTplActive(true);
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
        <p className="text-sm text-gray-500">Create categories and upload question greeting templates with preview support.</p>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white shadow sm:rounded-lg px-4 py-5 sm:p-6">
          <h3 className="text-md font-semibold text-gray-900 mb-3">Create Category</h3>
          <form onSubmit={handleCreateCategory} className="space-y-3">
            <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="e.g. Cars" required className="w-full border rounded px-3 py-2 text-sm" />
            <textarea value={catDesc} onChange={(e) => setCatDesc(e.target.value)} placeholder="Description (optional)" className="w-full border rounded px-3 py-2 text-sm" />
            <button className="btn-primary" type="submit">Add Category</button>
          </form>

          <div className="mt-5 space-y-2">
            {categories.map((cat) => (
              <div key={cat.id} className="border rounded p-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{cat.name}</p>
                  <p className="text-xs text-gray-500">{cat.template_count || 0} template(s)</p>
                </div>
                <button onClick={() => handleDeleteCategory(cat.id)} className="text-xs text-red-600 hover:underline">Delete</button>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white shadow sm:rounded-lg px-4 py-5 sm:p-6">
          <h3 className="text-md font-semibold text-gray-900 mb-3">Create Audio Template</h3>
          <form onSubmit={handleCreateTemplate} className="space-y-3">
            <input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Template Name" required className="w-full border rounded px-3 py-2 text-sm" />
            <select value={tplCategory} onChange={(e) => setTplCategory(e.target.value)} required className="w-full border rounded px-3 py-2 text-sm">
              <option value="">Select Category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
            <input type="file" accept=".wav,.gsm,.mp3,.ulaw,.alaw" onChange={(e) => setTplAudio(e.target.files?.[0] || null)} required className="w-full text-xs" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={tplActive} onChange={(e) => setTplActive(e.target.checked)} /> Active
            </label>
            <button className="btn-primary" type="submit">Upload Template</button>
          </form>
        </div>
      </div>

      <div className="bg-white shadow sm:rounded-lg px-4 py-5 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-md font-semibold text-gray-900">Templates</h3>
          <p className="text-xs text-gray-500">Page {page} of {totalPages}</p>
        </div>

        <div className="space-y-3">
          {templates.map((tpl) => (
            <div key={tpl.id} className="border rounded p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-sm">{tpl.name}</p>
                  <p className="text-xs text-gray-500">Category: {tpl.category_name}</p>
                  <p className="text-xs text-gray-500">Status: {tpl.is_active ? 'Active' : 'Inactive'}</p>
                </div>
                <button onClick={() => handleDeleteTemplate(tpl.id)} className="text-xs text-red-600 hover:underline">Delete</button>
              </div>
              {tpl.greeting_audio_url && (
                <audio controls className="mt-3 w-full" preload="none">
                  <source src={tpl.greeting_audio_url} />
                </audio>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <button disabled={page <= 1} onClick={() => fetchTemplates(page - 1)} className="btn-secondary">Previous</button>
          <button disabled={page >= totalPages} onClick={() => fetchTemplates(page + 1)} className="btn-secondary">Next</button>
        </div>
      </div>
    </div>
  );
}
