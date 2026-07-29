import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const fastApiTarget = env.VITE_FASTAPI_URL || 'https://paybue-quee.hnhsofttechsolutions.com';

  return {
    plugins: [
      tailwindcss(),
      react()
    ],
    optimizeDeps: {
      include: ['xlsx-js-style'],
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api-fast': {
          target: fastApiTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-fast/, ''),
          headers: {
            'ngrok-skip-browser-warning': 'true',
          }
        },
        '/api-sendgrid': {
          target: 'https://api.sendgrid.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-sendgrid/, ''),
        }
      }
    }
  };
})
