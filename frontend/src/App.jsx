import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import CampaignDetails from './pages/CampaignDetails';
import SingleCallPage from './pages/SingleCallPage';
import TemplateManagerPage from './pages/TemplateManagerPage';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-100">
        <nav className="bg-white shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <span className="text-xl font-bold text-indigo-600">Voice Marketing</span>
              <div className="flex gap-6">
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) =>
                    `text-sm font-medium ${isActive ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`
                  }
                >
                  Campaigns
                </NavLink>
                <NavLink
                  to="/calls"
                  className={({ isActive }) =>
                    `text-sm font-medium ${isActive ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`
                  }
                >
                  Single Call
                </NavLink>
                <NavLink
                  to="/templates"
                  className={({ isActive }) =>
                    `text-sm font-medium ${isActive ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`
                  }
                >
                  Templates
                </NavLink>
              </div>
            </div>
          </div>
        </nav>

        <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/campaigns/:id" element={<CampaignDetails />} />
            <Route path="/calls" element={<SingleCallPage />} />
            <Route path="/templates" element={<TemplateManagerPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
