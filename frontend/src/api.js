import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';
export const WS_BASE = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';

const api = axios.create({
    baseURL: API_BASE,
});

export default api;
