import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'SyncNos-AI+Web Clipper (WXT)',
    description:
      'Clip AI chats to local storage, export to JSON or Markdown, and sync to Notion on demand.',
  },
});

