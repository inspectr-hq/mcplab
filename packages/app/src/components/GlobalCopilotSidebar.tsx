import { GlobalCopilotController } from '@/components/global-copilot/GlobalCopilotController';

export {
  globalCopilotToolDisplayName,
  globalCopilotToolLabel
} from '@/lib/global-copilot-message';

/** App-layout entry point for the Global Copilot. */
export function GlobalCopilotSidebar() {
  return <GlobalCopilotController />;
}
