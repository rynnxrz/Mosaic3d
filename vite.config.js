import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl'; // You might not need this if ngrok handles HTTPS
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/mosaic3d/',
  plugins: [
    // basicSsl(), // If ngrok handles HTTPS, you can comment this out for simplicity when using ngrok
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['vite.svg', 'icon-192.png', 'icon-512.png'], // Ensure these are relative to public
      manifest: {
        name: 'mod3d App',
        short_name: 'mod3d',
        description: 'A 3D web app with PWA support.',
        theme_color: '#18181C',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'icon-192.png', // Relative to public
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512.png', // Relative to public
            sizes: '512x512',
            type: 'image/png'
          }
        ],
        start_url: '/mosaic3d/',
        scope: '/mosaic3d/'
      }
    })
  ],
  server: { // This is for `npm run dev`
    host: true,
    // https: true // If using basicSsl() for dev
  },
  preview: { // <<--- ADD THIS SECTION (or modify if it exists)
    host: true, // Allows access from network IPs (good for ngrok)
    // https: true, // If you want `vite preview` itself to serve HTTPS (requires certs, can be complex)
                  // Often not needed if ngrok provides the outer HTTPS layer.
    allowedHosts: [
      'd53b-152-37-69-194.ngrok-free.app' // <<--- ADD YOUR NGROK HOSTNAME HERE
      // You can also add 'localhost', or other specific IPs if needed
    ]
  }
});