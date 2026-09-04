import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://pozerkalam.space',
  output: 'static',
  build: { format: 'directory' },
});
