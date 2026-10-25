import {defineConfig} from 'vitest/config';

// The integration files share the database selected by the test runner.
// Startup reconciliation in one file must not close a voice session in another.
export default defineConfig({test:{fileParallelism:false}});
