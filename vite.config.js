// vite.config.js
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl'; // 如果 ngrok 处理 HTTPS，可以注释掉这个
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/mosaic3d/',
  plugins: [
    // basicSsl(), // 如果 ngrok 处理 HTTPS，为了简单起见，在使用 ngrok 时可以注释掉这一行
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['vite.svg', 'icon-192.png', 'icon-512.png'], // 确保这些路径相对于 public 文件夹
      manifest: {
        name: 'mod3d App',
        short_name: 'mod3d',
        description: 'A 3D web app with PWA support.',
        theme_color: '#18181C',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'icon-192.png', // 相对于 public
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512.png', // 相对于 public
            sizes: '512x512',
            type: 'image/png'
          }
        ],
        start_url: '/mosaic3d/',
        scope: '/mosaic3d/'
      }
    })
  ],
  server: { // 这个配置块用于 `npm run dev`
    host: true,
    // https: true // 如果你使用 basicSsl() 进行开发
    allowedHosts: ['.ngrok-free.app'] // <--- 主要修改这里！使用方法一
  },
  preview: { // 这个配置块用于 `vite preview`
    host: true,
    allowedHosts: [
      // 你可以保留之前的特定 ngrok 域名，或者也改成通用的设置
      // '770b-152-37-69-194.ngrok-free.app', // 这是你之前为 preview 添加的特定 ngrok 域名
      '.ngrok-free.app' // <--- 如果你也希望 `vite preview` 通用，可以这样修改
    ]
    // https: true, // 如果你希望 `vite preview` 本身也提供 HTTPS (需要证书，可能比较复杂)
                  // 如果 ngrok 提供了外层的 HTTPS，这里通常不需要
  }
});