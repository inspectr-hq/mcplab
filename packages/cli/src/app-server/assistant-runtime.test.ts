import { assistantRuntimeContract } from '../../test-support/assistant-runtime-contract.js';
import { createNativeAssistantRuntimeFactory } from './assistant-runtime.js';

assistantRuntimeContract('native assistant runtime', createNativeAssistantRuntimeFactory);
