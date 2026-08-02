import { GlobalCopilotController } from '@/components/global-copilot/GlobalCopilotController';

export {
  globalCopilotToolDisplayName,
  globalCopilotToolLabel,
  storedGlobalCopilotFrontendAction
} from '@/components/global-copilot/GlobalCopilotController';

/** App-layout entry point for the Global Copilot. */
export function GlobalCopilotSidebar() {
  return <GlobalCopilotController />;
}
