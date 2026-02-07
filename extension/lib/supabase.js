// Cliente de Supabase para Chrome Extension
// Este cliente comparte la sesión con el Dashboard Web mediante cookies
// Configuración centralizada en lib/config.js (cargado antes que este archivo)

// Almacenamiento de sesión usando chrome.storage.local
class SupabaseAuthStorage {
  async getItem(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] || null);
      });
    });
  }

  async setItem(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => {
        resolve();
      });
    });
  }

  async removeItem(key) {
    return new Promise((resolve) => {
      chrome.storage.local.remove([key], () => {
        resolve();
      });
    });
  }
}

// Cliente de Supabase simplificado para extensión
class SupabaseClient {
  constructor() {
    this.url = CONFIG.SUPABASE_URL;
    this.key = CONFIG.SUPABASE_ANON_KEY;
    this.storage = new SupabaseAuthStorage();
  }

  async getSession() {
    try {
      const sessionData = await this.storage.getItem('supabase.auth.token');
      if (!sessionData) return null;
      
      const session = JSON.parse(sessionData);
      
      // Verificar si el token expiró
      if (session.expires_at && session.expires_at < Date.now() / 1000) {
        await this.storage.removeItem('supabase.auth.token');
        return null;
      }
      
      return session;
    } catch (error) {
      console.error('Error al obtener sesión:', error);
      return null;
    }
  }

  async setSession(session) {
    if (!session) {
      await this.storage.removeItem('supabase.auth.token');
      return;
    }
    await this.storage.setItem('supabase.auth.token', JSON.stringify(session));
  }

  async syncSessionFromDashboard() {
    try {
      // Llamar al endpoint del Dashboard que verifica la sesión
      const response = await fetch(CONFIG.API.AUTH_SESSION, {
        method: 'GET',
        credentials: 'include', // Incluye cookies automáticamente
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error('Error en respuesta del servidor:', response.status);
        return null;
      }

      const data = await response.json();

      if (data.session && data.user) {
        // Guardar la sesión en el storage local de la extensión
        await this.setSession(data.session);
        return data.session;
      }

      return null;
    } catch (error) {
      console.error('Error sincronizando sesión desde Dashboard:', error);
      return null;
    }
  }

  async signOut() {
    await this.storage.removeItem('supabase.auth.token');
  }

  // Método para hacer requests autenticados
  async fetch(endpoint, options = {}) {
    const session = await this.getSession();
    const headers = {
      'apikey': this.key,
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    return fetch(`${this.url}${endpoint}`, {
      ...options,
      headers
    });
  }
}

// Exportar instancia única
const supabase = new SupabaseClient();
