import { installProxyFetch } from './proxyFetch.mjs';
import { runStdioPluginWorker } from '@vibex/plugin-sdk/stdio';
import definition from './worker.mjs';

installProxyFetch();

await runStdioPluginWorker(definition);
