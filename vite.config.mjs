import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({root:path.join(root,'renderer'),base:'./',plugins:[react(),tailwind()],resolve:{dedupe:['react','react-dom']},build:{outDir:path.join(root,'ui'),emptyOutDir:true,sourcemap:false}});
